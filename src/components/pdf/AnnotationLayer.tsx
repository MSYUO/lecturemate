/**
 * @file components/pdf/AnnotationLayer.tsx
 * LectureMate — 텍스트 상자 레이어
 *
 * ## 역할
 * - `annotationStore`의 textboxes를 현재 페이지 기준으로 필터링해 렌더링
 * - `activeToolType === 'textbox'` 일 때 더블클릭으로 새 텍스트 상자 생성
 *
 * ## 이벤트 투명성
 * - textbox 도구 모드:   `pointerEvents: all`  (더블클릭 수신)
 * - 그 외 모드:          `pointerEvents: none` (OverlayCanvas로 이벤트 통과)
 * - TextBoxComponent:  항상 `pointer-events-auto` (드래그·편집 항상 활성)
 *
 * ## 부모 컨테이너 요구사항
 * `position: relative` 컨테이너 내에서 `absolute inset-0`으로 배치됩니다.
 * OverlayCanvas 위(z-index 높음)에 와야 합니다:
 * ```tsx
 * <div className="relative">
 *   <Page />
 *   <OverlayCanvas pageNumber={n} />
 *   <AnnotationLayer pageNumber={n} />   ← 위에
 * </div>
 * ```
 */

import { useRef, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUndoRedoStore } from '@/stores/undoRedoStore'
import { TextBoxComponent } from './TextBoxComponent'

// ============================================================
// 상수
// ============================================================

/** 새 텍스트 상자 기본 너비 (페이지 너비의 28%) */
const DEFAULT_W = 0.28
/** 새 텍스트 상자 기본 높이 (페이지 높이의 6%) */
const DEFAULT_H = 0.06

// ============================================================
// Props
// ============================================================

interface Props {
  /** 이 레이어가 커버하는 PDF 페이지 번호 (1-based) */
  pageNumber: number
}

// ============================================================
// AnnotationLayer
// ============================================================

export function AnnotationLayer({ pageNumber }: Props) {
  const layerRef = useRef<HTMLDivElement>(null)

  // ---- 현재 페이지 텍스트 상자 (shallow 비교로 불필요 리렌더 방지) ----

  const textboxSelector = useMemo(
    () => (s: ReturnType<typeof useAnnotationStore.getState>) =>
      s.textboxes.filter((tb) => tb.pageNumber === pageNumber),
    [pageNumber],
  )
  const textboxes = useAnnotationStore(useShallow(textboxSelector))

  // ---- 세션 / 도구 상태 ----

  const activeToolType = useSessionStore((s) => s.activeToolType)
  const sessionId      = useSessionStore((s) => s.sessionId)
  const pdfId          = useSessionStore((s) => s.pdfId)
  const addTextBox     = useUndoRedoStore((s) => s.addTextBox)

  const isTextboxMode = activeToolType === 'textbox'

  // ---- 더블클릭 → 텍스트 상자 생성 ----

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!isTextboxMode || !sessionId || !pdfId || !layerRef.current) return
    e.preventDefault()
    e.stopPropagation()

    const rect = layerRef.current.getBoundingClientRect()
    // 클릭 좌표 → 정규화 [0, 1]. 우·하단 여백을 남겨 텍스트 상자가 잘리지 않게 함
    const x = Math.min(1 - DEFAULT_W,  Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1 - DEFAULT_H,  Math.max(0, (e.clientY - rect.top)  / rect.height))

    addTextBox({
      sessionId,
      pdfId,
      pageNumber,
      coordinates: { x, y, width: DEFAULT_W, height: DEFAULT_H },
    })
  }

  // ============================================================
  // 렌더
  // ============================================================

  return (
    <div
      ref={layerRef}
      className="absolute inset-0"
      style={{
        /**
         * textbox 모드: 더블클릭 수신 (all)
         * 그 외 모드:   이벤트 통과 (none) — TextBoxComponent 자체는
         *               pointer-events-auto로 항상 인터랙티브
         */
        pointerEvents: isTextboxMode ? 'all' : 'none',
        cursor:        isTextboxMode ? 'crosshair' : 'default',
      }}
      onDoubleClick={handleDoubleClick}
    >
      {textboxes.map((tb) => (
        <TextBoxComponent
          key={tb.id}
          textbox={tb}
          containerRef={layerRef as React.RefObject<HTMLDivElement>}
        />
      ))}
    </div>
  )
}
