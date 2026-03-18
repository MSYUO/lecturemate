/**
 * @file components/status/WhisperStatusBadge.tsx
 * LectureMate — Whisper 모델 상태 배지
 *
 * sessionStore.whisperStatus / whisperProgress를 구독해 상태를 표시합니다.
 *
 * - idle         → 표시 안 함 (세션 없을 때)
 * - loading      → "AI 준비 중..." + 스피너 + 프로그레스 바
 * - ready        → "AI 준비 완료 ✓" (초록)
 * - transcribing → "변환 중..." + 스피너 (파랑)
 * - error        → "AI 오류" (빨강)
 */

import { useSessionStore } from '@/stores/sessionStore'
import type { WhisperStatus } from '@/types'

// ============================================================
// 상태별 표시 설정
// ============================================================

const CONFIG: Record<
  WhisperStatus,
  { label: string; color: string; showSpinner: boolean; showProgress: boolean }
> = {
  idle: {
    label:        'AI 대기',
    color:        'var(--status-idle)',
    showSpinner:  false,
    showProgress: false,
  },
  loading: {
    label:        'AI 준비 중',
    color:        'var(--status-loading)',
    showSpinner:  true,
    showProgress: true,
  },
  ready: {
    label:        'AI 준비 완료',
    color:        'var(--status-ready)',
    showSpinner:  false,
    showProgress: false,
  },
  transcribing: {
    label:        '변환 중',
    color:        'var(--accent-blue)',
    showSpinner:  true,
    showProgress: false,
  },
  error: {
    label:        'AI 오류',
    color:        'var(--status-error)',
    showSpinner:  false,
    showProgress: false,
  },
}

// ============================================================
// WhisperStatusBadge
// ============================================================

export function WhisperStatusBadge() {
  const whisperStatus   = useSessionStore((s) => s.whisperStatus)
  const whisperProgress = useSessionStore((s) => s.whisperProgress)

  const { label, color, showSpinner, showProgress } = CONFIG[whisperStatus]

  // idle은 표시하지 않음 (공간 낭비 방지)
  if (whisperStatus === 'idle') return null

  return (
    <div
      className="flex items-center gap-1.5"
      title={showProgress ? `${label} (${whisperProgress}%)` : label}
    >
      {/* 스피너 */}
      {showSpinner && (
        <span
          className="shrink-0 rounded-full border-2"
          style={{
            width:             12,
            height:            12,
            borderColor:       color,
            borderTopColor:    'transparent',
            animation:         'spin 0.8s linear infinite',
            display:           'inline-block',
          }}
        />
      )}

      {/* 상태 텍스트 */}
      <span
        className="text-xs whitespace-nowrap"
        style={{ color }}
      >
        {label}
        {whisperStatus === 'ready'  && ' ✓'}
        {whisperStatus === 'loading' && showProgress && ` ${whisperProgress}%`}
      </span>

      {/* 로딩 프로그레스 바 */}
      {showProgress && whisperProgress > 0 && (
        <div
          className="rounded-full overflow-hidden"
          style={{
            width:           40,
            height:          3,
            backgroundColor: 'var(--bg-tertiary)',
          }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width:           `${whisperProgress}%`,
              backgroundColor: color,
            }}
          />
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
