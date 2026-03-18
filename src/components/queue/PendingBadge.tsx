/**
 * @file components/queue/PendingBadge.tsx
 * LectureMate — 미완료 작업 카운트 뱃지
 *
 * jobQueueStore에서 status !== 'done'인 작업 수를 표시.
 * 작업이 없으면 렌더링하지 않음.
 */

import { useJobQueueStore } from '@/stores/jobQueueStore'

interface PendingBadgeProps {
  onClick?: () => void
  isOpen?:  boolean
}

export function PendingBadge({ onClick, isOpen }: PendingBadgeProps) {
  const jobs = useJobQueueStore((s) => s.jobs)

  const activeCount  = jobs.filter((j) => j.status === 'active').length
  const pendingCount = jobs.filter((j) => j.status === 'pending').length
  const failedCount  = jobs.filter((j) => j.status === 'failed').length
  const total        = activeCount + pendingCount + failedCount

  if (total === 0) return null

  const hasError  = failedCount > 0
  const hasActive = activeCount > 0

  return (
    <button
      onClick={onClick}
      className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-95"
      style={{
        backgroundColor: isOpen
          ? 'var(--bg-tertiary)'
          : hasError
            ? 'rgba(239,68,68,0.12)'
            : 'var(--bg-tertiary)',
        color: hasError
          ? '#ef4444'
          : 'var(--text-secondary)',
        border: `1px solid ${hasError ? 'rgba(239,68,68,0.3)' : 'var(--border-subtle)'}`,
      }}
      title={`작업 ${total}건`}
    >
      {/* 스피너 (활성 작업 있을 때) */}
      {hasActive && (
        <span
          className="inline-block w-3 h-3 rounded-full border-2 border-transparent animate-spin"
          style={{
            borderTopColor:   'var(--accent-blue)',
            borderRightColor: 'var(--accent-blue)',
          }}
        />
      )}

      {/* 아이콘 (활성 작업 없을 때) */}
      {!hasActive && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {hasError ? (
            <>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </>
          ) : (
            <>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </>
          )}
        </svg>
      )}

      <span>{total}</span>

      {/* 실패 개수 강조 */}
      {failedCount > 0 && (
        <span
          className="px-1 rounded text-white"
          style={{ fontSize: 10, backgroundColor: '#ef4444' }}
        >
          {failedCount}실패
        </span>
      )}
    </button>
  )
}
