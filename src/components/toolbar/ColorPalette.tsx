/**
 * @file components/toolbar/ColorPalette.tsx
 * LectureMate — 형광펜 색상 팔레트
 *
 * 형광펜 도구(H)가 활성화되면 Toolbar 위에 올라와 표시됩니다.
 * 각 색상 버튼 클릭 또는 H+1~5 단축키로 색상을 변경합니다.
 */

import type { HighlightColor } from '@/types'

// ============================================================
// 색상 목록
// ============================================================

const COLORS: { key: HighlightColor; cssVar: string; label: string; hotkey: string }[] = [
  { key: 'yellow', cssVar: 'var(--highlight-yellow)', label: '노랑',  hotkey: '1' },
  { key: 'green',  cssVar: 'var(--highlight-green)',  label: '초록',  hotkey: '2' },
  { key: 'blue',   cssVar: 'var(--highlight-blue)',   label: '파랑',  hotkey: '3' },
  { key: 'pink',   cssVar: 'var(--highlight-pink)',   label: '분홍',  hotkey: '4' },
  { key: 'orange', cssVar: 'var(--highlight-orange)', label: '주황',  hotkey: '5' },
]

// ============================================================
// Props
// ============================================================

interface Props {
  activeColor: HighlightColor
  onSelect: (color: HighlightColor) => void
}

// ============================================================
// ColorPalette
// ============================================================

export function ColorPalette({ activeColor, onSelect }: Props) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl shadow-lg"
      style={{
        backgroundColor: 'var(--bg-primary)',
        border:          '1px solid var(--border-default)',
      }}
    >
      {COLORS.map(({ key, cssVar, label, hotkey }) => {
        const isActive = key === activeColor
        return (
          <button
            key={key}
            title={`${label} (H+${hotkey})`}
            onClick={() => onSelect(key)}
            className="relative transition-all hover:scale-110 active:scale-95"
            style={{
              width:        isActive ? 24 : 20,
              height:       isActive ? 24 : 20,
              borderRadius: '50%',
              backgroundColor: cssVar,
              border:       isActive
                ? '2px solid var(--text-primary)'
                : '2px solid transparent',
              outline:      isActive ? '2px solid var(--bg-primary)' : 'none',
              outlineOffset: isActive ? '-3px' : undefined,
              transition:   'width 0.12s, height 0.12s, border 0.12s',
              flexShrink:   0,
            }}
          />
        )
      })}
    </div>
  )
}
