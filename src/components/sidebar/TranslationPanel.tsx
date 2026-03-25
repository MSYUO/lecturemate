/**
 * @file components/sidebar/TranslationPanel.tsx
 * LectureMate — 사이드바 번역 결과 패널
 *
 * 상단 세그먼트 컨트롤로 모든 번역을 오버레이/패널 모드로 일괄 전환합니다.
 * 카드별로도 개별 모드 전환이 가능합니다.
 */

import { useState } from 'react'
import { useTranslationStore } from '@/stores/translationStore'
import { useSessionStore } from '@/stores/sessionStore'
import { translateText, LANG_LABELS } from '@/lib/translator'
import type { TranslationResult } from '@/types'

// ============================================================
// 세그먼트 컨트롤
// ============================================================

function SegmentControl({
  value,
  onChange,
}: {
  value: 'overlay' | 'panel'
  onChange: (v: 'overlay' | 'panel') => void
}) {
  return (
    <div
      className="flex"
      style={{
        backgroundColor: '#F2F4F8',
        borderRadius:    10,
        padding:         2,
        gap:             2,
      }}
    >
      {(['overlay', 'panel'] as const).map((mode) => {
        const active = value === mode
        return (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            style={{
              flex:            1,
              padding:         '5px 0',
              borderRadius:    8,
              fontSize:        12,
              fontWeight:      active ? 600 : 400,
              backgroundColor: active ? '#3182F6' : 'transparent',
              color:           active ? '#FFFFFF' : '#8B95A1',
              border:          'none',
              cursor:          'pointer',
              transition:      'all 150ms',
            }}
          >
            {mode === 'overlay' ? '오버레이' : '패널'}
          </button>
        )
      })}
    </div>
  )
}

// ============================================================
// 빈 상태
// ============================================================

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 px-6 text-center"
      style={{ paddingTop: 48 }}
    >
      <span style={{ fontSize: 36 }}>🌐</span>
      <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
        번역할 영역을 PDF에서 선택하세요
      </p>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Toolbar에서 🌐를 클릭하고<br />
        번역할 영역을 드래그하세요
      </p>
    </div>
  )
}

// ============================================================
// TranslationCard
// ============================================================

