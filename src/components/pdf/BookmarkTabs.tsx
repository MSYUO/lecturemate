/**
 * @file components/pdf/BookmarkTabs.tsx
 * LectureMate — PDF 뷰어 좌측 북마크 탭
 *
 * ## 역할
 * PDF 뷰어 컨테이너 좌측에 `position: absolute`로 겹쳐,
 * 북마크된 페이지를 세로 색깔 탭으로 시각화합니다.
 *
 * - 탭 세로 위치: (pageNumber / totalPages) 비율로 배치
 * - 클릭 → sessionStore.setCurrentPage()
 * - 호버 → 페이지 번호 + 제목 툴팁
 *
 * ## 부모 컨테이너 요구사항
 * `position: relative` + 스크롤 높이를 반영하는 컨테이너에 배치해야 합니다.
 * PDFViewerPanel의 스크롤 영역 옆에 `left: 0` 으로 붙입니다.
 */

import { useMemo } from 'react'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useSessionStore } from '@/stores/sessionStore'

// ============================================================
// 북마크 색상 팔레트 (color가 없을 때 순환 사용)
// ============================================================

const DEFAULT_COLORS = [
  'var(--accent-blue)',
  '#FF6B6B',
  '#51CF66',
  '#FAB005',
  '#CC5DE8',
  '#20C997',
]

interface Props {
  /** 전체 페이지 수 (북마크 세로 위치 계산용) */
  totalPages: number
}

export function BookmarkTabs({ totalPages }: Props) {
  const bookmarks      = useAnnotationStore((s) => s.bookmarks)
  const currentPage    = useSessionStore((s) => s.currentPage)
  const setCurrentPage = useSessionStore((s) => s.setCurrentPage)

  // 페이지 번호 오름차순 정렬
  const sorted = useMemo(
    () => [...bookmarks].sort((a, b) => a.pageNumber - b.pageNumber),
    [bookmarks],
  )

  if (sorted.length === 0 || totalPages === 0) return null

  return (
    <div
      className="absolute top-0 left-0 h-full pointer-events-none"
      style={{ width: 18, zIndex: 20 }}
    >
      {sorted.map((bm, idx) => {
        const isActive = bm.pageNumber === currentPage
        const color    = bm.color ?? DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
        // 세로 위치: 페이지 중앙 기준
        const topPct = ((bm.pageNumber - 0.5) / totalPages) * 100

        return (
          <button
            key={bm.id}
            title={`p.${bm.pageNumber}${bm.title ? ' — ' + bm.title : ''}`}
            className="absolute left-0 group pointer-events-auto"
            style={{
              top:           `${topPct}%`,
              transform:     'translateY(-50%)',
              width:         isActive ? 16 : 12,
              height:        24,
              backgroundColor: color,
              borderRadius:  '0 4px 4px 0',
              border:        'none',
              cursor:        'pointer',
              transition:    'width 0.15s, opacity 0.15s',
              opacity:       isActive ? 1 : 0.7,
              padding:       0,
            }}
            onClick={() => setCurrentPage(bm.pageNumber)}
          >
            {/* 툴팁 */}
            <span
              className="absolute left-full ml-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap rounded px-1.5 py-0.5 text-xs shadow-lg transition-opacity"
              style={{
                backgroundColor: 'var(--bg-primary)',
                color:           'var(--text-primary)',
                border:          '1px solid var(--border-default)',
              }}
            >
              p.{bm.pageNumber}{bm.title ? ` — ${bm.title}` : ''}
            </span>
          </button>
        )
      })}
    </div>
  )
}
