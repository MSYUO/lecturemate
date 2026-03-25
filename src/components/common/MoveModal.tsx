/**
 * @file components/common/MoveModal.tsx
 * LectureMate — 폴더 이동 선택 모달 (토스뱅크 스타일)
 *
 * 폴더 트리를 보여주고 이동할 위치를 선택합니다.
 * createPortal로 document.body에 렌더됩니다.
 *
 * Props:
 *   title?     모달 제목 (기본: "이동")
 *   excludeId? 이동 대상 폴더 ID — 트리에서 제외 (자기 자신으로 이동 방지)
 *   onConfirm  이동 확인 (folderId: string | null — null이면 루트)
 *   onClose    모달 닫기
 */

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useFolderStore } from '@/stores/folderStore'
import type { Folder } from '@/types'

// ============================================================
// 트리 아이템
// ============================================================

function TreeItem({
  folder,
  folders,
  excludeId,
  selectedId,
  depth,
  onSelect,
}: {
  folder: Folder
  folders: Folder[]
  excludeId?: string
  selectedId: string | null
  depth: number
  onSelect: (id: string | null) => void
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const children = folders.filter((f) => f.parentId === folder.id && f.id !== excludeId)
  const isSelected = selectedId === folder.id

  return (
    <div>
      <button
        onClick={() => onSelect(folder.id)}
        className="w-full flex items-center gap-2 py-2 rounded-xl text-sm text-left transition-colors"
        style={{
          paddingLeft:     12 + depth * 20,
          paddingRight:    12,
          backgroundColor: isSelected ? 'rgba(49,130,246,0.08)' : 'transparent',
          color:           isSelected ? '#3182F6' : '#191F28',
          fontWeight:      isSelected ? 600 : 400,
        }}
        onMouseEnter={(e) => {
          if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = '#F9FAFB'
        }}
        onMouseLeave={(e) => {
          if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
        }}
      >
        {children.length > 0 ? (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
            className="shrink-0 w-4 h-4 flex items-center justify-center rounded"
            style={{ color: '#8B95A1' }}
          >
            <svg
              width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}

        <svg width="15" height="15" viewBox="0 0 24 24" className="shrink-0">
          <path
            d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
            fill={folder.color}
          />
        </svg>

        <span className="truncate flex-1">{folder.name}</span>

        {isSelected && (
          <svg
            className="shrink-0 ml-auto"
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="#3182F6" strokeWidth="2.5" strokeLinecap="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      {expanded && children.map((child) => (
        <TreeItem
          key={child.id}
          folder={child}
          folders={folders}
          excludeId={excludeId}
          selectedId={selectedId}
          depth={depth + 1}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

// ============================================================
// MoveModal
// ============================================================

interface MoveModalProps {
  title?: string
  excludeId?: string
  onConfirm: (folderId: string | null) => void
  onClose: () => void
}

export function MoveModal({ title = '이동', excludeId, onConfirm, onClose }: MoveModalProps) {
  const { folders, isLoaded, loadFolders } = useFolderStore()
  const [selectedId, setSelectedId]        = useState<string | null>(null)
  const backdropRef                        = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isLoaded) void loadFolders()
  }, [isLoaded, loadFolders])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rootFolders = folders.filter((f) => !f.parentId && f.id !== excludeId)

  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.20)' }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        className="rounded-2xl flex flex-col overflow-hidden"
        style={{
          backgroundColor: '#FFFFFF',
          boxShadow:       '0 20px 60px rgba(0,0,0,0.15)',
          width:           320,
          maxHeight:       '60vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid #F2F4F8' }}
        >
          <p className="text-base font-bold" style={{ color: '#191F28' }}>{title}</p>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:bg-[#F2F4F8]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8B95A1" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 폴더 트리 */}
        <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0">
          {/* 홈 (루트) */}
          <button
            onClick={() => setSelectedId(null)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left transition-colors"
            style={{
              backgroundColor: selectedId === null ? 'rgba(49,130,246,0.08)' : 'transparent',
              color:           selectedId === null ? '#3182F6' : '#191F28',
              fontWeight:      selectedId === null ? 600 : 400,
            }}
            onMouseEnter={(e) => {
              if (selectedId !== null) (e.currentTarget as HTMLElement).style.backgroundColor = '#F9FAFB'
            }}
            onMouseLeave={(e) => {
              if (selectedId !== null) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
            }}
          >
            <span className="w-4 h-4 shrink-0" />
            <svg
              width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="#8B95A1" strokeWidth="1.8" strokeLinecap="round"
              strokeLinejoin="round" className="shrink-0"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span className="flex-1">홈 (루트)</span>
            {selectedId === null && (
              <svg
                className="shrink-0 ml-auto"
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="#3182F6" strokeWidth="2.5" strokeLinecap="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>

          {rootFolders.map((folder) => (
            <TreeItem
              key={folder.id}
              folder={folder}
              folders={folders}
              excludeId={excludeId}
              selectedId={selectedId}
              depth={0}
              onSelect={setSelectedId}
            />
          ))}
        </div>

        {/* 하단 버튼 */}
        <div
          className="flex gap-2 px-5 py-4 shrink-0"
          style={{ borderTop: '1px solid #F2F4F8' }}
        >
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
            style={{ backgroundColor: '#F2F4F8', color: '#4E5968' }}
          >
            취소
          </button>
          <button
            onClick={() => onConfirm(selectedId)}
            className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-95"
            style={{ backgroundColor: '#3182F6', color: '#FFFFFF' }}
          >
            여기로 이동
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
