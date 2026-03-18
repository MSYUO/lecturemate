/**
 * @file hooks/useTagging.ts
 * LectureMate — 태깅 모드 마우스 인터랙션 훅 (Section 7)
 *
 * ## 책임
 * PDF 오버레이 위의 마우스 이벤트를 태그 생성으로 변환합니다.
 * OverlayCanvas 등 1:1로 결합된 컴포넌트에서 사용하세요.
 *
 * ## 태깅 모드 ON (isTaggingMode=true)
 * - Alt+클릭          → addPointTag  (timestampStart = 클릭 시점 currentTime)
 * - 드래그            → addAreaTag   (timestampStart = mouseDown, timestampEnd = mouseUp)
 * - 커서              → crosshair
 *
 * ## 태깅 모드 OFF
 * - 마우스 이벤트를 막지 않음 (PDF 텍스트 선택·스크롤 그대로)
 * - isInteractive = false → OverlayCanvas가 pointerEvents:none 적용
 *
 * ## highlighter 도구
 * - 드래그 → addHighlight (색상: sessionStore.activeHighlightColor)
 * - 태깅 모드보다 우선순위가 낮음 (isTaggerActive 먼저 확인)
 *
 * ## 부수 효과
 * 태그/하이라이트 생성 후 `autoSave.markDirty()` 호출 → 3초 디바운스 자동 저장.
 */

import { useState, useRef, useCallback } from 'react'
import { useSessionStore } from '@/stores/sessionStore'
import { useUndoRedoStore } from '@/stores/undoRedoStore'
import { autoSave } from '@/core/AutoSaveManager'
import type { BoundingBox, Point } from '@/types'

// ============================================================
// 헬퍼
// ============================================================

