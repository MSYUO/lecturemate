/**
 * @file components/code/CodeTab.tsx
 * LectureMate — 코드 에디터 탭 (Section 5.1~5.2 / Section 10)
 *
 * ## 레이아웃
 * ```
 * ┌─────────────────────────────────────┐
 * │  [Python ▼]          [▶ Run]        │  ← 상단 툴바
 * ├─────────────────────────────────────┤
 * │                                     │
 * │         MonacoWrapper               │  ← 중앙 에디터 (flex-1)
 * │                                     │
 * ├─────────────────────────────────────┤
 * │  ConsoleOutput (#1E1E1E, rounded-xl)│  ← 하단 콘솔
 * └─────────────────────────────────────┘
 * ```
 * pyodideStatus === 'loading' + language === 'python' → CodeSkeletonUI 전체 표시
 */

import { useCallback } from 'react'
import { useCodeStore } from '@/stores/codeStore'
import { useCodeRunner } from '@/hooks/useCodeRunner'
import { useSessionStore } from '@/stores/sessionStore'
import { MonacoWrapper }        from './MonacoWrapper'
import { ConsoleOutput }        from './ConsoleOutput'
import { CodeSkeletonUI }       from './CodeSkeletonUI'
import { RunButton }            from './RunButton'
import { SupportedPackagesInfo } from './SupportedPackagesInfo'
import { SnippetHistory }       from './SnippetHistory'
import type { EditorLanguage } from '@/stores/codeStore'

// ============================================================
// 언어 옵션
// ============================================================

const LANGUAGE_OPTIONS: { value: EditorLanguage; label: string }[] = [
  { value: 'python',     label: 'Python'     },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
]

// ============================================================
// CodeTab
// ============================================================

export function CodeTab() {
  const editorLanguage  = useCodeStore((s) => s.editorLanguage)
  const source          = useCodeStore((s) => s.source)
  const stdoutLines     = useCodeStore((s) => s.stdoutLines)
  const stderrLines     = useCodeStore((s) => s.stderrLines)
  const executionTime   = useCodeStore((s) => s.executionTime)
  const runStatus       = useCodeStore((s) => s.runStatus)
  const pyodideStatus   = useCodeStore((s) => s.pyodideStatus)
  const pyodideProgress = useCodeStore((s) => s.pyodideProgress)

  const setEditorLanguage = useCodeStore((s) => s.setEditorLanguage)
  const setSource         = useCodeStore((s) => s.setSource)
  const clearOutput       = useCodeStore((s) => s.clearOutput)
  const saveSnippet       = useCodeStore((s) => s.saveSnippet)

  const sessionId = useSessionStore((s) => s.sessionId)
  const pdfId     = useSessionStore((s) => s.pdfId)

  const { run, interrupt } = useCodeRunner()

  const isRunning = runStatus === 'running'

  const handleRun = useCallback(() => {
    if (isRunning) interrupt()
    else           run(source, editorLanguage)
  }, [isRunning, interrupt, run, source, editorLanguage])

  const handleSave = useCallback(() => {
    if (!source.trim()) return
    saveSnippet({ sessionId: sessionId ?? undefined, pdfId: pdfId ?? undefined })
  }, [saveSnippet, source, sessionId, pdfId])

  const showSkeleton = pyodideStatus === 'loading' && editorLanguage === 'python'

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--bg-primary)' }}>

      {/* ── 상단 툴바 ─────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        {/* 언어 선택 드롭다운 */}
        <select
          value={editorLanguage}
          onChange={(e) => setEditorLanguage(e.target.value as EditorLanguage)}
          className="text-xs rounded-md outline-none cursor-pointer px-2 py-1"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color:           'var(--text-primary)',
            border:          '1px solid var(--border-subtle)',
          }}
        >
          {LANGUAGE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        {/* 저장 버튼 */}
        <button
          onClick={handleSave}
          disabled={!source.trim() || isRunning}
          title="스니펫으로 저장"
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color:           source.trim() && !isRunning ? 'var(--text-secondary)' : 'var(--text-disabled)',
            border:          '1px solid var(--border-subtle)',
            cursor:          source.trim() && !isRunning ? 'pointer' : 'not-allowed',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          저장
        </button>

        {/* 실행 버튼 (RunButton) + 중단 버튼 */}
        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              onClick={interrupt}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
              style={{
                backgroundColor: 'rgba(248,113,113,0.12)',
                color:           '#f87171',
                border:          '1px solid rgba(248,113,113,0.25)',
              }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                <rect width="8" height="8" rx="1" />
              </svg>
              중단
            </button>
          )}
          <RunButton
            isRunning={isRunning}
            disabled={showSkeleton}
            onClick={handleRun}
          />
        </div>
      </div>

      {/* ── 스켈레톤 / 에디터 + 콘솔 ─────────────────────── */}
      {showSkeleton ? (
        <CodeSkeletonUI progress={pyodideProgress} />
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          {/* 에디터 */}
          <div className="flex-1 min-h-0">
            <MonacoWrapper
              language={editorLanguage}
              value={source}
              onChange={setSource}
              readOnly={isRunning}
            />
          </div>

          {/* 지원 라이브러리 패널 (Python 전용) */}
          {editorLanguage === 'python' && <SupportedPackagesInfo />}

          {/* 스니펫 히스토리 */}
          <SnippetHistory />

          {/* 콘솔 출력 */}
          <ConsoleOutput
            stdoutLines={stdoutLines}
            stderrLines={stderrLines}
            executionTime={executionTime}
            runStatus={runStatus}
            onClear={clearOutput}
          />
        </div>
      )}
    </div>
  )
}
