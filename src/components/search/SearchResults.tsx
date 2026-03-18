/**
 * @file components/search/SearchResults.tsx
 * LectureMate — 통합 검색 결과 목록
 *
 * ## 소스별 컬러 바
 * STT=블루, annotation=그린, pdfText=회색, code=퍼플, math=주황
 *
 * ## 인터랙션
 * - 클릭: PDF 페이지 이동 / 오디오 seek / 위치 하이라이트 애니메이션
 * - 키보드 ↑↓: 포커스 이동 (SearchOverlay에서 인덱스 제어)
 */

import { useRef, useEffect } from 'react'
import type { SearchResult } from '@/types'

// ============================================================
// 소스별 메타
// ============================================================

const SOURCE_META: Record<SearchResult['source'], { color: string; label: string }> = {
  stt:        { color: '#3b82f6', label: 'STT'  },
  annotation: { color: '#22c55e', label: '필기' },
  pdfText:    { color: '#6b7280', label: 'PDF'  },
  code:       { color: '#a855f7', label: '코드' },
  math:       { color: '#f97316', label: '수식' },
}

// ============================================================
// 텍스트 하이라이트 헬퍼
// ============================================================

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts  = text.split(regex)
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} style={{ backgroundColor: 'rgba(59,130,246,0.25)', borderRadius: 2, padding: '0 1px' }}>{part}</mark>
      : part
  )
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ============================================================
// 개별 결과 행
// ============================================================

interface ResultRowProps {
  result:    SearchResult
  query:     string
  isFocused: boolean
  onClick:   () => void
}

function ResultRow({ result, query, isFocused, onClick }: ResultRowProps) {
  const rowRef = useRef<HTMLButtonElement>(null)
  const meta   = SOURCE_META[result.source]

  useEffect(() => {
    if (isFocused) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [isFocused])

  // 텍스트 미리보기: 최대 120자
  const preview = result.text.length > 120
    ? result.text.slice(0, 120) + '…'
    : result.text

  return (
    <button
      ref={rowRef}
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 px-4 py-3 transition-colors"
      style={{
        backgroundColor: isFocused ? 'var(--bg-tertiary)' : 'transparent',
        outline: 'none',
      }}
    >
      {/* 소스 컬러 바 */}
      <div
        className="shrink-0 mt-0.5"
        style={{ width: 3, height: 40, borderRadius: 2, backgroundColor: meta.color }}
      />

      {/* 내용 */}
      <div className="flex-1 min-w-0">
        {/* 소스 레이블 + 위치 정보 */}
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="text-xs font-medium px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
          >
            {meta.label}
          </span>
          {result.pageNumber > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-disabled)' }}>
              p.{result.pageNumber}
            </span>
          )}
          {result.timestampStart !== undefined && (
            <span className="text-xs tabular-nums" style={{ color: 'var(--text-disabled)' }}>
              {formatTime(result.timestampStart)}
            </span>
          )}
          {result.codeLanguage && (
            <span className="text-xs" style={{ color: 'var(--text-disabled)' }}>
              {result.codeLanguage}
            </span>
          )}
        </div>

        {/* 매칭 텍스트 */}
        <p
          className="text-sm leading-snug"
          style={{ color: 'var(--text-primary)' }}
        >
          {highlightText(preview, query)}
        </p>

        {/* 수식 LaTeX 미리보기 */}
        {result.mathLatex && (
          <p
            className="text-xs mt-0.5 font-mono truncate"
            style={{ color: 'var(--text-muted)' }}
          >
            {result.mathLatex}
          </p>
        )}
      </div>
    </button>
  )
}

// ============================================================
// SearchResults
// ============================================================

interface SearchResultsProps {
  results:      SearchResult[]
  query:        string
  focusedIndex: number
  onSelect:     (result: SearchResult) => void
  /** 사용자가 결과를 클릭해 페이지 이동 후 검색창 닫기 트리거 */
  onClose:      () => void
}

export function SearchResults({
  results,
  query,
  focusedIndex,
  onSelect,
  onClose,
}: SearchResultsProps) {
  const handleSelect = (result: SearchResult) => {
    onSelect(result)
    onClose()
  }

  if (results.length === 0) return null

  return (
    <div
      className="overflow-y-auto"
      style={{ maxHeight: 400 }}
    >
      {results.map((r, idx) => (
        <ResultRow
          key={idx}
          result={r}
          query={query}
          isFocused={idx === focusedIndex}
          onClick={() => handleSelect(r)}
        />
      ))}
    </div>
  )
}
