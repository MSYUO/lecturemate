/**
 * @file core/JobScheduler.ts
 * LectureMate — 백그라운드 작업 스케줄러 (Section Phase 3)
 *
 * ## 역할
 * 1. **우선순위 스케줄링**: stt-realtime > 현재 세션 postprocess > 백그라운드 postprocess
 * 2. **STT Worker 단일화**: Whisper(400MB)는 메모리 제약으로 동시 실행 불가 — 직렬 처리
 * 3. **녹음-후처리 인터리빙**:
 *    - 녹음 시작 → 진행 중 postprocess는 finish 후 다음 큐 처리 중단 (자연스러운 멈춤)
 *    - 녹음 종료 → OPFS에서 청크 목록 읽어 postprocess 배치 자동 등록 + tick()
 * 4. **자동 재시도**: 실패 시 지수 백오프(2s × 재시도 횟수)로 최대 3회 재시도
 *
 * ## STT 후처리 결과 처리
 * - isPostProcess=true 결과만 이 스케줄러가 수신
 * - 세그먼트를 IndexedDB에 저장 (실시간 결과와 병존; 향후 교체 로직 추가 가능)
 *
 * ## 싱글톤 사용
 * ```typescript
 * import { jobScheduler } from '@/core/JobScheduler'
 * jobScheduler.init()   // App.tsx useEffect
 * ```
 */

import { preWarming } from '@/core/PreWarmingManager'
import { opfs } from '@/core/OPFSStorage'
import { useSessionStore } from '@/stores/sessionStore'
import { useJobQueueStore } from '@/stores/jobQueueStore'
import { db } from '@/db/schema'
import type { Job, SttWorkerInMessage, SttWorkerOutMessage, SttSegment } from '@/types'

// ============================================================
// 상수
// ============================================================

const MAX_RETRIES     = 3
const RETRY_BASE_MS   = 2_000
const WORKER_ATTACH_INTERVAL_MS = 500
const WORKER_ATTACH_MAX_RETRIES = 20   // 10초

// ============================================================
// 우선순위 계산
// ============================================================

/**
 * 작업 우선순위를 숫자로 반환합니다. 높을수록 먼저 실행됩니다.
 *
 * stt-realtime (3) > stt-postprocess 현재 세션 (2) > 그 외 (1)
 */
function jobPriority(job: Job, currentSessionId: string | null): number {
  if (job.type === 'stt-realtime') return 3
  if (
    (job.type === 'stt-postprocess' || job.type === 'pdf-index') &&
    job.sessionId === currentSessionId
  ) return 2
  return 1
}

// ============================================================
// JobScheduler
// ============================================================

export class JobScheduler {

  /** 새 녹음이 시작돼 후처리 큐 처리를 멈춘 상태 */
  private paused          = false
  /** 현재 작업을 실행 중 (tick 중복 방지) */
  private isRunning       = false

  /**
   * 후처리 결과를 기다리는 Promise 콜백.
   * key = chunkIndex (Whisper result의 chunkIndex와 매칭)
   */
  private pendingCallbacks = new Map<number, {
    resolve:   () => void
    reject:    (e: Error) => void
    sessionId: string
  }>()

  /** sessionStore 구독 해제 함수 */
  private unsubSessionStore: (() => void) | null = null

  // ----------------------------------------------------------
  // 공개 API
  // ----------------------------------------------------------

  /**
   * 스케줄러를 초기화합니다.
   *
   * - sessionStore 구독 (녹음 상태 변화 감지)
   * - STT Worker 메시지 핸들러 부착 (Worker 미준비 시 lazy-retry)
   * - DB에서 미완료 작업 복구 후 tick()
   *
   * App.tsx의 useEffect에서 한 번만 호출하세요.
   */
  init(): void {
    this.setupSessionSubscription()
    this.attachWorkerHandlerLazy()

    useJobQueueStore.getState()
      .recoverPendingJobs()
      .then(() => this.tick())
      .catch((err) => console.error('[JobScheduler] 초기 복구 실패:', err))
  }

