/**
 * @file hooks/useDragDrop.ts
 * LectureMate — STT 세그먼트 → PDF 드래그앤드롭 훅
 *
 * ## 흐름
 * ```
 * STTStream 세그먼트 (useDraggable)
 *   ↓  드래그 시작 → activeSegment 저장
 *   ↓  드래그 중   → DragOverlay가 ghost 카드 렌더링
 *   ↓  PDF 페이지에 드롭
 *        1. active.rect.current.translated 로 드롭 중심 좌표 계산
 *        2. over.rect 로 정규화 (0~1)
 *        3. annotationStore.addTextBox + updateTextBox(content)
 *        4. findTagsAtTime → linkedTagId 연결
 *        5. dropSuccessId 세팅 → 체크 애니메이션
 * ```
 *
 * ## 드롭 타겟 ID 규칙
 * PDFViewerPanel의 각 페이지: `pdf-page-{pageNumber}`
 *
 * ## App.tsx에서 DndContext 최상위 래핑:
 * ```tsx
 * const dnd = useDragDrop()
 * <DndContext sensors={dnd.sensors} onDragStart={dnd.handleDragStart} onDragEnd={dnd.handleDragEnd}>
 *   ...
 *   <DragOverlay>{ dnd.activeSegment && <SegmentDragOverlay segment={dnd.activeSegment} /> }</DragOverlay>
 * </DndContext>
 * ```
 */

import { useState, useCallback } from 'react'
import {
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useSessionStore } from '@/stores/sessionStore'
import { findTagsAtTime } from '@/lib/timeSync'
import type { SttSegment } from '@/types'

// ============================================================
// 상수
// ============================================================

/** PDF 페이지 드롭 타겟 ID 접두어 */
export const PDF_DROP_ID_PREFIX = 'pdf-page-'

/** 생성할 텍스트 상자의 정규화 너비 (페이지 너비 대비) */
const TEXTBOX_W = 0.30
/** 생성할 텍스트 상자의 정규화 높이 (페이지 높이 대비) */
const TEXTBOX_H = 0.06

// ============================================================
// 헬퍼
// ============================================================

/** 페이지 번호로 드롭 타겟 ID를 만듭니다 */
export function pdfDropId(pageNumber: number): string {
  return `${PDF_DROP_ID_PREFIX}${pageNumber}`
}

// ============================================================
// 반환 타입
// ============================================================

export interface UseDragDropReturn {
  sensors:         ReturnType<typeof useSensors>
  /** 드래그 중인 세그먼트 — DragOverlay 렌더에 사용 */
  activeSegment:   SttSegment | null
  /** 드롭 성공한 텍스트 상자 ID — 체크 애니메이션에 사용 */
  dropSuccessId:   string | null
  handleDragStart: (e: DragStartEvent) => void
  handleDragEnd:   (e: DragEndEvent)   => void
}

// ============================================================
// useDragDrop
// ============================================================

export function useDragDrop(): UseDragDropReturn {
  const [activeSegment, setActiveSegment] = useState<SttSegment | null>(null)
  const [dropSuccessId, setDropSuccessId] = useState<string | null>(null)

  // 8px 이동 후 드래그 시작 — 단순 클릭과 구분
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  // ── 드래그 시작 ───────────────────────────────────────────
  const handleDragStart = useCallback((e: DragStartEvent) => {
    const segment = e.active.data.current?.segment as SttSegment | undefined
    setActiveSegment(segment ?? null)
  }, [])

  // ── 드래그 종료 ───────────────────────────────────────────
  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setActiveSegment(null)

    const { over, active } = e

    // 드롭 타겟 검증
    if (!over || !active.data.current?.segment) return
    const overId = String(over.id)
    if (!overId.startsWith(PDF_DROP_ID_PREFIX)) return

    const segment    = active.data.current.segment as SttSegment
    const pageNumber = over.data.current?.pageNumber as number | undefined
    if (!pageNumber) return

    // ── 정규화 좌표 계산 ──────────────────────────────────
    // active.rect.current.translated: 드래그 종료 시 드래거블의 ClientRect
    // over.rect: 드롭 타겟(페이지)의 ClientRect
    const translatedRect = active.rect.current.translated
    if (!translatedRect) return

    const overRect = over.rect
    const centerX  = translatedRect.left + translatedRect.width  / 2
    const centerY  = translatedRect.top  + translatedRect.height / 2

    // 페이지 기준 정규화 (0~1), 텍스트 상자가 페이지 밖으로 나가지 않도록 clamp
    const x = Math.max(0, Math.min(1 - TEXTBOX_W, (centerX - overRect.left) / overRect.width  - TEXTBOX_W / 2))
    const y = Math.max(0, Math.min(1 - TEXTBOX_H, (centerY - overRect.top)  / overRect.height - TEXTBOX_H / 2))

    // ── 세션·PDF 확인 ─────────────────────────────────────
    const { sessionId, pdfId } = useSessionStore.getState()
    if (!sessionId || !pdfId) return

    // ── linkedTagId: 세그먼트 시간대의 태그와 연결 ─────────
    const { tags }     = useAnnotationStore.getState()
    const matchingTags = findTagsAtTime(segment.startTime, tags)
    const linkedTagId  =
      matchingTags.find((t) => t.pageNumber === pageNumber)?.id ??
      matchingTags[0]?.id

    // ── 텍스트 상자 생성 ──────────────────────────────────
    const store   = useAnnotationStore.getState()
    const textbox = store.addTextBox({
      sessionId,
      pdfId,
      pageNumber,
      coordinates: { x, y, width: TEXTBOX_W, height: TEXTBOX_H },
      linkedTagId,
    })
    // addTextBox는 content='' 으로 생성 → 즉시 STT 텍스트로 업데이트
    store.updateTextBox(textbox.id, { content: segment.text })

    // ── 드롭 성공 피드백 ──────────────────────────────────
    setDropSuccessId(textbox.id)
    setTimeout(() => setDropSuccessId(null), 1_500)
  }, [])

  return { sensors, activeSegment, dropSuccessId, handleDragStart, handleDragEnd }
}
