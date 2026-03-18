/**
 * @file lib/exporters/htmlExporter.ts
 * LectureMate — 세션 데이터 → HTML 내보내기 (Section 9.6)
 *
 * ## 특징
 * - KaTeX CSS를 CDN `<link>`로 포함 → 수식이 완전히 렌더링된 상태
 * - `katex.renderToString()`으로 LaTeX → HTML 변환 (서버/클라이언트 동일)
 * - 인쇄 최적화 `@media print` 스타일 포함
 * - 완전한 독립 HTML 파일 (외부 폰트 제외하면 오프라인 뷰 가능)
 */

import katex from 'katex'
import type { ExportData } from './markdownExporter'

// ============================================================
// 헬퍼
// ============================================================

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderMath(latex: string, displayMode = false): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode,
      output: 'html',
    })
  } catch {
    return `<code>${esc(latex)}</code>`
  }
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

const HIGHLIGHT_CSS_COLOR: Record<string, string> = {
  yellow: 'rgba(255,235,59,0.45)',
  green:  'rgba(76,175,80,0.35)',
  blue:   'rgba(33,150,243,0.35)',
  pink:   'rgba(233,30,99,0.35)',
  orange: 'rgba(255,152,0,0.45)',
}

// ============================================================
// exportToHtml
// ============================================================