  /**
   * 큐에서 다음 실행 가능한 작업을 골라 시작합니다.
   *
   * - paused=true (녹음 중) → 즉시 반환
   * - isRecording=true → 즉시 반환
   * - 이미 실행 중 → 즉시 반환
   * - pending 작업 없음 → 즉시 반환
   */
  tick(): void {
    if (this.paused || this.isRunning) return
    if (useSessionStore.getState().isRecording) return

    const store         = useJobQueueStore.getState()
    const { sessionId } = useSessionStore.getState()
    const pending       = store.getPendingJobs()

    if (pending.length === 0) return

    // 우선순위 내림차순 정렬 후 첫 번째 선택
    const next = [...pending].sort(
      (a, b) => jobPriority(b, sessionId) - jobPriority(a, sessionId),
    )[0]

    this.runJob(next).catch((err) =>
      console.error('[JobScheduler] runJob 예외:', err),
    )
  }

  /**
   * ResourceManager에서 호출 — 코딩 모드 전환 시 후처리 큐 일시 정지.
   * 녹음 일시정지(paused)와 동일 플래그를 공유합니다.
   */
  pauseQueue(): void {
    this.paused = true
  }

  /**
   * ResourceManager에서 호출 — 코딩 모드 종료 후 후처리 큐 재개.
   * 녹음 중이면 tick()이 isRecording 을 보고 다시 멈추므로 안전합니다.
   */
  resumeQueue(): void {
    this.paused = false
    if (!this.isRunning) this.tick()
  }

  /**
   * 스케줄러를 정리합니다.
   * 앱 언마운트 또는 테스트 정리 시 호출하세요.
   */
  dispose(): void {
    this.unsubSessionStore?.()
    this.unsubSessionStore = null
    this.pendingCallbacks.clear()
  }

  // ----------------------------------------------------------
  // 녹음 상태 핸들러
  // ----------------------------------------------------------

  private setupSessionSubscription(): void {
    let prevIsRecording = useSessionStore.getState().isRecording

    this.unsubSessionStore = useSessionStore.subscribe((state) => {
      if (state.isRecording === prevIsRecording) return
      prevIsRecording = state.isRecording

      if (state.isRecording) {
        this.onRecordingStart()
      } else {
        this.onRecordingStop(state.sessionId)
      }
    })
  }

  private onRecordingStart(): void {
    // 진행 중인 후처리를 중단 (현재 Whisper 추론은 자연스럽게 완료)
    // isRunning=true 상태면 그 작업이 끝난 후 tick()이 isRecording을 보고 중단
    this.paused = true
    console.info('[JobScheduler] 녹음 시작 — postprocess 중단')
  }

  private onRecordingStop(sessionId: string | null): void {
    this.paused = false
    console.info('[JobScheduler] 녹음 종료 — postprocess 큐 등록')

    if (!sessionId) {
      this.tick()
      return
    }

    // OPFS의 청크 목록을 읽어 후처리 작업 일괄 등록
    this.enqueuePostprocessBatch(sessionId)
      .then(() => this.tick())
      .catch((err) => {
        console.error('[JobScheduler] postprocess 등록 실패:', err)
        this.tick()
      })
  }

  /**
   * 세션의 모든 오디오 청크에 대해 stt-postprocess 작업을 일괄 등록합니다.
   * 이미 큐에 있는 청크(pending/active/done)는 건너뜁니다.
   */
  private async enqueuePostprocessBatch(sessionId: string): Promise<void> {
    let chunkIndices: number[]
    try {
      chunkIndices = await opfs.listAudioChunks(sessionId)
    } catch {
      chunkIndices = []
    }

    if (chunkIndices.length === 0) return

    const store      = useJobQueueStore.getState()
    const existingSet = new Set(
      store.jobs
        .filter(
          (j) =>
            j.sessionId === sessionId &&
            j.type      === 'stt-postprocess' &&
            j.status    !== 'failed',
        )
        .map((j) => (j.payload as { chunkIndex: number }).chunkIndex),
    )

    for (const chunkIndex of chunkIndices) {
      if (existingSet.has(chunkIndex)) continue
      await store.enqueue({
        type:      'stt-postprocess',
        sessionId,
        payload:   { chunkIndex },
      })
    }

    console.info(
      `[JobScheduler] postprocess 등록: ${chunkIndices.length}청크 ` +
      `(신규 ${chunkIndices.length - existingSet.size}건)`,
    )
  }

  // ----------------------------------------------------------
  // 작업 실행
  // ----------------------------------------------------------

