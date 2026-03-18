/**
 * @file components/sidebar/STTStream.tsx
 * LectureMate — 실시간 STT 텍스트 스트림
 *
 * ## 기능
 * - sttStore의 세그먼트를 시간순으로 표시
 * - 새 세그먼트 도착 시 fade-in 애니메이션
 * - 채팅창 형태로 아래로 자동 스크롤
 * - 각 세그먼트 클릭 → 해당 시간으로 오디오 seek
 * - @dnd-kit/core Draggable (Phase 3-5 드래그앤드롭 연결 예정)
 *
 * ## 스타일
 * 토스 스타일: bg-secondary, rounded-xl, padding 카드 형태
 */

import { useEffect, useRef } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useSttStore } from '@/stores/sttStore'
import { useSessionStore } from '@/stores/sessionStore'
import type { SttSegment } from '@/types'

// ============================================================
// 시간 포맷 헬퍼
// ============================================================

/** 초(float)를 "MM:SS" 형태로 변환합니다 */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ============================================================
// DraggableSegmentCard — 개별 세그먼트 카드
// ============================================================

interface SegmentCardProps {
  segment: SttSegment
  isNew: boolean
  onSeek: (time: number) => void
}

function DraggableSegmentCard({ segment, isNew, onSeek }: SegmentCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: segment.id,
    data: { segment },
  })

  const style: React.CSSProperties = {
    transform:       isDragging ? `${CSS.Translate.toString(transform)} scale(1.02)` : CSS.Translate.toString(transform),
    cursor:          isDragging ? 'grabbing' : 'grab',
    opacity:         isDragging ? 0.85 : 1,
    zIndex:          isDragging ? 999 : undefined,
    boxShadow:       isDragging ? '0 20px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.4)' : undefined,
    animation:       isNew ? 'lm-stt-fadein 300ms ease-out both' : undefined,
    backgroundColor: 'var(--bg-secondary)',
    border:          '1px solid var(--border-subtle)',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-xl px-3 py-2.5 transition-colors select-none"
      {...listeners}
      {...attributes}
      onClick={(e) => {
        // 드래그 중에는 click 무시
        if (isDragging) return
        e.stopPropagation()
        onSeek(segment.startTime)
      }}
      onPointerDown={(e) => {
        // drag handler와 click 구분을 위해 stopPropagation 없이 둠
        // (dnd-kit이 내부적으로 처리)
        e.currentTarget.style.cursor = 'grabbing'
      }}
      onPointerUp={(e) => {
        e.currentTarget.style.cursor = 'grab'
      }}
      title={`${formatTime(segment.startTime)} 으로 이동`}
    >
      {/* 텍스트 */}
      <p
        className="text-sm leading-relaxed break-words"
        style={{ color: 'var(--text-primary)' }}
      >
        {segment.text}
      </p>

      {/* 타임스탬프 */}
      <p
        className="mt-1 text-xs tabular-nums"
        style={{ color: 'var(--text-muted)' }}
      >
        {formatTime(segment.startTime)}
        {segment.endTime > segment.startTime && ` – ${formatTime(segment.endTime)}`}
        {segment.isPostProcessed && (
          <span
            className="ml-1.5 px-1 rounded"
            style={{
              fontSize:        10,
              backgroundColor: 'var(--accent-blue)20',
              color:           'var(--accent-blue)',
            }}
          >
            HD
          </span>
        )}
      </p>
    </div>
  )
}

// ============================================================
// STTStream
// ============================================================

export function STTStream() {
  const segments      = useSttStore((s) => s.segments)
  const setCurrentTime = useSessionStore((s) => s.setCurrentTime)

  const containerRef  = useRef<HTMLDivElement>(null)
  const prevCountRef  = useRef(0)

  // 새 세그먼트 도착 시 자동 스크롤
  useEffect(() => {
    if (segments.length > prevCountRef.current) {
      containerRef.current?.scrollTo({
        top:      containerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
    prevCountRef.current = segments.length
  }, [segments])

  const handleSeek = (time: number) => {
    setCurrentTime(time)
  }

  // ── 빈 상태 ─────────────────────────────────────────────
  if (segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 gap-4 px-6">
        <span style={{ fontSize: 40, opacity: 0.25 }}>🎙</span>
        <p
          className="text-sm text-center leading-relaxed"
          style={{ color: 'var(--text-muted)' }}
        >
          녹음을 시작하면<br />여기에 텍스트가 표시됩니다
        </p>
        <p
          className="text-xs text-center"
          style={{ color: 'var(--text-disabled)' }}
        >
          Ctrl+R 녹음 시작
        </p>
      </div>
    )
  }

  // ── 세그먼트 목록 ────────────────────────────────────────
  return (
    <>
      {/* fade-in keyframe */}
      <style>{`
        @keyframes lm-stt-fadein {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>

      <div
        ref={containerRef}
        className="flex flex-col gap-2 px-3 py-3 overflow-y-auto h-full"
      >
        {segments.map((seg, idx) => (
          <DraggableSegmentCard
            key={seg.id}
            segment={seg}
            isNew={idx >= prevCountRef.current - 1}
            onSeek={handleSeek}
          />
        ))}

        {/* 자동 스크롤 앵커 */}
        <div style={{ height: 1, flexShrink: 0 }} />
      </div>
    </>
  )
}
