/**
 * @file components/home/_shared.tsx
 * LectureMate — 홈·폴더 페이지 공통 하위 컴포넌트
 *
 * FolderCard, SessionCard, ContextMenu, InlineRenameInput, formatDate
 * HomePage.tsx와 FolderPage.tsx에서 import해서 사용합니다.
 */

import { useState, useEffect, useRef } from 'react'
import { FOLDER_COLORS } from '@/stores/folderStore'
import { MoveModal } from '@/components/common/MoveModal'
import type { Folder, Session } from '@/types'

// ============================================================
// 날짜 포맷 헬퍼
// ============================================================

export function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

// ============================================================
// ContextMenu
// ============================================================

export interface ContextMenuState {
  x: number
  y: number
  type: 'folder' | 'session'
  target: Folder | Session
}

function CtxMenuItem({
  label, onClick, danger,
}: {
  label: string; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center px-4 py-2.5 text-sm text-left transition-colors"
      style={{ color: danger ? '#F03E3E' : '#191F28', backgroundColor: 'transparent' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#F9FAFB' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
    >
      {label}
    </button>
  )
}

export function ContextMenu({
  menu, onClose, onRename, onDelete, onMove, onColorChange,
}: {
  menu: ContextMenuState
  onClose: () => void
  onRename: () => void
  onDelete: () => void
  onMove: (folderId: string | null) => void
  onColorChange?: (color: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [showMoveModal, setShowMoveModal] = useState(false)

  useEffect(() => {
    if (showMoveModal) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, showMoveModal])

  return (
    <>
      {!showMoveModal && (
        <div
          ref={ref}
          className="fixed z-50 rounded-2xl overflow-hidden py-1"
          style={{
            left:            menu.x,
            top:             menu.y,
            backgroundColor: '#FFFFFF',
            border:          '1px solid #F2F4F8',
            boxShadow:       '0 8px 32px rgba(0,0,0,0.12)',
            minWidth:        164,
          }}
        >
          <CtxMenuItem label="이름 바꾸기" onClick={onRename} />
          <CtxMenuItem label="이동" onClick={() => setShowMoveModal(true)} />
          {menu.type === 'folder' && onColorChange && (
            <div className="px-4 py-2">
              <p className="text-xs mb-2 font-medium" style={{ color: '#8B95A1' }}>폴더 색상</p>
              <div className="flex gap-2 flex-wrap">
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => { onColorChange(c); onClose() }}
                    className="w-5 h-5 rounded-full transition-transform hover:scale-125"
                    style={{
                      backgroundColor: c,
                      outline: (menu.target as Folder).color === c ? `2px solid ${c}` : 'none',
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          <div style={{ height: 1, backgroundColor: '#F2F4F8', margin: '4px 0' }} />
          <CtxMenuItem label="삭제" onClick={onDelete} danger />
        </div>
      )}
      {showMoveModal && (
        <MoveModal
          excludeId={menu.type === 'folder' ? menu.target.id : undefined}
          onConfirm={(folderId) => {
            setShowMoveModal(false)
            onMove(folderId)
            onClose()
          }}
          onClose={() => setShowMoveModal(false)}
        />
      )}
    </>
  )
}

// ============================================================
// InlineRenameInput (이름 바꾸기 모달)
// ============================================================

export function InlineRenameInput({
  defaultValue, onConfirm, onCancel,
}: {
  defaultValue: string
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(defaultValue)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.20)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-2xl p-6"
        style={{
          backgroundColor: '#FFFFFF',
          boxShadow:       '0 20px 60px rgba(0,0,0,0.15)',
          width:           340,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-base font-bold mb-4" style={{ color: '#191F28' }}>이름 바꾸기</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) onConfirm(value.trim())
            if (e.key === 'Escape') onCancel()
          }}
          className="w-full px-4 py-3 rounded-xl text-sm outline-none mb-5"
          style={{
            border:          '1.5px solid #3182F6',
            backgroundColor: '#F9FAFB',
            color:           '#191F28',
          }}
        />
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
            style={{ backgroundColor: '#F2F4F8', color: '#4E5968' }}
          >
            취소
          </button>
          <button
            onClick={() => value.trim() && onConfirm(value.trim())}
            className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-95"
            style={{ backgroundColor: '#3182F6', color: '#FFFFFF' }}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// FolderCard
// ============================================================

export function FolderCard({
  folder, childCount, onClick, onContextMenu,
}: {
  folder: Folder
  childCount: number
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="flex flex-col items-center gap-2 p-4 rounded-2xl transition-all text-left select-none"
      style={{
        backgroundColor: '#FFFFFF',
        border:          '1px solid #F2F4F8',
        boxShadow:       '0 2px 12px rgba(0,0,0,0.05)',
        cursor:          'pointer',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 24px rgba(0,0,0,0.10)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.05)' }}
    >
      {/* 폴더 아이콘 */}
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ backgroundColor: `${folder.color}18` }}
      >
        <svg width="30" height="30" viewBox="0 0 24 24">
          <path
            d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
            fill={folder.color}
          />
        </svg>
      </div>
      {/* 이름 */}
      <span
        className="text-sm font-semibold text-center leading-tight line-clamp-2 w-full"
        style={{ color: '#191F28' }}
      >
        {folder.name}
      </span>
      {/* 항목 수 */}
      <span className="text-xs" style={{ color: '#8B95A1' }}>
        {childCount}개 항목
      </span>
    </button>
  )
}

// ============================================================
// SessionCard
// ============================================================

export function SessionCard({
  session, onClick, onContextMenu,
}: {
  session: Session
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const durationMin = Math.floor(session.duration / 60)

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="flex flex-col p-4 rounded-2xl transition-all text-left select-none"
      style={{
        backgroundColor: '#FFFFFF',
        border:          '1px solid #F2F4F8',
        boxShadow:       '0 2px 12px rgba(0,0,0,0.05)',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 24px rgba(0,0,0,0.10)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.05)' }}
    >
      {/* 아이콘 */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
        style={{ backgroundColor: 'rgba(49,130,246,0.08)' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3182F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      {/* 제목 */}
      <p
        className="text-sm font-semibold leading-tight line-clamp-2 mb-1"
        style={{ color: '#191F28' }}
      >
        {session.title || '제목 없는 세션'}
      </p>
      {/* 날짜 */}
      <p className="text-xs mb-3" style={{ color: '#8B95A1' }}>
        {formatDate(session.createdAt)}
        {durationMin > 0 && ` · ${durationMin}분`}
      </p>
      {/* 배지 */}
      <div className="flex items-center gap-1 flex-wrap mt-auto">
        {session.hasPdf && (
          <span
            className="text-xs px-2 py-0.5 rounded-lg font-medium"
            style={{ backgroundColor: 'rgba(49,130,246,0.08)', color: '#3182F6' }}
          >
            PDF
          </span>
        )}
        {session.hasRecording && (
          <span
            className="text-xs px-2 py-0.5 rounded-lg font-medium"
            style={{ backgroundColor: 'rgba(255,82,82,0.08)', color: '#FF5252' }}
          >
            녹음
          </span>
        )}
        {session.hasNotes && (
          <span
            className="text-xs px-2 py-0.5 rounded-lg font-medium"
            style={{ backgroundColor: 'rgba(5,196,107,0.08)', color: '#05C46B' }}
          >
            노트
          </span>
        )}
      </div>
    </button>
  )
}
