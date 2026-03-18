/**
 * @file components/sidebar/BookmarkList.tsx
 * LectureMate — 사이드바 북마크 목록
 *
 * ## 역할
 * 사이드바 탭 내부에 북마크 목록을 표시합니다.
 * - 제목 + 페이지 번호
 * - 클릭 → 해당 페이지로 이동
 * - 북마크 없으면 빈 상태 메시지
 * - 각 항목 호버 → 삭제 버튼
 */

import { useMemo } from 'react'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUndoRedoStore } from '@/stores/undoRedoStore'

// ============================================================
// 북마크 색상 팔레트
// ============================================================

const DEFAULT_COLORS = [
  'var(--accent-blue)',
  '#FF6B6B',
  '#51CF66',
  '#FAB005',
  '#CC5DE8',
  '#20C997',
]

// ============================================================
// BookmarkList
// ============================================================

export function BookmarkList() {
  const bookmarks      = useAnnotationStore((s) => s.bookmarks)
  const currentPage    = useSessionStore((s) => s.currentPage)
  const setCurrentPage = useSessionStore((s) => s.setCurrentPage)
  const deleteBookmark = useUndoRedoStore((s) => s.deleteBookmark)

  const sorted = useMemo(
    () => [...bookmarks].sort((a, b) => a.pageNumber - b.pageNumber),
    [bookmarks],
  )

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <span style={{ fontSize: 32, opacity: 0.3 }}>🔖</span>
        <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
          북마크가 없습니다
        </p>
        <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
          Ctrl+B로 현재 페이지를 북마크하세요
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 py-2 px-2">
      {sorted.map((bm, idx) => {
        const isActive = bm.pageNumber === currentPage
        const color    = bm.color ?? DEFAULT_COLORS[idx % DEFAULT_COLORS.length]

        return (
          <div
            key={bm.id}
            className="group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-all"
            style={{
              backgroundColor: isActive
                ? 'var(--bg-tertiary)'
                : 'transparent',
              border: isActive
                ? `1px solid ${color}40`
                : '1px solid transparent',
            }}
            onClick={() => setCurrentPage(bm.pageNumber)}
          >
            {/* 색상 인디케이터 */}
            <div
              className="shrink-0 rounded-full"
              style={{ width: 8, height: 8, backgroundColor: color }}
            />

            {/* 제목 */}
            <span
              className="flex-1 text-sm truncate"
              style={{
                color:      isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isActive ? 500 : 400,
              }}
            >
              {bm.title || `페이지 ${bm.pageNumber}`}
            </span>

            {/* 페이지 번호 */}
            <span
              className="shrink-0 text-xs tabular-nums"
              style={{ color: 'var(--text-muted)' }}
            >
              p.{bm.pageNumber}
            </span>

            {/* 삭제 버튼 (호버 시) */}
            <button
              className="shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:brightness-125"
              style={{
                backgroundColor: 'transparent',
                color:           'var(--text-muted)',
                fontSize:        12,
              }}
              title="북마크 삭제"
              onClick={(e) => {
                e.stopPropagation()
                deleteBookmark(bm.id)
              }}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
