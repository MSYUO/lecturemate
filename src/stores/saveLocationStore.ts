/**
 * @file stores/saveLocationStore.ts
 * LectureMate — 저장 위치 선택 모달 전역 상태
 *
 * 사용법 (어느 컴포넌트에서나):
 *   const folderId = await useSaveLocationStore.getState().requestFolder('pdf')
 *   if (folderId !== null) { // 사용자가 확인 }
 *
 * 모달은 App.tsx 루트에 <SaveLocationModal />로 마운트됩니다.
 */

import { create } from 'zustand'

export type SaveFileType = 'recording' | 'pdf' | 'notes'

interface SaveLocationState {
  isOpen: boolean
  fileType: SaveFileType | null
  /** resolve 콜백. 사용자가 확인하면 folderId(string|null), 취소하면 false */
  _resolve: ((folderId: string | null | false) => void) | null
}

interface SaveLocationActions {
  /**
   * 저장 위치 선택 모달을 열고 사용자 선택을 기다립니다.
   * @returns 선택한 folderId (루트면 null), 취소하면 false
   */
  requestFolder(fileType: SaveFileType): Promise<string | null | false>

  /** 사용자가 "여기에 저장" 클릭 — folderId 확인 */
  confirm(folderId: string | null): void

  /** 사용자가 취소 또는 오버레이 클릭 */
  cancel(): void
}

export const useSaveLocationStore = create<SaveLocationState & SaveLocationActions>()(
  (set, get) => ({
    isOpen:    false,
    fileType:  null,
    _resolve:  null,

    requestFolder: (fileType) => {
      return new Promise<string | null | false>((resolve) => {
        set({ isOpen: true, fileType, _resolve: resolve })
      })
    },

    confirm: (folderId) => {
      get()._resolve?.(folderId)
      set({ isOpen: false, fileType: null, _resolve: null })
    },

    cancel: () => {
      get()._resolve?.(false)
      set({ isOpen: false, fileType: null, _resolve: null })
    },
  }),
)
