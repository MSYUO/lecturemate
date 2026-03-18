/**
 * @file lib/exporters/markdownExporter.ts
 * LectureMate — 세션 데이터 → Markdown 내보내기 (Section 9.6)
 *
 * ## 출력 구조
 * ```
 * # 세션 제목
 * 생성: 2024-01-15
 *
 * ---
 * ## 페이지 1
 * ### 태그
 * - [00:42] 레이블
 * ### STT
 * - [00:40 - 01:20] 변환 텍스트
 * ### 필기
 * > 내용
 * ### 수식
 * $\LaTeX$
 * ### 코드
 * ```python ... ```
 * ---
 * ## STT 전체 텍스트
 * [00:00 - 00:05] ...
 * ```
 *
 * ## 수식 처리
 * `mathLatex`가 있으면 `$...$`로 인라인 렌더링.
 * `isMathMode=false`이면 인용문으로 출력.
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
  CodeSnippet,
} from '@/types'

// ============================================================
// ExportData — 모든 익스포터가 공유하는 데이터 구조
// ============================================================

export interface ExportData {
  session:     Session
  tags:        Tag[]
  annotations: Annotation[]
  textboxes:   TextBoxAnnotation[]
  highlights:  Highlight[]
  stickers:    Sticker[]
  sttSegments: SttSegment[]
  codeSnippets: CodeSnippet[]
}

// ============================================================
// 데이터 로더 (모든 익스포터가 공통 사용)
// ============================================================

/**
 * 세션 ID로 내보내기에 필요한 모든 데이터를 로드합니다.
 */
export async function loadExportData(sessionId: string): Promise<ExportData> {
  const [
    session,
    tags,
    annotations,
    textboxes,
    highlights,
    stickers,
    sttSegments,
    codeSnippets,
  ] = await Promise.all([
    db.sessions.get(sessionId),
    db.tags        .where('sessionId').equals(sessionId).toArray(),
    db.annotations .where('sessionId').equals(sessionId).toArray(),
    db.textboxes   .where('sessionId').equals(sessionId).toArray(),
    db.highlights  .where('sessionId').equals(sessionId).toArray(),
    db.stickers    .where('sessionId').equals(sessionId).toArray(),
    db.sttSegments .where('sessionId').equals(sessionId).sortBy('startTime'),
    db.codeSnippets.where('sessionId').equals(sessionId).toArray(),
  ])

  if (!session) throw new Error(`세션을 찾을 수 없습니다 (id=${sessionId})`)

  return { session, tags, annotations, textboxes, highlights, stickers, sttSegments, codeSnippets }
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
  important: '⭐',
  question:  '❓',
  review:    '🔁',
  exam:      '📝',
  understand: '✅',
  difficult:  '🔴',
  custom:     '📌',
}

// ============================================================
// exportToMarkdown
// ============================================================

/**
 * ExportData를 Markdown 문자열로 변환합니다.
 */
export function exportToMarkdown(data: ExportData): string {
  const {
    session, tags, annotations, textboxes,
    stickers, sttSegments, codeSnippets,
  } = data

  const lines: string[] = []

  // ── 헤더 ──────────────────────────────────────────────────
  lines.push(`# ${session.title || '제목 없는 세션'}`)
  lines.push(``)
  lines.push(`생성: ${new Date(session.createdAt).toLocaleString('ko-KR')}`)
  lines.push(``)

  // ── 페이지별 섹션 ─────────────────────────────────────────
  const pages = new Set<number>([
    ...tags       .map((t) => t.pageNumber),
    ...annotations.map((a) => a.pageNumber),
    ...textboxes  .map((tb) => tb.pageNumber),
    ...stickers   .map((s) => s.pageNumber),
    ...codeSnippets.filter((c) => c.pageNumber != null).map((c) => c.pageNumber!),
  ])

  for (const page of [...pages].sort((a, b) => a - b)) {
    lines.push(`---`)
    lines.push(``)
    lines.push(`## 페이지 ${page}`)
    lines.push(``)

    // 태그
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

    // STT (태그 타임스탬프 구간과 겹치는 세그먼트)
    const tagTimes = pageTags.map((t) => ({
      start: t.timestampStart,
      end:   t.timestampEnd ?? t.timestampStart + 10,
    }))
    const pageSegs = sttSegments.filter((seg) =>
      tagTimes.some(
        (tt) => seg.startTime >= tt.start - 2 && seg.startTime <= tt.end + 2,
      ),
    )
    if (pageSegs.length > 0) {
      lines.push(`### STT`)
      for (const seg of pageSegs) {
        lines.push(`- [${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}] ${seg.text}`)
      }
      lines.push(``)
    }

    // 필기 (Annotation)
    const pageAnnotations = annotations.filter((a) => a.pageNumber === page)
    if (pageAnnotations.length > 0) {
      lines.push(`### 필기`)
      for (const ann of pageAnnotations) {
        lines.push(`> ${ann.content}`)
      }
      lines.push(``)
    }

    // 텍스트 상자 (수식 포함)
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

    // 스티커
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

    // 코드 스니펫 (페이지 연결된 것)
    const pageCode = codeSnippets.filter((c) => c.pageNumber === page)
    if (pageCode.length > 0) {
      lines.push(`### 코드`)
      for (const snippet of pageCode) {
        lines.push(`\`\`\`${snippet.language}`)
        lines.push(snippet.source)
        lines.push(`\`\`\``)
        lines.push(``)
      }
    }
  }

  // ── STT 전체 텍스트 ───────────────────────────────────────
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

  // ── 페이지 미연결 코드 스니펫 ─────────────────────────────
  const unpagedCode = codeSnippets.filter((c) => c.pageNumber == null)
  if (unpagedCode.length > 0) {
    lines.push(`---`)
    lines.push(``)
    lines.push(`## 코드 스니펫`)
    lines.push(``)
    for (const snippet of unpagedCode) {
      lines.push(`\`\`\`${snippet.language}`)
      lines.push(snippet.source)
      lines.push(`\`\`\``)
      lines.push(``)
    }
  }

  return lines.join('\n')
}
