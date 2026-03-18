/**
 * @file components/code/MonacoWrapper.tsx
 * LectureMate — Monaco Editor 래퍼 (React.lazy 동적 로드)
 *
 * ## 설정
 * - 테마: vs-light
 * - fontSize 14, minimap off, lineNumbers on, padding 16px
 * - automaticLayout: true (패널 리사이즈 대응)
 */

import { Suspense, lazy, memo } from 'react'
import type { EditorLanguage } from '@/stores/codeStore'

// @monaco-editor/react 동적 로드 — 초기 번들에서 제외
const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.Editor }))
)

// ============================================================
// Monaco 언어 ID 매핑
// ============================================================

const MONACO_LANG: Record<EditorLanguage, string> = {
  python:     'python',
  javascript: 'javascript',
  typescript: 'typescript',
}

// ============================================================
// Props
// ============================================================

interface MonacoWrapperProps {
  language:  EditorLanguage
  value:     string
  onChange:  (value: string) => void
  readOnly?: boolean
}

// ============================================================
// 로딩 폴백
// ============================================================

function EditorLoadingFallback() {
  return (
    <div
      className="flex items-center justify-center h-full"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <span className="text-xs" style={{ color: 'var(--text-disabled)' }}>
        에디터 로딩 중…
      </span>
    </div>
  )
}

// ============================================================
// MonacoWrapper
// ============================================================

export const MonacoWrapper = memo(function MonacoWrapper({
  language,
  value,
  onChange,
  readOnly = false,
}: MonacoWrapperProps) {
  return (
    <Suspense fallback={<EditorLoadingFallback />}>
      <MonacoEditor
        height="100%"
        language={MONACO_LANG[language]}
        value={value}
        theme="vs-light"
        options={{
          fontSize:            14,
          minimap:             { enabled: false },
          lineNumbers:         'on',
          padding:             { top: 16, bottom: 16 },
          readOnly,
          scrollBeyondLastLine: false,
          wordWrap:            'on',
          automaticLayout:     true,
          fontFamily:          '"JetBrains Mono", "Fira Code", Consolas, monospace',
          renderLineHighlight: 'line',
          tabSize:             4,
          smoothScrolling:     true,
        }}
        onChange={(v) => onChange(v ?? '')}
      />
    </Suspense>
  )
})
