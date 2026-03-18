/**
 * @file stores/storageStore.ts
 * LectureMate — OPFS 저장 용량 상태 (Zustand)
 *
 * StorageManager가 업데이트하고, StorageUsageBar가 구독합니다.
 *
 * 사용:
 *   import { useStorageStore } from '@/stores/storageStore'
 *   const { usage, quota, level } = useStorageStore()
 */

import { create } from 'zustand'

// ============================================================
// 타입
// ============================================================

/**
 * 저장 용량 경고 수준.
 *
 * - ok     < 70%: 정상
 * - warn   70~85%: 경고 (상태바 주황)
 * - danger ≥ 85%: 위험 (자동 정리 제안)
 */
export type StorageLevel = 'ok' | 'warn' | 'danger'

interface StorageState {
  /** 현재 사용 중인 바이트 수 */
  usage:        number
  /** 허용된 최대 용량 (바이트) */
  quota:        number
  /** 사용률 [0, 1] */
  ratio:        number
  /** 경고 수준 */
  level:        StorageLevel
  /** smartCleanup 실행 중 여부 */
  isCleaningUp: boolean
}

interface StorageActions {
  /** StorageManager 내부에서만 호출 */
  _setEstimate:    (usage: number, quota: number) => void
  /** StorageManager 내부에서만 호출 */
  _setCleaningUp:  (v: boolean) => void
}

// ============================================================
// 헬퍼
// ============================================================

function toLevel(ratio: number): StorageLevel {
  if (ratio >= 0.85) return 'danger'
  if (ratio >= 0.70) return 'warn'
  return 'ok'
}

// ============================================================
// Store
// ============================================================

export const useStorageStore = create<StorageState & StorageActions>()((set) => ({
  usage:        0,
  quota:        0,
  ratio:        0,
  level:        'ok',
  isCleaningUp: false,

  _setEstimate: (usage, quota) => {
    const ratio = quota > 0 ? usage / quota : 0
    set({ usage, quota, ratio, level: toLevel(ratio) })
  },

  _setCleaningUp: (v) => set({ isCleaningUp: v }),
}))
