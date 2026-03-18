/**
 * @file components/pdf/StickerLayer.tsx
 * LectureMate — PDF 스티커 레이어
 *
 * ## 역할
 * PDF 페이지 위에 `position: absolute / inset: 0`으로 겹쳐,
 * 스티커(이모지 아이콘)를 배치·표시합니다.
 *
 * - 클릭(sticker 도구 활성 시) → 해당 좌표에 스티커 배치
 * - 드래그 → 스티커 이동 (undoable: 삭제 후 재생성)
 * - 더블클릭 → 라벨 텍스트 인라인 편집
 * - Delete 키 → 선택된 스티커 삭제
 * - 우클릭 → 컨텍스트 메뉴 (삭제)
 *
 * ## 부모 컨테이너 요구사항
 * `position: relative` 컨테이너 안에 배치해야 합니다.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUndoRedoStore } from '@/stores/undoRedoStore'
import type { StickerType, Point } from '@/types'

// ============================================================
// 스티커 타입별 이모지
// ============================================================

export const STICKER_EMOJI: Record<StickerType, string> = {
  important:  '⭐',
  question:   '❓',
  review:     '🔄',
  exam:       '📝',
  understand: '✅',
  difficult:  '🔴',
  custom:     '📌',
}

/** 스티커 표시 크기 (px) */
const STICKER_SIZE = 32

// ============================================================
// Props
// ============================================================

interface Props {
  pageNumber: number
  /** StickerPalette에서 선택된 활성 스티커 타입 */
  activeStickerType: StickerType
}

// ============================================================
// StickerLayer
// ============================================================