  private async runJob(job: Job): Promise<void> {
    this.isRunning   = true
    useJobQueueStore.getState().start(job.id)

    try {
      switch (job.type) {
        case 'stt-postprocess':
          await this.runSttPostprocess(job)
          break
        // stt-realtime: useStt 훅이 직접 처리 — 여기엔 오지 않음
        // pdf-index / export: Phase 4~6에서 구현
        default:
          console.warn('[JobScheduler] 미구현 작업 타입:', job.type)
      }

      useJobQueueStore.getState().complete(job.id)
      console.info(`[JobScheduler] 완료: ${job.type} #${job.id.slice(0, 6)}`)

    } catch (err) {
      const error = String(err)
      useJobQueueStore.getState().fail(job.id, error)
      console.error(`[JobScheduler] 실패: ${job.type} #${job.id.slice(0, 6)} —`, error)

      // 자동 재시도 (지수 백오프)
      const updatedJob = useJobQueueStore.getState().jobs.find((j) => j.id === job.id)
      if (updatedJob && updatedJob.retries < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * updatedJob.retries
        console.info(`[JobScheduler] ${delay}ms 후 재시도 (${updatedJob.retries}/${MAX_RETRIES})`)
        setTimeout(() => {
          // 재시도: failed → pending으로 되돌리고 tick
          useJobQueueStore.getState().pause(job.id)   // status → pending
          this.tick()
        }, delay)
      }

    } finally {
      this.isRunning   = false
      // 다음 작업 자동 시작 (녹음 중이 아닌 경우에만)
      if (!this.paused) this.tick()
    }
  }

  /**
   * stt-postprocess 작업 실행:
   * OPFS에서 PCM 읽기 → STT Worker 전송 → 결과 수신 → DB 저장
   */
  private async runSttPostprocess(job: Job): Promise<void> {
    const worker = preWarming.getSttWorker()
    if (!worker) throw new Error('STT Worker를 찾을 수 없습니다')

    const { chunkIndex } = job.payload as { chunkIndex: number }

    let pcmData: Float32Array
    try {
      pcmData = await opfs.readAudioChunk(job.sessionId, chunkIndex)
    } catch {
      throw new Error(`OPFS에서 청크 ${chunkIndex} 읽기 실패 (sessionId=${job.sessionId})`)
    }

    return new Promise<void>((resolve, reject) => {
      // 콜백 등록 — handleWorkerMessage에서 chunkIndex로 매칭
      this.pendingCallbacks.set(chunkIndex, { resolve, reject, sessionId: job.sessionId })

      worker.postMessage(
        {
          type:          'transcribe',
          chunkIndex,
          pcmData,
          isPostProcess: true,
        } satisfies SttWorkerInMessage,
        [pcmData.buffer],
      )
    })
  }

  // ----------------------------------------------------------
  // STT Worker 메시지 핸들러
  // ----------------------------------------------------------

  /**
   * STT Worker의 isPostProcess=true 결과를 수신합니다.
   * 실시간 결과(isPostProcess=false)는 useStt 훅이 처리합니다.
   */
  private handleWorkerMessage = (e: MessageEvent<SttWorkerOutMessage>): void => {
    const msg = e.data
    if (msg.type !== 'result' || !msg.isPostProcess) return

    const cb = this.pendingCallbacks.get(msg.chunkIndex)
    if (!cb) return
    this.pendingCallbacks.delete(msg.chunkIndex)

    const { sessionId } = cb
    const filled: SttSegment[] = msg.segments.map((s) => ({ ...s, sessionId }))

    if (filled.length === 0) {
      cb.resolve()
      return
    }

    db.sttSegments
      .bulkPut(filled)
      .then(() => cb.resolve())
      .catch((err) => cb.reject(err instanceof Error ? err : new Error(String(err))))
  }

  /**
   * STT Worker가 준비될 때까지 주기적으로 핸들러 부착을 시도합니다.
   * PreWarmingManager가 onmessage를 사용하므로 addEventListener로 공존합니다.
   */
  private attachWorkerHandlerLazy(): void {
    let retries = 0

    const tryAttach = (): boolean => {
      const worker = preWarming.getSttWorker()
      if (!worker) return false
      worker.addEventListener('message', this.handleWorkerMessage)
      console.info('[JobScheduler] STT Worker 핸들러 부착 완료')
      return true
    }

    if (tryAttach()) return

    const intervalId = setInterval(() => {
      retries += 1
      if (tryAttach() || retries > WORKER_ATTACH_MAX_RETRIES) {
        clearInterval(intervalId)
      }
    }, WORKER_ATTACH_INTERVAL_MS)
  }
}

// ============================================================
// 싱글톤
// ============================================================

/**
 * JobScheduler 싱글톤.
 *
 * @example
 * // App.tsx
 * useEffect(() => { jobScheduler.init() }, [])
 */
export const jobScheduler = new JobScheduler()
