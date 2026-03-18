/**
 * @file components/export/ExportDialog.tsx
 * LectureMate — 내보내기 다이얼로그 (Section 9.6)
 *
 * ## 단축키
 * Ctrl+E — 다이얼로그 열기 / 닫기
 *
 * ## 형식
 * - Markdown    (.md)  — 태그·STT·필기·수식·코드
 * - HTML        (.html) — KaTeX 렌더링, 인쇄 최적화
 * - JSON        (.json) — 전체 세션 데이터 원시 덤프
 * - PDF 합성    (.pdf)  — 원본 PDF에 형광펜·필기 합성 (pdf-lib)
 *
 * ## 스타일
 * 토스 스타일: rounded-2xl, shadow-xl
 */

import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useHotkeys }  from 'react-hotkeys-hook'
import { useSessionStore } from '@/stores/sessionStore'
import { loadExportData, exportToMarkdown } from '@/lib/exporters/markdownExporter'
import { exportToHtml }   from '@/lib/exporters/htmlExporter'
import { exportToPdf }    from '@/lib/exporters/pdfExporter'

// ============================================================
// 타입
// ============================================================

type ExportFormat = 'markdown' | 'html' | 'json' | 'pdf'

interface FormatOption {
  id:       ExportFormat
  label:    string
  ext:      string
  icon:     string
  desc:     string
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    id:    'markdown',
    label: 'Markdown',
    ext:   'md',
    icon:  'M↓',
    desc:  '태그·STT·필기·수식·코드 포함. 수식은 $...$ 그대로.',
  },
  {
    id:    'html',
    label: 'HTML (인쇄용)',
    ext:   'html',
    icon:  '</>',
    desc:  'KaTeX 수식 렌더링 포함. 브라우저에서 인쇄 가능.',
  },
  {
    id:    'json',
    label: 'JSON',
    ext:   'json',
    icon:  '{}',
    desc:  '전체 세션 데이터 원시 덤프. 개발 / 백업용.',
  },
  {
    id:    'pdf',
    label: 'PDF (필기 합성)',
    ext:   'pdf',
    icon:  'PDF',
    desc:  '원본 PDF에 형광펜·텍스트 상자·스티커 합성.',
  },
]

// ============================================================
// ExportDialog
// ============================================================

export function ExportDialog() {
  const [isOpen,     setIsOpen]     = useState(false)
  const [format,     setFormat]     = useState<ExportFormat>('markdown')
  const [isExporting, setIsExporting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const sessionId = useSessionStore((s) => s.sessionId)

  // Ctrl+E 단축키
  useHotkeys(
    'ctrl+e',
    (e) => {
      e.preventDefault()
      setIsOpen((prev) => !prev)
      setError(null)
    },
    { enableOnFormTags: false },
  )

  const handleClose = useCallback(() => {
    if (isExporting) return
    setIsOpen(false)
    setError(null)
  }, [isExporting])

  const handleExport = async () => {
    if (!sessionId) {
      setError('열려 있는 세션이 없습니다. 먼저 세션을 선택해 주세요.')
      return
    }
    setIsExporting(true)
    setError(null)

    try {
      const data = await loadExportData(sessionId)
      const safeName = (data.session.title || 'session').replace(/[/\\?%*:|"<>]/g, '_')

      let blob:     Blob
      let filename: string

      switch (format) {
        case 'markdown':
          blob     = new Blob([exportToMarkdown(data)], { type: 'text/markdown;charset=utf-8' })
          filename = `${safeName}.md`
          break
        case 'html':
          blob     = new Blob([exportToHtml(data)], { type: 'text/html;charset=utf-8' })
          filename = `${safeName}.html`
          break
        case 'json':
          blob     = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
          filename = `${safeName}.json`
          break
        case 'pdf':
          blob     = await exportToPdf(data)
          filename = `${safeName}_annotated.pdf`
          break
      }

      // 파일 다운로드 트리거
      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      a.href     = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setIsOpen(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsExporting(false)
    }
  }

  if (!isOpen) return null

  const selectedOption = FORMAT_OPTIONS.find((o) => o.id === format)!

  return createPortal(
    <>
      {/* 배경 오버레이 */}
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
        onClick={handleClose}
      />

      {/* 모달 */}
      <div
        className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width:           420,
          backgroundColor: 'var(--bg-primary)',
          borderRadius:    20,
          boxShadow:       '0 24px 48px rgba(0,0,0,0.4), 0 0 0 1px var(--border-subtle)',
          padding:         '24px 24px 20px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-5">
          <h2
            className="text-base font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            내보내기
          </h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            disabled={isExporting}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6"  x2="6"  y2="18" />
              <line x1="6"  y1="6"  x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 형식 선택 */}
        <div className="flex flex-col gap-2 mb-5">
          {FORMAT_OPTIONS.map((opt) => {
            const isSelected = format === opt.id
            return (
              <label
                key={opt.id}
                className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all"
                style={{
                  backgroundColor: isSelected
                    ? 'rgba(59,130,246,0.12)'
                    : 'var(--bg-secondary)',
                  border: `1.5px solid ${isSelected ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                }}
              >
                <input
                  type="radio"
                  name="export-format"
                  value={opt.id}
                  checked={isSelected}
                  onChange={() => { setFormat(opt.id); setError(null) }}
                  className="sr-only"
                />

                {/* 커스텀 라디오 */}
                <div
                  className="shrink-0 mt-0.5 rounded-full flex items-center justify-center"
                  style={{
                    width:       18,
                    height:      18,
                    border:      `2px solid ${isSelected ? 'var(--accent-blue)' : 'var(--border-default)'}`,
                    backgroundColor: isSelected ? 'var(--accent-blue)' : 'transparent',
                  }}
                >
                  {isSelected && (
                    <div className="rounded-full" style={{ width: 6, height: 6, backgroundColor: '#fff' }} />
                  )}
                </div>

                {/* 포맷 정보 */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-mono px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: isSelected ? 'rgba(59,130,246,0.2)' : 'var(--bg-tertiary)',
                        color:           isSelected ? 'var(--accent-blue)'   : 'var(--text-muted)',
                      }}
                    >
                      {opt.icon}
                    </span>
                    <span
                      className="text-sm font-medium"
                      style={{ color: isSelected ? 'var(--accent-blue)' : 'var(--text-primary)' }}
                    >
                      {opt.label}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: 'var(--text-disabled)' }}
                    >
                      .{opt.ext}
                    </span>
                  </div>
                  <p
                    className="text-xs mt-0.5 leading-relaxed"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {opt.desc}
                  </p>
                </div>
              </label>
            )
          })}
        </div>

        {/* 에러 메시지 */}
        {error && (
          <p
            className="text-xs mb-3 px-3 py-2 rounded-lg"
            style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
          >
            {error}
          </p>
        )}

        {/* 내보내기 버튼 */}
        <button
          onClick={handleExport}
          disabled={isExporting || !sessionId}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--accent-blue)',
            color:           '#fff',
          }}
        >
          {isExporting
            ? `${selectedOption.label} 생성 중…`
            : `${selectedOption.label}으로 내보내기`}
        </button>

        {/* 단축키 힌트 */}
        <p
          className="text-xs text-center mt-3"
          style={{ color: 'var(--text-disabled)' }}
        >
          <kbd style={{ fontFamily: 'monospace' }}>Ctrl+E</kbd> 로 열고 닫기
        </p>
      </div>
    </>,
    document.body,
  )
}