export function exportToHtml(data: ExportData): string {
  const {
    session, tags, annotations, textboxes,
    highlights, stickers, sttSegments, codeSnippets,
  } = data

  const sections: string[] = []

  // ── 페이지별 섹션 ─────────────────────────────────────────
  const pages = new Set<number>([
    ...tags       .map((t) => t.pageNumber),
    ...annotations.map((a) => a.pageNumber),
    ...textboxes  .map((tb) => tb.pageNumber),
    ...highlights .map((h) => h.pageNumber),
    ...stickers   .map((s) => s.pageNumber),
    ...codeSnippets.filter((c) => c.pageNumber != null).map((c) => c.pageNumber!),
  ])

  for (const page of [...pages].sort((a, b) => a - b)) {
    const parts: string[] = []
    parts.push(`<h2 class="page-heading">페이지 ${page}</h2>`)

    // 태그
    const pageTags = tags.filter((t) => t.pageNumber === page)
    if (pageTags.length > 0) {
      parts.push(`<h3>태그</h3><ul class="tag-list">`)
      for (const tag of pageTags) {
        const label = tag.label ? ` — ${esc(tag.label)}` : ''
        parts.push(
          `<li><span class="timestamp">[${formatTime(tag.timestampStart)}]</span>${label}</li>`,
        )
      }
      parts.push(`</ul>`)
    }

    // STT (태그 구간 근방)
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
      parts.push(`<h3>STT</h3><ul class="stt-list">`)
      for (const seg of pageSegs) {
        parts.push(
          `<li><span class="timestamp">[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}]</span> ${esc(seg.text)}</li>`,
        )
      }
      parts.push(`</ul>`)
    }

    // 필기
    const pageAnnotations = annotations.filter((a) => a.pageNumber === page)
    if (pageAnnotations.length > 0) {
      parts.push(`<h3>필기</h3>`)
      for (const ann of pageAnnotations) {
        parts.push(`<blockquote>${esc(ann.content)}</blockquote>`)
      }
    }

    // 텍스트 상자 (수식 렌더링)
    const pageTextboxes = textboxes.filter((tb) => tb.pageNumber === page)
    if (pageTextboxes.length > 0) {
      parts.push(`<h3>텍스트 상자</h3>`)
      for (const tb of pageTextboxes) {
        if (tb.isMathMode && tb.mathLatex) {
          parts.push(`<div class="math-block">${renderMath(tb.mathLatex, true)}</div>`)
        } else {
          parts.push(`<blockquote>${esc(tb.content)}</blockquote>`)
        }
      }
    }

    // 형광펜 메모
    const pageHighlights = highlights.filter((h) => h.pageNumber === page && h.note)
    if (pageHighlights.length > 0) {
      parts.push(`<h3>형광펜 메모</h3><ul class="highlight-list">`)
      for (const hl of pageHighlights) {
        const bg = HIGHLIGHT_CSS_COLOR[hl.color] ?? 'rgba(255,235,59,0.45)'
        parts.push(
          `<li><span class="highlight-mark" style="background:${bg}">&nbsp;&nbsp;&nbsp;&nbsp;</span> ${esc(hl.note!)}</li>`,
        )
      }
      parts.push(`</ul>`)
    }

    // 스티커
    const pageStickers = stickers.filter((s) => s.pageNumber === page)
    if (pageStickers.length > 0) {
      parts.push(`<h3>스티커</h3><ul class="sticker-list">`)
      for (const sticker of pageStickers) {
        const emoji = STICKER_EMOJI[sticker.type] ?? '📌'
        const label = sticker.label ? ` ${esc(sticker.label)}` : ''
        parts.push(`<li>${emoji}${label}</li>`)
      }
      parts.push(`</ul>`)
    }

    // 코드
    const pageCode = codeSnippets.filter((c) => c.pageNumber === page)
    if (pageCode.length > 0) {
      parts.push(`<h3>코드</h3>`)
      for (const snippet of pageCode) {
        parts.push(
          `<pre class="code-block" data-lang="${snippet.language}"><code>${esc(snippet.source)}</code></pre>`,
        )
      }
    }

    if (parts.length > 1) {
      sections.push(`<section class="page-section">\n${parts.join('\n')}\n</section>`)
    }
  }

  // ── STT 전체 텍스트 ───────────────────────────────────────
  if (sttSegments.length > 0) {
    const sttLines = sttSegments.map(
      (seg) =>
        `<li><span class="timestamp">[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}]</span> ${esc(seg.text)}</li>`,
    )
    sections.push(
      `<section class="page-section">\n<h2>STT 전체 텍스트</h2>\n<ul class="stt-list">\n${sttLines.join('\n')}\n</ul>\n</section>`,
    )
  }

  // ── 페이지 미연결 코드 ────────────────────────────────────
  const unpagedCode = codeSnippets.filter((c) => c.pageNumber == null)
  if (unpagedCode.length > 0) {
    const codeBlocks = unpagedCode.map(
      (s) =>
        `<pre class="code-block" data-lang="${s.language}"><code>${esc(s.source)}</code></pre>`,
    )
    sections.push(
      `<section class="page-section">\n<h2>코드 스니펫</h2>\n${codeBlocks.join('\n')}\n</section>`,
    )
  }

  const date = new Date(session.createdAt).toLocaleString('ko-KR')

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(session.title || '제목 없는 세션')}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
    line-height: 1.7;
    color: #1a1a2e;
    background: #fff;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }
  h1 { font-size: 1.8rem; margin-bottom: 0.25rem; }
  h2.page-heading {
    font-size: 1.25rem;
    color: #3b82f6;
    border-bottom: 2px solid #3b82f6;
    padding-bottom: 0.25rem;
    margin-top: 2rem;
  }
  h2 { font-size: 1.25rem; margin-top: 2rem; }
  h3 { font-size: 1rem; color: #555; margin: 1rem 0 0.5rem; }
  .meta { color: #888; font-size: 0.85rem; margin-bottom: 2rem; }
  .page-section { margin-bottom: 2rem; }
  .timestamp { color: #3b82f6; font-size: 0.85em; font-family: monospace; }
  ul { padding-left: 1.5rem; }
  li { margin: 0.25rem 0; }
  blockquote {
    border-left: 3px solid #d1d5db;
    margin: 0.5rem 0;
    padding: 0.5rem 1rem;
    color: #374151;
    background: #f9fafb;
  }
  .math-block {
    overflow-x: auto;
    margin: 0.75rem 0;
    padding: 0.75rem;
    background: #f5f5f5;
    border-radius: 6px;
  }
  .code-block {
    background: #1e1e2e;
    color: #cdd6f4;
    border-radius: 8px;
    padding: 1rem;
    overflow-x: auto;
    font-size: 0.875rem;
    margin: 0.5rem 0;
  }
  .highlight-mark {
    display: inline-block;
    border-radius: 3px;
    margin-right: 0.5rem;
  }
  @media print {
    body { max-width: 100%; padding: 0; }
    .page-section { break-inside: avoid; }
    a { text-decoration: none; }
  }
</style>
</head>
<body>
<h1>${esc(session.title || '제목 없는 세션')}</h1>
<p class="meta">생성: ${date}</p>
${sections.join('\n')}
</body>
</html>`
}
