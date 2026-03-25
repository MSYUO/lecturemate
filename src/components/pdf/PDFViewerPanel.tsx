/**
 * @file components/pdf/PDFViewerPanel.tsx
 * LectureMate — PDF 뷰어 패널
 *
 * ## 주요 기능
 *   - 로컬 PDF 파일 열기 (input[type="file"])
 *   - sessionStore.currentPage 양방향 연동
 *   - 페이지 가상화: 현재 페이지 ±2만 실제 렌더링, 나머지는 빈 placeholder
 *   - 이전/다음 버튼 + 페이지 번호 직접 입력
 *   - 토스 스타일 shadow 적용
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { useDroppable } from '@dnd-kit/core'
import { useSessionStore } from '@/stores/sessionStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useUndoRedoStore } from '@/stores/undoRedoStore'
import { OverlayCanvas } from './OverlayCanvas'
import { HighlightLayer } from './HighlightLayer'
import { AnnotationLayer } from './AnnotationLayer'
import { StickerLayer } from './StickerLayer'
import { BookmarkTabs } from './BookmarkTabs'
import { TranslationSelectBox } from './TranslationSelectBox'
import { TranslationOverlay } from './TranslationOverlay'
import { StickerPalette } from '@/components/toolbar/StickerPalette'
import { pdfDropId } from '@/hooks/useDragDrop'
import { db } from '@/db/schema'
import type { StickerType, PdfWorkerOutMessage } from '@/types'

// ============================================================
// PDF.js 워커 설정
// ============================================================

// public/pdf.worker.min.mjs로 고정 (pdfjs-dist 5.4.296, react-pdf 내부 버전과 동일)
// optimizeDeps.exclude와 충돌 없이 dev/prod 양쪽에서 동일하게 동작합니다.
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

// ============================================================
// 상수
// ============================================================

/** PDF 렌더링 너비 (px) */
const PDF_WIDTH = 720

/** 뷰포트에 보이는 페이지 기준 ±RANGE 내 페이지만 실제 렌더링합니다 */
const VIRTUALIZE_RANGE = 1

/** 가상화 placeholder 높이 (px) — A4 용지 720px 폭 기준 (≈720×1.414) */
const PLACEHOLDER_HEIGHT = Math.round(PDF_WIDTH * 1.414)

/** 파일명 + 크기 기반 결정적 pdfId (같은 파일은 항상 동일한 ID) */
function derivePdfId(file: File): string {
  return `pdf-${file.name.replace(/[^a-z0-9]/gi, '_')}-${file.size}`
}

// ============================================================
// DroppablePage — dnd-kit 드롭 타겟 래퍼
// ============================================================

/**
 * PDF 페이지 하나를 dnd-kit 드롭 타겟으로 만듭니다.
 * STTStream 세그먼트를 이 위에 드롭하면 텍스트 상자가 생성됩니다.
 * isOver 상태에서 얇은 파란 테두리로 드롭 가능 위치를 표시합니다.
 */
function DroppablePage({
  pageNumber,
  children,
}: {
  pageNumber: number
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id:   pdfDropId(pageNumber),
    data: { pageNumber },
  })

  return (
    <div
      ref={setNodeRef}
      className="relative"
      style={{
        outline:       isOver ? '2px solid var(--accent-blue)' : '2px solid transparent',
        outlineOffset: '-2px',
        borderRadius:  8,
        transition:    'outline-color 120ms ease',
      }}
    >
      {children}
    </div>
  )
}

// ============================================================
// Props
// ============================================================

interface PDFViewerPanelProps {
  /**
   * 외부에서 제어하는 PDF 파일.
   * 제공되면 내부 파일 상태를 무시하고 이 값을 사용합니다 (controlled mode).
   * undefined이면 내부 파일 선택 버튼으로 동작합니다 (uncontrolled mode).
   */
  pdfFile?: File | null
  /**
   * TopBar 등 외부에서 파일 열기 버튼이 있을 때 내부 열기 버튼을 숨깁니다.
   * controlled mode에서 사용합니다.
   */
  onRequestOpen?: () => void
  /**
   * controlled mode에서 내부 파일 선택(빈 영역 클릭)으로 파일이 선택됐을 때
   * 부모 상태를 업데이트할 수 있도록 파일을 전달합니다.
   */
  onFileSelected?: (file: File) => void
}

// ============================================================
// PDFViewerPanel
// ============================================================

