/**
 * @file App.tsx
 * LectureMate — 앱 루트 레이아웃
 *
 * ## 레이아웃
 * ```
 * ┌─────────────────────────── TopBar (56px) ──────────────────────────┐
 * │  [로고] [PDF 열기] [파일명]     [녹음버튼]     [AI|저장|스토리지]  │
 * ├─────────────── MainLayout (flex-1, min-w-1024px) ──────────────────┤
 * │   PDFViewerPanel (65%)   ║드래그║   SidebarPanel (35%)           │
 * │                          ║handle║                                  │
 * └────────────────────────────────────────────────────────────────────┘
 *                     [Toolbar — fixed bottom]
 * ```
 *
 * ## 전역 단축키 (Section 14)
 * V H T        도구 전환
 * Tab          태깅 모드 토글
 * Ctrl+Space   페이지 전체 태그
 * Ctrl+Z/Y     Undo / Redo
 * Ctrl+F       검색 (미구현 → console)
 * Ctrl+B       북마크 토글
 * Ctrl+S       수동 저장 (미구현 → console)
 * Ctrl+E       내보내기 (미구현 → console)
 * Ctrl+R       녹음 시작/정지
 * Ctrl+Shift+R 녹음 일시정지
 * Escape       선택 해제
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { useSessionStore } from '@/stores/sessionStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useUndoRedoStore } from '@/stores/undoRedoStore'
import { useRouterStore } from '@/stores/routerStore'
import { PDFViewerPanel } from '@/components/pdf/PDFViewerPanel'
import { SidebarPanel } from '@/components/sidebar/SidebarPanel'
import { Toolbar } from '@/components/toolbar/Toolbar'
import { TopBar } from '@/components/status/TopBar'
import { crashRecovery } from '@/core/CrashRecoveryManager'
import { preWarming } from '@/core/PreWarmingManager'
import { jobScheduler } from '@/core/JobScheduler'
import { useTimeSync } from '@/lib/timeSync'
import { useDragDrop } from '@/hooks/useDragDrop'
import { useSearch } from '@/hooks/useSearch'
import { useSearchStore } from '@/stores/searchStore'
import { SearchOverlay } from '@/components/search/SearchOverlay'
import { HomePage } from '@/components/home/HomePage'
import { FolderPage } from '@/components/home/FolderPage'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SaveLocationModal } from '@/components/common/SaveLocationModal'
import { useSaveLocationStore } from '@/stores/saveLocationStore'
import { db } from '@/db/schema'
import type { Session, SttSegment } from '@/types'

// ============================================================
// 드래그 오버레이 — 고스트 카드
// ============================================================

function SegmentDragOverlay({ segment }: { segment: SttSegment }) {
  const m = Math.floor(segment.startTime / 60)
  const s = Math.floor(segment.startTime % 60)
  const ts = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border:          '1px solid var(--border-subtle)',
        boxShadow:       '0 20px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.4)',
        transform:       'scale(1.02)',
        cursor:          'grabbing',
        borderRadius:    12,
        padding:         '10px 12px',
        maxWidth:        320,
        pointerEvents:   'none',
      }}
    >
      <p className="text-sm leading-relaxed break-words" style={{ color: 'var(--text-primary)' }}>
        {segment.text}
      </p>
      <p className="mt-1 text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{ts}</p>
    </div>
  )
}

// ============================================================
// 리사이즈 핸들 상수
// ============================================================

const MIN_LEFT_PCT = 30
const MAX_LEFT_PCT = 80
const DEFAULT_LEFT_PCT = 65

// ============================================================
// App
// ============================================================

export default function App() {
  // ---- 라우터 ----
  const currentRoute = useRouterStore((s) => s.currentPage)
  const navigate     = useRouterStore((s) => s.navigate)
  const inSession    = currentRoute === 'session'

  // ---- PDF 파일 상태 (TopBar → PDFViewerPanel 공유) ----
  const [pdfFile, setPdfFile] = useState<File | null>(null)

  // ---- 드래그앤드롭 (STT → PDF) ----
  const dnd = useDragDrop()

  // ---- 드래그 리사이즈 상태 ----
  const [leftPct, setLeftPct]   = useState(DEFAULT_LEFT_PCT)
  const isDragging               = useRef(false)
  const containerRef             = useRef<HTMLDivElement>(null)

  // ---- sessionStore ----
  const setActiveTool      = useSessionStore((s) => s.setActiveTool)
  const toggleTaggingMode  = useSessionStore((s) => s.toggleTaggingMode)
  const deselect           = useSessionStore((s) => s.deselect)
  const sessionId          = useSessionStore((s) => s.sessionId)
  const pdfId              = useSessionStore((s) => s.pdfId)
  const currentPage        = useSessionStore((s) => s.currentPage)

  // ---- annotationStore / undoRedoStore ----
  const bookmarks      = useAnnotationStore((s) => s.bookmarks)
  const addBookmark    = useUndoRedoStore((s) => s.addBookmark)
  const deleteBookmark = useUndoRedoStore((s) => s.deleteBookmark)
  const addPageTag     = useUndoRedoStore((s) => s.addPageTag)
  const undo           = useUndoRedoStore((s) => s.undo)
  const redo           = useUndoRedoStore((s) => s.redo)

  // ---- 홈 ↔ 세션 라우팅 ----

  const handleOpenSession = useCallback((session: Session) => {
    useSessionStore.getState().openSession(session.id, session.pdfId ?? null)
    setPdfFile(null) // 기존 PDF 초기화; 사용자가 세션에서 재첨부
    navigate('session', { sessionId: session.id })
  }, [navigate])

  const handleNewSession = useCallback(async (folderId: string | null) => {
    const id  = crypto.randomUUID()
    const now = Date.now()
    await db.sessions.add({
      id,
      title:     '새 세션',
      folderId,
      pdfId:     null,
      duration:  0,
      createdAt: now,
      updatedAt: now,
    })
    useSessionStore.getState().openSession(id, null)
    setPdfFile(null)
    navigate('session', { sessionId: id })
  }, [navigate])

  // PDF 첨부 시 저장 위치 선택 모달 (defaultSaveFolderId 없을 때)
  const handlePdfChange = useCallback(async (file: File) => {
    const { defaultSaveFolderId } = useSessionStore.getState()
    if (!defaultSaveFolderId) {
      const result = await useSaveLocationStore.getState().requestFolder('pdf')
      if (result === false) return
    }
    setPdfFile(file)
  }, [])

  // ============================================================
  // 앱 시작 시 크래시 복구
  // ============================================================

  useEffect(() => {
    crashRecovery.recover().catch((e) => {
      console.error('[App] 크래시 복구 실패:', e)
    })
    // 크래시 복구 후 유휴 시간에 Whisper 모델 프리워밍 시작
    preWarming.warmUpOnIdle().catch((e) => {
      console.error('[App] Whisper 프리워밍 실패:', e)
    })
    // 작업 스케줄러 초기화 (미완료 작업 복구 + STT Worker 핸들러 부착)
    jobScheduler.init()
  }, [])

  // currentTime 변경 시 activeTagId 자동 동기화
  useTimeSync()

  // 통합 검색 (Fuse.js 5개 인스턴스)
  useSearch()
  const toggleSearch = useSearchStore((s) => s.toggle)

  // ============================================================
  // 드래그 리사이즈 핸들러
  // ============================================================

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor    = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const raw  = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.max(MIN_LEFT_PCT, Math.min(MAX_LEFT_PCT, raw)))
    }
    const onUp = () => {
      if (!isDragging.current) return
      isDragging.current            = false
      document.body.style.cursor    = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  // ============================================================
  // 전역 단축키
  // ============================================================

  // ── 도구 전환 (세션에서만 활성) ──────────────────────────
  useHotkeys('v', () => setActiveTool('pointer'),     { enabled: inSession, preventDefault: true })
  useHotkeys('h', () => setActiveTool('highlighter'), { enabled: inSession, preventDefault: true })
  useHotkeys('t', () => setActiveTool('textbox'),     { enabled: inSession, preventDefault: true })
  useHotkeys('s', () => setActiveTool('tagger'),      { enabled: inSession, preventDefault: true })
  useHotkeys('p', () => setActiveTool('pen'),         { enabled: inSession, preventDefault: true })
  useHotkeys('g', () => setActiveTool('shape'),       { enabled: inSession, preventDefault: true })

  // ── 태깅 모드 ────────────────────────────────────────────
  useHotkeys('tab', (e) => { e.preventDefault(); toggleTaggingMode() }, { enabled: inSession })

  // ── 페이지 전체 태그 (Ctrl+Space) ────────────────────────
  useHotkeys('ctrl+space', (e) => {
    e.preventDefault()
    if (!sessionId || !pdfId) return
    const { currentTime } = useSessionStore.getState()
    addPageTag({ sessionId, pdfId, pageNumber: currentPage, timestampStart: currentTime })
  }, { enabled: inSession, enableOnFormTags: false }, [sessionId, pdfId, currentPage])

  // ── Undo / Redo ──────────────────────────────────────────
  useHotkeys('ctrl+z',       (e) => { e.preventDefault(); undo() }, { enabled: inSession })
  useHotkeys('ctrl+shift+z', (e) => { e.preventDefault(); redo() }, { enabled: inSession })

  // ── 검색 (Ctrl+F) ────────────────────────────────────────
  useHotkeys('ctrl+f', (e) => {
    e.preventDefault()
    toggleSearch()
  }, { enabled: inSession })

  // ── 북마크 토글 (Ctrl+B) ─────────────────────────────────
  useHotkeys('ctrl+b', (e) => {
    e.preventDefault()
    if (!sessionId || !pdfId) return
    const existing = bookmarks.find((b) => b.pageNumber === currentPage)
    if (existing) {
      deleteBookmark(existing.id)
    } else {
      addBookmark({ sessionId, pdfId, pageNumber: currentPage, title: `페이지 ${currentPage}` })
    }
  }, { enabled: inSession }, [sessionId, pdfId, currentPage, bookmarks])

  // ── 수동 저장 (Ctrl+S) ───────────────────────────────────
  useHotkeys('ctrl+s', (e) => {
    e.preventDefault()
    const s = useAnnotationStore.getState()
    const n = s.dirtyTags.size + s.dirtyAnnotations.size +
              s.dirtyHighlights.size + s.dirtyTextboxes.size +
              s.dirtyStickers.size + s.dirtyBookmarks.size
    console.log(`[LectureMate] Ctrl+S — 수동 저장 (dirty: ${n}건) — Phase 3에서 구현`)
  }, { enabled: inSession })

  // ── 내보내기 (Ctrl+E) ────────────────────────────────────
  useHotkeys('ctrl+e', (e) => {
    e.preventDefault()
    console.log('[LectureMate] Ctrl+E — 내보내기 (Phase 6에서 구현)')
  }, { enabled: inSession })

  // ── Ctrl+R / Ctrl+Shift+R: RecordingControls 컴포넌트가 처리 ──

  // ── Escape ───────────────────────────────────────────────
  useHotkeys('escape', () => deselect(), { enabled: inSession, enableOnFormTags: false })

  // ============================================================
  // 렌더
  // ============================================================

  // ── 홈 화면 ─────────────────────────────────────────────────
  if (currentRoute === 'home') {
    return (
      <>
        <div
          key="home"
          className="page-enter flex flex-col h-screen overflow-hidden"
          style={{ minWidth: 1024, backgroundColor: '#F9FAFB' }}
        >
          <HomePage
            onOpenSession={handleOpenSession}
            onNewSession={(folderId) => void handleNewSession(folderId)}
          />
        </div>
        <SaveLocationModal />
      </>
    )
  }

  // ── 폴더 화면 ────────────────────────────────────────────────
  if (currentRoute === 'folder') {
    return (
      <>
        <div
          key="folder"
          className="page-enter flex flex-col h-screen overflow-hidden"
          style={{ minWidth: 1024, backgroundColor: '#F9FAFB' }}
        >
          <FolderPage
            onOpenSession={handleOpenSession}
            onNewSession={(folderId) => void handleNewSession(folderId)}
          />
        </div>
        <SaveLocationModal />
      </>
    )
  }

  // ── 설정 화면 ────────────────────────────────────────────────
  if (currentRoute === 'settings') {
    return (
      <>
        <div
          key="settings"
          className="page-enter flex flex-col h-screen overflow-hidden"
          style={{ minWidth: 1024, backgroundColor: '#F9FAFB' }}
        >
          <SettingsPage />
        </div>
        <SaveLocationModal />
      </>
    )
  }

  // ── 세션 뷰 ─────────────────────────────────────────────────
  return (
    <DndContext
      sensors={dnd.sensors}
      onDragStart={dnd.handleDragStart}
      onDragEnd={dnd.handleDragEnd}
    >
    <div
      key="session"
      className="page-enter flex flex-col h-screen overflow-hidden"
      style={{
        minWidth:        1024,
        backgroundColor: 'var(--bg-secondary)',
      }}
    >
      {/* ── TopBar ────────────────────────────────────────── */}
      <TopBar
        pdfFileName={pdfFile?.name}
        onPdfChange={(file) => void handlePdfChange(file)}
        onGoHome={() => navigate('home')}
      />

      {/* ── MainLayout ────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex flex-1 min-h-0"
      >
        {/* PDF 뷰어 패널 */}
        <div
          className="min-h-0 overflow-hidden"
          style={{ width: `${leftPct}%` }}
        >
          <PDFViewerPanel
            pdfFile={pdfFile}
            onRequestOpen={() => {/* TopBar의 input이 처리 */}}
            onFileSelected={(file) => setPdfFile(file)}
          />
        </div>

        {/* 드래그 리사이즈 핸들 */}
        <div
          className="shrink-0 flex items-center justify-center group cursor-col-resize select-none"
          style={{ width: 8 }}
          onMouseDown={handleResizeStart}
        >
          <div
            className="h-full transition-all duration-150 group-hover:opacity-100"
            style={{
              width:           4,
              backgroundColor: 'var(--border-default)',
              opacity:         0.4,
            }}
          />
          {/* hover 강조선 */}
          <div
            className="absolute h-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{
              width:           2,
              backgroundColor: 'var(--accent-blue)',
            }}
          />
        </div>

        {/* 사이드바 패널 */}
        <div
          className="min-h-0 overflow-hidden"
          style={{ flex: 1 }}
        >
          <SidebarPanel />
        </div>
      </div>

      {/* ── Toolbar (fixed bottom) ────────────────────────── */}
      <Toolbar />
    </div>

    {/* ── DragOverlay — 드래그 중 고스트 카드 ──────────── */}
    <DragOverlay dropAnimation={null}>
      {dnd.activeSegment && <SegmentDragOverlay segment={dnd.activeSegment} />}
    </DragOverlay>

    {/* ── 검색 모달 (Ctrl+F) ────────────────────────────── */}
    <SearchOverlay />

    {/* ── 저장 위치 선택 모달 ─────────────────────────── */}
    <SaveLocationModal />
    </DndContext>
  )
}
