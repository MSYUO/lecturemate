/**
 * @file components/toolbar/Toolbar.tsx
 * LectureMate — 하단 플로팅 툴바 (Chrome PDF 뷰어 + 토스뱅크 스타일)
 *
 * 레이아웃: [↖ 포인터 | ✏️ 펜 | 🖊 형광펜 | □ 도형 | — | T 텍스트 | — | 🎙 녹음 | — | ● 색상]
 * - 하단 중앙 플로팅, rounded-full pill, bg-white/92 backdrop-blur-xl
 * - 높이 48px, 아이콘 18px, 버튼 40×40 rounded-full
 * - 활성 도구: bg-[#3182F6] text-white
 */

import { useState, useRef, useEffect } from 'react'
import { useSessionStore } from '@/stores/sessionStore'
import type { ToolType, HighlightColor } from '@/types'

// ============================================================
// SVG 아이콘
// ============================================================

function PointerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3l14 9-7 1-4 7z"/>
    </svg>
  )
}

function PenIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
    </svg>
  )
}

function HighlighterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 11-6 6v3h9l3-3"/>
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>
    </svg>
  )
}

function ShapeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
    </svg>
  )
}

function TextIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7"/>
      <line x1="9" y1="20" x2="15" y2="20"/>
      <line x1="12" y1="4" x2="12" y2="20"/>
    </svg>
  )
}

function TranslateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 8 6 6"/>
      <path d="m4 14 6-6 2-3"/>
      <path d="M2 5h12"/>
      <path d="M7 2h1"/>
      <path d="m22 22-5-10-5 10"/>
      <path d="M14 18h6"/>
    </svg>
  )
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
    </svg>
  )
}

// ============================================================
// 헬퍼 컴포넌트
// ============================================================

function Divider() {
  return (
    <div
      className="self-stretch shrink-0 mx-0.5"
      style={{ width: 1, backgroundColor: 'rgba(0,0,0,0.08)', marginTop: 10, marginBottom: 10 }}
    />
  )
}

function ToolBtn({
  active, onClick, title, children, extraStyle,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
  extraStyle?: React.CSSProperties
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="relative flex items-center justify-center shrink-0 transition-colors duration-150 active:scale-90"
      style={{
        width:           40,
        height:          40,
        borderRadius:    20,
        backgroundColor: active ? '#3182F6' : 'transparent',
        color:           active ? '#FFFFFF' : '#6B7684',
        ...extraStyle,
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = '#F2F4F6'
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
      }}
    >
      {children}
    </button>
  )
}

// ============================================================
// 색상 / 굵기 팝업
// ============================================================

const HIGHLIGHT_COLORS_LIST: { key: HighlightColor; hex: string; label: string }[] = [
  { key: 'yellow', hex: '#FFD600', label: '노랑' },
  { key: 'green',  hex: '#34C77B', label: '초록' },
  { key: 'blue',   hex: '#3182F6', label: '파랑' },
  { key: 'pink',   hex: '#E91E63', label: '분홍' },
  { key: 'orange', hex: '#FF8A00', label: '주황' },
]

const PEN_COLORS_LIST = [
  { hex: '#000000', label: '검정' },
  { hex: '#F03E3E', label: '빨강' },
  { hex: '#3182F6', label: '파랑' },
  { hex: '#05C46B', label: '초록' },
  { hex: '#FF8A00', label: '주황' },
  { hex: '#7C3AED', label: '보라' },
  { hex: '#8B95A1', label: '회색' },
  { hex: '#FFFFFF', label: '흰색' },
]

const THICKNESS_LIST = [1, 2, 4, 6]

