/**
 * @file components/pdf/TranslationSelectBox.tsx
 * LectureMate — PDF 영역 선택 번역 도구
 *
 * 드래그로 영역을 선택하고 LibreTranslate API로 번역합니다.
 * pdfjs-dist의 getTextContent()로 선택 영역 내 텍스트를 추출합니다.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import * as pdfjs from 'pdfjs-dist'
import { translateText, detectLang, LANG_LABELS } from '@/lib/translator'
import { useTranslationStore } from '@/stores/translationStore'
import { useSessionStore } from '@/stores/sessionStore'

// ============================================================
// 언어 목록
// ============================================================

const LANGUAGES = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'es', label: 'Español' },
]

// ============================================================
// 헬퍼
// ============================================================

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x:      Math.min(x1, x2),
    y:      Math.min(y1, y2),
    width:  Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

async function extractTextFromRect(
  pdfFile: File,
  pageNumber: number,
  selRect: Rect,
  pageWidth: number,
  pageHeight: number,
): Promise<string> {
  const arrayBuffer = await pdfFile.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })

  const scaleX = viewport.width  / pageWidth
  const scaleY = viewport.height / pageHeight

  const selLeft   = selRect.x                        * scaleX
  const selTop    = selRect.y                        * scaleY
  const selRight  = (selRect.x + selRect.width)      * scaleX
  const selBottom = (selRect.y + selRect.height)     * scaleY

  const textContent = await page.getTextContent()
  const items = textContent.items as Array<{
    str: string
    transform: number[]
    width: number
    height: number
  }>

  const matched: string[] = []

  for (const item of items) {
    if (!item.str.trim()) continue
    const [, , , d, e, f] = item.transform
    const [cssX, cssY] = viewport.convertToViewportPoint(e, f)
    const textHeight = Math.abs(d) * (viewport.height / viewport.width) * scaleX

    const itemLeft   = cssX
    const itemBottom = cssY
    const itemTop    = cssY - textHeight
    const itemRight  = cssX + item.width * scaleX

    if (
      itemRight  >= selLeft  &&
      itemLeft   <= selRight &&
      itemBottom >= selTop   &&
      itemTop    <= selBottom
    ) {
      matched.push(item.str)
    }
  }

  return matched.join(' ').replace(/\s+/g, ' ').trim()
}

// ============================================================
// Props
// ============================================================

interface TranslationSelectBoxProps {
  pageNumber: number
  pdfFile: File
  pageWidth: number
  pageHeight: number
}

// ============================================================
// Component
// ============================================================

type Phase = 'idle' | 'dragging' | 'toolbar' | 'loading' | 'result'

export function TranslationSelectBox({
  pageNumber,
  pdfFile,
  pageWidth,
  pageHeight,
}: TranslationSelectBoxProps) {
  const defaultTargetLang    = useTranslationStore((s) => s.defaultTargetLang)
  const defaultDisplayMode   = useTranslationStore((s) => s.defaultDisplayMode)
  const autoDetectSource     = useTranslationStore((s) => s.autoDetectSource)
  const setDefaultTargetLang = useTranslationStore((s) => s.setDefaultTargetLang)
  const addTranslation       = useTranslationStore((s) => s.addTranslation)
  const sessionId            = useSessionStore((s) => s.sessionId)
  const pdfId                = useSessionStore((s) => s.pdfId)

  const [phase, setPhase]               = useState<Phase>('idle')
  const [dragStart, setDragStart]       = useState<{ x: number; y: number } | null>(null)
  const [dragCurrent, setDragCurrent]   = useState<{ x: number; y: number } | null>(null)
  const [selRect, setSelRect]           = useState<Rect | null>(null)
  const [targetLang, setTargetLang]     = useState(defaultTargetLang)
  const [detectedLang, setDetectedLang] = useState<string | null>(null)
  const [isDetecting, setIsDetecting]   = useState(false)
  const [sourceText, setSourceText]     = useState('')
  const [translatedText, setTranslated] = useState('')
  const [error, setError]               = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // defaultTargetLang이 외부에서 바뀌면 동기화
  useEffect(() => {
    setTargetLang(defaultTargetLang)
  }, [defaultTargetLang])

  const getRelativePos = useCallback((e: React.MouseEvent) => {
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (phase !== 'idle') return
    e.preventDefault()
    e.stopPropagation()
    const pos = getRelativePos(e)
    setDragStart(pos)
    setDragCurrent(pos)
    setPhase('dragging')
    setError(null)
    setDetectedLang(null)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (phase !== 'dragging' || !dragStart) return
    e.preventDefault()
    setDragCurrent(getRelativePos(e))
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    if (phase !== 'dragging' || !dragStart || !dragCurrent) return
    e.preventDefault()
    const rect = normalizeRect(dragStart.x, dragStart.y, dragCurrent.x, dragCurrent.y)
    if (rect.width < 8 || rect.height < 8) {
      setPhase('idle')
      setDragStart(null)
      setDragCurrent(null)
      return
    }
    setSelRect(rect)
    setPhase('toolbar')
    setDragStart(null)
    setDragCurrent(null)

    // 선택 직후 텍스트 추출 + 언어 자동 감지 (설정에 따라 조건부)
    if (autoDetectSource) {
      void (async () => {
        setIsDetecting(true)
        try {
          const extracted = await extractTextFromRect(pdfFile, pageNumber, rect, pageWidth, pageHeight)
          if (extracted) {
            const lang = await detectLang(extracted)
            setDetectedLang(lang)
          }
        } catch {
          // 감지 실패 시 무시
        } finally {
          setIsDetecting(false)
        }
      })()
    }
  }

  const handleTranslate = async () => {
    if (!selRect) return
    setPhase('loading')
    setError(null)
    try {
      const extracted = await extractTextFromRect(pdfFile, pageNumber, selRect, pageWidth, pageHeight)
      if (!extracted) {
        setError('선택 영역에서 텍스트를 찾을 수 없습니다.')
        setPhase('toolbar')
        return
      }
      const sourceLang = detectedLang ?? 'auto'
      const translated = await translateText(extracted, sourceLang, targetLang)
      setSourceText(extracted)
      setTranslated(translated)

      // 기본 언어 기억 + 스토어에 저장
      setDefaultTargetLang(targetLang)
      if (sessionId && pdfId) {
        void addTranslation({
          sessionId,
          pdfId,
          pageNumber,
          sourceRect: {
            x:      selRect.x      / pageWidth,
            y:      selRect.y      / pageHeight,
            width:  selRect.width  / pageWidth,
            height: selRect.height / pageHeight,
          },
          sourceText:     extracted,
          translatedText: translated,
          sourceLang:     sourceLang,
          targetLang,
          displayMode: defaultDisplayMode,
        })
      }

      setPhase('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : '번역 오류')
      setPhase('toolbar')
    }
  }

  const handleCancel = () => {
    setPhase('idle')
    setSelRect(null)
    setDragStart(null)
    setDragCurrent(null)
    setSourceText('')
    setTranslated('')
    setDetectedLang(null)
    setError(null)
  }

  // 현재 그려지는 rect
  const drawnRect: Rect | null =
    phase === 'dragging' && dragStart && dragCurrent
      ? normalizeRect(dragStart.x, dragStart.y, dragCurrent.x, dragCurrent.y)
      : selRect

  const popupTop  = drawnRect ? drawnRect.y + drawnRect.height + 8 : 0
  const popupLeft = drawnRect ? drawnRect.x : 0

  // 감지된 언어 레이블
  const detectedLabel = detectedLang && LANG_LABELS[detectedLang]
    ? `${LANG_LABELS[detectedLang]} (자동 감지)`
    : null

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'absolute',
        inset:    0,
        zIndex:   20,
        cursor:   phase === 'idle' ? 'crosshair' : 'default',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* ── 선택 영역 rect ─────────────────────────────── */}
      {drawnRect && (
        <div
          style={{
            position:        'absolute',
            left:            drawnRect.x,
            top:             drawnRect.y,
            width:           drawnRect.width,
            height:          drawnRect.height,
            border:          '2px dashed #3182F6',
            backgroundColor: 'rgba(49,130,246,0.08)',
            borderRadius:    4,
            pointerEvents:   'none',
          }}
        />
      )}

      {/* ── 번역 중 로딩 오버레이 ──────────────────────── */}
      {phase === 'loading' && drawnRect && (
        <div
          style={{
            position:        'absolute',
            left:            drawnRect.x,
            top:             drawnRect.y,
            width:           drawnRect.width,
            height:          drawnRect.height,
            borderRadius:    4,
            backgroundColor: 'rgba(255,255,255,0.80)',
            backdropFilter:  'blur(4px)',
            display:         'flex',
            flexDirection:   'column',
            alignItems:      'center',
            justifyContent:  'center',
            gap:             6,
            pointerEvents:   'none',
          }}
        >
          {/* 스피너 */}
          <div
            style={{
              width:       20,
              height:      20,
              border:      '2.5px solid #DBEAFE',
              borderTop:   '2.5px solid #3182F6',
              borderRadius:'50%',
              animation:   'spin 0.7s linear infinite',
            }}
          />
          <span style={{ fontSize: 11, color: '#3182F6', fontWeight: 500 }}>번역 중...</span>
        </div>
      )}

      {/* ── 팝업 (툴바 / 결과) ─────────────────────────── */}
      {(phase === 'toolbar' || phase === 'loading' || phase === 'result') && drawnRect && (
        <div
          style={{
            position:        'absolute',
            top:             popupTop,
            left:            popupLeft,
            backgroundColor: '#FFFFFF',
            border:          '1px solid #E5E7EB',
            borderRadius:    12,
            boxShadow:       '0 8px 24px rgba(0,0,0,0.12)',
            padding:         '10px 12px',
            zIndex:          30,
            minWidth:        280,
            maxWidth:        360,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {phase === 'result' ? (
            /* ── 번역 결과 ──────────────────────────── */
            <div>
              <p style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>원문</p>
              <p style={{ fontSize: 12, color: '#374151', marginBottom: 8, lineHeight: 1.5 }}>
                {sourceText}
              </p>
              <p style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>번역</p>
              <p style={{ fontSize: 13, color: '#111827', fontWeight: 500, lineHeight: 1.6 }}>
                {translatedText}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button
                  onClick={handleCancel}
                  style={{
                    padding:         '5px 14px',
                    borderRadius:    8,
                    fontSize:        12,
                    backgroundColor: '#F3F4F6',
                    color:           '#374151',
                    border:          'none',
                    cursor:          'pointer',
                  }}
                >
                  닫기
                </button>
              </div>
            </div>
          ) : (
            /* ── 번역 툴바 ──────────────────────────── */
            <div>
              {/* 감지된 소스 언어 */}
              {(isDetecting || detectedLabel) && (
                <p style={{ fontSize: 11, color: '#6B7280', marginBottom: 6 }}>
                  {isDetecting ? '언어 감지 중...' : detectedLabel}
                </p>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#6B7280', whiteSpace: 'nowrap' }}>→</span>
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  disabled={phase === 'loading'}
                  style={{
                    flex:            1,
                    padding:         '4px 8px',
                    borderRadius:    8,
                    border:          '1px solid #D1D5DB',
                    fontSize:        12,
                    backgroundColor: '#F9FAFB',
                    color:           '#111827',
                    cursor:          'pointer',
                  }}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => void handleTranslate()}
                  disabled={phase === 'loading'}
                  style={{
                    padding:         '5px 14px',
                    borderRadius:    8,
                    fontSize:        12,
                    fontWeight:      600,
                    backgroundColor: '#3182F6',
                    color:           '#FFFFFF',
                    border:          'none',
                    cursor:          phase === 'loading' ? 'not-allowed' : 'pointer',
                    whiteSpace:      'nowrap',
                    opacity:         phase === 'loading' ? 0.6 : 1,
                  }}
                >
                  번역하기
                </button>
                <button
                  onClick={handleCancel}
                  disabled={phase === 'loading'}
                  style={{
                    padding:         '5px 10px',
                    borderRadius:    8,
                    fontSize:        12,
                    backgroundColor: '#F3F4F6',
                    color:           '#6B7280',
                    border:          'none',
                    cursor:          'pointer',
                  }}
                >
                  취소
                </button>
              </div>

              {error && (
                <p style={{ fontSize: 11, color: '#EF4444', marginTop: 6 }}>{error}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 스피너 keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
