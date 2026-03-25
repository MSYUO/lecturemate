/**
 * @file stores/routerStore.ts
 * LectureMate — 페이지 라우팅 전역 상태 (Zustand)
 *
 * 라우터 라이브러리 없이 Zustand로 SPA 라우팅을 관리합니다.
 *
 * 페이지:
 *   home     → 앱 첫 화면 (최근 세션 + 폴더 그리드)
 *   folder   → 폴더 내부 뷰 (currentFolderId 기준)
 *   session  → PDF 뷰어 + 사이드바 (currentSessionId 기준)
 *   settings → 설정 화면
 *
 * 사용:
 *   import { useRouterStore } from '@/stores/routerStore'
 *   const navigate = useRouterStore(s => s.navigate)
 *   navigate('folder', { folderId: 'abc' })
 */

import { create } from 'zustand'

export type PageName = 'home' | 'folder' | 'session' | 'settings'

interface RouterState {
  /** 현재 표시 중인 페이지 */
  currentPage: PageName
  /** folder 페이지에서 표시할 폴더 ID */
  currentFolderId: string | null
  /** session 페이지에서 표시할 세션 ID */
  currentSessionId: string | null
  /** 뒤로가기 스택 (PageName) */
  history: PageName[]
}

interface RouterActions {
  /**
   * 페이지 이동.
   * @param page     이동할 페이지
   * @param params   옵션: folderId / sessionId 전달 시 해당 상태도 갱신
   */
  navigate(page: PageName, params?: { folderId?: string | null; sessionId?: string | null }): void
  /** 뒤로가기 — history 스택에서 이전 페이지로 복귀 */
  goBack(): void
}

export const useRouterStore = create<RouterState & RouterActions>()((set, get) => ({
  currentPage:      'home',
  currentFolderId:  null,
  currentSessionId: null,
  history:          [],

  navigate: (page, params = {}) => {
    const { currentPage, history } = get()
    const updates: Partial<RouterState> = {
      currentPage: page,
      history: [...history, currentPage],
    }
    // home으로 이동 시 ID 초기화
    if (page === 'home') {
      updates.currentFolderId  = null
      updates.currentSessionId = null
    }
    if (params.folderId  !== undefined) updates.currentFolderId  = params.folderId
    if (params.sessionId !== undefined) updates.currentSessionId = params.sessionId
    set(updates)
  },

  goBack: () => {
    const { history } = get()
    if (history.length === 0) {
      set({ currentPage: 'home', currentFolderId: null, currentSessionId: null })
      return
    }
    const prev = history[history.length - 1]
    const updates: Partial<RouterState> = {
      currentPage: prev,
      history: history.slice(0, -1),
    }
    if (prev === 'home') {
      updates.currentFolderId  = null
      updates.currentSessionId = null
    }
    set(updates)
  },
}))
