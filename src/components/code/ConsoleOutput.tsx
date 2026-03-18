/**
 * @file components/code/ConsoleOutput.tsx
 * LectureMate — 코드 실행 결과 콘솔 (Section 5.2)
 *
 * ## 스타일
 * - 배경: #1E1E1E (어두운 VS Code 터미널 스타일), rounded-xl
 * - stdout: 흰색 (#d4d4d4)
 * - stderr: 빨강 (#f87171)
 * - 실행 시간: 하단 상태 바에 표시
 * - Ctrl+L: 출력 클리어
 */

import { useRef, useEffect, useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import type { RunStatus } from '@/stores/codeStore'

interface ConsoleOutputProps {
  stdoutLines:   string[]
  stderrLines:   string[]
  executionTime: number | null
  runStatus:     RunStatus
  onClear:       () => void
}

// ============================================================
// 실행 상태 → 배지 색상 / 텍스트
// ============================================================

function StatusBadge({ runStatus, executionTime }: { runStatus: RunStatus; executionTime: number | null }) {
  if (runStatus === 'running') {
    return (
      <div className="flex items-center gap-1.5">
        <div
          style={{
            width:           6,
            height:          6,
            borderRadius:    '50%',
            backgroundColor: '#4ade80',
            animation:       'lm-con-pulse 0.9s ease-in-out infinite',
          }}
        />
        <span style={{ color: '#4ade80', fontSize: 11 }}>실행 중…</span>
      </div>
    )
  }
  if (runStatus === 'ok' && executionTime !== null) {
    return <span style={{ color: '#6b7280', fontSize: 11 }}>{executionTime}ms</span>
  }
  if (runStatus === 'error') {
    return <span style={{ color: '#f87171', fontSize: 11 }}>오류</span>
  }
  if (runStatus === 'timeout') {
    return <span style={{ color: '#f97316', fontSize: 11 }}>시간 초과</span>
  }
  return null
}

// ============================================================
// ConsoleOutput
// ============================================================

export function ConsoleOutput({
  stdoutLines,
  stderrLines,
  executionTime,
  runStatus,
  onClear,
}: ConsoleOutputProps) {
  const bottomRef    = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 새 줄 출력 시 자동 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [stdoutLines.length, stderrLines.length])

  // Ctrl+L: 출력 클리어
  const handleClear = useCallback((e: KeyboardEvent) => {
    e.preventDefault()
    onClear()
  }, [onClear])

  useHotkeys('ctrl+l', handleClear, { preventDefault: true })

  const isEmpty = stdoutLines.length === 0 && stderrLines.length === 0

  return (
    <div
      ref={containerRef}
      className="flex flex-col shrink-0 rounded-xl overflow-hidden mx-2 mb-2"
      style={{
        height:          180,
        backgroundColor: '#1E1E1E',
        fontFamily:      '"JetBrains Mono", "Fira Code", Consolas, monospace',
      }}
    >
      {/* ── 헤더 ───────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{ height: 30, borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        <span style={{ color: '#6b7280', fontSize: 11, fontWeight: 500 }}>
          출력
        </span>

        <div className="flex items-center gap-3">
          <StatusBadge runStatus={runStatus} executionTime={executionTime} />

          {/* 클리어 버튼 */}
          {!isEmpty && (
            <button
              onClick={onClear}
              title="클리어 (Ctrl+L)"
              style={{
                color:      '#4b5563',
                background: 'none',
                border:     'none',
                cursor:     'pointer',
                padding:    '2px 4px',
                borderRadius: 4,
                fontSize:   11,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── 출력 영역 ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-2" style={{ fontSize: 12, lineHeight: 1.6 }}>
        {isEmpty && runStatus !== 'running' && (
          <span style={{ color: '#4b5563' }}>
            ▶ Run을 클릭하거나 Ctrl+Enter로 실행하세요
          </span>
        )}

        {/* stdout — 흰색 */}
        {stdoutLines.map((line, i) => (
          <div
            key={`out-${i}`}
            style={{ color: '#d4d4d4', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          >
            {line}
          </div>
        ))}

        {/* stderr — 빨강 */}
        {stderrLines.map((line, i) => (
          <div
            key={`err-${i}`}
            style={{ color: '#f87171', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          >
            {line}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <style>{`
        @keyframes lm-con-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
