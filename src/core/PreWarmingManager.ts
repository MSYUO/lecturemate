/**
 * @file core/PreWarmingManager.ts
 * LectureMate — WASM 프리워밍 매니저
 *
 * ## 전략
 * - **STT(Whisper)**: 앱 시작 직후 `requestIdleCallback`으로 유휴 시간 감지 →
 *   `stt.worker.ts` 생성 + `{ type: 'load' }` 전송 → 모델 로딩 진행률을
 *   sessionStore에 반영 → `ready` 수신 시 "AI 준비 완료 ✓" 표시
 *
 * ## 싱글톤 사용
 * ```typescript
 * import { preWarming } from '@/core/PreWarmingManager'
 * await preWarming.warmUpOnIdle()           // App.tsx useEffect
 * const sttWorker = preWarming.getSttWorker() // STT 훅에서 Worker 참조
 * ```
 */

import { useSessionStore } from '@/stores/sessionStore'
import type { SttWorkerInMessage, SttWorkerOutMessage } from '@/types'

// ============================================================
// PreWarmingManager
// ============================================================

export class PreWarmingManager {

  private sttWorker:   Worker | null = null
  private whisperReady = false

  // ----------------------------------------------------------
  // warmUpOnIdle — STT(Whisper) 프리워밍
  // ----------------------------------------------------------

  async warmUpOnIdle(): Promise<void> {
    if (this.whisperReady || this.sttWorker !== null) return

    await new Promise<void>((resolve) => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => resolve(), { timeout: 3_000 })
      } else {
        setTimeout(resolve, 1_000)
      }
    })

    useSessionStore.getState().setWhisperStatus('loading', 0)

    try {
      const worker = new Worker(
        new URL('../workers/stt.worker.ts', import.meta.url),
        { type: 'module' },
      )
      this.sttWorker = worker

      worker.onmessage = (e: MessageEvent<SttWorkerOutMessage>) => {
        const msg = e.data
        if (msg.type === 'ready') {
          this.whisperReady = true
          useSessionStore.getState().setWhisperStatus('ready')
          console.info('[PreWarming] Whisper 모델 로딩 완료')
        } else if (msg.type === 'progress') {
          useSessionStore.getState().setWhisperStatus('loading', msg.percent)
        } else if (msg.type === 'error') {
          console.error('[PreWarming] STT Worker 오류:', msg.message)
          useSessionStore.getState().setWhisperStatus('error')
        }
      }

      worker.onerror = (e) => {
        console.error('[PreWarming] STT Worker 예외:', e.message)
        useSessionStore.getState().setWhisperStatus('error')
      }

      worker.postMessage({ type: 'load' } satisfies SttWorkerInMessage)

    } catch (err) {
      console.error('[PreWarming] STT Worker 생성 실패:', err)
      useSessionStore.getState().setWhisperStatus('error')
    }
  }

  // ----------------------------------------------------------
  // Worker 참조
  // ----------------------------------------------------------

  getSttWorker(): Worker | null {
    return this.sttWorker
  }

  get isWhisperReady(): boolean { return this.whisperReady }

  // ----------------------------------------------------------
  // 정리
  // ----------------------------------------------------------

  dispose(): void {
    this.sttWorker?.terminate()
    this.sttWorker    = null
    this.whisperReady = false
  }
}

// ============================================================
// 싱글톤
// ============================================================

export const preWarming = new PreWarmingManager()