export function StickerLayer({ pageNumber, activeStickerType }: Props) {
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [editingId,  setEditingId]        = useState<string | null>(null)
  const [editLabel,  setEditLabel]        = useState('')
  const [contextMenu, setContextMenu]     = useState<{
    id: string; x: number; y: number
  } | null>(null)

  // 드래그 상태
  const dragRef = useRef<{
    id: string
    startNorm: Point   // 드래그 시작 시 스티커 정규화 좌표
    mouseStart: Point  // 드래그 시작 시 마우스 정규화 좌표
    moved: boolean
  } | null>(null)
  const [dragPreview, setDragPreview] = useState<{ id: string; pos: Point } | null>(null)

  const layerRef    = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // ---- 세션 상태 ----
  const activeToolType = useSessionStore((s) => s.activeToolType)
  const sessionId      = useSessionStore((s) => s.sessionId)
  const pdfId          = useSessionStore((s) => s.pdfId)

  // ---- 페이지별 스티커 ----
  const stickersSelector = useMemo(
    () => (s: ReturnType<typeof useAnnotationStore.getState>) =>
      s.stickers.filter((s) => s.pageNumber === pageNumber),
    [pageNumber],
  )
  const stickers = useAnnotationStore(useShallow(stickersSelector))

  // ---- Undoable 액션 ----
  const addSticker    = useUndoRedoStore((s) => s.addSticker)
  const deleteSticker = useUndoRedoStore((s) => s.deleteSticker)
  // updateSticker이 없으므로 이동은 삭제→재생성으로 처리
  const updateStickerLabel = useAnnotationStore((_s) => {
    // annotationStore에 직접 접근해 label만 업데이트
    return (id: string, label: string) => {
      const stickersArr = useAnnotationStore.getState().stickers
      const idx = stickersArr.findIndex((st) => st.id === id)
      if (idx === -1) return
      useAnnotationStore.setState((state) => ({
        stickers: state.stickers.map((st) => st.id === id ? { ...st, label } : st),
      }))
    }
  })

  // ---- 좌표 변환 ----
  const toNorm = useCallback((clientX: number, clientY: number): Point => {
    const rect = layerRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top)  / rect.height)),
    }
  }, [])

  // ---- Delete 키로 삭제 ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Delete' &&
        selectedId !== null &&
        editingId === null &&
        contextMenu === null &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        deleteSticker(selectedId)
        setSelectedId(null)
      }
      if (e.key === 'Escape') {
        setSelectedId(null)
        setContextMenu(null)
        setEditingId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, editingId, contextMenu, deleteSticker])

  // 컨텍스트 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [contextMenu])

  // 편집 모드 진입 시 input focus
  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingId])

  // ---- 레이어 배경 클릭 → 스티커 배치 or 선택 해제 ----
  const handleLayerClick = useCallback((e: React.MouseEvent) => {
    if (e.target !== layerRef.current) return  // 스티커 자체 클릭은 handleStickerClick이 처리
    setSelectedId(null)
    setContextMenu(null)

    if (activeToolType !== 'tagger' || sessionId === null || pdfId === null) return
    const pos = toNorm(e.clientX, e.clientY)
    addSticker({ sessionId, pdfId, pageNumber, type: activeStickerType, coordinates: pos })
  }, [activeToolType, sessionId, pdfId, pageNumber, activeStickerType, addSticker, toNorm])

  // ---- 스티커 클릭 ----
  const handleStickerClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (dragRef.current?.moved) return  // 드래그 후 click 이벤트 무시
    setSelectedId((prev) => prev === id ? null : id)
    setContextMenu(null)
  }, [])

  // ---- 더블클릭 → 라벨 편집 ----
  const handleStickerDblClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const st = stickers.find((s) => s.id === id)
    setEditingId(id)
    setEditLabel(st?.label ?? '')
  }, [stickers])

  // ---- 라벨 편집 완료 ----
  const commitLabel = useCallback(() => {
    if (editingId === null) return
    updateStickerLabel(editingId, editLabel.trim())
    setEditingId(null)
  }, [editingId, editLabel, updateStickerLabel])

  const handleLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.stopPropagation()
      commitLabel()
    }
  }

  // ---- 우클릭 컨텍스트 메뉴 ----
  const handleStickerContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedId(id)
    const rect = layerRef.current!.getBoundingClientRect()
    setContextMenu({ id, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])

  // ---- 드래그: mousedown ----
  const handleStickerMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const st = stickers.find((s) => s.id === id)
    if (!st) return
    const mouseStart = toNorm(e.clientX, e.clientY)
    dragRef.current = {
      id,
      startNorm:  st.coordinates,
      mouseStart,
      moved: false,
    }
    setSelectedId(id)
  }, [stickers, toNorm])

  // ---- 드래그: mousemove (window 레벨) ----
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current || !layerRef.current) return
      const cur = toNorm(e.clientX, e.clientY)
      const dx = cur.x - dragRef.current.mouseStart.x
      const dy = cur.y - dragRef.current.mouseStart.y
      if (!dragRef.current.moved && Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005) return
      dragRef.current.moved = true
      const newPos: Point = {
        x: Math.max(0, Math.min(1, dragRef.current.startNorm.x + dx)),
        y: Math.max(0, Math.min(1, dragRef.current.startNorm.y + dy)),
      }
      setDragPreview({ id: dragRef.current.id, pos: newPos })
    }

    const onMouseUp = (e: MouseEvent) => {
      if (!dragRef.current) return
      const { id, moved, startNorm, mouseStart } = dragRef.current
      if (moved) {
        const cur = toNorm(e.clientX, e.clientY)
        const dx = cur.x - mouseStart.x
        const dy = cur.y - mouseStart.y
        const newPos: Point = {
          x: Math.max(0, Math.min(1, startNorm.x + dx)),
          y: Math.max(0, Math.min(1, startNorm.y + dy)),
        }
        // 이동: 삭제 후 재생성 (undo-safe)
        const st = useAnnotationStore.getState().stickers.find((s) => s.id === id)
        if (st && sessionId && pdfId) {
          deleteSticker(id)
          addSticker({
            sessionId,
            pdfId,
            pageNumber: st.pageNumber,
            type:        st.type,
            coordinates: newPos,
            label:       st.label,
          })
        }
      }
      dragRef.current = null
      setDragPreview(null)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [toNorm, sessionId, pdfId, deleteSticker, addSticker])

  // ============================================================
  // 렌더
  // ============================================================

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 overflow-visible"
      style={{ pointerEvents: activeToolType === 'tagger' ? 'all' : 'none' }}
      onClick={handleLayerClick}
    >
      {stickers.map((st) => {
        const pos      = dragPreview?.id === st.id ? dragPreview.pos : st.coordinates
        const isSelected  = selectedId === st.id
        const isEditing   = editingId  === st.id
        const isDragging  = dragPreview?.id === st.id

        return (
          <div
            key={st.id}
            className="absolute flex flex-col items-center gap-0.5 select-none"
            style={{
              left:         `calc(${pos.x * 100}% - ${STICKER_SIZE / 2}px)`,
              top:          `calc(${pos.y * 100}% - ${STICKER_SIZE / 2}px)`,
              pointerEvents: 'auto',
              cursor:        'grab',
              zIndex:        isSelected ? 10 : 1,
              opacity:       isDragging ? 0.7 : 1,
              transform:     isSelected ? 'scale(1.15)' : 'scale(1)',
              transition:    isDragging ? 'none' : 'transform 0.1s',
              filter:        isSelected
                ? 'drop-shadow(0 0 4px var(--accent-blue))'
                : 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))',
            }}
            onClick={(e) => handleStickerClick(e, st.id)}
            onDoubleClick={(e) => handleStickerDblClick(e, st.id)}
            onContextMenu={(e) => handleStickerContextMenu(e, st.id)}
            onMouseDown={(e) => handleStickerMouseDown(e, st.id)}
          >
            {/* 이모지 아이콘 */}
            <span style={{ fontSize: STICKER_SIZE, lineHeight: 1 }}>
              {STICKER_EMOJI[st.type]}
            </span>

            {/* 라벨 — 편집 중이면 input, 아니면 텍스트 */}
            {isEditing ? (
              <input
                ref={editInputRef}
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                onBlur={commitLabel}
                onKeyDown={handleLabelKeyDown}
                className="text-center rounded px-1 outline-none"
                style={{
                  fontSize:        10,
                  width:           80,
                  backgroundColor: 'var(--bg-primary)',
                  color:           'var(--text-primary)',
                  border:          '1px solid var(--border-focus)',
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : st.label ? (
              <span
                className="rounded px-1 text-center leading-tight"
                style={{
                  fontSize:        10,
                  maxWidth:        80,
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  color:           '#fff',
                  wordBreak:       'break-word',
                }}
              >
                {st.label}
              </span>
            ) : null}
          </div>
        )
      })}

      {/* ── 컨텍스트 메뉴 ──────────────────────────────────── */}
      {contextMenu && (
        <div
          className="absolute z-50 rounded-lg overflow-hidden shadow-xl"
          style={{
            left:            contextMenu.x,
            top:             contextMenu.y,
            backgroundColor: 'var(--bg-primary)',
            border:          '1px solid var(--border-default)',
            minWidth:        120,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:brightness-110 transition-all"
            style={{ color: 'var(--accent-red)' }}
            onClick={(e) => {
              e.stopPropagation()
              deleteSticker(contextMenu.id)
              setSelectedId(null)
              setContextMenu(null)
            }}
          >
            <span>🗑</span> 삭제
          </button>
        </div>
      )}
    </div>
  )
}
