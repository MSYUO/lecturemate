/**
 * @file components/pdf/TranslationOverlay.tsx
 * LectureMate — 번역 결과 오버레이 레이어
 *
 * translationStore의 translations를 현재 페이지 기준으로 필터링하여
 * displayMode === 'overlay'인 항목을 PDF 위에 덮어 표시합니다.
 *
 * 부모 컨테이너 요구사항:
 *   position: relative, 페이지와 동일한 크기 (AnnotationLayer 패턴과 동일)
 */

import { useState } from 'react'
import { useTranslationStore } from '@/stores/translationStore'
import type { TranslationResult } from '@/types'

// ============================================================
// OverlayItem
// ============================================================

function OverlayItem({
  translation,
  pageHeight,
  isFocused,
  onRemove,
  onMoveToPanel,
}: {
  translation: TranslationResult
  pageHeight: number
  isFocused: boolean
  onRemove: (id: string) => void
  onMoveToPanel: () => void
}) {
  const [hovered, setHovered]           = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)

  const { sourceRect } = translation

  // 영역 높이(px) 기반 폰트 크기 자동 조절 [10, 15]
  const estHeightPx = sourceRect.height * pageHeight
  const fontSize    = Math.max(10, Math.min(15, estHeightPx / 10))

  const borderColor = isFocused || hovered
    ? 'rgba(49,130,246,0.55)'
    : 'transparent'

  return (
    <div
      style={{
        position:      'absolute',
        left:          `${sourceRect.x      * 100}%`,
        top:           `${sourceRect.y      * 100}%`,
        width:         `${sourceRect.width  * 100}%`,
        height:        `${sourceRect.height * 100}%`,
        pointerEvents: 'all',
        cursor:        'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowOriginal(false) }}
    >
      {/* ── 반투명 배경 + 번역 텍스트 ───────────────────── */}
      <div
        style={{
          position:             'absolute',
          inset:                0,
          backgroundColor:      'rgba(255,255,255,0.85)',
          backdropFilter:       'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          border:               `1.5px dashed ${borderColor}`,
          borderRadius:         4,
          padding:              '4px 8px',
          overflow:             'hidden',
          opacity:              showOriginal ? 0.1 : 1,
          transition:           'opacity 150ms ease, border-color 150ms ease',
          boxSizing:            'border-box',
          animation:            isFocused ? 'translation-pulse 0.6s ease 3' : 'none',
        }}
      >
        <p
          style={{
            margin:     0,
            fontSize,
            color:      '#191F28',
            lineHeight: 1.5,
            wordBreak:  'break-word',
          }}
        >
          {translation.translatedText}
        </p>
      </div>

      {/* ── 호버 버튼 바 (우상단 fade-in) ───────────────── */}
      <div
        style={{
          position:      'absolute',
          top:           -34,
          right:         0,
          display:       'flex',
          alignItems:    'center',
          gap:           3,
          opacity:       hovered ? 1 : 0,
          pointerEvents: hovered ? 'all' : 'none',
          transition:    'opacity 150ms ease',
          zIndex:        10,
        }}
      >
        {/* 원본 보기 */}
        <button
          title="원본 보기"
          onMouseEnter={() => setShowOriginal(true)}
          onMouseLeave={() => setShowOriginal(false)}
          style={btnStyle}
        >
          <span style={{ fontSize: 13 }}>📋</span>
          <span>원본</span>
        </button>

        {/* 패널로 */}
        <button
          title="패널로 이동"
          onClick={(e) => { e.stopPropagation(); onMoveToPanel() }}
          style={btnStyle}
        >
          <span style={{ fontSize: 13 }}>📌</span>
          <span>패널로</span>
        </button>

        {/* 삭제 */}
        <button
          title="삭제"
          onClick={(e) => { e.stopPropagation(); onRemove(translation.id) }}
          style={{ ...btnStyle, color: '#EF4444' }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// 공유 버튼 스타일
const btnStyle: React.CSSProperties = {
  display:         'flex',
  alignItems:      'center',
  gap:             3,
  padding:         '3px 8px',
  borderRadius:    8,
  fontSize:        11,
  fontWeight:      500,
  backgroundColor: '#FFFFFF',
  color:           '#374151',
  border:          '1px solid #E5E7EB',
  boxShadow:       '0 2px 8px rgba(0,0,0,0.10)',
  cursor:          'pointer',
  whiteSpace:      'nowrap' as const,
}

// ============================================================
// TranslationOverlay
// ============================================================

interface Props {
  pageNumber: number
  pageHeight: number
}

export function TranslationOverlay({ pageNumber, pageHeight }: Props) {
  const translations         = useTranslationStore((s) => s.translations)
  const focusedTranslationId = useTranslationStore((s) => s.focusedTranslationId)
  const removeTranslation    = useTranslationStore((s) => s.removeTranslation)
  const toggleDisplayMode    = useTranslationStore((s) => s.toggleDisplayMode)

  const pageOverlays = translations.filter(
    (t) => t.pageNumber === pageNumber && t.displayMode === 'overlay',
  )

  if (pageOverlays.length === 0) return null

  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: 'none', zIndex: 15 }}
    >
      {/* keyframes는 한 번만 주입 */}
      <style>{`
        @keyframes translation-pulse {
          0%   { box-shadow: 0 0 0 0   rgba(49,130,246,0.50); border-color: rgba(49,130,246,0.9) !important; }
          50%  { box-shadow: 0 0 0 6px rgba(49,130,246,0.15); border-color: rgba(49,130,246,0.9) !important; }
          100% { box-shadow: 0 0 0 0   rgba(49,130,246,0);    border-color: rgba(49,130,246,0.9) !important; }
        }
      `}</style>

      {pageOverlays.map((t) => (
        <OverlayItem
          key={t.id}
          translation={t}
          pageHeight={pageHeight}
          isFocused={focusedTranslationId === t.id}
          onRemove={(id) => void removeTranslation(id)}
          onMoveToPanel={() => toggleDisplayMode(t.id, 'panel')}
        />
      ))}
    </div>
  )
}
