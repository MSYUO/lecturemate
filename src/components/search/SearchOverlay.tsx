/**
 * @file components/search/SearchOverlay.tsx
 * LectureMate — 통합 검색 모달 (Ctrl+F)
 *
 * ## 레이아웃
 * 상단 중앙 고정 모달. max-width 560px.
 * 반투명 backdrop + blur.
 *
 * ## 키보드
 * - ↑ / ↓          결과 탐색
 * - Enter           선택한 결과 이동
 * - Escape          닫기
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchStore } from '@/stores/searchStore'
import { useSessionStore } from '@/stores/sessionStore'
import { SearchResults } from './SearchResults'
import type { SearchResult } from '@/types'

export function SearchOverlay() {
  const isOpen     = useSearchStore((s) => s.isSearchOpen)
  const query      = useSearchStore((s) => s.query)
  const results    = useSearchStore((s) => s.results)
  const setQuery   = useSearchStore((s) => s.setQuery)
  const close      = useSearchStore((s) => s.close)

  const setCurrentPage = useSessionStore((s) => s.setCurrentPage)
  const setCurrentTime = useSessionStore((s) => s.setCurrentTime)

  const [focusedIndex, setFocusedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 결과 선택 — 페이지 이동 + 오디오 seek + 하이라이트 이벤트
  const handleSelect = useCallback((result: SearchResult) => {
    if (result.pageNumber > 0) setCurrentPage(result.pageNumber)
    if (result.timestampStart !== undefined) setCurrentTime(result.timestampStart)
    if (result.coordinates) {
      window.dispatchEvent(new CustomEvent('lm-highlight-pos', {
        detail: { pageNumber: result.pageNumber, ...result.coordinates },
      }))
    }
    close()
  }, [setCurrentPage, setCurrentTime, close])

  // 열릴 때 input 포커스 + 인덱스 초기화
  useEffect(() => {
    if (isOpen) {
      setFocusedIndex(0)
      // 다음 프레임에 포커스 (Portal 렌더 후)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isOpen])

  // query 바뀌면 포커스 인덱스 초기화
  useEffect(() => {
    setFocusedIndex(0)
  }, [query])

  // 키보드 핸들러
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((i) => Math.min(i + 1, results.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter' && results[focusedIndex]) {
      e.preventDefault()
      handleSelect(results[focusedIndex])
    }
  }, [close, results, focusedIndex, handleSelect])

  // backdrop 클릭 시 닫기
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close()
  }, [close])

  if (!isOpen) return null

  return (
    <>
      {/* 키프레임 */}
      <style>{`
        @keyframes lm-search-slide-down {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
      `}</style>

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex flex-col items-center pt-16 px-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
        onClick={handleBackdropClick}
      >
        {/* 모달 컨테이너 */}
        <div
          className="w-full overflow-hidden"
          style={{
            maxWidth:        560,
            borderRadius:    16,
            backgroundColor: 'var(--bg-primary)',
            boxShadow:       '0 24px 48px rgba(0,0,0,0.5), 0 0 0 1px var(--border-subtle)',
            animation:       'lm-search-slide-down 180ms ease-out both',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 입력 행 */}
          <div
            className="flex items-center gap-3 px-4"
            style={{
              height:      56,
              borderBottom: results.length > 0 ? '1px solid var(--border-subtle)' : 'none',
            }}
          >
            {/* 검색 아이콘 */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--text-muted)', flexShrink: 0 }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>

            {/* 입력 필드 */}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="검색… (STT, 필기, PDF, 코드, 수식)"
              className="flex-1 text-sm bg-transparent outline-none"
              style={{ color: 'var(--text-primary)' }}
              spellCheck={false}
            />

            {/* 결과 수 뱃지 */}
            {results.length > 0 && (
              <span
                className="text-xs tabular-nums shrink-0"
                style={{ color: 'var(--text-disabled)' }}
              >
                {results.length}건
              </span>
            )}

            {/* 닫기 버튼 */}
            <button
              onClick={close}
              className="p-1 rounded-md shrink-0 transition-colors"
              style={{ color: 'var(--text-muted)' }}
              tabIndex={-1}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6"  x2="6"  y2="18" />
                <line x1="6"  y1="6"  x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* 결과 목록 */}
          {results.length > 0 && (
            <SearchResults
              results={results}
              query={query}
              focusedIndex={focusedIndex}
              onSelect={handleSelect}
              onClose={close}
            />
          )}

          {/* 빈 상태 (쿼리 있고 결과 없음) */}
          {query.trim() && results.length === 0 && (
            <div
              className="py-8 text-center text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              검색 결과가 없습니다
            </div>
          )}

          {/* 하단 힌트 */}
          <div
            className="flex items-center justify-between px-4 py-2"
            style={{
              borderTop:       results.length > 0 ? '1px solid var(--border-subtle)' : 'none',
              color:           'var(--text-disabled)',
            }}
          >
            <span className="text-xs">↑↓ 이동</span>
            <span className="text-xs">Enter 선택 · Esc 닫기</span>
          </div>
        </div>
      </div>
    </>
  )
}
