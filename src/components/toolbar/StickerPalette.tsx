/**
 * @file components/toolbar/StickerPalette.tsx
 * LectureMate — 스티커 선택 팔레트
 *
 * ## 역할
 * S 키를 누르면 화면에 오버레이로 표시되는 스티커 선택 팔레트입니다.
 * 스티커 타입을 클릭하면 activeSticker를 변경하고 팔레트를 닫습니다.
 *
 * ## 사용법
 * 부모 컴포넌트에서 S 키 이벤트를 감지해 `open` prop을 제어합니다.
 * 또는 `useHotkeys('s', toggle)` 방식으로 연동합니다.
 *
 * ```tsx
 * const [paletteOpen, setPaletteOpen] = useState(false)
 * useHotkeys('s', () => setPaletteOpen(v => !v))
 *
 * <StickerPalette
 *   open={paletteOpen}
 *   onClose={() => setPaletteOpen(false)}
 *   onSelect={(type) => { setActiveStickerType(type); setPaletteOpen(false) }}
 *   activeType={activeStickerType}
 * />
 * ```
 */

import { useEffect, useRef } from 'react'
import type { StickerType } from '@/types'
import { STICKER_EMOJI } from '@/components/pdf/StickerLayer'

// ============================================================
// 스티커 목록 정의
// ============================================================

const STICKER_LIST: { type: StickerType; label: string }[] = [
  { type: 'important',  label: '중요'      },
  { type: 'question',   label: '질문'      },
  { type: 'review',     label: '복습'      },
  { type: 'exam',       label: '시험'      },
  { type: 'understand', label: '이해 완료' },
  { type: 'difficult',  label: '어려움'    },
]

// ============================================================
// Props
// ============================================================

interface Props {
  /** 팔레트 표시 여부 */
  open: boolean
  /** 현재 선택된 스티커 타입 */
  activeType: StickerType
  /** 스티커 선택 시 호출 */
  onSelect: (type: StickerType) => void
  /** 팔레트 닫기 */
  onClose: () => void
}

// ============================================================
// StickerPalette
// ============================================================

export function StickerPalette({ open, activeType, onSelect, onClose }: Props) {
  const paletteRef = useRef<HTMLDivElement>(null)

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onClose])

  // Escape 키로 닫기
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    // 배경 오버레이 (반투명)
    <div className="fixed inset-0 z-50 flex items-end justify-center pb-24 pointer-events-none">
      <div
        ref={paletteRef}
        className="pointer-events-auto rounded-2xl shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border:          '1px solid var(--border-default)',
          padding:         '12px 8px',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <p
          className="text-xs font-medium text-center mb-3 px-2"
          style={{ color: 'var(--text-muted)' }}
        >
          스티커 선택
        </p>

        {/* 스티커 그리드 */}
        <div className="grid grid-cols-3 gap-1">
          {STICKER_LIST.map(({ type, label }) => {
            const isActive = type === activeType
            return (
              <button
                key={type}
                onClick={() => onSelect(type)}
                className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 transition-all hover:brightness-110 active:scale-95"
                style={{
                  backgroundColor: isActive
                    ? 'var(--bg-tertiary)'
                    : 'transparent',
                  border: isActive
                    ? '1px solid var(--accent-blue)'
                    : '1px solid transparent',
                  minWidth: 72,
                }}
              >
                <span style={{ fontSize: 28, lineHeight: 1 }}>
                  {STICKER_EMOJI[type]}
                </span>
                <span
                  className="text-xs"
                  style={{
                    color:      isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: isActive ? 500 : 400,
                  }}
                >
                  {label}
                </span>
              </button>
            )
          })}
        </div>

        {/* 닫기 힌트 */}
        <p
          className="text-center mt-3"
          style={{ fontSize: 10, color: 'var(--text-muted)' }}
        >
          S 키 또는 Esc로 닫기
        </p>
      </div>
    </div>
  )
}
