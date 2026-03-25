/**
 * @file components/home/HomePage.tsx
 * LectureMate — 앱 첫 화면 (토스뱅크 스타일 대시보드)
 *
 * ## 레이아웃
 * ```
 * ┌─────────────────────────────────────────────────┐
 * │  [LM] LectureMate   [🔍 검색...]       [⚙]     │ ← header
 * ├─────────────────────────────────────────────────┤
 * │  최근 세션                                       │
 * │  ← [카드] [카드] [카드] [카드] →                 │ ← 가로 스크롤
 * │                                                 │
 * │  내 폴더                                         │
 * │  [폴더] [폴더] [폴더]                             │ ← 그리드
 * └─────────────────────────────────────────────────┘
 *                                        [+ FAB]
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useFolderStore } from '@/stores/folderStore'
import { useRouterStore } from '@/stores/routerStore'
import { db } from '@/db/schema'
import {
  FolderCard, SessionCard, ContextMenu, InlineRenameInput,
  formatDate, type ContextMenuState,
} from './_shared'
import type { Folder, Session } from '@/types'

// ============================================================
// Props
// ============================================================

interface HomePageProps {
  onOpenSession: (session: Session) => void
  onNewSession: (folderId: string | null) => void
}

// ============================================================
// RecentSessionCard — 가로 스크롤용 컴팩트 카드
// ============================================================

function RecentSessionCard({ session, onClick }: { session: Session; onClick: () => void }) {
  const durationMin = Math.floor(session.duration / 60)

  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 flex flex-col p-4 rounded-2xl text-left transition-all select-none"
      style={{
        width:           200,
        backgroundColor: '#FFFFFF',
        border:          '1px solid #F2F4F8',
        boxShadow:       '0 2px 12px rgba(0,0,0,0.05)',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 24px rgba(0,0,0,0.10)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.05)' }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
        style={{ backgroundColor: 'rgba(49,130,246,0.08)' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3182F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <p className="text-sm font-semibold leading-tight line-clamp-2 mb-1" style={{ color: '#191F28' }}>
        {session.title || '제목 없는 세션'}
      </p>
      <p className="text-xs" style={{ color: '#8B95A1' }}>
        {formatDate(session.updatedAt || session.createdAt)}
        {durationMin > 0 && ` · ${durationMin}분`}
      </p>
    </button>
  )
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
        { label: '새 폴더', action: onNewFolder },
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
// HomePage
// ============================================================

export function HomePage({ onOpenSession, onNewSession }: HomePageProps) {
  const navigate = useRouterStore((s) => s.navigate)
  const {
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

  const [recentSessions, setRecentSessions]   = useState<Session[]>([])
  const [rootSessions, setRootSessions]       = useState<Session[]>([])
  const [contextMenu, setContextMenu]         = useState<ContextMenuState | null>(null)
  const [renaming, setRenaming]               = useState<{ type: 'folder' | 'session'; target: Folder | Session } | null>(null)
  const [showFAB, setShowFAB]                 = useState(false)
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)

  const rootFolders = getChildFolders(null)

  // ---- 초기 로드 ----

  useEffect(() => {
    if (!isLoaded) void loadFolders()
  }, [isLoaded, loadFolders])

  const loadSessions = useCallback(async () => {
    const all = await db.sessions.orderBy('updatedAt').reverse().toArray()
    setRecentSessions(all.slice(0, 4))
    setRootSessions(all.filter((s) => !s.folderId))
  }, [])

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

  const getChildCount = (folderId: string) =>
    getChildFolders(folderId).length

  const isEmpty = rootFolders.length === 0 && rootSessions.length === 0 && recentSessions.length === 0

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#F9FAFB' }}>

      {/* ── 헤더 ──────────────────────────────────────────── */}
      <header
        className="flex items-center gap-4 px-6 shrink-0"
        style={{
          height:          64,
          backgroundColor: '#FFFFFF',
          borderBottom:    '1px solid #F2F4F8',
          boxShadow:       '0 1px 0 #F2F4F8',
        }}
      >
        {/* 로고 */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold"
            style={{ background: 'linear-gradient(135deg, #3182F6 0%, #7c3aed 100%)' }}
          >
            LM
          </div>
          <span className="text-base font-bold" style={{ color: '#191F28' }}>LectureMate</span>
        </div>

        {/* 검색바 */}
        <div className="flex-1 max-w-sm relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="#8B95A1" strokeWidth="2" strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none cursor-default"
            style={{
              backgroundColor: '#F9FAFB',
              border:          '1px solid #F2F4F8',
              color:           '#191F28',
            }}
            placeholder="세션, 폴더 검색..."
            readOnly
          />
        </div>

        <div className="flex-1" />

        {/* 설정 버튼 */}
        <button
          onClick={() => navigate('settings')}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:bg-[#F2F4F8] active:scale-95"
          title="설정"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4E5968" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      {/* ── 본문 ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-8">

        {/* 빈 상태 */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-64 gap-4 select-none">
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center"
              style={{ backgroundColor: '#F2F4F8' }}
            >
              <svg width="36" height="36" viewBox="0 0 24 24" fill="#C9D0DA">
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold mb-1" style={{ color: '#191F28' }}>아직 아무것도 없어요</p>
              <p className="text-sm" style={{ color: '#8B95A1' }}>오른쪽 아래 + 버튼을 눌러 시작하세요.</p>
            </div>
          </div>
        )}

        {/* 최근 세션 */}
        {recentSessions.length > 0 && (
          <section className="mb-10">
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#8B95A1' }}>
              최근 세션
            </p>
            <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {recentSessions.map((s) => (
                <RecentSessionCard key={s.id} session={s} onClick={() => onOpenSession(s)} />
              ))}
            </div>
          </section>
        )}

        {/* 내 폴더 */}
        {rootFolders.length > 0 && (
          <section className="mb-10">
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#8B95A1' }}>
              내 폴더
            </p>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}
            >
              {rootFolders.map((folder) => (
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

        {/* 루트 세션 */}
        {rootSessions.length > 0 && (
          <section>
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#8B95A1' }}>
              세션
            </p>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
            >
              {rootSessions.map((s) => (
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
            onNewSession={() => onNewSession(null)}
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
            transition:      'transform 200ms ease, box-shadow 200ms',
          }}
          title="새 폴더 / 새 세션"
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

      {/* ── 새 폴더 이름 입력 ─────────────────────────────── */}
      {showNewFolderInput && (
        <InlineRenameInput
          defaultValue="새 폴더"
          onConfirm={async (name) => {
            await createFolder({ name, parentId: null })
            setShowNewFolderInput(false)
          }}
          onCancel={() => setShowNewFolderInput(false)}
        />
      )}
    </div>
  )
}
