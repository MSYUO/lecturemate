/**
 * @file components/pdf/HighlightLayer.tsx
 * LectureMate — 형광펜 하이라이트 레이어
 *
 * ## 역할
 * PDF 페이지 위에 `position: absolute / inset: 0`으로 겹쳐,
 * 저장된 highlight를 반투명 색상 div로 렌더링합니다.
 *
 * - 클릭 → 선택 (파란 테두리)
 * - Delete 키 → 선택된 하이라이트 삭제 (undoable)
 * - 우클릭 → 메모 추가/수정 팝업
 *
 * ## 부모 컨테이너 요구사항
 * `position: relative` 컨테이너 안에 배치해야 합니다.
 * z-index: OverlayCanvas 위, AnnotationLayer 아래.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useUndoRedoStore } from '@/stores/undoRedoStore'
import type { HighlightColor } from '@/types'

// ============================================================
// 형광펜 색상 맵 (CSS 변수)
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
  /** 이 레이어가 붙는 PDF 페이지 번호 (1-based) */
  pageNumber: number
}

// ============================================================
// NotePopup — 하이라이트 메모 입력 팝업
// ============================================================

interface NotePopupProps {
  note: string
  /** 팝업 기준점 (레이어 내 px 좌표) */
  anchorX: number
  anchorY: number
  layerWidth: number
  layerHeight: number
  onSave: (note: string) => void
  onClose: () => void
}

function NotePopup({ note, anchorX, anchorY, layerWidth, layerHeight, onSave, onClose }: NotePopupProps) {
  const [text, setText] = useState(note)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 팝업 크기
  const POPUP_W = 240
  const POPUP_H = 130

  // 화면 밖으로 나가지 않도록 위치 보정
  const left = Math.min(anchorX, layerWidth  - POPUP_W - 8)
  const top  = anchorY + POPUP_H + 8 > layerHeight
    ? anchorY - POPUP_H - 4
    : anchorY + 4

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.stopPropagation(); onSave(text) }
  }

  // 팝업 외부 클릭 시 닫기
  const popupRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onClose])

  return (
    <div
      ref={popupRef}
      className="absolute z-50 rounded-xl overflow-hidden shadow-2xl flex flex-col"
      style={{
        left,
        top,
        width:           POPUP_W,
        backgroundColor: 'var(--bg-primary)',
        border:          '1px solid var(--border-default)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 헤더 */}
      <div
        className="px-3 py-2 text-xs font-medium"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          color:           'var(--text-secondary)',
          borderBottom:    '1px solid var(--border-default)',
        }}
      >
        메모
      </div>

      {/* 텍스트 에어리어 */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        placeholder="메모를 입력하세요..."
        className="w-full px-3 py-2 text-sm resize-none outline-none"
        style={{
          backgroundColor: 'var(--bg-primary)',
          color:           'var(--text-primary)',
        }}
      />

      {/* 버튼 영역 */}
      <div
        className="flex items-center justify-end gap-2 px-3 py-2"
        style={{ borderTop: '1px solid var(--border-default)' }}
      >
        <span className="text-xs mr-auto" style={{ color: 'var(--text-muted)' }}>
          Ctrl+Enter 저장
        </span>
        <button
          onClick={onClose}
          className="px-2.5 py-1 rounded text-xs transition-all hover:brightness-110"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
        >
          취소
        </button>
        <button
          onClick={() => onSave(text)}
          className="px-2.5 py-1 rounded text-xs font-medium transition-all hover:brightness-110"
          style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}
        >
          저장
        </button>
      </div>
    </div>
  )
}

// ============================================================
// HighlightLayer
// ============================================================

