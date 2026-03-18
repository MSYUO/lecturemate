/**
 * @file components/toolbar/Toolbar.tsx
 * LectureMate — 하단 플로팅 툴바
 *
 * ## 레이아웃
 * ```
 *   [태깅 토글] | [V 포인터] [H 형광펜] [T 텍스트] [S 스티커] | [힌트 텍스트]
 * ```
 * - `position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%)`
 * - 형광펜(H) 활성 시 Toolbar 위쪽에 ColorPalette가 팝업
 *
 * ## 단축키 (App.tsx에서 전역 바인딩)
 * V H T S Tab 은 App.tsx의 useHotkeys에서 처리하고 Toolbar는 상태만 표시합니다.
 */

import { useSessionStore } from '@/stores/sessionStore'
import { ColorPalette } from './ColorPalette'
import type { ToolType } from '@/types'

// ============================================================
// 도구 목록
// ============================================================

const TOOLS: { type: ToolType; key: string; icon: string; label: string }[] = [
  { type: 'pointer',    key: 'V', icon: '↖',  label: '포인터'   },
  { type: 'highlighter', key: 'H', icon: '✏',  label: '형광펜'  },
  { type: 'textbox',    key: 'T', icon: 'T',  label: '텍스트'   },
  { type: 'tagger',     key: 'S', icon: '⭐', label: '스티커'   },
]

// 도구별 힌트 텍스트
const HINTS: Record<ToolType, string> = {
  pointer:    'Alt+클릭: 점 태그  |  드래그: 영역 태그  |  Tab: 태깅 모드',
  highlighter: 'H+1~5: 색상 변경  |  드래그: 형광펜 칠하기',
  textbox:    '더블클릭: 텍스트 상자 생성  |  Ctrl+M: 수식 모드',
  tagger:     'Alt+클릭: 점 태그  |  드래그: 영역 태그  |  Ctrl+Space: 페이지 태그',
}

// ============================================================
// Toolbar
// ============================================================

export function Toolbar() {
  const activeToolType         = useSessionStore((s) => s.activeToolType)
  const isTaggingMode          = useSessionStore((s) => s.isTaggingMode)
  const toggleTaggingMode      = useSessionStore((s) => s.toggleTaggingMode)
  const setActiveTool          = useSessionStore((s) => s.setActiveTool)
  const activeHighlightColor   = useSessionStore((s) => s.activeHighlightColor)
  const setActiveHighlightColor = useSessionStore((s) => s.setActiveHighlightColor)

  const isHighlighter = activeToolType === 'highlighter'

  return (
    <div
      className="fixed z-40 flex flex-col items-center gap-2"
      style={{ bottom: 24, left: '50%', transform: 'translateX(-50%)' }}
    >
      {/* ── ColorPalette (형광펜 활성 시만 표시) ─────────── */}
      {isHighlighter && (
        <ColorPalette
          activeColor={activeHighlightColor}
          onSelect={setActiveHighlightColor}
        />
      )}

      {/* ── 메인 툴바 ───────────────────────────────────── */}
      <div
        className="flex items-center gap-1 px-2 py-2 rounded-2xl shadow-2xl select-none"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border:          '1px solid var(--border-default)',
          backdropFilter:  'blur(12px)',
          // toss-style soft shadow
          boxShadow:       '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)',
        }}
      >
        {/* 태깅 모드 토글 */}
        <button
          title={`태깅 모드 ${isTaggingMode ? 'ON' : 'OFF'} (Tab)`}
          onClick={toggleTaggingMode}
          className="relative flex items-center justify-center w-8 h-8 rounded-xl transition-all hover:brightness-110 active:scale-95"
          style={{
            backgroundColor: isTaggingMode
              ? 'rgba(34, 197, 94, 0.15)'
              : 'var(--bg-tertiary)',
          }}
        >
          <span style={{ fontSize: 14 }}>🏷</span>
          {/* 활성 인디케이터 초록 도트 */}
          <span
            className="absolute rounded-full transition-all"
            style={{
              top:             2,
              right:           2,
              width:           6,
              height:          6,
              backgroundColor: isTaggingMode ? '#22c55e' : 'transparent',
              boxShadow:       isTaggingMode ? '0 0 4px #22c55e' : 'none',
            }}
          />
        </button>

        {/* 구분선 */}
        <div
          className="mx-1 self-stretch rounded-full"
          style={{ width: 1, backgroundColor: 'var(--border-default)' }}
        />

        {/* 도구 버튼 */}
        {TOOLS.map(({ type, key, icon, label }) => {
          const isActive = activeToolType === type
          return (
            <button
              key={type}
              title={`${label} (${key})`}
              onClick={() => setActiveTool(type)}
              className="flex flex-col items-center justify-center w-12 h-10 rounded-xl transition-all hover:brightness-110 active:scale-95 gap-0.5"
              style={{
                backgroundColor: isActive
                  ? 'var(--bg-tertiary)'
                  : 'transparent',
                border: isActive
                  ? '1px solid var(--accent-blue)'
                  : '1px solid transparent',
                color: isActive
                  ? 'var(--accent-blue)'
                  : 'var(--text-secondary)',
              }}
            >
              <span
                style={{
                  fontSize:   type === 'textbox' ? 13 : 16,
                  fontWeight: type === 'textbox' ? 700 : 400,
                  lineHeight: 1,
                }}
              >
                {icon}
              </span>
              <span
                style={{
                  fontSize:   9,
                  fontWeight: isActive ? 600 : 400,
                  lineHeight: 1,
                  opacity:    isActive ? 1 : 0.6,
                }}
              >
                {key}
              </span>
            </button>
          )
        })}

        {/* 구분선 */}
        <div
          className="mx-1 self-stretch rounded-full"
          style={{ width: 1, backgroundColor: 'var(--border-default)' }}
        />

        {/* 힌트 텍스트 */}
        <p
          className="px-2 text-xs max-w-[200px] truncate"
          style={{ color: 'var(--text-muted)', fontSize: 10 }}
          title={HINTS[activeToolType]}
        >
          {HINTS[activeToolType]}
        </p>
      </div>
    </div>
  )
}
