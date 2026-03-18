/**
 * @file hooks/useHighlighter.ts
 * LectureMate — 형광펜 도구 훅
 *
 * ## 역할
 * - 형광펜 모드(activeToolType === 'highlighter')에서 마우스 드래그 → BoundingBox 계산 → addHighlight
 * - H 키를 누른 채로 1~5 숫자키 → 색상 변경
 * - 현재 선택 색상을 sessionStore.activeHighlightColor에 저장
 *
 * ## 사용법
 * ```tsx
 * const { activeColor, dragHandlers, isDragging, previewBox } = useHighlighter(containerRef, pageNumber)
 *
 * <div ref={containerRef} {...dragHandlers}>
 *   {isDragging && previewBox && <PreviewRect box={previewBox} />}
 * </div>
 * ```
 *
 * ## 색상 단축키
 * H를 누른 상태에서:
 *   1 → yellow, 2 → green, 3 → blue, 4 → pink, 5 → orange
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useSessionStore } from '@/stores/sessionStore'
import { useUndoRedoStore } from '@/stores/undoRedoStore'
import type { BoundingBox, HighlightColor, Point } from '@/types'

// ============================================================
// 상수
// ============================================================

const COLOR_KEYS: Record<string, HighlightColor> = {
  '1': 'yellow',
  '2': 'green',
  '3': 'blue',
  '4': 'pink',
  '5': 'orange',
}

/** 드래그로 인식할 최소 이동 거리 (정규화 단위) */
const MIN_DRAG = 0.005

// ============================================================
// 헬퍼
// ============================================================

function makeBox(a: Point, b: Point): BoundingBox {
  return {
    x:      Math.min(a.x, b.x),
    y:      Math.min(a.y, b.y),
    width:  Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

function toNormalized(e: MouseEvent | React.MouseEvent, el: HTMLElement): Point {
  const rect = el.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height)),
  }
}

// ============================================================
// useHighlighter
// ============================================================

interface UseHighlighterResult {
  /** 현재 선택된 형광펜 색상 */
  activeColor: HighlightColor
  /** 드래그 중 여부 */
  isDragging: boolean
  /** 드래그 preview BoundingBox (정규화 좌표) */
  previewBox: BoundingBox | null
  /** 컨테이너에 spread할 마우스 이벤트 핸들러 */
  dragHandlers: {
    onMouseDown: (e: React.MouseEvent) => void
    onMouseMove: (e: React.MouseEvent) => void
    onMouseUp:   (e: React.MouseEvent) => void
    onMouseLeave: () => void
  }
}

/**
 * @param containerRef  이벤트를 받을 컨테이너 (BoundingClientRect 계산용)
 * @param pageNumber    하이라이트가 속하는 PDF 페이지 번호 (1-based)
 */
export function useHighlighter(
  containerRef: React.RefObject<HTMLElement | null>,
  pageNumber: number,
): UseHighlighterResult {
  // ---- sessionStore ----
  const activeColor             = useSessionStore((s) => s.activeHighlightColor)
  const setActiveHighlightColor = useSessionStore((s) => s.setActiveHighlightColor)
  const activeToolType          = useSessionStore((s) => s.activeToolType)
  const sessionId               = useSessionStore((s) => s.sessionId)
  const pdfId                   = useSessionStore((s) => s.pdfId)

  const isActive = activeToolType === 'highlighter'

  // ---- undoable addHighlight ----
  const addHighlight = useUndoRedoStore((s) => s.addHighlight)

  // ---- 드래그 상태 ----
  const [dragStart,   setDragStart]   = useState<Point | null>(null)
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null)

  // ---- H 키 홀드 상태 ----
  const hKeyHeld = useRef(false)

  // ---- 키보드: H + 1~5 색상 전환 ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 입력 필드 내부에서는 무시
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return

      if (e.key === 'h' || e.key === 'H') {
        hKeyHeld.current = true
        return
      }

      if (hKeyHeld.current && e.key in COLOR_KEYS) {
        e.preventDefault()
        setActiveHighlightColor(COLOR_KEYS[e.key])
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') {
        hKeyHeld.current = false
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
    }
  }, [setActiveHighlightColor])

  // ---- 마우스 이벤트 핸들러 ----

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isActive || !containerRef.current) return
    e.preventDefault()
    const pt = toNormalized(e, containerRef.current)
    setDragStart(pt)
    setDragCurrent(pt)
  }, [isActive, containerRef])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragStart === null || !containerRef.current) return
    setDragCurrent(toNormalized(e, containerRef.current))
  }, [dragStart, containerRef])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (dragStart === null || !containerRef.current) {
      setDragStart(null)
      setDragCurrent(null)
      return
    }

    const end = toNormalized(e, containerRef.current)
    const dx  = Math.abs(end.x - dragStart.x)
    const dy  = Math.abs(end.y - dragStart.y)

    if (
      (dx > MIN_DRAG || dy > MIN_DRAG) &&
      sessionId !== null &&
      pdfId !== null
    ) {
      addHighlight({
        sessionId,
        pdfId,
        pageNumber,
        color: activeColor,
        rects: [makeBox(dragStart, end)],
      })
    }

    setDragStart(null)
    setDragCurrent(null)
  }, [dragStart, containerRef, sessionId, pdfId, pageNumber, activeColor, addHighlight])

  const handleMouseLeave = useCallback(() => {
    setDragStart(null)
    setDragCurrent(null)
  }, [])

  // ---- preview box ----
  const previewBox: BoundingBox | null =
    dragStart !== null && dragCurrent !== null
      ? makeBox(dragStart, dragCurrent)
      : null

  return {
    activeColor,
    isDragging: dragStart !== null,
    previewBox,
    dragHandlers: {
      onMouseDown:  handleMouseDown,
      onMouseMove:  handleMouseMove,
      onMouseUp:    handleMouseUp,
      onMouseLeave: handleMouseLeave,
    },
  }
}
