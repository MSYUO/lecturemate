/**
 * @file components/pdf/TextBoxComponent.tsx
 * LectureMate — PDF 위 텍스트 상자 컴포넌트
 *
 * ## 슬래시 명령어 자동완성
 *   textarea에서 / 입력 시 수식 기호 드롭다운 팝업 표시
 *   /sigma → Σ, /alpha → α, /integral → ∫ 등
 *   Arrow 키 탐색, Enter 선택, ESC 닫기
 *
 * ## 수식 모드 진입
 *   $$ ... $$ → raw LaTeX 직접 사용
 *   $ ... → 한국어 → LaTeX 변환
 *   blur 시 자동 감지
 *   Ctrl+M: 수식 모드 토글
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
// 슬래시 명령어 목록
// ============================================================

interface SlashCommand {
  cmd:    string   // /sigma 등 명령어 (슬래시 제외)
  symbol: string   // Σ 등 실제 기호
  label:  string   // 'Sigma (합산)' 등 표시명
}

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: 'sigma',    symbol: 'Σ', label: 'Sigma (합산)' },
  { cmd: 'sum',      symbol: 'Σ', label: 'Sum' },
  { cmd: 'alpha',    symbol: 'α', label: 'Alpha' },
  { cmd: 'beta',     symbol: 'β', label: 'Beta' },
  { cmd: 'gamma',    symbol: 'γ', label: 'Gamma' },
  { cmd: 'delta',    symbol: 'δ', label: 'Delta' },
  { cmd: 'theta',    symbol: 'θ', label: 'Theta' },
  { cmd: 'pi',       symbol: 'π', label: 'Pi' },
  { cmd: 'omega',    symbol: 'ω', label: 'Omega' },
  { cmd: 'lambda',   symbol: 'λ', label: 'Lambda' },
  { cmd: 'mu',       symbol: 'μ', label: 'Mu' },
  { cmd: 'epsilon',  symbol: 'ε', label: 'Epsilon' },
  { cmd: 'phi',      symbol: 'φ', label: 'Phi' },
  { cmd: 'psi',      symbol: 'ψ', label: 'Psi' },
  { cmd: 'sqrt',     symbol: '√', label: 'Square Root' },
  { cmd: 'integral', symbol: '∫', label: 'Integral' },
  { cmd: 'infinity', symbol: '∞', label: 'Infinity' },
  { cmd: 'prod',     symbol: 'Π', label: 'Product' },
  { cmd: 'partial',  symbol: '∂', label: 'Partial Derivative' },
  { cmd: 'leq',      symbol: '≤', label: 'Less or Equal' },
  { cmd: 'geq',      symbol: '≥', label: 'Greater or Equal' },
  { cmd: 'neq',      symbol: '≠', label: 'Not Equal' },
  { cmd: 'approx',   symbol: '≈', label: 'Approximately' },
  { cmd: 'arrow',    symbol: '→', label: 'Arrow Right' },
  { cmd: 'leftarrow',symbol: '←', label: 'Arrow Left' },
  { cmd: 'forall',   symbol: '∀', label: 'For All' },
  { cmd: 'exists',   symbol: '∃', label: 'There Exists' },
  { cmd: 'in',       symbol: '∈', label: 'Element of' },
  { cmd: 'notin',    symbol: '∉', label: 'Not Element of' },
  { cmd: 'subset',   symbol: '⊂', label: 'Subset' },
  { cmd: 'cup',      symbol: '∪', label: 'Union' },
  { cmd: 'cap',      symbol: '∩', label: 'Intersection' },
  { cmd: 'pm',       symbol: '±', label: 'Plus Minus' },
  { cmd: 'times',    symbol: '×', label: 'Multiply' },
  { cmd: 'div',      symbol: '÷', label: 'Divide' },
  { cmd: 'cdot',     symbol: '·', label: 'Center Dot' },
  { cmd: 'degree',   symbol: '°', label: 'Degree' },
  { cmd: 'because',  symbol: '∵', label: 'Because' },
  { cmd: 'therefore',symbol: '∴', label: 'Therefore' },
  { cmd: 'nabla',    symbol: '∇', label: 'Nabla (Gradient)' },
]

// ============================================================
// 슬래시 드롭다운
// ============================================================

function SlashDropdown({
  query,
  selectedIndex,
  onSelect,
}: {
  query: string
  selectedIndex: number
  onSelect: (cmd: SlashCommand) => void
}) {
  const filtered = SLASH_COMMANDS.filter((c) =>
    c.cmd.startsWith(query.toLowerCase()) ||
    c.label.toLowerCase().includes(query.toLowerCase()),
  )

  if (filtered.length === 0) return null

  return (
    <div
      className="absolute z-50 rounded-xl overflow-hidden"
      style={{
        bottom:          '100%',
        left:            0,
        marginBottom:    6,
        backgroundColor: '#FFFFFF',
        border:          '1px solid #F2F4F8',
        boxShadow:       '0 8px 32px rgba(0,0,0,0.14)',
        minWidth:        220,
        maxHeight:       200,
        overflowY:       'auto',
      }}
    >
      {filtered.map((cmd, idx) => (
        <button
          key={cmd.cmd}
          onMouseDown={(e) => { e.preventDefault(); onSelect(cmd) }}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors"
          style={{
            backgroundColor: idx === selectedIndex ? '#EBF3FF' : 'transparent',
            color:           idx === selectedIndex ? '#3182F6' : '#191F28',
          }}
          onMouseEnter={(e) => {
            if (idx !== selectedIndex) (e.currentTarget as HTMLElement).style.backgroundColor = '#F9FAFB'
          }}
          onMouseLeave={(e) => {
            if (idx !== selectedIndex) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
          }}
        >
          <span
            className="shrink-0 text-center font-mono"
            style={{
              width:      28,
              fontSize:   16,
              lineHeight: 1,
              color:      '#191F28',
            }}
          >
            {cmd.symbol}
          </span>
          <div>
            <span className="font-medium text-xs" style={{ color: idx === selectedIndex ? '#3182F6' : '#191F28' }}>
              /{cmd.cmd}
            </span>
            <span className="ml-2 text-xs" style={{ color: '#8B95A1' }}>{cmd.label}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

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
  const [mathHtml, setMathHtml] = useState<string | null>(() =>
    textbox.isMathMode && textbox.mathLatex
      ? renderMath(textbox.mathLatex)
      : null,
  )
  const [mathVisible, setMathVisible] = useState(
    !!(textbox.isMathMode && textbox.mathLatex),
  )

  // ── 슬래시 자동완성 상태 ──────────────────────────────────
  const [slashQuery,    setSlashQuery]    = useState<string | null>(null)
  const [slashSelIdx,   setSlashSelIdx]   = useState(0)

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

  useEffect(() => {
    if (!isEditing) setContent(textbox.content)
  }, [textbox.content, isEditing])

  useEffect(() => {
    if (!isMountedRef.current) {
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

  useEffect(() => {
    if (isEditing) {
      const id = requestAnimationFrame(() => textareaRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [isEditing])

  // ── 슬래시 명령어 감지 ────────────────────────────────────

  const updateSlashState = useCallback((val: string, selStart: number) => {
    const textBefore = val.slice(0, selStart)
    const lastSlash  = textBefore.lastIndexOf('/')
    if (lastSlash === -1) { setSlashQuery(null); return }
    // 슬래시 이전에 공백이나 시작 위치인지 확인
    const charBefore = textBefore[lastSlash - 1]
    if (lastSlash > 0 && charBefore !== ' ' && charBefore !== '\n') {
      setSlashQuery(null); return
    }
    const query = textBefore.slice(lastSlash + 1)
    if (/\s/.test(query)) { setSlashQuery(null); return }
    setSlashQuery(query)
    setSlashSelIdx(0)
  }, [])

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setContent(val)
    updateSlashState(val, e.target.selectionStart ?? val.length)
  }, [updateSlashState])

  // ── 슬래시 명령어 삽입 ────────────────────────────────────

  const applySlashCommand = useCallback((cmd: SlashCommand) => {
    if (!textareaRef.current) return
    const ta      = textareaRef.current
    const sel     = ta.selectionStart ?? content.length
    const before  = content.slice(0, sel)
    const after   = content.slice(sel)
    const lastSlash = before.lastIndexOf('/')
    const newContent = before.slice(0, lastSlash) + cmd.symbol + after
    setContent(newContent)
    setSlashQuery(null)
    // 커서 위치 복원
    requestAnimationFrame(() => {
      if (!textareaRef.current) return
      const pos = lastSlash + cmd.symbol.length
      textareaRef.current.setSelectionRange(pos, pos)
    })
  }, [content])

  // ── 수식 모드 토글 (Ctrl+M) ───────────────────────────────
  const handleToggleMathMode = useCallback(async () => {
    if (textbox.isMathMode) {
      setMathHtml(null)
      updateTextBox(textbox.id, { isMathMode: false, mathLatex: undefined })
    } else {
      const src   = isEditing ? content : textbox.content
      const latex = naturalLanguageToLatex(src)
      const html  = renderMath(latex)
      setMathHtml(html)
      if (isEditing) setIsEditing(false)
      updateTextBox(textbox.id, { content: src, mathLatex: latex, isMathMode: true })
    }
  }, [textbox.isMathMode, textbox.id, textbox.content, isEditing, content, updateTextBox])

  // ── blur → 수식 감지·저장 ─────────────────────────────────
  const commitContent = useCallback(async () => {
    setIsEditing(false)
    setSlashQuery(null)

    let storedContent   = content
    let latex: string | null     = null
    let katexHtml: string | null = null

    const rawMatch = content.match(/^\$\$(.+)\$\$$/s)
    if (rawMatch) {
      storedContent = rawMatch[1].trim()
      latex    = storedContent
      katexHtml = renderMath(latex)
    } else if (content.startsWith('$')) {
      storedContent = content.slice(1).trim()
      latex    = naturalLanguageToLatex(storedContent)
      katexHtml = renderMath(latex)
    } else {
      const result = await detectAndConvertMath(content)
      if (result) { latex = result.latex; katexHtml = result.katexHtml }
    }

    if (latex !== null && katexHtml !== null) {
      setMathHtml(katexHtml)
      updateTextBox(textbox.id, { content: storedContent, mathLatex: latex, isMathMode: true })
    } else {
      setMathHtml(null)
      if (content !== textbox.content || textbox.isMathMode) {
        updateTextBox(textbox.id, { content, mathLatex: undefined, isMathMode: false })
      }
    }
  }, [content, textbox.id, textbox.content, textbox.isMathMode, updateTextBox])

  const handleBlur = useCallback(() => {
    // 슬래시 드롭다운에서 mousedown 이벤트로 선택 시 blur가 먼저 오므로 약간 딜레이
    setTimeout(() => {
      if (slashQuery !== null) return
      void commitContent()
    }, 150)
  }, [commitContent, slashQuery])

  // ── 키다운 (textarea) ─────────────────────────────────────
  const filteredSlashCmds = slashQuery !== null
    ? SLASH_COMMANDS.filter((c) =>
        c.cmd.startsWith(slashQuery.toLowerCase()) ||
        c.label.toLowerCase().includes(slashQuery.toLowerCase()),
      )
    : []

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()

    // 슬래시 드롭다운 탐색
    if (slashQuery !== null && filteredSlashCmds.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashSelIdx((i) => (i + 1) % filteredSlashCmds.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSelIdx((i) => (i - 1 + filteredSlashCmds.length) % filteredSlashCmds.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        applySlashCommand(filteredSlashCmds[slashSelIdx])
        return
      }
      if (e.key === 'Escape') {
        setSlashQuery(null)
        return
      }
    }

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void commitContent()
    }
  }, [
    slashQuery, filteredSlashCmds, slashSelIdx,
    applySlashCommand, textbox.content, commitContent, handleToggleMathMode,
  ])

  // ── 키다운 (표시 모드) ────────────────────────────────────
  const handleDisplayKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
      e.preventDefault()
      void handleToggleMathMode()
    }
  }, [handleToggleMathMode])

  // ── 드래그 / 리사이즈 ────────────────────────────────────
  const startDrag = useCallback((e: React.MouseEvent) => {
    if (isEditing) return
    e.preventDefault(); e.stopPropagation()
    const c = { ...textbox.coordinates }
    interactRef.current = { type: 'drag', mouseX: e.clientX, mouseY: e.clientY, startCoords: c, currentCoords: c, hasMoved: false }
  }, [isEditing, textbox.coordinates])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const c = { ...textbox.coordinates }
    interactRef.current = { type: 'resize', mouseX: e.clientX, mouseY: e.clientY, startCoords: c, currentCoords: c, hasMoved: false }
  }, [textbox.coordinates])

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
        next = { ...s, x: Math.max(0, Math.min(1 - s.width, s.x + dx)), y: Math.max(0, Math.min(1 - s.height, s.y + dy)) }
      } else {
        next = { ...s, width: Math.max(MIN_W, s.width + dx), height: Math.max(MIN_H, s.height + dy) }
      }
      ir.currentCoords = next; ir.hasMoved = true; setLocalCoords(next)
    }
    const onUp = () => {
      const ir = interactRef.current
      if (!ir) return
      if (ir.hasMoved) updateTextBox(textbox.id, { coordinates: ir.currentCoords })
      interactRef.current = null; setLocalCoords(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [textbox.id, containerRef, updateTextBox])

  // ── 렌더 ──────────────────────────────────────────────────
  const isMathDisplay = !isEditing && !!mathHtml

  return (
    <div
      className="absolute pointer-events-auto outline-none"
      tabIndex={0}
      style={{
        left:      `${coords.x * 100}%`,
        top:       `${coords.y * 100}%`,
        width:     `${coords.width * 100}%`,
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
      {/* 카드 본체 */}
      <div
        style={{
          position:        'relative',
          backgroundColor: 'rgba(255,255,255,0.97)',
          borderRadius:    8,
          border:          isEditing
            ? '1.5px solid var(--border-focus)'
            : isMathDisplay
              ? '1px solid rgba(79,142,247,0.3)'
              : '1px solid rgba(0,0,0,0.13)',
          boxShadow:  isEditing ? '0 4px 16px rgba(0,0,0,0.18)' : '0 1px 4px rgba(0,0,0,0.10)',
          padding:    '6px 8px',
          minHeight:  36,
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        {/* 슬래시 드롭다운 */}
        {isEditing && slashQuery !== null && (
          <SlashDropdown
            query={slashQuery}
            selectedIndex={slashSelIdx}
            onSelect={applySlashCommand}
          />
        )}

        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="텍스트 입력… | /sigma → Σ | $수식 | $$LaTeX$$"
            rows={2}
            className="w-full resize-none outline-none bg-transparent text-sm leading-relaxed"
            style={{ color: '#1a1a2e', fontFamily: 'var(--font-sans)', minHeight: 44 }}
          />
        ) : isMathDisplay ? (
          <div
            className="text-sm leading-relaxed"
            style={{
              color: '#1a1a2e', cursor: 'text',
              opacity: mathVisible ? 1 : 0, transition: 'opacity 150ms ease',
              paddingTop: 2, paddingBottom: 2,
            }}
            dangerouslySetInnerHTML={{ __html: mathHtml! }}
          />
        ) : (
          <p
            className="text-sm whitespace-pre-wrap leading-relaxed select-text"
            style={{ color: content ? '#1a1a2e' : 'rgba(0,0,0,0.35)', cursor: 'text', minHeight: 20, margin: 0 }}
          >
            {content || '(비어있음)'}
          </p>
        )}

        {/* 수식 모드 배지 */}
        {textbox.isMathMode && !isEditing && (
          <div
            className="absolute pointer-events-none select-none"
            style={{ top: 4, right: 6, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)', opacity: 0.55, lineHeight: 1 }}
          >
            Σ
          </div>
        )}
      </div>

      {/* 리사이즈 핸들 */}
      <div
        className="absolute bottom-0 right-0 rounded-br-lg"
        style={{
          width: 14, height: 14, cursor: 'se-resize',
          backgroundColor: isHovered ? 'var(--accent-blue)' : 'transparent',
          opacity: isHovered ? 0.7 : 0, transition: 'opacity 0.15s',
        }}
        onMouseDown={startResize}
      />

      {/* 삭제 버튼 */}
      <button
        className="absolute flex items-center justify-center rounded-full text-white font-bold text-xs leading-none"
        style={{
          top: -10, right: -10, width: 20, height: 20,
          backgroundColor: 'var(--accent-red)',
          opacity: isHovered ? 1 : 0, pointerEvents: isHovered ? 'auto' : 'none',
          transition: 'opacity 0.15s', cursor: 'pointer',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); deleteTextBox(textbox.id) }}
        aria-label="텍스트 상자 삭제"
      >
        ×
      </button>
    </div>
  )
}