function ColorPickerPopup({
  activeToolType,
  activePenColor,
  penThickness,
  activeHighlightColor,
  onPenColor,
  onThickness,
  onHighlightColor,
  onClose,
}: {
  activeToolType: ToolType
  activePenColor: string
  penThickness: number
  activeHighlightColor: HighlightColor
  onPenColor: (c: string) => void
  onThickness: (t: number) => void
  onHighlightColor: (c: HighlightColor) => void
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

  const isHighlighter = activeToolType === 'highlighter'

  return (
    <div
      ref={ref}
      className="absolute rounded-2xl p-4"
      style={{
        bottom:          60,
        right:           0,
        backgroundColor: '#FFFFFF',
        boxShadow:       '0 8px 32px rgba(0,0,0,0.14)',
        border:          '1px solid #F2F4F8',
        minWidth:        210,
        zIndex:          100,
      }}
    >
      {isHighlighter ? (
        <>
          <p className="text-xs font-semibold mb-2.5" style={{ color: '#8B95A1' }}>형광펜 색상</p>
          <div className="flex gap-2">
            {HIGHLIGHT_COLORS_LIST.map(({ key, hex, label }) => (
              <button
                key={key}
                title={label}
                onClick={() => { onHighlightColor(key); onClose() }}
                className="transition-transform hover:scale-110 active:scale-95"
                style={{
                  width:           activeHighlightColor === key ? 26 : 22,
                  height:          activeHighlightColor === key ? 26 : 22,
                  borderRadius:    '50%',
                  backgroundColor: hex,
                  border:          activeHighlightColor === key
                    ? '2px solid #191F28'
                    : '2px solid transparent',
                  opacity:         0.88,
                  transition:      'all 120ms',
                }}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs font-semibold mb-2.5" style={{ color: '#8B95A1' }}>색상</p>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {PEN_COLORS_LIST.map(({ hex, label }) => (
              <button
                key={hex}
                title={label}
                onClick={() => onPenColor(hex)}
                className="transition-transform hover:scale-110 active:scale-95"
                style={{
                  width:           activePenColor === hex ? 26 : 22,
                  height:          activePenColor === hex ? 26 : 22,
                  borderRadius:    '50%',
                  backgroundColor: hex,
                  border:          activePenColor === hex
                    ? '2px solid #3182F6'
                    : hex === '#FFFFFF' ? '2px solid #D1D5DB' : '2px solid transparent',
                  transition:      'all 120ms',
                }}
              />
            ))}
          </div>
          <p className="text-xs font-semibold mb-2.5" style={{ color: '#8B95A1' }}>굵기</p>
          <div className="flex gap-1.5 items-center">
            {THICKNESS_LIST.map((t) => (
              <button
                key={t}
                onClick={() => onThickness(t)}
                className="flex items-center justify-center rounded-xl transition-all"
                title={`${t}px`}
                style={{
                  width:           36,
                  height:          36,
                  backgroundColor: penThickness === t ? 'rgba(49,130,246,0.10)' : '#F9FAFB',
                  border:          penThickness === t ? '1.5px solid #3182F6' : '1.5px solid transparent',
                }}
              >
                <div
                  className="rounded-full"
                  style={{
                    width:           Math.min(28, Math.max(4, t * 3)),
                    height:          Math.min(28, Math.max(4, t * 3)),
                    backgroundColor: activePenColor || '#000000',
                    border:          activePenColor === '#FFFFFF' ? '1px solid #D1D5DB' : 'none',
                  }}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================
// Toolbar
// ============================================================

export function Toolbar() {
  const activeToolType          = useSessionStore((s) => s.activeToolType)
  const setActiveTool           = useSessionStore((s) => s.setActiveTool)
  const activeHighlightColor    = useSessionStore((s) => s.activeHighlightColor)
  const setActiveHighlightColor = useSessionStore((s) => s.setActiveHighlightColor)
  const activePenColor          = useSessionStore((s) => s.activePenColor)
  const setActivePenColor       = useSessionStore((s) => s.setActivePenColor)
  const penThickness            = useSessionStore((s) => s.penThickness)
  const setPenThickness         = useSessionStore((s) => s.setPenThickness)
  const isRecording             = useSessionStore((s) => s.isRecording)
  const toggleRecording         = useSessionStore((s) => s.toggleRecording)
  const currentTime             = useSessionStore((s) => s.currentTime)

  const [showColorPicker, setShowColorPicker] = useState(false)

  const mm = Math.floor(currentTime / 60)
  const ss = Math.floor(currentTime % 60)

  const dotColor = activeToolType === 'highlighter'
    ? HIGHLIGHT_COLORS_LIST.find((c) => c.key === activeHighlightColor)?.hex ?? '#FFD600'
    : activePenColor

  return (
    <div
      className="fixed z-40 flex items-end justify-center"
      style={{ bottom: 20, left: '50%', transform: 'translateX(-50%)' }}
    >
      <div
        className="flex items-center px-1 select-none relative"
        style={{
          height:              48,
          backgroundColor:     'rgba(255,255,255,0.94)',
          backdropFilter:      'blur(24px)',
          WebkitBackdropFilter:'blur(24px)',
          border:              '1px solid rgba(0,0,0,0.07)',
          boxShadow:           '0 4px 24px rgba(0,0,0,0.10), 0 1px 6px rgba(0,0,0,0.06)',
          borderRadius:        999,
          gap:                 1,
        }}
      >
        {/* 포인터 */}
        <ToolBtn active={activeToolType === 'pointer'} onClick={() => setActiveTool('pointer')} title="포인터 (V)">
          <PointerIcon />
        </ToolBtn>

        {/* 펜 */}
        <ToolBtn active={activeToolType === 'pen'} onClick={() => setActiveTool('pen')} title="펜 (P)">
          <PenIcon />
        </ToolBtn>

        {/* 형광펜 */}
        <ToolBtn active={activeToolType === 'highlighter'} onClick={() => setActiveTool('highlighter')} title="형광펜 (H)">
          <HighlighterIcon />
        </ToolBtn>

        {/* 도형 */}
        <ToolBtn active={activeToolType === 'shape'} onClick={() => setActiveTool('shape')} title="도형 (G)">
          <ShapeIcon />
        </ToolBtn>

        <Divider />

        {/* 텍스트 상자 */}
        <ToolBtn active={activeToolType === 'textbox'} onClick={() => setActiveTool('textbox')} title="텍스트 상자 (T)">
          <TextIcon />
        </ToolBtn>

        {/* 번역 */}
        <ToolBtn active={activeToolType === 'translate'} onClick={() => setActiveTool('translate')} title="영역 번역 (L)">
          <TranslateIcon />
        </ToolBtn>

        <Divider />

        {/* 녹음 버튼 */}
        <button
          title={isRecording ? '녹음 정지 (Ctrl+R)' : '녹음 시작 (Ctrl+R)'}
          onClick={toggleRecording}
          className="flex items-center gap-1.5 shrink-0 transition-colors duration-150 active:scale-90 px-3"
          style={{
            height:          40,
            borderRadius:    20,
            backgroundColor: isRecording ? '#F03E3E' : 'transparent',
            color:           isRecording ? '#FFFFFF' : '#6B7684',
            minWidth:        40,
          }}
          onMouseEnter={(e) => {
            if (!isRecording) (e.currentTarget as HTMLElement).style.backgroundColor = '#F2F4F6'
          }}
          onMouseLeave={(e) => {
            if (!isRecording) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
          }}
        >
          <span className={isRecording ? 'animate-pulse' : ''}>
            <MicIcon />
          </span>
          {isRecording && (
            <span className="text-xs font-bold tabular-nums" style={{ letterSpacing: '0.02em' }}>
              {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
            </span>
          )}
        </button>

        <Divider />

        {/* 색상 선택 */}
        <div className="relative">
          <button
            title="색상/굵기 선택"
            onClick={() => setShowColorPicker((v) => !v)}
            className="flex items-center justify-center shrink-0 transition-colors duration-150 active:scale-90"
            style={{
              width:           40,
              height:          40,
              borderRadius:    20,
              backgroundColor: showColorPicker ? '#F2F4F6' : 'transparent',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#F2F4F6' }}
            onMouseLeave={(e) => {
              if (!showColorPicker) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
            }}
          >
            <div
              style={{
                width:           20,
                height:          20,
                borderRadius:    '50%',
                backgroundColor: dotColor,
                border:          dotColor === '#FFFFFF' ? '2.5px solid #D1D5DB' : `2.5px solid rgba(0,0,0,0.15)`,
                boxShadow:       `inset 0 0 0 1.5px rgba(255,255,255,0.5)`,
              }}
            />
          </button>

          {showColorPicker && (
            <ColorPickerPopup
              activeToolType={activeToolType}
              activePenColor={activePenColor}
              penThickness={penThickness}
              activeHighlightColor={activeHighlightColor}
              onPenColor={setActivePenColor}
              onThickness={setPenThickness}
              onHighlightColor={setActiveHighlightColor}
              onClose={() => setShowColorPicker(false)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
