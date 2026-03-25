/**
 * @file components/common/SaveLocationModal.tsx
 * LectureMate — 저장 위치 선택 모달
 *
 * 녹음 완료, PDF 첨부, 정리 노트 완성 시 표시됩니다.
 * useSaveLocationStore.requestFolder()로 호출하면 Promise를 반환합니다.
 *
 * 기능:
 * - 폴더 트리 구조 표시 및 선택
 * - "여기에 저장" 확인
 * - "새 폴더 만들기"
 * - "항상 같은 폴더에 저장" 체크박스 → sessionStore.defaultSaveFolderId
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSaveLocationStore } from '@/stores/saveLocationStore'
import { useFolderStore } from '@/stores/folderStore'
import { useSessionStore } from '@/stores/sessionStore'
import type { Folder } from '@/types'

// ============================================================
// 파일 종류별 레이블 / 아이콘
// ============================================================

const FILE_TYPE_META = {
  recording: { icon: '🎙', label: '녹음 파일을 어디에 저장할까요?' },
  pdf:       { icon: '📄', label: 'PDF를 어디에 저장할까요?' },
  notes:     { icon: '📝', label: '정리 노트를 어디에 저장할까요?' },
} as const

// ============================================================
// FolderTreeNode — 재귀 트리 아이템
// ============================================================

function FolderTreeNode({
  folder,
  depth,
  selectedId,
  onSelect,
}: {
  folder: Folder
  depth: number
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const [expanded, setExpanded] = useState(depth < 2)
  const childFolders = useFolderStore((s) => s.getChildFolders(folder.id))
  const isSelected = selectedId === folder.id
  const hasChildren = childFolders.length > 0

  return (
    <div>
      <button
        onClick={() => onSelect(folder.id)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all text-left"
        style={{
          paddingLeft:     12 + depth * 20,
          backgroundColor: isSelected ? 'rgba(49, 130, 246, 0.1)' : 'transparent',
          color:           isSelected ? 'var(--accent-blue)' : 'var(--text-primary)',
          fontWeight:      isSelected ? 600 : 400,
        }}
      >
        {/* 토글 화살표 */}
        <span
          className="shrink-0 w-4 text-center text-xs transition-transform"
          style={{
            color:     'var(--text-muted)',
            transform: expanded ? 'rotate(90deg)' : 'none',
            opacity:   hasChildren ? 1 : 0,
          }}
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
        >
          ▶
        </span>
        {/* 폴더 아이콘 */}
        <span style={{ color: folder.color, fontSize: 16, lineHeight: 1 }}>📁</span>
        <span className="truncate flex-1">{folder.name}</span>
        {isSelected && (
          <span style={{ color: 'var(--accent-blue)', fontSize: 12 }}>✓</span>
        )}
      </button>

      {expanded && hasChildren && (
        <div>
          {childFolders.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// SaveLocationModal
// ============================================================

export function SaveLocationModal() {
  const { isOpen, fileType, confirm, cancel } = useSaveLocationStore()
  const { createFolder, getChildFolders } = useFolderStore()
  const { defaultSaveFolderId, setDefaultSaveFolderId } = useSessionStore()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [alwaysSave,  setAlwaysSave]  = useState(false)
  const [newFolderMode, setNewFolderMode] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  // 모달 열릴 때 defaultSaveFolderId로 초기 선택
  useEffect(() => {
    if (isOpen) {
      setSelectedId(defaultSaveFolderId)
      setAlwaysSave(!!defaultSaveFolderId)
      setNewFolderMode(false)
      setNewFolderName('')
    }
  }, [isOpen, defaultSaveFolderId])

  if (!isOpen || !fileType) return null

  const meta = FILE_TYPE_META[fileType]
  const rootFolders = getChildFolders(null)

  const handleConfirm = () => {
    if (alwaysSave) setDefaultSaveFolderId(selectedId)
    confirm(selectedId)
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    const folder = await createFolder({
      name:     newFolderName.trim(),
      parentId: selectedId,
    })
    setSelectedId(folder.id)
    setNewFolderMode(false)
    setNewFolderName('')
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.30)' }}
      onClick={(e) => { if (e.target === e.currentTarget) cancel() }}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden"
        style={{
          width:           420,
          maxHeight:       '80vh',
          backgroundColor: 'var(--bg-primary)',
          boxShadow:       '0 20px 60px rgba(0,0,0,0.20), 0 4px 16px rgba(0,0,0,0.10)',
          border:          '1px solid var(--border-default)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 헤더 ──────────────────────────────────────── */}
        <div
          className="px-5 pt-5 pb-4"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2.5 mb-1">
            <span style={{ fontSize: 22 }}>{meta.icon}</span>
            <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
              저장 위치 선택
            </h2>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-muted)', paddingLeft: 34 }}>
            {meta.label}
          </p>
        </div>

        {/* ── 루트 선택 옵션 ─────────────────────────────── */}
        <div className="px-4 pt-3">
          <button
            onClick={() => setSelectedId(null)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all text-left"
            style={{
              backgroundColor: selectedId === null ? 'rgba(49, 130, 246, 0.1)' : 'transparent',
              color:           selectedId === null ? 'var(--accent-blue)' : 'var(--text-secondary)',
              fontWeight:      selectedId === null ? 600 : 400,
            }}
          >
            <span style={{ fontSize: 16 }}>🏠</span>
            <span>루트 (최상위)</span>
            {selectedId === null && (
              <span className="ml-auto" style={{ color: 'var(--accent-blue)', fontSize: 12 }}>✓</span>
            )}
          </button>
        </div>

        {/* ── 폴더 트리 ──────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0" style={{ maxHeight: 280 }}>
          {rootFolders.length === 0 && (
            <p
              className="text-sm text-center py-8"
              style={{ color: 'var(--text-disabled)' }}
            >
              폴더가 없습니다. 아래에서 만들어보세요.
            </p>
          )}
          {rootFolders.map((folder) => (
            <FolderTreeNode
              key={folder.id}
              folder={folder}
              depth={0}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </div>

        {/* ── 새 폴더 만들기 ─────────────────────────────── */}
        <div
          className="px-4 py-3"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          {newFolderMode ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateFolder()
                  if (e.key === 'Escape') setNewFolderMode(false)
                }}
                placeholder="새 폴더 이름"
                className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
                style={{
                  border:          '1px solid var(--border-focus)',
                  backgroundColor: 'var(--bg-secondary)',
                  color:           'var(--text-primary)',
                }}
              />
              <button
                onClick={() => void handleCreateFolder()}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}
              >
                만들기
              </button>
              <button
                onClick={() => setNewFolderMode(false)}
                className="px-2 py-1.5 rounded-lg text-xs"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
              >
                취소
              </button>
            </div>
          ) : (
            <button
              onClick={() => setNewFolderMode(true)}
              className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
              style={{ color: 'var(--accent-blue)' }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
              <span>새 폴더 만들기</span>
            </button>
          )}
        </div>

        {/* ── "항상 같은 폴더에 저장" ─────────────────────── */}
        <div
          className="px-4 py-3"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={alwaysSave}
              onChange={(e) => setAlwaysSave(e.target.checked)}
              className="w-4 h-4 rounded"
              style={{ accentColor: 'var(--accent-blue)' }}
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              항상 이 폴더에 저장 (다음부터 모달 안 뜸)
            </span>
          </label>
        </div>

        {/* ── 확인 / 취소 버튼 ───────────────────────────── */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-4"
          style={{ borderTop: '1px solid var(--border-default)' }}
        >
          <button
            onClick={cancel}
            className="px-4 py-2 rounded-xl text-sm transition-all hover:brightness-110"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            className="px-5 py-2 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-95"
            style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}
          >
            여기에 저장
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
