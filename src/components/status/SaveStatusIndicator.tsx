/**
 * @file components/status/SaveStatusIndicator.tsx
 * LectureMate — 저장 상태 인디케이터
 *
 * sessionStore.saveStatus를 구독해 저장 상태를 아이콘+텍스트로 표시합니다.
 * - saved   → "저장 완료 ✓"  (초록)
 * - pending → "저장 중..."    (주황, 점 애니메이션)
 * - error   → "저장 실패 !"  (빨강)
 */

import { useSessionStore } from '@/stores/sessionStore'
import type { SaveStatus } from '@/stores/sessionStore'

// ============================================================
// 상태별 표시 설정
// ============================================================

const CONFIG: Record<
  SaveStatus,
  { label: string; color: string; dotColor: string; animate: boolean }
> = {
  saved: {
    label:    '저장 완료',
    color:    'var(--accent-green)',
    dotColor: 'var(--accent-green)',
    animate:  false,
  },
  pending: {
    label:    '저장 중',
    color:    'var(--accent-amber)',
    dotColor: 'var(--accent-amber)',
    animate:  true,
  },
  error: {
    label:    '저장 실패',
    color:    'var(--accent-red)',
    dotColor: 'var(--accent-red)',
    animate:  false,
  },
}

// ============================================================
// SaveStatusIndicator
// ============================================================

export function SaveStatusIndicator() {
  const saveStatus = useSessionStore((s) => s.saveStatus)
  const { label, color, dotColor, animate } = CONFIG[saveStatus]

  return (
    <div className="flex items-center gap-1.5" title={`자동 저장: ${label}`}>
      {/* 상태 도트 */}
      <span
        className="shrink-0 rounded-full"
        style={{
          width:           6,
          height:          6,
          backgroundColor: dotColor,
          boxShadow:       `0 0 6px ${dotColor}`,
          animation:       animate ? 'pulse 1.2s ease-in-out infinite' : 'none',
        }}
      />

      {/* 라벨 */}
      <span
        className="text-xs tabular-nums whitespace-nowrap"
        style={{ color, fontVariantNumeric: 'tabular-nums' }}
      >
        {label}
        {saveStatus === 'saved'  && ' ✓'}
        {saveStatus === 'error'  && ' !'}
        {saveStatus === 'pending' && (
          <span
            style={{
              display:   'inline-block',
              animation: 'ellipsis-dot 1.4s steps(4, end) infinite',
            }}
          />
        )}
      </span>

      <style>{`
        @keyframes ellipsis-dot {
          0%   { content: '';    }
          25%  { content: '.';   }
          50%  { content: '..';  }
          75%  { content: '...'; }
          100% { content: '';    }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1;   }
          50%      { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
