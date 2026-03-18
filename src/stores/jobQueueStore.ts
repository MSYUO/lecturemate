/**
 * @file stores/jobQueueStore.ts
 * LectureMate — 백그라운드 작업 큐 상태 (Zustand)
 *
 * ## 역할
 * - 실행 대기/진행/완료/실패 작업 목록을 인메모리로 관리
 * - 각 액션마다 IndexedDB(pendingJobs)에 동기화
 * - JobScheduler가 구독해 우선순위 스케줄링에 활용
 * - PendingTray UI가 구독해 작업 진행 상황 표시
 *
 * ## 우선순위 (JobScheduler에서 계산)
 * 1. stt-realtime        → 현재 녹음 중 실시간 STT (최고)
 * 2. stt-postprocess     → 현재 사용자가 보는 세션 (중간)
 * 3. stt-postprocess     → 백그라운드 세션 (최저)
 *
 * ## 사용
 * ```typescript
 * import { useJobQueueStore } from '@/stores/jobQueueStore'
 *
 * // React 컴포넌트
 * const jobs = useJobQueueStore((s) => s.jobs)
 *
 * // 비 React (JobScheduler)
 * useJobQueueStore.getState().enqueue({ type: 'stt-postprocess', ... })
 * ```
 */

import { create } from 'zustand'
import { db } from '@/db/schema'
import type { Job, JobStatus } from '@/types'

// ============================================================
// 내부 유틸
// ============================================================

function newJob(params: Pick<Job, 'type' | 'sessionId' | 'payload'>): Job {
  const now = Date.now()
  return {
    id:        crypto.randomUUID(),
    type:      params.type,
    sessionId: params.sessionId,
    payload:   params.payload,
    status:    'pending',
    retries:   0,
    createdAt: now,
    updatedAt: now,
  }
}

/** DB의 job 레코드를 부분 업데이트합니다 */
async function dbUpdate(id: string, fields: Partial<Job>): Promise<void> {
  await db.pendingJobs.update(id, { ...fields, updatedAt: Date.now() })
}

// ============================================================
// 상태 타입
// ============================================================

interface JobQueueState {
  /** 전체 작업 목록 (done 포함 — UI 표시용) */
  jobs: Job[]
  /** 현재 실행 중인 작업 ID 목록 */
  activeJobIds: string[]
}

interface JobQueueActions {
  /**
   * 새 작업을 큐에 추가합니다.
   * IndexedDB에 저장 후 인메모리 목록에 추가합니다.
   */
  enqueue(params: Pick<Job, 'type' | 'sessionId' | 'payload'>): Promise<Job>

  /**
   * 작업 실행을 시작합니다.
   * status: pending → active
   */
  start(jobId: string): void

  /**
   * 실행 중인 작업을 일시 중지합니다 (큐에 재등록).
   * status: active → pending
   * 주의: 이미 시작된 Whisper 추론은 완료될 때까지 중단할 수 없습니다.
   */
  pause(jobId: string): void

  /**
   * 일시 중지된 작업을 재개합니다.
   * status: pending → active
   */
  resume(jobId: string): void

  /**
   * 작업 실패를 기록합니다.
   * status: active → failed, retries++
   * JobScheduler가 retries < maxRetries이면 자동 재시도합니다.
   */
  fail(jobId: string, error: string): void

  /**
   * 작업 완료를 기록합니다.
   * status: active → done
   */
  complete(jobId: string): void

  /**
   * 앱 시작 시 DB에서 미완료 작업을 로드해 큐를 복원합니다.
   * - 'active' 상태 (크래시로 중단) → 'pending'으로 초기화
   * - 'pending' 상태 → 그대로 유지
   * - 'failed' 상태 (retries < 3) → 'pending'으로 초기화
   */
  recoverPendingJobs(): Promise<void>

  /** 완료된 작업을 목록에서 제거합니다 (UI 정리용) */
  clearCompleted(): void

  // ---- 조회 헬퍼 ----

  /** pending 상태 작업만 반환 */
  getPendingJobs(): Job[]
}

// ============================================================
// Store 생성
// ============================================================

