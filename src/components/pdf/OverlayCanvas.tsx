/**
 * @file components/pdf/OverlayCanvas.tsx
 * LectureMate — PDF 오버레이 캔버스
 *
 * ## 역할
 * react-pdf <Page> 위에 `position: absolute / inset: 0`으로 겹쳐,
 * 태그·형광펜을 렌더링하고 마우스 이벤트로 새 엔티티를 생성합니다.
 *
 * ## 부모 컨테이너 요구사항
 * 이 컴포넌트는 `position: relative` 컨테이너 내부에 배치해야 합니다:
 * ```tsx
 * <div className="relative">
 *   <Page pageNumber={n} width={PDF_WIDTH} />
 *   <OverlayCanvas pageNumber={n} />
 * </div>
 * ```
 *
 * ## 좌표계
 * 모든 태그·형광펜 좌표는 [0, 1] 범위의 정규화된 비율입니다.
 * 렌더링 시 `left: ${x*100}%` 방식으로 CSS 변환합니다.
 *
 * ## 이벤트 흐름
 * - 태깅 모드 ON + Alt+클릭  → addPointTag  (useTagging 훅)
 * - 태깅 모드 ON + 드래그    → addAreaTag   (drag preview 표시)
 * - highlighter 도구 + 드래그 → addHighlight (drag preview 표시)
 * - 비인터랙티브 모드         → pointerEvents: none (PDF 텍스트 선택 허용)
 */

import { useRef, useMemo, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useTagging } from '@/hooks/useTagging'
import { seekToTag } from '@/lib/timeSync'
import type { HighlightColor, Tag } from '@/types'

// ============================================================
// 형광펜 드래그 preview 색상 맵 (preview 테두리용)
// ============================================================

const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: 'var(--highlight-yellow)',
  green:  'var(--highlight-green)',
  blue:   'var(--highlight-blue)',
  pink:   'var(--highlight-pink)',
  orange: 'var(--highlight-orange)',
}

// ============================================================
// Props
// ============================================================

interface Props {
  /** 이 오버레이가 붙는 PDF 페이지 번호 (1-based) */
  pageNumber: number
}

// ============================================================
// OverlayCanvas
// ============================================================

export function OverlayCanvas({ pageNumber }: Props) {

  const overlayRef = useRef<HTMLDivElement>(null)

  // ---- 어노테이션 (페이지별 필터링 + shallow 비교) ----
  const tagsSelector = useMemo(
    () => (s: ReturnType<typeof useAnnotationStore.getState>) =>
      s.tags.filter((t) => t.pageNumber === pageNumber),
    [pageNumber],
  )
  const tags = useAnnotationStore(useShallow(tagsSelector))

  // ---- 세션 상태 ----
  const activeHighlightColor = useSessionStore((s) => s.activeHighlightColor)
  const activeTagId          = useSessionStore((s) => s.activeTagId)

  // ---- 태그 클릭 → seekToTag ----
  const handleTagClick = useCallback((e: React.MouseEvent, tag: Tag) => {
    // 태깅 모드에서는 드래그 시작을 막지 않도록 클릭만 처리
    e.stopPropagation()
    seekToTag(tag)
  }, [])

  // ---- 태깅 훅 ----
  const {
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
    dragBox,
    isTaggerActive,
    isInteractive,
  } = useTagging({ pageNumber, containerRef: overlayRef })

  // ============================================================
  // 렌더
  // ============================================================

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 select-none overflow-hidden"
      style={{
        cursor:        isInteractive ? 'crosshair' : 'default',
        // 비인터랙티브 모드: 아래 PDF 텍스트 레이어로 이벤트 통과
        pointerEvents: isInteractive ? 'all' : 'none',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    >

      {/* ── 영역 태그 레이어 ───────────────────────────────── */}
      {tags
        .filter((t) => t.type === 'area')
        .map((t) => {
          const isActive = t.id === activeTagId
          return (
            <div
              key={t.id}
              className="absolute"
              title={t.label ?? `영역 태그 (${t.timestampStart}s)`}
              onClick={(e) => handleTagClick(e, t)}
              style={{
                left:            `${t.coordinates.x      * 100}%`,
                top:             `${t.coordinates.y      * 100}%`,
                width:           `${t.coordinates.width  * 100}%`,
                height:          `${t.coordinates.height * 100}%`,
                border:          isActive
                  ? '2px solid var(--accent-blue)'
                  : '2px dashed var(--accent-blue)',
                borderRadius:    2,
                backgroundColor: isActive
                  ? 'rgba(79, 142, 247, 0.18)'
                  : 'rgba(79, 142, 247, 0.08)',
                cursor:          'pointer',
                pointerEvents:   'auto',
              }}
            />
          )
        })}

      {/* ── 점 태그 레이어 ─────────────────────────────────── */}
      {tags
        .filter((t) => t.type === 'point')
        .map((t) => {
          const isActive = t.id === activeTagId
          return (
            <div
              key={t.id}
              className="absolute"
              title={t.label ?? `점 태그 (${t.timestampStart}s)`}
              onClick={(e) => handleTagClick(e, t)}
              style={{
                left:          `calc(${t.coordinates.x * 100}% - 12px)`,
                top:           `calc(${t.coordinates.y * 100}% - 12px)`,
                width:         24,
                height:        24,
                fontSize:      18,
                lineHeight:    '24px',
                textAlign:     'center',
                cursor:        'pointer',
                pointerEvents: 'auto',
                filter:        isActive ? 'drop-shadow(0 0 4px var(--accent-blue))' : 'none',
                transform:     isActive ? 'scale(1.25)' : 'scale(1)',
                transition:    'transform 150ms, filter 150ms',
              }}
            >
              📌
            </div>
          )
        })}

      {/* ── 페이지 태그 뱃지 ───────────────────────────────── */}
      {tags.filter((t) => t.type === 'page').length > 0 && (
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1" style={{ pointerEvents: 'auto' }}>
          {tags
            .filter((t) => t.type === 'page')
            .map((t) => {
              const isActive = t.id === activeTagId
              return (
                <span
                  key={t.id}
                  className="inline-flex items-center rounded px-1.5 py-0.5 font-medium leading-none"
                  title={t.label ?? `페이지 태그 (${t.timestampStart}s)`}
                  onClick={(e) => handleTagClick(e, t)}
                  style={{
                    fontSize:        10,
                    backgroundColor: isActive ? 'var(--accent-blue)' : 'var(--accent-blue)',
                    color:           '#fff',
                    opacity:         isActive ? 1 : 0.75,
                    cursor:          'pointer',
                    outline:         isActive ? '2px solid #fff' : 'none',
                    outlineOffset:   1,
                    transition:      'opacity 150ms',
                  }}
                >
                  {t.label ?? 'P'}
                </span>
              )
            })}
        </div>
      )}

      {/* ── 드래그 preview ──────────────────────────────────── */}
      {dragBox && (
        <div
          className="absolute pointer-events-none"
          style={{
            left:            `${dragBox.x      * 100}%`,
            top:             `${dragBox.y      * 100}%`,
            width:           `${dragBox.width  * 100}%`,
            height:          `${dragBox.height * 100}%`,
            borderRadius:    2,
            border: isTaggerActive
              ? '2px dashed var(--accent-blue)'
              : `2px solid ${HIGHLIGHT_COLORS[activeHighlightColor]}`,
            backgroundColor: isTaggerActive
              ? 'rgba(79, 142, 247, 0.12)'
              : 'rgba(255, 235, 59, 0.20)',
          }}
        />
      )}
    </div>
  )
}
