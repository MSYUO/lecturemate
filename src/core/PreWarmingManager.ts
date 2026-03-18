/**
 * @file core/PreWarmingManager.ts
 * LectureMate — WASM 프리워밍 매니저 (Section 5)
 *
 * ## 전략
 * - **STT(Whisper)**: 앱 시작 직후 `requestIdleCallback`으로 유휴 시간 감지 →
 *   `stt.worker.ts` 생성 + `{ type: 'load' }` 전송 → 모델 로딩 진행률을
 *   sessionStore에 반영 → `ready` 수신 시 "AI 준비 완료 ✓" 표시
 *
 * - **Pyodide(코드 실행)**: 코드 탭 최초 클릭 시에만 `warmUpPyodide()` 호출.
 *   Whisper(400 MB)와 Pyodide(200 MB)를 동시 활성화하지 않도록 설계됨.
 *
 * ## 앱 시작 시퀀스
 * ```
 * t=0ms     HTML + React hydration
 * t=200ms   UI 완전 렌더링
 * t=300ms   CrashRecoveryManager.recover()
 * t=800ms   [유휴 감지] PreWarmingManager.warmUpOnIdle()
 *             └→ STT Worker 생성 + Whisper 로딩 시작
 *             └→ sessionStore.setWhisperStatus('loading', 0)
 * t=~3000ms Whisper 완료 → setWhisperStatus('ready')
 * t=???     [사용자 코드 탭 클릭] warmUpPyodide()
 * ```
 *
 * ## 싱글톤 사용
 * ```typescript
 * import { preWarming } from '@/core/PreWarmingManager'
 * await preWarming.warmUpOnIdle()           // App.tsx useEffect
 * await preWarming.warmUpPyodide()          // SidebarPanel 코드 탭 최초 클릭
 * const sttWorker = preWarming.getSttWorker() // STT 훅에서 Worker 참조
 * ```
 */

import { useSessionStore } from '@/stores/sessionStore'
import { useCodeStore } from '@/stores/codeStore'
import type { SttWorkerInMessage, SttWorkerOutMessage, CodeRunnerInMessage, CodeRunnerOutMessage } from '@/types'

// ============================================================
// PreWarmingManager
// ============================================================

export class PreWarmingManager {

  private sttWorker:    Worker | null = null
  private codeWorker:   Worker | null = null

  /** Whisper 모델 로딩 완료 여부 */
  private whisperReady  = false
  /** Pyodide 워커 생성 완료 여부 */
  private pyodideReady  = false

  // ----------------------------------------------------------
  // warmUpOnIdle — STT(Whisper) 프리워밍
  // ----------------------------------------------------------