function TranslationCard({
  translation,
  onFocus,
  onRemove,
  onMoveToOverlay,
  onUpdateText,
}: {
  translation: TranslationResult
  onFocus: () => void
  onRemove: () => void
  onMoveToOverlay: () => void
  onUpdateText: (text: string) => void
}) {
  const [sourceExpanded,  setSourceExpanded]  = useState(false)
  const [isRetranslating, setIsRetranslating] = useState(false)
  const [retransError,    setRetransError]    = useState<string | null>(null)

  const srcLabel  = LANG_LABELS[translation.sourceLang] ?? translation.sourceLang
  const tgtLabel  = LANG_LABELS[translation.targetLang] ?? translation.targetLang
  const isOverlay = translation.displayMode === 'overlay'

  const handleRetranslate = async () => {
    setIsRetranslating(true)
    setRetransError(null)
    try {
      const newText = await translateText(
        translation.sourceText,
        translation.sourceLang,
        translation.targetLang,
      )
      onUpdateText(newText)
    } catch (err) {
      setRetransError(err instanceof Error ? err.message : '번역 오류')
    } finally {
      setIsRetranslating(false)
    }
  }

  const handleCopy = () => {
    void navigator.clipboard.writeText(translation.translatedText)
  }

  return (
    <div
      style={{
        backgroundColor: '#F5F6F8',
        borderRadius:    12,
        padding:         '12px 16px',
        cursor:          'pointer',
        transition:      'background-color 120ms',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = '#ECEEF2'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = '#F5F6F8'
      }}
      onClick={onFocus}
    >
      {/* ── 헤더 ─────────────────────────────────────── */}
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5">
          <span
            style={{
              fontSize:        11,
              fontWeight:      600,
              color:           'var(--accent-blue)',
              backgroundColor: 'rgba(49,130,246,0.10)',
              borderRadius:    6,
              padding:         '1px 6px',
            }}
          >
            p.{translation.pageNumber}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {srcLabel} → {tgtLabel}
          </span>
        </div>
        <button
          title="삭제"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="transition-opacity hover:opacity-70"
          style={{
            fontSize:   14,
            color:      '#8B95A1',
            lineHeight: 1,
            background: 'none',
            border:     'none',
            cursor:     'pointer',
            padding:    '2px 4px',
          }}
        >
          ✕
        </button>
      </div>

      {/* ── 원본 텍스트 (접이식) ──────────────────────── */}
      <div
        style={{ borderLeft: '2px solid #E5E8EB', paddingLeft: 10, marginBottom: 8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="w-full text-left"
          onClick={() => setSourceExpanded((v) => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <p
            style={{
              fontSize:         12,
              color:            '#8B95A1',
              margin:           0,
              lineHeight:       1.5,
              overflow:         sourceExpanded ? 'visible' : 'hidden',
              display:          sourceExpanded ? 'block' : '-webkit-box',
              WebkitLineClamp:  sourceExpanded ? undefined : 2,
              WebkitBoxOrient:  sourceExpanded ? undefined : 'vertical' as const,
            }}
          >
            {translation.sourceText}
          </p>
          {translation.sourceText.length > 80 && (
            <span style={{ fontSize: 11, color: 'var(--accent-blue)' }}>
              {sourceExpanded ? '접기 ▲' : '더 보기 ▼'}
            </span>
          )}
        </button>
      </div>

      {/* ── 번역 텍스트 ──────────────────────────────── */}
      <p
        style={{
          fontSize:   13,
          fontWeight: 500,
          color:      '#191F28',
          margin:     '0 0 10px',
          lineHeight: 1.6,
        }}
      >
        {isRetranslating
          ? <span style={{ color: '#8B95A1' }}>번역 중...</span>
          : translation.translatedText
        }
      </p>

      {retransError && (
        <p style={{ fontSize: 11, color: '#EF4444', marginBottom: 8 }}>{retransError}</p>
      )}

      {/* ── 하단 버튼 ────────────────────────────────── */}
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <ActionBtn title="복사" onClick={handleCopy}>📋 복사</ActionBtn>
        <ActionBtn
          title="재번역"
          disabled={isRetranslating}
          onClick={() => void handleRetranslate()}
        >
          {isRetranslating ? '...' : '🔄 재번역'}
        </ActionBtn>
        <ActionBtn
          title={isOverlay ? '패널로 전환' : '오버레이로 전환'}
          active={isOverlay}
          onClick={onMoveToOverlay}
        >
          📌 {isOverlay ? '오버레이 중' : '오버레이로'}
        </ActionBtn>
      </div>
    </div>
  )
}

function ActionBtn({
  children, title, onClick, disabled, active,
}: {
  children: React.ReactNode
  title?: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding:         '3px 8px',
        borderRadius:    8,
        fontSize:        11,
        fontWeight:      500,
        backgroundColor: active ? 'rgba(49,130,246,0.10)' : 'rgba(0,0,0,0.04)',
        color:           active ? 'var(--accent-blue)' : '#6B7280',
        border:          active ? '1px solid rgba(49,130,246,0.25)' : '1px solid transparent',
        cursor:          disabled ? 'not-allowed' : 'pointer',
        opacity:         disabled ? 0.5 : 1,
        whiteSpace:      'nowrap',
        transition:      'all 120ms',
      }}
    >
      {children}
    </button>
  )
}

// ============================================================
// TranslationPanel
// ============================================================

export function TranslationPanel() {
  const translations            = useTranslationStore((s) => s.translations)
  const defaultDisplayMode      = useTranslationStore((s) => s.defaultDisplayMode)
  const setAllDisplayMode       = useTranslationStore((s) => s.setAllDisplayMode)
  const removeTranslation       = useTranslationStore((s) => s.removeTranslation)
  const toggleDisplayMode       = useTranslationStore((s) => s.toggleDisplayMode)
  const setFocusedTranslationId = useTranslationStore((s) => s.setFocusedTranslationId)
  const updateTranslatedText    = useTranslationStore((s) => s.updateTranslatedText)
  const setCurrentPage          = useSessionStore((s) => s.setCurrentPage)

  const sorted = [...translations].sort((a, b) => a.createdAt - b.createdAt)

  const handleFocus = (t: TranslationResult) => {
    setCurrentPage(t.pageNumber)
    if (t.displayMode === 'overlay') {
      setFocusedTranslationId(t.id)
      setTimeout(() => setFocusedTranslationId(null), 1800)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── 상단 세그먼트 컨트롤 ────────────────────────── */}
      <div
        style={{
          padding:         '10px 12px 8px',
          borderBottom:    '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-primary)',
        }}
      >
        <SegmentControl
          value={defaultDisplayMode}
          onChange={setAllDisplayMode}
        />
      </div>

      {/* ── 번역 목록 ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
              번역 결과 {sorted.length}개
            </p>
            {sorted.map((t) => (
              <TranslationCard
                key={t.id}
                translation={t}
                onFocus={() => handleFocus(t)}
                onRemove={() => void removeTranslation(t.id)}
                onMoveToOverlay={() =>
                  toggleDisplayMode(t.id, t.displayMode === 'overlay' ? 'panel' : 'overlay')
                }
                onUpdateText={(text) => void updateTranslatedText(t.id, text)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
