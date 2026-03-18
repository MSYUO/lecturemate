/**
 * @file components/code/SnippetHistory.tsx
 * LectureMate — 저장된 코드 스니펫 히스토리 패널 (Section 10.3)
 *
 * codeStore.codeSnippets 목록을 접이식 패널로 표시합니다.
 * 항목을 클릭하면 해당 코드가 Monaco 에디터에 로드됩니다.
 * 스니펫이 없으면 패널 자체를 렌더링하지 않습니다.
 */

import { useState } from 'react'
import { useCodeStore } from '@/stores/codeStore'

// ============================================================
// 언어 배지 색상
// ============================================================

const LANG_COLOR: Record<string, string> = {
  python:     'rgba(59,130,246,0.15)',
  javascript: 'rgba(234,179,8,0.15)',
}

const LANG_TEXT: Record<string, string> = {
  python:     '#60a5fa',
  javascript: '#facc15',
}

// ============================================================
// SnippetHistory
// ============================================================

export function SnippetHistory() {
  const [open, setOpen] = useState(false)

  const codeSnippets  = useCodeStore((s) => s.codeSnippets)
  const loadSnippet   = useCodeStore((s) => s.loadSnippet)
  const deleteSnippet = useCodeStore((s) => s.deleteSnippet)

  if (codeSnippets.length === 0) return null

  return (
    <div
      className="shrink-0 mx-2 mb-1 overflow-hidden rounded-lg"
      style={{ border: '1px solid var(--border-subtle)' }}
    >
      {/* ── 접이식 헤더 ─────────────────────────────────── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          color:           'var(--text-muted)',
          border:          'none',
          cursor:          'pointer',
        }}
      >
        <span className="flex items-center gap-1.5">
          {/* 히스토리 시계 아이콘 */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          스니펫 히스토리
          <span
            className="px-1 rounded"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-disabled)' }}
          >
            {codeSnippets.length}
          </span>
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 180ms ease' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* ── 스니펫 목록 ─────────────────────────────────── */}
      {open && (
        <div style={{ backgroundColor: 'var(--bg-primary)', maxHeight: 200, overflowY: 'auto' }}>
          {codeSnippets.map((snippet) => {
            // 첫 번째 비어있지 않은 줄을 제목으로 사용
            const title = snippet.source.split('\n').find((l) => l.trim()) ?? '(빈 코드)'

            return (
              <div
                key={snippet.id}
                className="flex items-center gap-2 px-3 py-1.5 group"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                {/* 언어 배지 */}
                <span
                  className="shrink-0 text-xs px-1 rounded"
                  style={{
                    backgroundColor: LANG_COLOR[snippet.language] ?? 'var(--bg-tertiary)',
                    color:           LANG_TEXT[snippet.language] ?? 'var(--text-muted)',
                    fontFamily:      'monospace',
                  }}
                >
                  {snippet.language === 'python' ? 'py' : 'js'}
                </span>

                {/* 코드 미리보기 — 클릭 시 로드 */}
                <button
                  onClick={() => loadSnippet(snippet.id)}
                  className="flex-1 text-left text-xs truncate transition-colors"
                  style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
                  title={snippet.source}
                >
                  {title}
                </button>

                {/* 삭제 버튼 — hover 시만 표시 */}
                <button
                  onClick={() => deleteSnippet(snippet.id)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--text-disabled)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11 }}
                  title="삭제"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