/** 두 정규화 좌표([0,1])에서 BoundingBox를 계산합니다 (음수 없음) */
function makeBox(a: Point, b: Point): BoundingBox {
  return {
    x:      Math.min(a.x, b.x),
    y:      Math.min(a.y, b.y),
    width:  Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

// ============================================================
// 타입
// ============================================================

export interface UseTaggingParams {
  /** 이 훅이 담당하는 PDF 페이지 번호 (1-based) */
  pageNumber:    number
  /** 마우스 좌표 정규화에 사용할 오버레이 DOM 요소 ref */
  containerRef:  React.RefObject<HTMLElement | null>
}

export interface UseTaggingReturn {
  // ---- 이벤트 핸들러 (오버레이 div에 spread) ----
  onMouseDown:  (e: React.MouseEvent) => void
  onMouseMove:  (e: React.MouseEvent) => void
  onMouseUp:    (e: React.MouseEvent) => void
  onMouseLeave: () => void

  // ---- 파생 상태 (렌더에 사용) ----

  /** 드래그 중 preview 박스 (없으면 null) */
  dragBox:             BoundingBox | null
  /** 태깅 모드 활성 (isTaggingMode && !isHighlighterActive) */
  isTaggerActive:      boolean
  /** highlighter 도구 활성 */
  isHighlighterActive: boolean
  /** 마우스 이벤트를 수신해야 하는 경우 true */
  isInteractive:       boolean
  /** 오버레이에 적용할 CSS cursor 값 */
  cursor:              string
}

// ============================================================
// useTagging
// ============================================================

export function useTagging({ pageNumber, containerRef }: UseTaggingParams): UseTaggingReturn {

  // ---- 세션 상태 ----
  const isTaggingMode        = useSessionStore((s) => s.isTaggingMode)
  const activeToolType       = useSessionStore((s) => s.activeToolType)
  const activeHighlightColor = useSessionStore((s) => s.activeHighlightColor)
  const sessionId            = useSessionStore((s) => s.sessionId)
  const pdfId                = useSessionStore((s) => s.pdfId)

  // ---- undoable 액션 ----
  const addPointTag  = useUndoRedoStore((s) => s.addPointTag)
  const addAreaTag   = useUndoRedoStore((s) => s.addAreaTag)
  const addHighlight = useUndoRedoStore((s) => s.addHighlight)

  // ---- 드래그 상태 ----
  const [dragStart,   setDragStart]   = useState<Point | null>(null)
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null)

  /** mouseDown 시점의 Alt 키 (점 태그 vs 영역 태그 분기) */
  const wasAltDown = useRef(false)
  /** 드래그 시작 시점의 currentTime (영역 태그 timestampStart) */
  const dragStartTime = useRef(0)

  // ---- 파생 모드 ----
  const isHighlighterActive = activeToolType === 'highlighter'
  // 태거 우선: highlighter가 켜져도 태깅 모드가 true면 태그 생성
  const isTaggerActive      = isTaggingMode && !isHighlighterActive
  const isInteractive       = isTaggerActive || isHighlighterActive
  const cursor              = isInteractive ? 'crosshair' : 'default'

  // ============================================================
  // 좌표 변환
  // ============================================================

  const toNormalized = useCallback((e: React.MouseEvent): Point => {
    const el   = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height)),
    }
  }, [containerRef])

  // ============================================================
  // 마우스 이벤트
  // ============================================================

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isInteractive) return
    e.preventDefault()

    wasAltDown.current  = e.altKey
    // 드래그 시작 시점의 currentTime 캡처 (영역 태그 timestampStart 용)
    dragStartTime.current = useSessionStore.getState().currentTime

    const pt = toNormalized(e)
    setDragStart(pt)
    setDragCurrent(pt)
  }, [isInteractive, toNormalized])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragStart === null) return
    setDragCurrent(toNormalized(e))
  }, [dragStart, toNormalized])

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (dragStart === null || sessionId === null || pdfId === null) {
      setDragStart(null)
      setDragCurrent(null)
      return
    }

    const end       = toNormalized(e)
    const dx        = Math.abs(end.x - dragStart.x)
    const dy        = Math.abs(end.y - dragStart.y)
    const hasDragged = dx > 0.005 || dy > 0.005

    // 태그 생성 시 사용할 현재 시각 (mouseUp 시점)
    const nowTime = useSessionStore.getState().currentTime

    if (isTaggerActive) {
      if (!hasDragged && wasAltDown.current) {
        // ── Alt+클릭 → 점 태그 ─────────────────────────────
        addPointTag({
          sessionId,
          pdfId,
          pageNumber,
          position:       dragStart,
          timestampStart: nowTime,
        })
        autoSave.markDirty()

      } else if (hasDragged && !wasAltDown.current) {
        // ── 드래그 → 영역 태그 ─────────────────────────────
        addAreaTag({
          sessionId,
          pdfId,
          pageNumber,
          coordinates:    makeBox(dragStart, end),
          timestampStart: dragStartTime.current,
          timestampEnd:   nowTime,
        })
        autoSave.markDirty()
      }

    } else if (isHighlighterActive && hasDragged) {
      // ── 드래그 → 형광펜 ────────────────────────────────
      addHighlight({
        sessionId,
        pdfId,
        pageNumber,
        color: activeHighlightColor,
        rects: [makeBox(dragStart, end)],
      })
      autoSave.markDirty()
    }

    setDragStart(null)
    setDragCurrent(null)
  }, [
    dragStart, sessionId, pdfId, pageNumber,
    isTaggerActive, isHighlighterActive, activeHighlightColor,
    addPointTag, addAreaTag, addHighlight,
    toNormalized,
  ])

  const onMouseLeave = useCallback(() => {
    setDragStart(null)
    setDragCurrent(null)
  }, [])

  // ============================================================
  // 드래그 preview 박스
  // ============================================================

  const dragBox: BoundingBox | null =
    dragStart !== null && dragCurrent !== null
      ? makeBox(dragStart, dragCurrent)
      : null

  // ============================================================

  return {
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
    dragBox,
    isTaggerActive,
    isHighlighterActive,
    isInteractive,
    cursor,
  }
}
