/**
 * @file components/queue/PendingDropdown.tsx
 * LectureMate — 미완료 작업 드롭다운
 *
 * ## 표시 항목
 * - 세션 ID(앞 6자리) + 작업 타입
 * - 상태 레이블: 변환 중 / 대기 중 / 실패
 * - 진행률 바 (active: 애니메이션, pending: 0%, done: 100%)
 * - "다시 시도" 버튼 (실패 항목)
 * - 하단 "완료된 항목 지우기" 버튼
 *
 * ## 스타일
 * 토스 스타일: rounded-2xl, shadow-xl
 */

import { useEffect, useRef } from 'react'
import { useJobQueueStore } from '@/stores/jobQueueStore'
import { jobScheduler } from '@/core/JobScheduler'
import type { Job } from '@/types'

// ============================================================
// 상수
// ============================================================

const JOB_TYPE_LABEL: Record<string, string> = {
  'stt-realtime':    '실시간 변환',
  'stt-postprocess': 'HD 변환',
  'pdf-index':       'PDF 색인',
  'export':          '내보내기',
}

// ============================================================
// 개별 작업 행
// ============================================================

interface JobRowProps {
  job: Job
}

function JobRow({ job }: JobRowProps) {
  const { pause } = useJobQueueStore.getState()

  const statusLabel =
    job.status === 'active'  ? '변환 중' :
    job.status === 'pending' ? '대기 중' :
    job.status === 'failed'  ? '실패'    :
    job.status === 'done'    ? '완료'    : job.status

  const statusColor =
    job.status === 'active'  ? 'var(--accent-blue)'  :
    job.status === 'pending' ? 'var(--text-muted)'   :
    job.status === 'failed'  ? '#ef4444'             :
    job.status === 'done'    ? '#22c55e'             : 'var(--text-muted)'

  const typeLabel = JOB_TYPE_LABEL[job.type] ?? job.type

  const handleRetry = () => {
    // failed → pending, then tick
    pause(job.id)         // pause resets to pending
    jobScheduler.tick()
  }

  const handleLater = () => {
    // 현재 active이면 대기열로 내려두기 (pending 상태 유지)
    if (job.status === 'active') pause(job.id)
  }

  return (
    <div
      className="px-4 py-3"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      {/* 헤더 행 */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-xs font-medium truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            {typeLabel}
          </span>
          <span
            className="text-xs shrink-0"
            style={{ color: 'var(--text-disabled)' }}
          >
            #{job.sessionId.slice(0, 6)}
          </span>
        </div>

        {/* 상태 레이블 */}
        <span
          className="text-xs shrink-0 font-medium"
          style={{ color: statusColor }}
        >
          {statusLabel}
        </span>
      </div>

      {/* 진행률 바 */}
      <div
        className="h-1 rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--bg-tertiary)' }}
      >
        {job.status === 'active' && (
          <div
            className="h-full rounded-full"
            style={{
              width:           '40%',
              backgroundColor: 'var(--accent-blue)',
              animation:       'lm-progress-slide 1.5s ease-in-out infinite',
            }}
          />
        )}
        {job.status === 'done' && (
          <div
            className="h-full rounded-full"
            style={{ width: '100%', backgroundColor: '#22c55e' }}
          />
        )}
        {job.status === 'failed' && (
          <div
            className="h-full rounded-full"
            style={{ width: '100%', backgroundColor: '#ef4444', opacity: 0.5 }}
          />
        )}
      </div>

      {/* 오류 메시지 */}
      {job.status === 'failed' && job.lastError && (
        <p
          className="mt-1.5 text-xs leading-tight"
          style={{ color: '#ef4444', opacity: 0.8 }}
        >
          {job.lastError.slice(0, 80)}
        </p>
      )}

      {/* 버튼 행 */}
      {(job.status === 'failed' || job.status === 'active') && (
        <div className="flex items-center gap-2 mt-2">
          {job.status === 'failed' && (
            <button
              onClick={handleRetry}
              className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all hover:brightness-110 active:scale-95"
              style={{
                backgroundColor: 'rgba(59,130,246,0.15)',
                color:           'var(--accent-blue)',
              }}
            >
              다시 시도
            </button>
          )}
          {job.status === 'active' && (
            <button
              onClick={handleLater}
              className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all hover:brightness-110 active:scale-95"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                color:           'var(--text-muted)',
              }}
            >
              나중에
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================
// PendingDropdown
// ============================================================

interface PendingDropdownProps {
  onClose: () => void
}

export function PendingDropdown({ onClose }: PendingDropdownProps) {
  const jobs         = useJobQueueStore((s) => s.jobs)
  const clearCompleted = useJobQueueStore((s) => s.clearCompleted)
  const dropdownRef  = useRef<HTMLDivElement>(null)

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const visibleJobs = jobs.filter((j) => j.status !== 'done')
  const doneCount   = jobs.filter((j) => j.status === 'done').length

  // 우선순위 순 정렬: active → pending → failed
  const sortedJobs = [...visibleJobs].sort((a, b) => {
    const order = { active: 0, pending: 1, failed: 2, done: 3 }
    return (order[a.status] ?? 9) - (order[b.status] ?? 9)
  })

  return (
    <>
      {/* 진행 바 keyframe */}
      <style>{`
        @keyframes lm-progress-slide {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(150%);  }
          100% { transform: translateX(150%);  }
        }
      `}</style>

      <div
        ref={dropdownRef}
        className="absolute top-full right-0 mt-2 z-50 overflow-hidden"
        style={{
          width:           320,
          backgroundColor: 'var(--bg-primary)',
          borderRadius:    16,
          boxShadow:       '0 20px 40px rgba(0,0,0,0.35), 0 0 0 1px var(--border-subtle)',
        }}
      >
        {/* 헤더 */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <span
            className="text-sm font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            백그라운드 작업
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-md transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6"  y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 작업 목록 */}
        <div
          className="overflow-y-auto"
          style={{ maxHeight: 360 }}
        >
          {sortedJobs.length === 0 ? (
            <div
              className="py-8 text-center text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              대기 중인 작업이 없습니다
            </div>
          ) : (
            sortedJobs.map((job) => <JobRow key={job.id} job={job} />)
          )}
        </div>

        {/* 푸터: 완료 항목 정리 */}
        {doneCount > 0 && (
          <div
            className="px-4 py-2.5"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <button
              onClick={clearCompleted}
              className="w-full text-xs py-1.5 rounded-lg transition-all hover:brightness-110 active:scale-95"
              style={{
                color:           'var(--text-muted)',
                backgroundColor: 'var(--bg-tertiary)',
              }}
            >
              완료된 항목 {doneCount}건 지우기
            </button>
          </div>
        )}
      </div>
    </>
  )
}