export const useJobQueueStore = create<JobQueueState & JobQueueActions>()((set, get) => ({
  jobs:         [],
  activeJobIds: [],

  // ----------------------------------------------------------
  // enqueue
  // ----------------------------------------------------------

  async enqueue(params) {
    const job = newJob(params)
    try {
      await db.pendingJobs.add(job)
    } catch (err) {
      console.error('[jobQueueStore] enqueue DB write failed:', err)
    }
    set((state) => ({ jobs: [...state.jobs, job] }))
    return job
  },

  // ----------------------------------------------------------
  // start
  // ----------------------------------------------------------

  start(jobId) {
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.id === jobId ? { ...j, status: 'active' as JobStatus, updatedAt: Date.now() } : j,
      ),
      activeJobIds: [...state.activeJobIds, jobId],
    }))
    dbUpdate(jobId, { status: 'active' }).catch(console.error)
  },

  // ----------------------------------------------------------
  // pause (active → pending, 재큐)
  // ----------------------------------------------------------

  pause(jobId) {
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.id === jobId ? { ...j, status: 'pending' as JobStatus, updatedAt: Date.now() } : j,
      ),
      activeJobIds: state.activeJobIds.filter((id) => id !== jobId),
    }))
    dbUpdate(jobId, { status: 'pending' }).catch(console.error)
  },

  // ----------------------------------------------------------
  // resume (pending → active)
  // ----------------------------------------------------------

  resume(jobId) {
    // resume = start (same state transition)
    get().start(jobId)
  },

  // ----------------------------------------------------------
  // fail
  // ----------------------------------------------------------

  fail(jobId, error) {
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              status:    'failed' as JobStatus,
              retries:   j.retries + 1,
              lastError: error,
              updatedAt: Date.now(),
            }
          : j,
      ),
      activeJobIds: state.activeJobIds.filter((id) => id !== jobId),
    }))
    const updated = get().jobs.find((j) => j.id === jobId)
    dbUpdate(jobId, {
      status:    'failed',
      retries:   updated?.retries ?? 0,
      lastError: error,
    }).catch(console.error)
  },

  // ----------------------------------------------------------
  // complete
  // ----------------------------------------------------------

  complete(jobId) {
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.id === jobId ? { ...j, status: 'done' as JobStatus, updatedAt: Date.now() } : j,
      ),
      activeJobIds: state.activeJobIds.filter((id) => id !== jobId),
    }))
    dbUpdate(jobId, { status: 'done' }).catch(console.error)
  },

  // ----------------------------------------------------------
  // recoverPendingJobs
  // ----------------------------------------------------------

  async recoverPendingJobs() {
    try {
      // 'pending' | 'active' | 'failed' (retries < 3) 항목 모두 로드
      const allUnfinished = await db.pendingJobs
        .where('status')
        .anyOf(['pending', 'active', 'failed'])
        .toArray()

      const MAX_RETRIES = 3

      const recovered: Job[] = []
      for (const job of allUnfinished) {
        if (job.status === 'failed' && job.retries >= MAX_RETRIES) continue

        if (job.status === 'active') {
          // 크래시로 중단된 작업 → pending으로 초기화
          await dbUpdate(job.id, { status: 'pending' })
          recovered.push({ ...job, status: 'pending', updatedAt: Date.now() })
        } else if (job.status === 'failed') {
          // 재시도 가능한 실패 → pending으로 초기화
          await dbUpdate(job.id, { status: 'pending' })
          recovered.push({ ...job, status: 'pending', updatedAt: Date.now() })
        } else {
          recovered.push(job)
        }
      }

      set({ jobs: recovered, activeJobIds: [] })
      console.info(`[jobQueueStore] 복구된 작업: ${recovered.length}건`)
    } catch (err) {
      console.error('[jobQueueStore] recoverPendingJobs 실패:', err)
    }
  },

  // ----------------------------------------------------------
  // clearCompleted
  // ----------------------------------------------------------

  clearCompleted() {
    set((state) => ({
      jobs: state.jobs.filter((j) => j.status !== 'done'),
    }))
  },

  // ----------------------------------------------------------
  // getPendingJobs
  // ----------------------------------------------------------

  getPendingJobs() {
    return get().jobs.filter((j) => j.status === 'pending')
  },
}))