export function PDFViewerPanel({ pdfFile: pdfFileProp, onRequestOpen: _onRequestOpen, onFileSelected }: PDFViewerPanelProps = {}) {
  const [pdfFileInternal, setPdfFileInternal] = useState<File | null>(null)
  // controlled 여부: pdfFileProp이 undefined가 아니면 controlled
  const isControlled = pdfFileProp !== undefined
  const pdfFile      = isControlled ? pdfFileProp : pdfFileInternal

  const [numPages, setNumPages] = useState(0)
  const [pageInputValue, setPageInputValue] = useState('')
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [activeStickerType, setActiveStickerType] = useState<StickerType>('important')
  const [stickerPaletteOpen, setStickerPaletteOpen] = useState(false)

  // controlled mode에서 pdfFile이 바뀌면 numPages 초기화
  useEffect(() => {
    if (isControlled) {
      setNumPages(0)
      pageRefs.current = []
    }
  }, [pdfFileProp]) // eslint-disable-line react-hooks/exhaustive-deps

  const fileInputRef = useRef<HTMLInputElement>(null)
  /** 각 페이지 컨테이너 DOM 참조 (1-based 인덱스용, [0] = page 1) */
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  /** 스크롤 가능한 PDF 뷰 영역 (IntersectionObserver root) */
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  /** 한 번이라도 렌더된 페이지 Set — 캐시, 다시 placeholder로 되돌리지 않음 */
  const renderedPagesRef   = useRef<Set<number>>(new Set<number>())
  /** 페이지별 실제 렌더 높이 캐시 (px) */
  const pageHeightsRef     = useRef<Map<number, number>>(new Map<number, number>())
  /** 프로그래밍적 스크롤(버튼·북마크) 중 IO 업데이트 억제 플래그 */
  const isProgramScrollRef = useRef(false)
  const scrollEndTimerRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 각 페이지의 현재 뷰포트 교차 비율 */
  const pageRatiosRef      = useRef<Map<number, number>>(new Map<number, number>())
  /** 현재 실제로 뷰포트에 보이는 페이지 (sessionStore currentPage와 분리) */
  const [viewportPage, setViewportPage] = useState(1)

  const currentPage    = useSessionStore((s) => s.currentPage)
  const setCurrentPage = useSessionStore((s) => s.setCurrentPage)
  const sessionId      = useSessionStore((s) => s.sessionId)
  const pdfId          = useSessionStore((s) => s.pdfId)
  const setPdfId       = useSessionStore((s) => s.setPdfId)
  const activeToolType = useSessionStore((s) => s.activeToolType)

  /** PDF 텍스트 추출 Worker */
  const pdfWorkerRef   = useRef<Worker | null>(null)

  const bookmarks      = useAnnotationStore((s) => s.bookmarks)
  const addBookmark    = useUndoRedoStore((s) => s.addBookmark)
  const deleteBookmark = useUndoRedoStore((s) => s.deleteBookmark)

  // currentPage가 버튼/북마크 등에 의해 바뀌면 해당 페이지로 스크롤
  // isProgramScrollRef를 세워 IntersectionObserver가 setCurrentPage를 덮어쓰지 않도록 방지
  useEffect(() => {
    const el = pageRefs.current[currentPage - 1]
    if (!el) return
    isProgramScrollRef.current = true
    clearTimeout(scrollEndTimerRef.current)
    scrollEndTimerRef.current = setTimeout(() => {
      isProgramScrollRef.current = false
    }, 800)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [currentPage])

  // ----------------------------------------------------------
  // pdfFile 변경 시 pdfId 등록 + 이전 추출 Worker 정리
  // ----------------------------------------------------------
  useEffect(() => {
    if (!pdfFile) {
      setPdfId(null)
      pdfWorkerRef.current?.terminate()
      pdfWorkerRef.current = null
      return
    }
    setPdfId(derivePdfId(pdfFile))
    return () => {
      pdfWorkerRef.current?.terminate()
      pdfWorkerRef.current = null
    }
  }, [pdfFile, setPdfId])

  // ----------------------------------------------------------
  // Ctrl+B — 현재 페이지 북마크 토글
  // ----------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        !e.ctrlKey || e.key !== 'b' ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return
      e.preventDefault()
      if (!sessionId || !pdfId || numPages === 0) return
      const existing = bookmarks.find((b) => b.pageNumber === currentPage)
      if (existing) {
        deleteBookmark(existing.id)
      } else {
        addBookmark({ sessionId, pdfId, pageNumber: currentPage, title: `페이지 ${currentPage}` })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sessionId, pdfId, numPages, currentPage, bookmarks, addBookmark, deleteBookmark])

  // ----------------------------------------------------------
  // tagger 도구 전환 시 스티커 팔레트 자동 표시
  // (S 키 전역 핸들러는 App.tsx useHotkeys에서 처리하므로 여기서 중복 등록 안 함)
  // ----------------------------------------------------------
  const prevToolTypeRef = useRef(activeToolType)
  useEffect(() => {
    if (activeToolType === 'tagger' && prevToolTypeRef.current !== 'tagger') {
      setStickerPaletteOpen(true)
    }
    prevToolTypeRef.current = activeToolType
  }, [activeToolType])

  // ----------------------------------------------------------
  // IntersectionObserver — 스크롤 시 현재 페이지 자동 추적
  // 뷰포트에 들어온 페이지: renderedPagesRef 캐시 + currentPage 업데이트
  // ----------------------------------------------------------
  useEffect(() => {
    if (numPages === 0) return

    const container = scrollContainerRef.current
    // 새 PDF 로드 시 캐시 초기화
    renderedPagesRef.current = new Set<number>()
    pageRatiosRef.current.clear()
    setViewportPage(1)

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const pn = parseInt((entry.target as HTMLElement).dataset.pn ?? '0', 10)
          if (!pn) return
          if (entry.isIntersecting) {
            pageRatiosRef.current.set(pn, entry.intersectionRatio)
            renderedPagesRef.current.add(pn) // 한번 보인 페이지는 캐시에 추가
          } else {
            pageRatiosRef.current.delete(pn)
          }
        })

        // 프로그래밍적 스크롤 중에는 currentPage를 덮어쓰지 않음
        if (isProgramScrollRef.current) return

        let bestPage = 0, bestRatio = 0
        pageRatiosRef.current.forEach((ratio, pn) => {
          if (ratio > bestRatio) { bestRatio = ratio; bestPage = pn }
        })
        if (bestPage > 0) {
          setViewportPage(bestPage)
          setCurrentPage(bestPage)
        }
      },
      { root: container, threshold: [0, 0.1, 0.3, 0.5] },
    )

    pageRefs.current.forEach((el) => { if (el) io.observe(el) })

    return () => io.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, setCurrentPage])

  // ----------------------------------------------------------
  // 파일 처리
  // ----------------------------------------------------------

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (!isControlled) {
        setPdfFileInternal(file)
      } else {
        // controlled mode: 부모(App)의 상태를 업데이트해야 렌더링됨
        onFileSelected?.(file)
      }
      setNumPages(0)
      setCurrentPage(1)
      e.target.value = ''
    },
    [isControlled, onFileSelected, setCurrentPage],
  )

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    pageRefs.current = Array(numPages).fill(null)
  }, [])

  // ----------------------------------------------------------
  // PDF 텍스트 추출 Worker — pdfFile + numPages 모두 준비된 후 시작
  // cancelled 플래그로 cleanup 후 비동기 작업이 이어지지 않도록 보장
  // ----------------------------------------------------------
  useEffect(() => {
    if (!pdfFile || numPages === 0) return

    const currentPdfId = derivePdfId(pdfFile)
    let cancelled      = false
    let workerInstance: Worker | null = null

    db.pdfTextIndex.where('pdfId').equals(currentPdfId).count().then((count) => {
      if (cancelled) return
      if (count >= numPages) {
        console.info(`[PDFViewer] 텍스트 인덱스 이미 완료: ${currentPdfId}`)
        return
      }

      const worker = new Worker(
        new URL('@/workers/pdf.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerInstance        = worker
      pdfWorkerRef.current  = worker

      pdfFile.arrayBuffer().then((buf) => {
        if (cancelled) { worker.terminate(); return }
        worker.postMessage(
          { type: 'extract', pdfId: currentPdfId, arrayBuffer: buf, pageCount: numPages },
          [buf],
        )
      })

      worker.onmessage = (e: MessageEvent<PdfWorkerOutMessage>) => {
        const msg = e.data
        if (msg.type === 'done') {
          console.info(`[PDFViewer] 텍스트 추출 완료: ${currentPdfId}`)
          worker.terminate()
          if (pdfWorkerRef.current === worker) pdfWorkerRef.current = null
        } else if (msg.type === 'error') {
          console.error('[PDFViewer] 텍스트 추출 실패:', msg.message)
          worker.terminate()
          if (pdfWorkerRef.current === worker) pdfWorkerRef.current = null
        }
      }
    }).catch((err) => {
      if (!cancelled) console.error('[PDFViewer] pdfTextIndex 조회 실패:', err)
    })

    return () => {
      cancelled = true
      workerInstance?.terminate()
      if (pdfWorkerRef.current === workerInstance) pdfWorkerRef.current = null
    }
  }, [pdfFile, numPages])

  // ----------------------------------------------------------
  // 페이지 네비게이션
  // ----------------------------------------------------------

  const goToPrev = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1)
  }

  const goToNext = () => {
    if (currentPage < numPages) setCurrentPage(currentPage + 1)
  }

  const commitPageInput = () => {
    const page = parseInt(pageInputValue, 10)
    if (!isNaN(page) && page >= 1 && page <= numPages) {
      setCurrentPage(page)
    }
    setIsInputFocused(false)
    setPageInputValue('')
  }

  const handlePageKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitPageInput()
    if (e.key === 'Escape') {
      setIsInputFocused(false)
      setPageInputValue('')
    }
  }

  // ============================================================
  // 렌더
  // ============================================================

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--bg-secondary)' }}>

      {/* ── 상단 툴바 ─────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 py-2 shrink-0"
        style={{
          backgroundColor: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        {/* PDF 열기 버튼 — controlled mode에서는 TopBar 버튼으로 대체 */}
        {!isControlled && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all hover:brightness-110 active:scale-95"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              PDF 열기
            </button>
          </>
        )}
        {/* 파일 입력 — controlled/uncontrolled 모두 필요 (empty state 클릭 처리) */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* 파일명 */}
        {pdfFile && (
          <span
            className="text-sm truncate max-w-[200px]"
            style={{ color: 'var(--text-secondary)' }}
            title={pdfFile.name}
          >
            {pdfFile.name}
          </span>
        )}

        <div className="flex-1" />

        {/* 페이지 네비게이션 — 문서 로드 후에만 표시 */}
        {numPages > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={goToPrev}
              disabled={currentPage <= 1}
              className="w-7 h-7 flex items-center justify-center rounded text-lg leading-none disabled:opacity-30 transition-all hover:brightness-110 active:scale-95"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
              aria-label="이전 페이지"
            >
              ‹
            </button>

            {/* 페이지 번호 입력 */}
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={numPages}
                value={isInputFocused ? pageInputValue : currentPage}
                onChange={(e) => setPageInputValue(e.target.value)}
                onFocus={() => {
                  setIsInputFocused(true)
                  setPageInputValue(String(currentPage))
                }}
                onBlur={commitPageInput}
                onKeyDown={handlePageKeyDown}
                className="w-11 text-center text-sm rounded px-1 py-1 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: isInputFocused
                    ? '1px solid var(--border-focus)'
                    : '1px solid var(--border-default)',
                  transition: 'border-color 0.15s',
                }}
              />
              <span className="text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
                / {numPages}
              </span>
            </div>

            <button
              onClick={goToNext}
              disabled={currentPage >= numPages}
              className="w-7 h-7 flex items-center justify-center rounded text-lg leading-none disabled:opacity-30 transition-all hover:brightness-110 active:scale-95"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
              aria-label="다음 페이지"
            >
              ›
            </button>
          </div>
        )}
      </div>

      {/* ── PDF 뷰 영역 ───────────────────────────────────── */}
      <div ref={scrollContainerRef} className="flex-1 relative overflow-y-auto flex flex-col items-center py-8 gap-6">
        {/* 북마크 탭 (좌측 세로 탭) */}
        {numPages > 0 && <BookmarkTabs totalPages={numPages} />}
        {!pdfFile ? (
          /* 빈 상태 — 클릭해도 파일 선택 */
          <button
            className="flex flex-col items-center justify-center flex-1 w-full gap-4 cursor-pointer transition-opacity hover:opacity-80"
            onClick={() => fileInputRef.current?.click()}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: 'var(--text-muted)' }}
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                PDF를 열어주세요
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                클릭하거나 위 버튼을 눌러 파일을 선택하세요
              </p>
            </div>
          </button>
        ) : (
          <Document
            file={pdfFile}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(err) => console.error('[PDFViewer] onLoadError:', err)}
            loading={
              <div
                className="flex items-center gap-2 py-12 text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                <div
                  className="w-4 h-4 border-2 rounded-full animate-spin"
                  style={{
                    borderColor: 'var(--accent-blue)',
                    borderTopColor: 'transparent',
                  }}
                />
                PDF 로딩 중...
              </div>
            }
            error={
              <p className="py-12 text-sm" style={{ color: 'var(--accent-red)' }}>
                PDF를 불러오지 못했습니다.
              </p>
            }
          >
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
              // 렌더 여부: 뷰포트 ±RANGE 이내 OR 이미 한번 렌더된 캐시 페이지
              const nearViewport = Math.abs(pageNum - viewportPage) <= VIRTUALIZE_RANGE
              const isCached     = renderedPagesRef.current.has(pageNum)
              const isVisible    = nearViewport || isCached

              return (
                <div
                  key={pageNum}
                  ref={(el) => { pageRefs.current[pageNum - 1] = el }}
                  data-pn={pageNum}
                >
                  {isVisible ? (
                    /*
                     * 실제 페이지 렌더링
                     * DroppablePage: dnd-kit 드롭 타겟 + isOver 시 파란 테두리
                     * inner(rounded+overflow-hidden): 토스 스타일 shadow + 모서리 클리핑
                     * OverlayCanvas, AnnotationLayer는 relative 기준 absolute 배치
                     */
                    <DroppablePage pageNumber={pageNum}>
                      <div
                        className="rounded-lg overflow-hidden"
                        style={{
                          boxShadow:
                            '0 4px 16px rgba(0, 0, 0, 0.5), 0 1px 4px rgba(0, 0, 0, 0.3)',
                        }}
                      >
                        <Page
                          pageNumber={pageNum}
                          width={PDF_WIDTH}
                          renderAnnotationLayer
                          renderTextLayer
                          onRenderSuccess={({ height }) => {
                            if (height) pageHeightsRef.current.set(pageNum, height)
                          }}
                        />
                      </div>
                      {/* 태그 오버레이 + 형광펜 드래그 생성 */}
                      <OverlayCanvas pageNumber={pageNum} />
                      {/* 형광펜 하이라이트 표시 (클릭 선택·삭제·메모) */}
                      <HighlightLayer pageNumber={pageNum} />
                      {/* 스티커 레이어 */}
                      <StickerLayer pageNumber={pageNum} activeStickerType={activeStickerType} />
                      {/* 번역 오버레이 레이어 (AnnotationLayer 아래 — 텍스트 상자가 위에 오도록) */}
                      <TranslationOverlay
                        pageNumber={pageNum}
                        pageHeight={pageHeightsRef.current.get(pageNum) ?? PLACEHOLDER_HEIGHT}
                      />
                      {/* 텍스트 상자 레이어 (TextBox 삭제 버튼이 밖으로 나올 수 있음) */}
                      <AnnotationLayer pageNumber={pageNum} />
                      {/* 번역 영역 선택 도구 */}
                      {activeToolType === 'translate' && pdfFile && (
                        <TranslationSelectBox
                          pageNumber={pageNum}
                          pdfFile={pdfFile}
                          pageWidth={PDF_WIDTH}
                          pageHeight={pageHeightsRef.current.get(pageNum) ?? PLACEHOLDER_HEIGHT}
                        />
                      )}
                    </DroppablePage>
                  ) : (
                    /* 빈 placeholder — 실제 렌더 높이 캐시 사용, 없으면 기본값 */
                    <div
                      className="rounded-lg"
                      style={{
                        width:           PDF_WIDTH,
                        height:          pageHeightsRef.current.get(pageNum) ?? PLACEHOLDER_HEIGHT,
                        backgroundColor: 'var(--bg-tertiary)',
                      }}
                    />
                  )}
                </div>
              )
            })}
          </Document>
        )}
      </div>

      {/* ── 스티커 팔레트 (S 키로 토글) ──────────────────── */}
      <StickerPalette
        open={stickerPaletteOpen}
        activeType={activeStickerType}
        onSelect={(type) => { setActiveStickerType(type); setStickerPaletteOpen(false) }}
        onClose={() => setStickerPaletteOpen(false)}
      />

    </div>
  )
}
