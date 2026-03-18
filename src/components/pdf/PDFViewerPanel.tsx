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
import { createPortal } from 'react-dom'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { useDroppable } from '@dnd-kit/core'
import { useSessionStore } from '@/stores/sessionStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useUndoRedoStore } from '@/stores/undoRedoStore'
import { useCodeStore } from '@/stores/codeStore'
import { isCodeBlock, detectLanguage } from '@/lib/codeDetector'
import { OverlayCanvas } from './OverlayCanvas'
import { HighlightLayer } from './HighlightLayer'
import { AnnotationLayer } from './AnnotationLayer'
import { StickerLayer } from './StickerLayer'
import { BookmarkTabs } from './BookmarkTabs'
import { StickerPalette } from '@/components/toolbar/StickerPalette'
import { pdfDropId } from '@/hooks/useDragDrop'
import { db } from '@/db/schema'
import type { StickerType, PdfWorkerOutMessage } from '@/types'
import type { EditorLanguage } from '@/stores/codeStore'

// ============================================================
// PDF.js 워커 설정
// ============================================================

// Vite의 `new URL(module, import.meta.url)` 패턴으로 Worker 파일을
// 번들에 포함시킵니다. COOP/COEP 환경에서 CDN 대신 로컬 파일을 사용합니다.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// ============================================================
// 상수
// ============================================================

/** 현재 페이지 기준 ±RANGE 내 페이지만 실제 렌더링합니다 */
const VIRTUALIZE_RANGE = 2

/** 가상화 placeholder 높이 (px) — A4 용지 비율 기준 */
const PLACEHOLDER_HEIGHT = 842

/** PDF 렌더링 너비 (px) */
const PDF_WIDTH = 720

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
}

// ============================================================
// PDFViewerPanel
// ============================================================

export function PDFViewerPanel({ pdfFile: pdfFileProp, onRequestOpen: _onRequestOpen }: PDFViewerPanelProps = {}) {
  const [pdfFileInternal, setPdfFileInternal] = useState<File | null>(null)
  // controlled 여부: pdfFileProp이 undefined가 아니면 controlled
  const isControlled = pdfFileProp !== undefined
  const pdfFile      = isControlled ? pdfFileProp : pdfFileInternal

  const [numPages, setNumPages] = useState(0)
  const [pageInputValue, setPageInputValue] = useState('')
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [activeStickerType, setActiveStickerType] = useState<StickerType>('important')
  const [stickerPaletteOpen, setStickerPaletteOpen] = useState(false)

  /** 코드 감지 툴팁 (텍스트 선택 시 표시) */
  const [codeTooltip, setCodeTooltip] = useState<{
    x: number; y: number; text: string; lang: EditorLanguage
  } | null>(null)

  const setSource         = useCodeStore((s) => s.setSource)
  const setEditorLanguage = useCodeStore((s) => s.setEditorLanguage)

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

  const currentPage    = useSessionStore((s) => s.currentPage)
  const setCurrentPage = useSessionStore((s) => s.setCurrentPage)
  const sessionId      = useSessionStore((s) => s.sessionId)
  const pdfId          = useSessionStore((s) => s.pdfId)
  const setPdfId       = useSessionStore((s) => s.setPdfId)

  /** PDF 텍스트 추출 Worker */
  const pdfWorkerRef   = useRef<Worker | null>(null)

  const bookmarks      = useAnnotationStore((s) => s.bookmarks)
  const addBookmark    = useUndoRedoStore((s) => s.addBookmark)
  const deleteBookmark = useUndoRedoStore((s) => s.deleteBookmark)

  // currentPage가 바뀌면 해당 페이지로 부드럽게 스크롤
  useEffect(() => {
    const el = pageRefs.current[currentPage - 1]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
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
  // S 키 — 스티커 팔레트 토글
  // ----------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key !== 's' && e.key !== 'S' ||
        e.ctrlKey || e.metaKey || e.altKey ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return
      setStickerPaletteOpen((v) => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ----------------------------------------------------------
  // PDF 텍스트 선택 → 코드 감지 툴팁
  // ----------------------------------------------------------

  useEffect(() => {
    const handleMouseUp = () => {
      // 선택이 확정될 때까지 짧게 대기
      setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed) { setCodeTooltip(null); return }
        const text = sel.toString().trim()
        if (text.length < 10 || !isCodeBlock(text)) { setCodeTooltip(null); return }
        try {
          const rect = sel.getRangeAt(0).getBoundingClientRect()
          setCodeTooltip({
            x:    rect.left + rect.width / 2,
            y:    rect.bottom + 8,
            text,
            lang: detectLanguage(text),
          })
        } catch {
          setCodeTooltip(null)
        }
      }, 10)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCodeTooltip(null)
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const handleCopyToCode = useCallback(() => {
    if (!codeTooltip) return
    setSource(codeTooltip.text)
    setEditorLanguage(codeTooltip.lang)
    setCodeTooltip(null)
    window.getSelection()?.removeAllRanges()
    // 사이드바를 코드 탭으로 전환하도록 이벤트 발송
    window.dispatchEvent(new CustomEvent('lm:switch-tab', { detail: 'code' }))
  }, [codeTooltip, setSource, setEditorLanguage])

  // ----------------------------------------------------------
  // 파일 처리
  // ----------------------------------------------------------

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (!isControlled) setPdfFileInternal(file)
      setNumPages(0)
      setCurrentPage(1)
      e.target.value = ''
    },
    [isControlled, setCurrentPage],
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
      <div className="flex-1 relative overflow-y-auto flex flex-col items-center py-8 gap-6">
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
              const isVisible = Math.abs(pageNum - currentPage) <= VIRTUALIZE_RANGE

              return (
                <div
                  key={pageNum}
                  ref={(el) => { pageRefs.current[pageNum - 1] = el }}
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
                        />
                      </div>
                      {/* 태그 오버레이 + 형광펜 드래그 생성 */}
                      <OverlayCanvas pageNumber={pageNum} />
                      {/* 형광펜 하이라이트 표시 (클릭 선택·삭제·메모) */}
                      <HighlightLayer pageNumber={pageNum} />
                      {/* 스티커 레이어 */}
                      <StickerLayer pageNumber={pageNum} activeStickerType={activeStickerType} />
                      {/* 텍스트 상자 레이어 (TextBox 삭제 버튼이 밖으로 나올 수 있음) */}
                      <AnnotationLayer pageNumber={pageNum} />
                    </DroppablePage>
                  ) : (
                    /* 빈 placeholder — 스크롤 높이 유지용 */
                    <div
                      className="rounded-lg"
                      style={{
                        width: PDF_WIDTH,
                        height: PLACEHOLDER_HEIGHT,
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

      {/* ── 코드 감지 툴팁 (텍스트 선택 시 코드면 표시) ── */}
      {codeTooltip && createPortal(
        <div
          style={{
            position:  'fixed',
            left:      codeTooltip.x,
            top:       codeTooltip.y,
            transform: 'translateX(-50%)',
            zIndex:    9999,
          }}
          // 클릭해도 텍스트 선택이 해제되지 않도록 mousedown 기본 동작 차단
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            onClick={handleCopyToCode}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg"
            style={{
              backgroundColor: 'var(--accent-blue)',
              color:           '#fff',
              border:          'none',
              cursor:          'pointer',
              whiteSpace:      'nowrap',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            코드로 복사 ({codeTooltip.lang})
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}
