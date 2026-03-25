/**
 * @file components/home/FolderPage.tsx
 * LectureMate — 폴더 내부 뷰
 *
 * ## 레이아웃
 * ```
 * ┌─────────────────────────────────────────────────┐
 * │  [← 뒤로]  홈 › 1학기 › 선형대수           [+] │ ← header
 * ├─────────────────────────────────────────────────┤
 * │  폴더                                           │
 * │  [폴더] [폴더]                                  │ ← 그리드
 * │  세션                                           │
 * │  [세션] [세션] [세션]                            │ ← 그리드
 * └─────────────────────────────────────────────────┘
 *                                        [+ FAB]
 * ```
 *
 * 우클릭 → 이름 바꾸기 / 루트로 이동 / 삭제
 * 폴더 클릭 → navigate('folder', { folderId })
 * 세션 클릭 → onOpenSession(session)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useFolderStore } from '@/stores/folderStore'
import { useRouterStore } from '@/stores/routerStore'
import { db } from '@/db/schema'
import {
  FolderCard, SessionCard, ContextMenu, InlineRenameInput,
  formatDate as _formatDate, type ContextMenuState,
} from './_shared'
import type { Folder, Session } from '@/types'

// ============================================================
// breadcrumb 헬퍼 (현재 폴더까지의 경로)
// ============================================================

function buildBreadcrumb(folderId: string | null, folders: Folder[]): Folder[] {
  if (!folderId) return []
  const path: Folder[] = []
  let cur = folders.find((f) => f.id === folderId)
  while (cur) {
    path.unshift(cur)
    cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined
  }
  return path
}

// ============================================================
// Props
// ============================================================

interface FolderPageProps {
  onOpenSession: (session: Session) => void
  onNewSession: (folderId: string | null) => void
}

// ============================================================
// FAB 팝업 메뉴
// ============================================================

function FABMenu({
  onNewFolder, onNewSession, onClose,
}: {
  onNewFolder: () => void
  onNewSession: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute bottom-16 right-0 rounded-2xl overflow-hidden py-1"
      style={{
        backgroundColor: '#FFFFFF',
        border:          '1px solid #F2F4F8',
        boxShadow:       '0 8px 32px rgba(0,0,0,0.12)',
        minWidth:        148,
      }}
    >
      {[
        { label: '새 하위 폴더', action: onNewFolder },
        { label: '새 세션', action: onNewSession },
      ].map(({ label, action }) => (
        <button
          key={label}
          onClick={() => { action(); onClose() }}
          className="w-full flex items-center px-4 py-3 text-sm font-medium text-left transition-colors"
          style={{ color: '#191F28', backgroundColor: 'transparent' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#F9FAFB' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ============================================================
// FolderPage
// ============================================================

export function FolderPage({ onOpenSession, onNewSession }: FolderPageProps) {
  const navigate         = useRouterStore((s) => s.navigate)
  const goBack           = useRouterStore((s) => s.goBack)
  const currentFolderId  = useRouterStore((s) => s.currentFolderId)

  const {
    folders,
    getChildFolders,
    createFolder,
    renameFolder,
    setFolderColor,
    deleteFolder,
    moveFolder,
    moveSession,
    isLoaded,
    loadFolders,
  } = useFolderStore()

  const [sessions, setSessions]               = useState<Session[]>([])
  const [contextMenu, setContextMenu]         = useState<ContextMenuState | null>(null)
  const [renaming, setRenaming]               = useState<{ type: 'folder' | 'session'; target: Folder | Session } | null>(null)
  const [showFAB, setShowFAB]                 = useState(false)
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)

  const breadcrumb   = buildBreadcrumb(currentFolderId, folders)
  const childFolders = getChildFolders(currentFolderId)

  // ---- 초기 로드 ----

  useEffect(() => {
    if (!isLoaded) void loadFolders()
  }, [isLoaded, loadFolders])

  const loadSessions = useCallback(async () => {
    if (!currentFolderId) return
    const all = await db.sessions.orderBy('updatedAt').reverse().toArray()
    setSessions(all.filter((s) =>
      currentFolderId === null
        ? (!s.folderId)
        : s.folderId === currentFolderId,
    ))
  }, [currentFolderId])

  useEffect(() => { void loadSessions() }, [loadSessions, isLoaded])

  // ---- 컨텍스트 메뉴 ----

  const openCtx = (e: React.MouseEvent, type: 'folder' | 'session', target: Folder | Session) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type, target })
  }

  const handleRename = () => {
    if (!contextMenu) return
    setRenaming({ type: contextMenu.type, target: contextMenu.target })
    setContextMenu(null)
  }

  const handleRenameConfirm = async (name: string) => {
    if (!renaming) return
    if (renaming.type === 'folder') {
      await renameFolder(renaming.target.id, name)
    } else {
      await db.sessions.update(renaming.target.id, { title: name })
      void loadSessions()
    }
    setRenaming(null)
  }

  const handleDelete = async () => {
    if (!contextMenu) return
    setContextMenu(null)
    if (contextMenu.type === 'folder') {
      await deleteFolder(contextMenu.target.id)
    } else {
      await db.sessions.delete(contextMenu.target.id)
      void loadSessions()
    }
  }

  const handleMove = async (folderId: string | null) => {
    if (!contextMenu) return
    setContextMenu(null)
    if (contextMenu.type === 'folder') {
      await moveFolder(contextMenu.target.id, folderId)
    } else {
      await moveSession(contextMenu.target.id, folderId)
      void loadSessions()
    }
  }

  const handleColorChange = async (color: string) => {
    if (!contextMenu || contextMenu.type !== 'folder') return
    await setFolderColor(contextMenu.target.id, color)
    setContextMenu(null)
  }

  const getChildCount = (folderId: string) => getChildFolders(folderId).length

  const isEmpty = childFolders.length === 0 && sessions.length === 0

  const currentFolderName = breadcrumb[breadcrumb.length - 1]?.name ?? '폴더'

  // ---- unused import warning suppression ----
  void _formatDate

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#F9FAFB' }}>

      {/* ── 헤더 ──────────────────────────────────────────── */}
      <header
        className="flex items-center gap-3 px-6 shrink-0"
        style={{
          height:          64,
          backgroundColor: '#FFFFFF',
          borderBottom:    '1px solid #F2F4F8',
          boxShadow:       '0 1px 0 #F2F4F8',
        }}
      >
        {/* 뒤로가기 */}
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all hover:bg-[#F2F4F8] active:scale-95 shrink-0"
          style={{ color: '#3182F6' }}
          title="뒤로"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          뒤로
        </button>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
          <button
            onClick={() => navigate('home')}
            className="text-sm transition-opacity hover:opacity-70 shrink-0"
            style={{ color: '#3182F6' }}
          >
            홈
          </button>
          {breadcrumb.map((f, idx) => (
            <span key={f.id} className="flex items-center gap-1 min-w-0">
              <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#C9D0DA" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
              <button
                onClick={() => {
                  if (idx < breadcrumb.length - 1) navigate('folder', { folderId: f.id })
                }}
                className="text-sm truncate transition-opacity hover:opacity-70"
                style={{
                  color:      idx === breadcrumb.length - 1 ? '#191F28' : '#3182F6',
                  fontWeight: idx === breadcrumb.length - 1 ? 600 : 400,
                  cursor:     idx === breadcrumb.length - 1 ? 'default' : 'pointer',
                }}
              >
                {f.name}
              </button>
            </span>
          ))}
        </div>

        {/* 제목 */}
        <h1 className="text-sm font-bold shrink-0" style={{ color: '#191F28' }}>
          {currentFolderName}
        </h1>
      </header>

      {/* ── 본문 ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-8">

        {/* 빈 상태 */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-64 gap-4 select-none">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ backgroundColor: '#F2F4F8' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="#C9D0DA">
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: '#8B95A1' }}>
              이 폴더는 비어 있어요. + 버튼을 눌러 추가하세요.
            </p>
          </div>
        )}

        {/* 하위 폴더 */}
        {childFolders.length > 0 && (
          <section className="mb-10">
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#8B95A1' }}>폴더</p>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}
            >
              {childFolders.map((folder) => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  childCount={getChildCount(folder.id)}
                  onClick={() => navigate('folder', { folderId: folder.id })}
                  onContextMenu={(e) => openCtx(e, 'folder', folder)}
                />
              ))}
            </div>
          </section>
        )}

        {/* 세션 */}
        {sessions.length > 0 && (
          <section>
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#8B95A1' }}>세션</p>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
            >
              {sessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  onClick={() => onOpenSession(s)}
                  onContextMenu={(e) => openCtx(e, 'session', s)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── FAB ───────────────────────────────────────────── */}
      <div className="fixed bottom-8 right-8 z-30 flex flex-col items-end">
        {showFAB && (
          <FABMenu
            onNewFolder={() => setShowNewFolderInput(true)}
            onNewSession={() => onNewSession(currentFolderId)}
            onClose={() => setShowFAB(false)}
          />
        )}
        <button
          onClick={() => setShowFAB((v) => !v)}
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-light text-3xl transition-all hover:brightness-110 active:scale-95"
          style={{
            backgroundColor: '#3182F6',
            boxShadow:       '0 4px 24px rgba(49,130,246,0.40)',
            transform:       showFAB ? 'rotate(45deg)' : 'rotate(0deg)',
            transition:      'transform 200ms ease',
          }}
        >
          +
        </button>
      </div>

      {/* ── 컨텍스트 메뉴 ─────────────────────────────────── */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={handleRename}
          onDelete={() => void handleDelete()}
          onMove={(folderId) => void handleMove(folderId)}
          onColorChange={contextMenu.type === 'folder' ? handleColorChange : undefined}
        />
      )}

      {/* ── 이름 바꾸기 모달 ─────────────────────────────── */}
      {renaming && (
        <InlineRenameInput
          defaultValue={
            renaming.type === 'folder'
              ? (renaming.target as Folder).name
              : (renaming.target as Session).title
          }
          onConfirm={(name) => void handleRenameConfirm(name)}
          onCancel={() => setRenaming(null)}
        />
      )}

      {/* ── 새 하위 폴더 입력 ────────────────────────────── */}
      {showNewFolderInput && (
        <InlineRenameInput
          defaultValue="새 폴더"
          onConfirm={async (name) => {
            await createFolder({ name, parentId: currentFolderId })
            setShowNewFolderInput(false)
          }}
          onCancel={() => setShowNewFolderInput(false)}
        />
      )}
    </div>
  )
}
