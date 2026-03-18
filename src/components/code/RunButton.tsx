/**
 * @file components/code/RunButton.tsx
 * LectureMate — 코드 실행 버튼
 *
 * - 기본 상태: [▶ Run] — bg-accent-blue, rounded-xl
 * - 실행 중:   [⟳ 실행 중…] — 스피너 + 비활성
 * - 단축키:    Ctrl+Enter → 실행 시작
 */

import { useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

interface RunButtonProps {
  isRunning: boolean
  disabled?: boolean
  onClick:   () => void
}

export function RunButton({ isRunning, disabled = false, onClick }: RunButtonProps) {
  const handleHotkey = useCallback(() => {
    if (!isRunning && !disabled) onClick()
  }, [isRunning, disabled, onClick])

  // Ctrl+Enter: Monaco 에디터가 포커스되어 있어도 동작하도록 enableOnContentEditable
  useHotkeys('ctrl+enter', handleHotkey, {
    preventDefault:          true,
    enableOnFormTags:        true,
    enableOnContentEditable: true,
  })

  const isDisabled = disabled || isRunning

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      title="실행 (Ctrl+Enter)"
      className="flex items-center gap-2 px-4 py-1.5 rounded-xl text-sm font-medium transition-all select-none"
      style={{
        backgroundColor: isDisabled
          ? 'var(--bg-tertiary)'
          : 'var(--accent-blue)',
        color:   isDisabled ? 'var(--text-disabled)' : '#fff',
        cursor:  isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.7 : 1,
        border:  'none',
        outline: 'none',
      }}
    >
      {isRunning ? (
        <>
          {/* 스피너 */}
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          실행 중…
        </>
      ) : (
        <>
          {/* 실행 삼각형 아이콘 */}
          <svg width="10" height="11" viewBox="0 0 10 11" fill="currentColor" style={{ flexShrink: 0 }}>
            <polygon points="0,0 10,5.5 0,11" />
          </svg>
          Run
        </>
      )}
    </button>
  )
}