export function HighlightLayer({ pageNumber }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notePopup, setNotePopup]   = useState<{
    id: string
    note: string
    anchorX: number
    anchorY: number
  } | null>(null)

  const layerRef = useRef<HTMLDivElement>(null)

  // ---- 페이지별 하이라이트 (shallow 비교) ----
  const highlightsSelector = useMemo(
    () => (s: ReturnType<typeof useAnnotationStore.getState>) =>
      s.highlights.filter((h) => h.pageNumber === pageNumber),
    [pageNumber],
  )
  const highlights = useAnnotationStore(useShallow(highlightsSelector))

  // ---- Undoable 액션 ----
  const deleteHighlight      = useUndoRedoStore((s) => s.deleteHighlight)
  const updateHighlightNote  = useUndoRedoStore((s) => s.updateHighlightNote)

  // ---- Delete 키로 선택된 하이라이트 삭제 ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Delete' &&
        selectedId !== null &&
        notePopup === null &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        deleteHighlight(selectedId)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, notePopup, deleteHighlight])

  // ---- 클릭 핸들러 ----
  const handleRectClick = useCallback(
    (e: React.MouseEvent, hlId: string) => {
      e.stopPropagation()
      setSelectedId((prev) => (prev === hlId ? null : hlId))
    },
    [],
  )

  // ---- 우클릭 핸들러 ----
  const handleRectContextMenu = useCallback(
    (e: React.MouseEvent, hlId: string) => {
      e.preventDefault()
      e.stopPropagation()
      const layer = layerRef.current
      if (!layer) return
      const rect = layer.getBoundingClientRect()
      const hl = highlights.find((h) => h.id === hlId)
      setSelectedId(hlId)
      setNotePopup({
        id:      hlId,
        note:    hl?.note ?? '',
        anchorX: e.clientX - rect.left,
        anchorY: e.clientY - rect.top,
      })
    },
    [highlights],
  )

  // ---- 레이어 배경 클릭 시 선택 해제 ----
  const handleLayerClick = useCallback(() => {
    setSelectedId(null)
  }, [])

  // ---- 팝업 저장 ----
  const handleNoteSave = useCallback(
    (note: string) => {
      if (!notePopup) return
      updateHighlightNote(notePopup.id, note)
      setNotePopup(null)
    },
    [notePopup, updateHighlightNote],
  )

  // ---- 레이어 크기 (팝업 위치 보정용) ----
  const layerWidth  = layerRef.current?.offsetWidth  ?? 720
  const layerHeight = layerRef.current?.offsetHeight ?? 842

  // ============================================================
  // 렌더
  // ============================================================

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 overflow-visible"
      style={{ pointerEvents: 'none' }}
      onClick={handleLayerClick}
    >
      {highlights.map((hl) =>
        hl.rects.map((rect, i) => {
          const isSelected = selectedId === hl.id
          const isFirst    = i === 0   // 첫 번째 rect에만 선택 테두리 표시

          return (
            <div
              key={`${hl.id}-${i}`}
              className="absolute"
              style={{
                left:            `${rect.x      * 100}%`,
                top:             `${rect.y      * 100}%`,
                width:           `${rect.width  * 100}%`,
                height:          `${rect.height * 100}%`,
                backgroundColor: HIGHLIGHT_COLORS[hl.color] ?? HIGHLIGHT_COLORS.yellow,
                mixBlendMode:    'multiply',
                cursor:          'pointer',
                pointerEvents:   'auto',
                // 선택 시 테두리 표시
                outline:         isSelected && isFirst
                  ? '2px solid var(--accent-blue)'
                  : 'none',
                outlineOffset:   isSelected && isFirst ? '1px' : undefined,
                // 호버 시 살짝 밝게
                transition:      'filter 0.1s',
              }}
              onClick={(e) => handleRectClick(e, hl.id)}
              onContextMenu={(e) => handleRectContextMenu(e, hl.id)}
            />
          )
        }),
      )}

      {/* ── 메모 팝업 ────────────────────────────────────── */}
      {notePopup && (
        <NotePopup
          note={notePopup.note}
          anchorX={notePopup.anchorX}
          anchorY={notePopup.anchorY}
          layerWidth={layerWidth}
          layerHeight={layerHeight}
          onSave={handleNoteSave}
          onClose={() => setNotePopup(null)}
        />
      )}

      {/* ── 선택된 하이라이트 메모 뱃지 ─────────────────── */}
      {selectedId !== null && (() => {
        const hl = highlights.find((h) => h.id === selectedId)
        if (!hl?.note) return null
        const firstRect = hl.rects[0]
        return (
          <div
            className="absolute pointer-events-none rounded px-1.5 py-0.5 text-xs shadow"
            style={{
              left:            `${firstRect.x * 100}%`,
              top:             `calc(${(firstRect.y + firstRect.height) * 100}% + 4px)`,
              maxWidth:        200,
              backgroundColor: 'var(--bg-primary)',
              color:           'var(--text-primary)',
              border:          '1px solid var(--border-default)',
              whiteSpace:      'pre-wrap',
              wordBreak:       'break-word',
              lineHeight:      1.4,
            }}
          >
            {hl.note}
          </div>
        )
      })()}
    </div>
  )
}
