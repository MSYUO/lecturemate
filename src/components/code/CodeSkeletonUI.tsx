/**
 * @file components/code/CodeSkeletonUI.tsx
 * LectureMate — Pyodide 로딩 중 코드 에디터 스켈레톤 UI (Section 5.2)
 *
 * 에디터 모양의 회색 줄무늬 라인 + 하단 진행률 바를 표시합니다.
 */

interface CodeSkeletonUIProps {
  /** Pyodide 로딩 진행률 (0–100) */
  progress: number
}

// 각 라인의 가상 너비 (에디터처럼 보이도록 다양하게)
const LINE_WIDTHS = [75, 55, 88, 42, 68]

export function CodeSkeletonUI({ progress }: CodeSkeletonUIProps) {
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* ── 에디터 영역 스켈레톤 ─────────────────────────── */}
      <div className="flex-1 overflow-hidden p-4 space-y-3">
        {LINE_WIDTHS.map((w, i) => (
          <div key={i} className="flex items-center gap-3">
            {/* 라인 번호 */}
            <div
              style={{
                width:           20,
                height:          13,
                borderRadius:    3,
                backgroundColor: 'var(--border-subtle)',
                opacity:         0.5,
                flexShrink:      0,
              }}
            />
            {/* 코드 줄 */}
            <div
              style={{
                width:           `${w}%`,
                height:          13,
                borderRadius:    3,
                backgroundColor: 'var(--border-subtle)',
                opacity:         0.35 + i * 0.06,
                animation:       'lm-skel-pulse 1.6s ease-in-out infinite',
                animationDelay:  `${i * 120}ms`,
              }}
            />
          </div>
        ))}
      </div>

      {/* ── 하단 진행률 영역 ──────────────────────────────── */}
      <div
        className="shrink-0 px-4 py-3 flex flex-col gap-2"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        {/* 스피너 + 메시지 */}
        <div className="flex items-center gap-2">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{
              color:      'var(--accent-blue)',
              flexShrink: 0,
              animation:  'spin 0.9s linear infinite',
            }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Python 실행 환경 준비 중… (최초 1회)
          </span>
          <span
            className="ml-auto text-xs tabular-nums"
            style={{ color: 'var(--text-disabled)' }}
          >
            {progress}%
          </span>
        </div>

        {/* 진행률 바 */}
        <div
          className="w-full overflow-hidden"
          style={{ height: 4, borderRadius: 4, backgroundColor: 'var(--border-subtle)' }}
        >
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{
              width:           `${progress}%`,
              borderRadius:    4,
              backgroundColor: 'var(--accent-blue)',
            }}
          />
        </div>
      </div>

      {/* 애니메이션 키프레임 */}
      <style>{`
        @keyframes lm-skel-pulse {
          0%, 100% { opacity: 0.35; }
          50%       { opacity: 0.65; }
        }
      `}</style>
    </div>
  )
}
