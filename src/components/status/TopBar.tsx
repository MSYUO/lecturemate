/**
 * @file components/status/TopBar.tsx
 * LectureMate — 상단 앱 바
 *
 * ## 레이아웃 (높이 56px)
 * ```
 * [로고 | 세션명]          [● 녹음 버튼]          [AI배지 | 저장상태 | 스토리지]
 * ```
 *
 * 녹음 버튼은 Phase 2에서 실제 기능 연동 예정.
 * 현재는 sessionStore.isRecording만 표시합니다.
 */

import { useRef } from 'react'
import { useSessionStore } from '@/stores/sessionStore'
import { WhisperStatusBadge } from './WhisperStatusBadge'
import { SaveStatusIndicator } from './SaveStatusIndicator'
import { StorageUsageBar } from './StorageUsageBar'
import { RecordingControls } from '@/components/audio/RecordingControls'
import { PendingTray } from '@/components/queue/PendingTray'

// ============================================================
// Props
// ============================================================

interface TopBarProps {
  /** PDF 파일이 선택됐을 때 호출 (controlled pdfFile 연동) */
  onPdfChange?: (file: File) => void
  /** 현재 열려 있는 PDF 파일명 표시용 */
  pdfFileName?: string
}

// ============================================================
// TopBar
// ============================================================

export function TopBar({ onPdfChange, pdfFileName }: TopBarProps = {}) {
  const sessionId   = useSessionStore((s) => s.sessionId)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  return (
    <header
      className="flex items-center shrink-0 px-4 gap-4"
      style={{
        height:          56,
        backgroundColor: 'var(--bg-primary)',
        borderBottom:    '1px solid var(--border-default)',
        boxShadow:       '0 1px 0 var(--border-subtle)',
      }}
    >
      {/* ── 좌측: 로고 + 세션명 ──────────────────────────── */}
      <div className="flex items-center gap-3 min-w-0">
        {/* 로고 */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold"
            style={{
              background:  'linear-gradient(135deg, var(--accent-blue) 0%, #7c3aed 100%)',
              fontSize:     13,
            }}
          >
            LM
          </div>
          <span
            className="text-sm font-semibold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            LectureMate
          </span>
        </div>

        {/* 구분선 */}
        <div
          className="shrink-0"
          style={{ width: 1, height: 16, backgroundColor: 'var(--border-default)' }}
        />

        {/* PDF 열기 버튼 */}
        <button
          onClick={() => pdfInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:brightness-110 active:scale-95 shrink-0"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          title="PDF 파일 열기"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          PDF 열기
        </button>
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) { onPdfChange?.(file); e.target.value = '' }
          }}
        />

        {/* 파일명 */}
        {pdfFileName && (
          <>
            <div
              className="shrink-0"
              style={{ width: 1, height: 16, backgroundColor: 'var(--border-default)' }}
            />
            <span
              className="text-xs truncate max-w-[180px]"
              style={{ color: 'var(--text-muted)' }}
              title={pdfFileName}
            >
              {pdfFileName}
            </span>
          </>
        )}

        {/* 세션 ID */}
        {sessionId && (
          <>
            <div
              className="shrink-0"
              style={{ width: 1, height: 16, backgroundColor: 'var(--border-default)' }}
            />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              #{sessionId.slice(0, 6)}
            </span>
          </>
        )}
      </div>

      {/* ── 중앙: 녹음 컨트롤 ────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center">
        <RecordingControls />
      </div>

      {/* ── 우측: 상태 표시 ───────────────────────────────── */}
      <div className="flex items-center gap-4 shrink-0">
        <WhisperStatusBadge />

        {/* 구분선 */}
        <div
          style={{ width: 1, height: 14, backgroundColor: 'var(--border-default)' }}
        />

        <SaveStatusIndicator />

        {/* 구분선 */}
        <div
          style={{ width: 1, height: 14, backgroundColor: 'var(--border-default)' }}
        />

        <StorageUsageBar />

        {/* 구분선 */}
        <div
          style={{ width: 1, height: 14, backgroundColor: 'var(--border-default)' }}
        />

        <PendingTray />
      </div>
    </header>
  )
}
