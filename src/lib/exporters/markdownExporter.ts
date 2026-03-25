/**
 * @file lib/exporters/markdownExporter.ts
 * LectureMate — 세션 데이터 → Markdown 내보내기
 */

import { db } from '@/db/schema'
import type {
  Session,
  Tag,
  Annotation,
  TextBoxAnnotation,
  Highlight,
  Sticker,
  SttSegment,
} from '@/types'

// ============================================================
// ExportData
// ============================================================

export interface ExportData {
  session:     Session
  tags:        Tag[]
  annotations: Annotation[]
  textboxes:   TextBoxAnnotation[]
  highlights:  Highlight[]
  stickers:    Sticker[]
  sttSegments: SttSegment[]
}

// ============================================================
// 데이터 로더
// ============================================================

export async function loadExportData(sessionId: string): Promise<ExportData> {
  const [session, tags, annotations, textboxes, highlights, stickers, sttSegments] =
    await Promise.all([
      db.sessions.get(sessionId),
      db.tags        .where('sessionId').equals(sessionId).toArray(),
      db.annotations .where('sessionId').equals(sessionId).toArray(),
      db.textboxes   .where('sessionId').equals(sessionId).toArray(),
      db.highlights  .where('sessionId').equals(sessionId).toArray(),
      db.stickers    .where('sessionId').equals(sessionId).toArray(),
      db.sttSegments .where('sessionId').equals(sessionId).sortBy('startTime'),
    ])

  if (!session) throw new Error(`세션을 찾을 수 없습니다 (id=${sessionId})`)

  return { session, tags, annotations, textboxes, highlights, stickers, sttSegments }
}

// ============================================================
// 헬퍼
// ============================================================

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const STICKER_EMOJI: Record<string, string> = {
  important:  '⭐',
  question:   '❓',
  review:     '🔁',
  exam:       '📝',
  understand: '✅',
  difficult:  '🔴',
  custom:     '📌',
}

// ============================================================
// exportToMarkdown
// ============================================================

export function exportToMarkdown(data: ExportData): string {
  const { session, tags, annotations, textboxes, stickers, sttSegments } = data

  const lines: string[] = []

  lines.push(`# ${session.title || '제목 없는 세션'}`)
  lines.push(``)
  lines.push(`생성: ${new Date(session.createdAt).toLocaleString('ko-KR')}`)
  lines.push(``)

  const pages = new Set<number>([
    ...tags       .map((t) => t.pageNumber),
    ...annotations.map((a) => a.pageNumber),
    ...textboxes  .map((tb) => tb.pageNumber),
    ...stickers   .map((s) => s.pageNumber),
  ])

  for (const page of [...pages].sort((a, b) => a - b)) {
    lines.push(`---`)
    lines.push(``)
    lines.push(`## 페이지 ${page}`)
    lines.push(``)

    const pageTags = tags.filter((t) => t.pageNumber === page)
    if (pageTags.length > 0) {
      lines.push(`### 태그`)
      for (const tag of pageTags) {
        const time  = formatTime(tag.timestampStart)
        const label = tag.label ? ` — ${tag.label}` : ''
        lines.push(`- [${time}]${label}`)
      }
      lines.push(``)
    }

    const tagTimes = pageTags.map((t) => ({
      start: t.timestampStart,
      end:   t.timestampEnd ?? t.timestampStart + 10,
    }))
    const pageSegs = sttSegments.filter((seg) =>
      tagTimes.some((tt) => seg.startTime >= tt.start - 2 && seg.startTime <= tt.end + 2),
    )
    if (pageSegs.length > 0) {
      lines.push(`### STT`)
      for (const seg of pageSegs) {
        lines.push(`- [${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}] ${seg.text}`)
      }
      lines.push(``)
    }

    const pageAnnotations = annotations.filter((a) => a.pageNumber === page)
    if (pageAnnotations.length > 0) {
      lines.push(`### 필기`)
      for (const ann of pageAnnotations) lines.push(`> ${ann.content}`)
      lines.push(``)
    }

    const pageTextboxes = textboxes.filter((tb) => tb.pageNumber === page)
    if (pageTextboxes.length > 0) {
      lines.push(`### 텍스트 상자`)
      for (const tb of pageTextboxes) {
        if (tb.isMathMode && tb.mathLatex) {
          lines.push(`$${tb.mathLatex}$`)
        } else {
          lines.push(`> ${tb.content}`)
        }
      }
      lines.push(``)
    }

    const pageStickers = stickers.filter((s) => s.pageNumber === page)
    if (pageStickers.length > 0) {
      lines.push(`### 스티커`)
      for (const sticker of pageStickers) {
        const emoji = STICKER_EMOJI[sticker.type] ?? '📌'
        const label = sticker.label ? ` ${sticker.label}` : ''
        lines.push(`- ${emoji}${label}`)
      }
      lines.push(``)
    }
  }

  if (sttSegments.length > 0) {
    lines.push(`---`)
    lines.push(``)
    lines.push(`## STT 전체 텍스트`)
    lines.push(``)
    for (const seg of sttSegments) {
      lines.push(`[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}] ${seg.text}`)
    }
    lines.push(``)
  }

  return lines.join('\n')
}
