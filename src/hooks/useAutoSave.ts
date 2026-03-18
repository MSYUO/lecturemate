/**
 * @file hooks/useAutoSave.ts
 * LectureMate — 자동 저장 React 훅
 *
 * annotationStore의 상태 변화를 구독하여 AutoSaveManager.markDirty()를 호출합니다.
 *
 * ## 동작 원리
 *
 *   Zustand `subscribe(listener)` (단일 인자 형태)를 사용합니다.
 *   subscribeWithSelector 미들웨어 없이도 동작하며, 리스너 내부에서
 *   selectHasDirty로 실제 dirty 여부를 확인합니다.
 *
 *   구독 흐름:
 *     annotationStore 상태 변경
 *       └→ listener(state, prevState) 호출
 *             └→ selectHasDirty(state) === true 이면 autoSave.markDirty()
 *                   └→ 3초 디바운스 후 IndexedDB 저장
 *
 * ## 마운트 위치
 *
 *   App.tsx 또는 세션 레이아웃 컴포넌트에서 한 번만 마운트합니다:
 *
 *   ```tsx
 *   function SessionLayout() {
 *     useAutoSave()
 *     useHotkeys('ctrl+s', () => autoSave.flush())
 *     return <Outlet />
 *   }
 *   ```
 *
 * ## 수동 저장 (Ctrl+S)
 *
 *   `autoSave.flush()`를 직접 호출하면 디바운스 없이 즉시 저장됩니다.
 */

import { useEffect } from 'react'
import { useAnnotationStore, selectHasDirty } from '@/stores/annotationStore'
import { useSessionStore } from '@/stores/sessionStore'
import { autoSave } from '@/core/AutoSaveManager'

// ============================================================
// 훅
// ============================================================

/**
 * annotationStore 변경을 감지해 AutoSaveManager에 알립니다.
 *
 * 세션이 열려 있는 동안 레이아웃 컴포넌트에서 한 번만 호출합니다.
 * 컴포넌트 언마운트 시 Zustand 구독을 자동으로 해제합니다.
 */
export function useAutoSave(): void {
  useEffect(() => {
    // Zustand subscribe(listener) — 단일 인자 형태.
    // subscribeWithSelector 미들웨어 없이 사용 가능합니다.
    // state가 바뀔 때마다 호출되며, dirty 엔티티가 있을 때만 markDirty()를 실행합니다.
    // AutoSaveManager의 디바운스가 연속 호출을 안전하게 처리합니다.
    const unsubscribe = useAnnotationStore.subscribe((state) => {
      if (selectHasDirty(state)) {
        autoSave.markDirty()
      }
    })

    return unsubscribe
  }, [])
}

// ============================================================
// 저장 상태 구독 훅 (UI 표시용 — 선택적)
// ============================================================

/**
 * SaveStatusIndicator 컴포넌트용 훅.
 * sessionStore의 saveStatus와 즉시 저장 flush 함수를 반환합니다.
 *
 * @example
 * function SaveStatusIndicator() {
 *   const { saveStatus, flush } = useSaveStatus()
 *   return (
 *     <button onClick={flush}>
 *       {saveStatus === 'saved'   && '저장됨 ✓'}
 *       {saveStatus === 'pending' && '저장 중...'}
 *       {saveStatus === 'error'   && '저장 실패 — 재시도 중'}
 *     </button>
 *   )
 * }
 */
export function useSaveStatus() {
  const saveStatus = useSessionStore((s) => s.saveStatus)

  return {
    saveStatus,
    /** 디바운스를 무시하고 즉시 저장합니다 (Ctrl+S) */
    flush: () => autoSave.flush(),
  } as const
}
