/**
 * @file components/audio/RecordingControls.tsx
 * LectureMate — 녹음 컨트롤 UI
 *
 * ## 레이아웃
 * ```
 * [● 녹음] [■ 정지] [⏸ 일시정지]    00:00
 * ```
 *
 * ## 단축키
 * - Ctrl+R        녹음 시작/정지 토글
 * - Ctrl+Shift+R  일시정지/재개 토글 (녹음 중일 때만)
 */

import { useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useRecording } from '@/hooks/useRecording'
import { useStt } from '@/hooks/useStt'

// ============================================================
// 시간 포맷 헬퍼
// ============================================================

/** 초(정수)를 "MM:SS" 형태로 변환합니다 */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ============================================================
// RecordingControls
// ============================================================

export function RecordingControls() {
  useStt()

  const {
    isRecording,
    isPaused,
    duration,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
  } = useRecording()

  // ── 버튼 핸들러 ───────────────────────────────────────────

  const handleRecord = useCallback(async () => {
    if (!isRecording) {
      await startRecording()
    }
  }, [isRecording, startRecording])

  const handleStop = useCallback(() => {
    if (isRecording) stopRecording()
  }, [isRecording, stopRecording])

  const handlePauseResume = useCallback(() => {
    if (!isRecording) return
    if (isPaused) resumeRecording()
    else          pauseRecording()
  }, [isRecording, isPaused, pauseRecording, resumeRecording])

  // ── 단축키 ───────────────────────────────────────────────

  useHotkeys('ctrl+r', (e) => {
    e.preventDefault()
    if (!isRecording) { startRecording() }
    else              { stopRecording() }
  }, { enableOnFormTags: false }, [isRecording, startRecording, stopRecording])

  useHotkeys('ctrl+shift+r', (e) => {
    e.preventDefault()
    handlePauseResume()
  }, { enableOnFormTags: false }, [handlePauseResume])

  // ── 렌더 ─────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-2">

      {/* ── ● 녹음 버튼 ─────────────────────────────────── */}
      <button
        onClick={handleRecord}
        disabled={isRecording}
        title="녹음 시작 (Ctrl+R)"
        style={{
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          width:           36,
          height:          36,
          borderRadius:    '50%',
          border:          'none',
          cursor:          isRecording ? 'not-allowed' : 'pointer',
          backgroundColor: isRecording ? 'var(--border-default)' : 'var(--accent-red, #ef4444)',
          opacity:         isRecording ? 0.5 : 1,
          transition:      'background-color 150ms',
        }}
      >
        {/* 녹음 중 깜빡임 */}
        <span
          style={{
            display:         'block',
            width:           14,
            height:          14,
            borderRadius:    '50%',
            backgroundColor: '#fff',
            animation:       isRecording && !isPaused ? 'lm-blink 1s ease-in-out infinite' : 'none',
          }}
        />
      </button>

      {/* ── ■ 정지 버튼 ──────────────────────────────────── */}
      <button
        onClick={handleStop}
        disabled={!isRecording}
        title="녹음 정지 (Ctrl+R)"
        style={{
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          width:           36,
          height:          36,
          borderRadius:    6,
          border:          '1.5px solid var(--border-default)',
          cursor:          !isRecording ? 'not-allowed' : 'pointer',
          backgroundColor: 'transparent',
          opacity:         !isRecording ? 0.4 : 1,
          transition:      'opacity 150ms',
        }}
      >
        <span
          style={{
            display:         'block',
            width:           12,
            height:          12,
            backgroundColor: 'var(--text-primary)',
            borderRadius:    2,
          }}
        />
      </button>

      {/* ── ⏸ 일시정지/재개 버튼 ────────────────────────── */}
      <button
        onClick={handlePauseResume}
        disabled={!isRecording}
        title={isPaused ? '재개 (Ctrl+Shift+R)' : '일시정지 (Ctrl+Shift+R)'}
        style={{
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          width:           36,
          height:          36,
          borderRadius:    6,
          border:          '1.5px solid var(--border-default)',
          cursor:          !isRecording ? 'not-allowed' : 'pointer',
          backgroundColor: 'transparent',
          opacity:         !isRecording ? 0.4 : 1,
          transition:      'opacity 150ms',
        }}
      >
        {isPaused ? (
          /* 재개 아이콘 (▶) */
          <span
            style={{
              width:       0,
              height:      0,
              borderTop:   '6px solid transparent',
              borderBottom: '6px solid transparent',
              borderLeft:  '10px solid var(--text-primary)',
              marginLeft:  2,
            }}
          />
        ) : (
          /* 일시정지 아이콘 (⏸) — 두 줄 */
          <span style={{ display: 'flex', gap: 3 }}>
            <span style={{ width: 3, height: 12, backgroundColor: 'var(--text-primary)', borderRadius: 1 }} />
            <span style={{ width: 3, height: 12, backgroundColor: 'var(--text-primary)', borderRadius: 1 }} />
          </span>
        )}
      </button>

      {/* ── 시간 표시 ────────────────────────────────────── */}
      <span
        style={{
          fontVariantNumeric: 'tabular-nums',
          fontSize:           14,
          fontWeight:         500,
          color:              isRecording ? 'var(--accent-red, #ef4444)' : 'var(--text-secondary)',
          minWidth:           40,
          textAlign:          'right',
          letterSpacing:      '0.05em',
        }}
      >
        {formatDuration(duration)}
      </span>

      {/* ── 깜빡임 keyframes ─────────────────────────────── */}
      <style>{`
        @keyframes lm-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.2; }
        }
      `}</style>
    </div>
  )
}
