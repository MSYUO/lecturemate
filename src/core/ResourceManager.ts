/**
 * @file core/ResourceManager.ts
 * LectureMate — 모드별 메모리/Worker 관리 (Section 6.2)
 *
 * ## 배경
 * Whisper(400 MB)와 Pyodide(200 MB)를 동시에 활성화하면 브라우저 메모리가
 * 600 MB 이상 소비되어 모바일/저사양 PC에서 탭 크래시가 발생합니다.
 * ResourceManager 는 세 가지 ActiveMode 중 하나를 유지하고, 전환 시
 * 불필요한 Worker 를 해제해 상호 배타적 로딩을 보장합니다.
 *
 * ## ActiveMode
 * - `recording` : STT(Whisper) 활성, Pyodide 해제
 * - `reviewing` : Whisper idle(유지), Pyodide 해제
 * - `coding`    : Pyodide 활성, STT 후처리 큐 일시 정지
 *
 * ## switchMode 전환 규칙
 * | 이전 → 이후   | 이전 모드 정리              | 이후 모드 준비              |
 * |--------------|----------------------------|-----------------------------|
 * | * → coding   | STT 후처리 큐 pause         | Pyodide warm-up (async)     |
 * | coding → *   | Pyodide Worker terminate    | STT 후처리 큐 resume + tick |
 * | * → reviewing| (coding이면 Pyodide 해제)   | STT 큐 resume               |
 * | * → recording| (coding이면 Pyodide 해제)   | 큐는 JobScheduler가 자체 관리 |
 *
 * ## emergencyCleanup
 * MemoryGuard가 메모리 압박 시 호출합니다.
 * 현재 모드에서 불필요한 Worker 를 강제 terminate 합니다.
 *
 * ## 싱글톤 사용
 * ```typescript
 * import { resourceManager } from '@/core/ResourceManager'
 * resourceManager.switchMode('coding')  // SidebarPanel 코드 탭 클릭 시
 * ```
 */

import { preWarming } from '@/core/PreWarmingManager'
import { jobScheduler } from '@/core/JobScheduler'
import { useSessionStore } from '@/stores/sessionStore'
import type { ActiveMode } from '@/types'

// ============================================================
// ResourceManager
// ============================================================

export class ResourceManager {

  /** 현재 활성 모드 */
  private mode: ActiveMode = 'reviewing'

  // ----------------------------------------------------------
  // 공개 API
  // ----------------------------------------------------------

  /**
   * 모드를 전환합니다.
   *
   * 이미 같은 모드면 즉시 반환합니다.
   * Pyodide 로딩은 비동기지만 fire-and-forget 으로 처리되므로
   * 이 메서드 자체는 동기 완료입니다.
   */
  switchMode(newMode: ActiveMode): void {
    if (this.mode === newMode) return

    const prev = this.mode
    this.mode  = newMode
    console.info(`[ResourceManager] ${prev} → ${newMode}`)

    // ── 이전 모드 정리 ──────────────────────────────────────
    if (prev === 'coding') {
      // Pyodide Worker 종료 + codeStore pyodideStatus → idle
      preWarming.resetCodeWorker()
    }

    // ── 새 모드 준비 ────────────────────────────────────────
    switch (newMode) {
      case 'coding':
        // STT 후처리 큐 일시 정지 (Whisper 와 Pyodide 동시 실행 방지)
        jobScheduler.pauseQueue()
        // Pyodide 온디맨드 로딩 (이미 ready 면 내부에서 즉시 반환)
        preWarming.warmUpPyodide().catch((err) =>
          console.error('[ResourceManager] Pyodide 로딩 실패:', err),
        )
        break

      case 'recording':
        // 녹음 시작은 JobScheduler 가 isRecording 을 보고 자체 처리하므로
        // 여기서는 큐 재개만 시도 (이미 녹음 중이면 tick 이 알아서 스킵)
        if (!useSessionStore.getState().isRecording) {
          jobScheduler.resumeQueue()
        }
        break

      case 'reviewing':
        // Whisper 는 메모리에 유지 (재다운로드 비용 400 MB 절감)
        // STT 후처리 큐 재개 (코딩 모드에서 쌓인 작업 처리)
        jobScheduler.resumeQueue()
        break
    }
  }

  /**
   * MemoryGuard가 메모리 압박을 감지했을 때 호출합니다.
   *
   * 현재 모드에서 불필요한 Worker 를 강제 terminate 합니다.
   * - coding 모드가 아니면 Pyodide Worker 즉시 해제
   * - reviewing 모드에서 극단적 압박 시 Whisper 도 해제하고 상태를 idle 로 초기화
   */
  emergencyCleanup(): void {
    console.warn('[ResourceManager] emergencyCleanup: 비활성 Worker 강제 종료')

    if (this.mode !== 'coding') {
      preWarming.resetCodeWorker()
    }

    // reviewing 중 메모리가 극히 부족하면 Whisper 도 해제
    // (재시작 시 재다운로드 없이 Cache API 에서 복원되므로 허용)
    if (this.mode === 'reviewing') {
      preWarming.dispose()
      useSessionStore.getState().setWhisperStatus('idle')
    }
  }

  /** 현재 모드를 반환합니다. */
  get currentMode(): ActiveMode {
    return this.mode
  }
}

// ============================================================
// 싱글톤
// ============================================================

/**
 * ResourceManager 싱글톤.
 *
 * @example
 * // SidebarPanel — 탭 전환 시
 * resourceManager.switchMode('coding')
 *
 * // MemoryGuard — 메모리 압박 시
 * resourceManager.emergencyCleanup()
 */
export const resourceManager = new ResourceManager()