  /**
   * 유휴 시간에 STT Worker를 생성하고 Whisper 모델을 백그라운드에서 로딩합니다.
   * 이미 워커가 존재하거나 ready 상태면 즉시 반환합니다.
   *
   * App.tsx의 useEffect에서 한 번만 호출하세요.
   */
  async warmUpOnIdle(): Promise<void> {
    if (this.whisperReady || this.sttWorker !== null) return

    // ── 1단계: UI가 먼저 완전히 렌더링되도록 브라우저에 양보 ──
    await new Promise<void>((resolve) => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => resolve(), { timeout: 3_000 })
      } else {
        // Safari / 구형 브라우저 폴백: 1초 대기
        setTimeout(resolve, 1_000)
      }
    })

    // ── 2단계: STT Worker 생성 + 모델 로딩 시작 ─────────────
    useSessionStore.getState().setWhisperStatus('loading', 0)

    try {
      const worker = new Worker(
        new URL('../workers/stt.worker.ts', import.meta.url),
        { type: 'module' },
      )
      this.sttWorker = worker

      // Worker 메시지 핸들러
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

      // Whisper 모델 로딩 시작
      worker.postMessage({ type: 'load' } satisfies SttWorkerInMessage)

    } catch (err) {
      console.error('[PreWarming] STT Worker 생성 실패:', err)
      useSessionStore.getState().setWhisperStatus('error')
    }
  }

  // ----------------------------------------------------------
  // warmUpPyodide — Pyodide(코드 실행) 온디맨드 로딩
  // ----------------------------------------------------------

  /**
   * 코드 탭이 최초로 활성화될 때 `codeRunner.worker.ts`를 생성합니다.
   * Whisper(400 MB)와 Pyodide(200 MB)를 동시 활성화하지 않습니다.
   *
   * Phase 5에서 Pyodide 로딩 진행률 표시 + codeStore 연동이 추가됩니다.
   */
  async warmUpPyodide(): Promise<void> {
    if (this.pyodideReady || this.codeWorker !== null) return

    const { setPyodideStatus } = useCodeStore.getState()
    setPyodideStatus('loading', 0)

    try {
      const worker = new Worker(
        new URL('../workers/codeRunner.worker.ts', import.meta.url),
        { type: 'module' },
      )
      this.codeWorker = worker

      worker.addEventListener('message', (e: MessageEvent<CodeRunnerOutMessage>) => {
        const msg = e.data
        if (msg.type === 'progress') {
          useCodeStore.getState().setPyodideStatus('loading', msg.percent)
        } else if (msg.type === 'ready') {
          this.pyodideReady = true
          useCodeStore.getState().setPyodideStatus('ready', 100)
          console.info('[PreWarming] Pyodide 로딩 완료')
        } else if (msg.type === 'error' && !msg.snippetId) {
          // snippetId가 없는 error = 초기화 실패
          useCodeStore.getState().setPyodideStatus('error')
          this.codeWorker = null
        }
      })

      worker.onerror = (e) => {
        console.error('[PreWarming] CodeRunner Worker 예외:', e.message)
        useCodeStore.getState().setPyodideStatus('error')
        this.codeWorker   = null
        this.pyodideReady = false
      }

      // Pyodide 로딩 시작 (CDN ESM 동적 import)
      worker.postMessage({ type: 'init' } satisfies CodeRunnerInMessage)

      console.info('[PreWarming] CodeRunner Worker 생성 완료 (Pyodide 로딩 시작)')

    } catch (err) {
      console.error('[PreWarming] CodeRunner Worker 생성 실패:', err)
      useCodeStore.getState().setPyodideStatus('error')
    }
  }

  // ----------------------------------------------------------
  // Worker 참조 — 훅/컴포넌트에서 재사용
  // ----------------------------------------------------------

  /**
   * STT Worker 참조를 반환합니다.
   * Phase 3에서 `useStt` 훅이 오디오 청크를 이 Worker로 전달할 때 사용합니다.
   */
  getSttWorker(): Worker | null {
    return this.sttWorker
  }

  /**
   * CodeRunner Worker 참조를 반환합니다.
   * Phase 5에서 `useCodeRunner` 훅이 코드를 이 Worker로 전달할 때 사용합니다.
   */
  getCodeWorker(): Worker | null {
    return this.codeWorker
  }

  // ----------------------------------------------------------
  // 상태 조회
  // ----------------------------------------------------------

  get isWhisperReady(): boolean  { return this.whisperReady  }
  get isPyodideReady(): boolean  { return this.pyodideReady  }

  // ----------------------------------------------------------
  // 정리
  // ----------------------------------------------------------

  /**
   * 코드 실행 타임아웃 시 Worker를 강제 종료합니다.
   * 이후 warmUpPyodide()를 호출해 새 Worker를 생성합니다.
   */
  resetCodeWorker(): void {
    this.codeWorker?.terminate()
    this.codeWorker   = null
    this.pyodideReady = false
    useCodeStore.getState().setPyodideStatus('idle', 0)
  }

  /**
   * 앱 종료 / 테스트 정리 시 호출합니다.
   * Zustand unmount cleanup에서도 호출할 수 있습니다.
   */
  dispose(): void {
    this.sttWorker?.terminate()
    this.codeWorker?.terminate()
    this.sttWorker    = null
    this.codeWorker   = null
    this.whisperReady  = false
    this.pyodideReady  = false
  }
}

// ============================================================
// 싱글톤
// ============================================================

/**
 * PreWarmingManager 싱글톤.
 *
 * @example
 * // App.tsx
 * useEffect(() => { preWarming.warmUpOnIdle() }, [])
 *
 * // SidebarPanel — 코드 탭 최초 클릭
 * onClick={() => preWarming.warmUpPyodide()}
 *
 * // useStt hook (Phase 3)
 * const worker = preWarming.getSttWorker()
 */
export const preWarming = new PreWarmingManager()
