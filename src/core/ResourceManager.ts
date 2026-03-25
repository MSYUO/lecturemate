/**
 * @file core/ResourceManager.ts
 * LectureMate — 모드별 메모리/Worker 관리
 *
 * ## ActiveMode
 * - `recording` : STT(Whisper) 활성
 * - `reviewing` : Whisper idle(유지) — PDF 탐색 모드
 *
 * ## 싱글톤 사용
 * ```typescript
 * import { resourceManager } from '@/core/ResourceManager'
 * resourceManager.switchMode('recording')
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

  private mode: ActiveMode = 'reviewing'

  switchMode(newMode: ActiveMode): void {
    if (this.mode === newMode) return
    const prev = this.mode
    this.mode  = newMode
    console.info(`[ResourceManager] ${prev} → ${newMode}`)

    switch (newMode) {
      case 'recording':
        if (!useSessionStore.getState().isRecording) {
          jobScheduler.resumeQueue()
        }
        break

      case 'reviewing':
        jobScheduler.resumeQueue()
        break
    }
  }

  emergencyCleanup(): void {
    console.warn('[ResourceManager] emergencyCleanup: 비활성 Worker 강제 종료')
    if (this.mode === 'reviewing') {
      preWarming.dispose()
      useSessionStore.getState().setWhisperStatus('idle')
    }
  }

  get currentMode(): ActiveMode {
    return this.mode
  }
}

// ============================================================
// 싱글톤
// ============================================================

export const resourceManager = new ResourceManager()
