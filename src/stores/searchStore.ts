/**
 * @file stores/searchStore.ts
 * LectureMate — 통합 검색 상태 (Zustand)
 *
 * ## 역할
 * - 검색 UI 표시 여부 (isSearchOpen)
 * - 현재 쿼리 문자열 (query)
 * - 통합 검색 결과 목록 (results) — useSearch 훅이 채움
 *
 * ## 사용
 * ```typescript
 * const { isSearchOpen, open, close } = useSearchStore()
 * ```
 */

import { create } from 'zustand'
import type { SearchResult } from '@/types'

// ============================================================
// 상태 타입
// ============================================================

interface SearchState {
  isSearchOpen: boolean
  query:        string
  results:      SearchResult[]
}

interface SearchActions {
  open:         () => void
  close:        () => void
  toggle:       () => void
  setQuery:     (q: string) => void
  setResults:   (r: SearchResult[]) => void
  clearResults: () => void
}

// ============================================================
// Store
// ============================================================

// ============================================================
// Fuse.js 인덱스 해제 — MemoryGuard가 호출
// ============================================================

/** useSearch 훅이 마운트 시 등록하는 Fuse 인스턴스 정리 콜백 */
let _fuseDisposer: (() => void) | null = null

/** useSearch 훅이 호출 — Fuse 인스턴스 null 처리 콜백 등록 */
export function registerFuseDisposer(fn: () => void): void {
  _fuseDisposer = fn
}

/**
 * MemoryGuard가 호출 — 캐싱된 Fuse.js 인스턴스를 즉시 null 처리합니다.
 * 다음 검색 창 열기 시 자동으로 재빌드됩니다.
 */
export function disposeFuseIndexes(): void {
  _fuseDisposer?.()
}

// ============================================================
// Store
// ============================================================

export const useSearchStore = create<SearchState & SearchActions>()((set) => ({
  isSearchOpen: false,
  query:        '',
  results:      [],

  open:   () => set({ isSearchOpen: true }),
  close:  () => set({ isSearchOpen: false, query: '', results: [] }),
  toggle: () => set((s) => ({
    isSearchOpen: !s.isSearchOpen,
    query:        s.isSearchOpen ? '' : s.query,
    results:      s.isSearchOpen ? [] : s.results,
  })),

  setQuery:     (q) => set({ query: q }),
  setResults:   (r) => set({ results: r }),
  clearResults: ()  => set({ results: [] }),
}))
