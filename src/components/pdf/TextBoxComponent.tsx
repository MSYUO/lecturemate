/**
 * @file components/pdf/TextBoxComponent.tsx
 * LectureMate — PDF 위 텍스트 상자 컴포넌트
 *
 * ## 동작 상태 전이
 *   mount (content==='')  → 편집 모드 (autoFocus)
 *   blur / Enter          → detectAndConvertMath → 수식/텍스트 표시 모드
 *   클릭 / 더블클릭       → 편집 모드 재진입
 *   Escape                → 편집 취소 (변경 롤백)
 *
 * ## 수식 모드 진입 방법
 *   1. 자동 감지: blur 시 isMathExpression 점수 ≥ 3 → naturalLanguageToLatex 변환
 *   2. '$...' 접두사: "$시그마 i=1 에서 n" → 강제 한국어→LaTeX 변환
 *   3. '$$...$$' 감싸기: "$$\sum_{i=1}^{n}$$" → raw LaTeX 직접 사용
 *   4. Ctrl+M: 현재 텍스트 상자 수식 모드 토글
 *
 * ## 드래그 / 리사이즈
 *   이동 중 localCoords로 미리보기, mouseup 시 undoRedoStore에 커밋
 *
 * ## 애니메이션
 *   텍스트→수식 전환 시 opacity cross-fade 150ms
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import 'katex/dist/katex.min.css'
import {
  detectAndConvertMath,
  naturalLanguageToLatex,
  renderMath,
} from '@/lib/mathParser'
import { useUndoRedoStore } from '@/stores/undoRedoStore'
import type { TextBoxAnnotation, BoundingBox } from '@/types'

// ============================================================
// 상수
// ============================================================

const MIN_W = 0.12
const MIN_H = 0.04

// ============================================================
// Props / 내부 타입
// ============================================================

interface Props {
  textbox: TextBoxAnnotation
  containerRef: React.RefObject<HTMLDivElement>
}

interface InteractState {
  type:          'drag' | 'resize'
  mouseX:        number
  mouseY:        number
  startCoords:   BoundingBox
  currentCoords: BoundingBox
  hasMoved:      boolean
}

// ============================================================
// TextBoxComponent
// ============================================================

export function TextBoxComponent({ textbox, containerRef }: Props) {

  // ── 편집 상태 ─────────────────────────────────────────────
  const [isEditing,   setIsEditing]   = useState(textbox.content === '')
  const [content,     setContent]     = useState(textbox.content)
  const [isHovered,   setIsHovered]   = useState(false)
  const [localCoords, setLocalCoords] = useState<BoundingBox | null>(null)

  // ── 수식 상태 ─────────────────────────────────────────────
  /** KaTeX 렌더링 HTML 캐시 (state — undo/redo·변환 시 갱신) */
  const [mathHtml, setMathHtml] = useState<string | null>(() =>
    textbox.isMathMode && textbox.mathLatex
      ? renderMath(textbox.mathLatex)
      : null,
  )
  /**
   * opacity cross-fade 트리거.
   * - 마운트 시: true (애니메이션 없이 즉시 표시)
   * - mathHtml 변경 시: false → rAF → true (fade-in)
   */
  const [mathVisible, setMathVisible] = useState(
    !!(textbox.isMathMode && textbox.mathLatex),
  )

  // ── 레퍼런스 ──────────────────────────────────────────────
  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const interactRef  = useRef<InteractState | null>(null)
  const isMountedRef = useRef(false)

  const updateTextBox = useUndoRedoStore((s) => s.updateTextBox)
  const deleteTextBox = useUndoRedoStore((s) => s.deleteTextBox)

  const coords = localCoords ?? textbox.coordinates

  // ── undo/redo·외부 변경 → mathHtml 동기화 ─────────────────

  useEffect(() => {
    if (textbox.isMathMode && textbox.mathLatex) {
      setMathHtml(renderMath(textbox.mathLatex))
    } else {
      setMathHtml(null)
    }
  }, [textbox.isMathMode, textbox.mathLatex])

  // ── undo/redo → content 동기화 ────────────────────────────

  useEffect(() => {
    if (!isEditing) setContent(textbox.content)
  }, [textbox.content, isEditing])

  // ── mathHtml 변경 시 fade-in 애니메이션 ───────────────────

  useEffect(() => {
    if (!isMountedRef.current) {
      // 최초 마운트: 이미 존재하는 수식은 즉시 표시 (애니메이션 없음)
      isMountedRef.current = true
      return
    }
    if (mathHtml) {
      setMathVisible(false)
      const id = requestAnimationFrame(() => setMathVisible(true))
      return () => cancelAnimationFrame(id)
    }
    setMathVisible(false)
  }, [mathHtml])

  // ── 편집 모드 → textarea autoFocus ───────────────────────

  useEffect(() => {
    if (isEditing) {
      const id = requestAnimationFrame(() => textareaRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [isEditing])

  // ── 수식 모드 토글 (Ctrl+M) ───────────────────────────────

  const handleToggleMathMode = useCallback(async () => {
    if (textbox.isMathMode) {
      // 수식 모드 OFF → 일반 텍스트
      setMathHtml(null)
      updateTextBox(textbox.id, {
        isMathMode: false,
        mathLatex:  undefined,
      })
    } else {
      // 수식 모드 ON → 현재 내용 강제 변환
      const src   = isEditing ? content : textbox.content
      const latex = naturalLanguageToLatex(src)
      const html  = renderMath(latex)
      setMathHtml(html)
      if (isEditing) setIsEditing(false)
      updateTextBox(textbox.id, {
        content:    src,
        mathLatex:  latex,
        isMathMode: true,
      })
    }
  }, [
    textbox.isMathMode, textbox.id, textbox.content,
    isEditing, content, updateTextBox,
  ])

  // ── blur → 수식 감지·저장 ─────────────────────────────────

  const commitContent = useCallback(async () => {
    setIsEditing(false)

    let storedContent = content
    let latex: string | null   = null
    let katexHtml: string | null = null

    // ① "$$raw latex$$" → raw LaTeX 직접 사용
    const rawMatch = content.match(/^\$\$(.+)\$\$$/s)
    if (rawMatch) {
      storedContent = rawMatch[1].trim()
      latex    = storedContent
      katexHtml = renderMath(latex)
    }
    // ② "$..." → 강제 한국어→LaTeX 변환
    else if (content.startsWith('$')) {
      storedContent = content.slice(1).trim()
      latex    = naturalLanguageToLatex(storedContent)
      katexHtml = renderMath(latex)
    }
    // ③ 자동 감지
    else {
      const result = await detectAndConvertMath(content)
      if (result) {
        latex    = result.latex
        katexHtml = result.katexHtml
      }
    }

    if (latex !== null && katexHtml !== null) {
      // 수식으로 감지됨
      setMathHtml(katexHtml)
      updateTextBox(textbox.id, {
        content:    storedContent,
        mathLatex:  latex,
        isMathMode: true,
      })
    } else {
      // 일반 텍스트
      setMathHtml(null)
      if (content !== textbox.content || textbox.isMathMode) {
        updateTextBox(textbox.id, {
          content,
          mathLatex:  undefined,
          isMathMode: false,
        })
      }
    }
  }, [content, textbox.id, textbox.content, textbox.isMathMode, updateTextBox])

  const handleBlur = useCallback(() => {
    void commitContent()
  }, [commitContent])

  // ── 키다운 (textarea) ─────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()   // PDF 단축키 버블링 방지

    if (e.key === 'Escape') {
      setContent(textbox.content)
      setIsEditing(false)
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
      e.preventDefault()
      void handleToggleMathMode()
      return
    }
    // Enter 단독: 편집 완료 | Shift+Enter: 줄바꿈
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void commitContent()
    }
  }, [textbox.content, commitContent, handleToggleMathMode])

  // ── 키다운 (표시 모드 — outer div focused) ────────────────

  const handleDisplayKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
      e.preventDefault()
      void handleToggleMathMode()
    }
  }, [handleToggleMathMode])

  // ── 드래그 시작 ───────────────────────────────────────────

  const startDrag = useCallback((e: React.MouseEvent) => {
    if (isEditing) return
    e.preventDefault()
    e.stopPropagation()
    const c = { ...textbox.coordinates }
    interactRef.current = {
      type: 'drag',
      mouseX: e.clientX, mouseY: e.clientY,
      startCoords: c, currentCoords: c,
      hasMoved: false,
    }
  }, [isEditing, textbox.coordinates])

  // ── 리사이즈 시작 ─────────────────────────────────────────

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const c = { ...textbox.coordinates }
    interactRef.current = {
      type: 'resize',
      mouseX: e.clientX, mouseY: e.clientY,
      startCoords: c, currentCoords: c,
      hasMoved: false,
    }
  }, [textbox.coordinates])

  // ── 전역 mousemove / mouseup ──────────────────────────────

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const ir = interactRef.current
      if (!ir || !containerRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      const dx   = (e.clientX - ir.mouseX) / rect.width
      const dy   = (e.clientY - ir.mouseY) / rect.height
      const s    = ir.startCoords
      let next: BoundingBox

      if (ir.type === 'drag') {
        next = {
          ...s,
          x: Math.max(0, Math.min(1 - s.width,  s.x + dx)),
          y: Math.max(0, Math.min(1 - s.height, s.y + dy)),
        }
      } else {
        next = {
          ...s,
          width:  Math.max(MIN_W, s.width  + dx),
          height: Math.max(MIN_H, s.height + dy),
        }
      }

      ir.currentCoords = next
      ir.hasMoved      = true
      setLocalCoords(next)
    }

    const onUp = () => {
      const ir = interactRef.current
      if (!ir) return
      if (ir.hasMoved) {
        updateTextBox(textbox.id, { coordinates: ir.currentCoords })
      }
      interactRef.current = null
      setLocalCoords(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [textbox.id, containerRef, updateTextBox])

  // ── 렌더 ──────────────────────────────────────────────────

  const isMathDisplay = !isEditing && !!mathHtml

  return (
    <div
      className="absolute pointer-events-auto outline-none"
      tabIndex={0}   // 표시 모드에서도 키보드 이벤트 수신 (Ctrl+M 등)
      style={{
        left:      `${coords.x      * 100}%`,
        top:       `${coords.y      * 100}%`,
        width:     `${coords.width  * 100}%`,
        minHeight: `${coords.height * 100}%`,
        cursor:    isEditing ? 'default' : 'move',
        zIndex:    isEditing ? 20 : 10,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={startDrag}
      onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true) }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleDisplayKeyDown}
    >

      {/* ── 카드 본체 ────────────────────────────────────── */}
      <div
        style={{
          position:        'relative',
          backgroundColor: 'rgba(255, 255, 255, 0.97)',
          borderRadius:    8,
          border:          isEditing
            ? '1.5px solid var(--border-focus)'
            : isMathDisplay
              ? '1px solid rgba(79, 142, 247, 0.3)'  // 수식 모드: 연한 파란 테두리
              : '1px solid rgba(0, 0, 0, 0.13)',
          boxShadow: isEditing
            ? '0 4px 16px rgba(0,0,0,0.18)'
            : '0 1px 4px rgba(0,0,0,0.10)',
          padding:    '6px 8px',
          minHeight:  36,
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        {isEditing ? (
          /* 편집 모드 — textarea */
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="텍스트 입력… | $시그마 i=1 에서 n | $$\LaTeX$$"
            rows={2}
            className="w-full resize-none outline-none bg-transparent text-sm leading-relaxed"
            style={{
              color:      '#1a1a2e',
              fontFamily: 'var(--font-sans)',
              minHeight:  44,
            }}
          />
        ) : isMathDisplay ? (
          /* 수식 표시 모드 — KaTeX HTML (opacity cross-fade) */
          <div
            className="text-sm leading-relaxed"
            style={{
              color:      '#1a1a2e',
              cursor:     'text',
              opacity:    mathVisible ? 1 : 0,
              transition: 'opacity 150ms ease',
              // 수식 렌더링 패딩
              paddingTop:    2,
              paddingBottom: 2,
            }}
            dangerouslySetInnerHTML={{ __html: mathHtml! }}
          />
        ) : (
          /* 일반 텍스트 표시 */
          <p
            className="text-sm whitespace-pre-wrap leading-relaxed select-text"
            style={{
              color:     content ? '#1a1a2e' : 'rgba(0,0,0,0.35)',
              cursor:    'text',
              minHeight: 20,
              margin:    0,
            }}
          >
            {content || '(비어있음)'}
          </p>
        )}

        {/* ── [Σ] 수식 모드 뱃지 ─────────────────────────── */}
        {textbox.isMathMode && !isEditing && (
          <div
            className="absolute pointer-events-none select-none"
            style={{
              top:       4,
              right:     6,
              fontSize:  11,
              fontFamily: 'var(--font-mono)',
              color:     'var(--accent-blue)',
              opacity:   0.55,
              lineHeight: 1,
            }}
          >
            Σ
          </div>
        )}
      </div>

      {/* ── 리사이즈 핸들 (우하단) ──────────────────────── */}
      <div
        className="absolute bottom-0 right-0 rounded-br-lg"
        style={{
          width:           14,
          height:          14,
          cursor:          'se-resize',
          backgroundColor: isHovered ? 'var(--accent-blue)' : 'transparent',
          opacity:         isHovered ? 0.7 : 0,
          transition:      'opacity 0.15s',
        }}
        onMouseDown={startResize}
      />

      {/* ── 삭제 버튼 — 호버 시 fade-in ──────────────────── */}
      <button
        className="absolute flex items-center justify-center rounded-full text-white font-bold text-xs leading-none"
        style={{
          top:             -10,
          right:           -10,
          width:           20,
          height:          20,
          backgroundColor: 'var(--accent-red)',
          opacity:         isHovered ? 1 : 0,
          pointerEvents:   isHovered ? 'auto' : 'none',
          transition:      'opacity 0.15s',
          cursor:          'pointer',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          deleteTextBox(textbox.id)
        }}
        aria-label="텍스트 상자 삭제"
      >
        ×
      </button>
    </div>
  )
}
