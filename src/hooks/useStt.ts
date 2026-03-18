/**
 * @file hooks/useStt.ts
 * LectureMate — STT Worker 연결 훅 (Section 6)
 *
 * ## 역할
 * - PreWarmingManager가 생성한 STT Worker에 메시지 핸들러를 부착합니다.
 * - 오디오 청크 도착 시 `onChunkReady()`를 통해 Worker로 전달합니다.
 * - Worker `result` 수신 → sessionId 채움 → IndexedDB 저장 → sttStore 갱신.
 *
 * ## useRecording과의 연결
 * `onChunkReady`는 모듈 레벨 함수입니다.
 * useRecording의 chunk 핸들러가 이 함수를 호출합니다.
 * useStt 훅이 마운트되어 있지 않으면 no-op입니다.
 *
 * ## 마운트 위치
 * RecordingControls.tsx — 녹음 파이프라인과 동일한 컴포넌트.
 *
 * ## 주의
 * - Worker의 onmessage는 PreWarmingManager가 소유합니다.
 * - 이 훅은 addEventListener('message', ...) 로 중복 등록 없이 공존합니다.
 */

import { useEffect, useRef } from 'react'
import { preWarming } from '@/core/PreWarmingManager'
import { useSttStore } from '@/stores/sttStore'
import { useSessionStore } from '@/stores/sessionStore'
import { db } from '@/db/schema'
import type { SttWorkerInMessage, SttWorkerOutMessage, SttSegment } from '@/types'

// ============================================================
// 모듈 레벨 청크 전송 함수 (useRecording에서 호출)
// ============================================================

type ChunkSender = (
  pcmData: Float32Array,
  chunkIndex: number,
  isPostProcess: boolean,
) => void

let _sendChunk: ChunkSender | null = null

/**
 * 오디오 청크가 준비됐을 때 useRecording이 호출합니다.
 * useStt 훅이 마운트되지 않았으면 no-op입니다.
 *
 * @param pcmData       16kHz mono PCM Float32Array (Transferable — 호출 후 버퍼 소유권이 STT Worker로 이전)
 * @param chunkIndex    0-based 청크 순번
 * @param isPostProcess true이면 beam=5 후처리 패스
 */
export function onChunkReady(
  pcmData: Float32Array,
  chunkIndex: number,
  isPostProcess = false,
): void {
  _sendChunk?.(pcmData, chunkIndex, isPostProcess)
}

// ============================================================
// useStt 훅
// ============================================================

/**
 * STT Worker와 메인 스레드를 연결합니다.
 *
 * RecordingControls에서 한 번만 마운트하세요.
 * 반환값 없이 side-effect만 수행합니다.
 */
export function useStt(): void {
  const workerRef = useRef<Worker | null>(null)

  // ──────────────────────────────────────────────────────────
  // 1. 새 녹음 시작 시 세그먼트 초기화
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    let prevIsRecording = useSessionStore.getState().isRecording

    const unsub = useSessionStore.subscribe((state) => {
      if (state.isRecording && !prevIsRecording) {
        // false → true 전환: 새 녹음 세션 시작
        useSttStore.getState().clearSegments()
      }
      prevIsRecording = state.isRecording
    })

    return unsub
  }, [])

  // ──────────────────────────────────────────────────────────
  // 2. Worker 메시지 핸들러 + 청크 전송 함수 등록
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    let attached    = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    // 실시간 패스(isPostProcess=false)만 처리 — 후처리는 JobScheduler가 담당
    function handleMessage(e: MessageEvent<SttWorkerOutMessage>): void {
      if (e.data.type !== 'result' || e.data.isPostProcess) return

      const { chunkIndex, segments: raw } = e.data
      const sessionId = useSessionStore.getState().sessionId ?? ''

      // sessionId 채우기 (Worker는 '' 로 전달)
      const filled: SttSegment[] = raw.map((seg) => ({ ...seg, sessionId }))

      if (filled.length === 0) return

      // IndexedDB 저장 (비동기 fire-and-forget)
      db.sttSegments.bulkPut(filled).catch((err) => {
        console.error(`[useStt] IndexedDB bulkPut 실패 (chunk ${chunkIndex}):`, err)
      })

      // 인메모리 스토어 갱신 → STTStream 리렌더
      useSttStore.getState().addSegments(filled)
    }

    // Worker 가져오기 + 리스너 부착
    function tryAttach(): boolean {
      const worker = preWarming.getSttWorker()
      if (!worker) return false
      workerRef.current = worker
      worker.addEventListener('message', handleMessage)
      attached = true
      return true
    }

    // 청크 전송 함수 등록 (lazy — Worker null이어도 나중에 재시도)
    _sendChunk = (pcmData, chunkIndex, isPostProcess) => {
      // Worker 참조 없으면 lazy-acquire
      if (!workerRef.current) {
        const w = preWarming.getSttWorker()
        if (w) workerRef.current = w
      }
      if (!workerRef.current) {
        console.warn('[useStt] STT Worker 미준비 — 청크 드롭:', chunkIndex)
        return
      }
      workerRef.current.postMessage(
        {
          type: 'transcribe',
          chunkIndex,
          pcmData,
          isPostProcess,
        } satisfies SttWorkerInMessage,
        [pcmData.buffer],
      )
    }

    // 즉시 부착 시도 → 실패 시 0.5초 간격으로 재시도 (최대 ~10초)
    if (!tryAttach()) {
      let retries = 0
      intervalId = setInterval(() => {
        retries += 1
        if (tryAttach() || retries > 20) {
          clearInterval(intervalId!)
          intervalId = null
        }
      }, 500)
    }

    return () => {
      if (intervalId !== null) clearInterval(intervalId)
      if (attached && workerRef.current) {
        workerRef.current.removeEventListener('message', handleMessage)
      }
      _sendChunk = null
    }
  }, [])
}
