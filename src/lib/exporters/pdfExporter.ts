/**
 * @file lib/exporters/pdfExporter.ts
 * LectureMate — 원본 PDF에 필기/형광펜 합성 내보내기 (Section 9.6)
 *
 * ## 합성 순서 (페이지당)
 * 1. 형광펜 (반투명 색상 사각형, opacity 0.35)
 * 2. 어노테이션 텍스트 (작은 검정 텍스트)
 * 3. 텍스트 상자 (content / LaTeX raw)
 * 4. 스티커 (이모지 대신 ASCII 약어 — pdf-lib은 이모지 미지원)
 *
 * ## 좌표 변환
 * DB 좌표: [0,1] 정규화, origin 좌상단
 * pdf-lib 좌표: 포인트 단위, origin 좌하단
 *   x_pdf = x_norm × pageWidth
 *   y_pdf = (1 − y_norm − height_norm) × pageHeight
 *
 * ## 의존성
 * `pdf-lib` 패키지 필요 (npm install pdf-lib)
 */

import { PDFDocument, rgb, StandardFonts, type PDFPage } from 'pdf-lib'
import { opfs } from '@/core/OPFSStorage'
import type { ExportData } from './markdownExporter'
import type { BoundingBox, HighlightColor } from '@/types'

// ============================================================
// 색상 매핑
// ============================================================

type RGB = { r: number; g: number; b: number }

const HIGHLIGHT_RGB: Record<HighlightColor, RGB> = {
  yellow: { r: 1,    g: 0.92, b: 0.23 },
  green:  { r: 0.30, g: 0.69, b: 0.31 },
  blue:   { r: 0.13, g: 0.59, b: 0.95 },
  pink:   { r: 0.91, g: 0.12, b: 0.39 },
  orange: { r: 1,    g: 0.60, b: 0    },
}

const STICKER_LABEL: Record<string, string> = {
  important:  '[*]',
  question:   '[?]',
  review:     '[R]',
  exam:       '[E]',
  understand: '[V]',
  difficult:  '[X]',
  custom:     '[o]',
}

// ============================================================
// 좌표 변환 헬퍼
// ============================================================

/**
 * 정규화 BoundingBox → pdf-lib 좌표 (좌하단 origin, 포인트 단위)
 */
function toPageCoords(
  box: BoundingBox,
  pageWidth: number,
  pageHeight: number,
) {
  return {
    x:      box.x            * pageWidth,
    y:      (1 - box.y - box.height) * pageHeight,
    width:  box.width        * pageWidth,
    height: box.height       * pageHeight,
  }
}

// ============================================================
// 텍스트 줄바꿈 헬퍼
// ============================================================

function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(' ')) {
    if ((cur + ' ' + word).trim().length > maxChars) {
      if (cur) lines.push(cur)
      cur = word
    } else {
      cur = cur ? cur + ' ' + word : word
    }
  }
  if (cur) lines.push(cur)
  return lines
}

// ============================================================
// exportToPdf
// ============================================================

/**
 * 원본 PDF에 형광펜·필기·텍스트 상자·스티커를 합성한 새 PDF를 반환합니다.
 *
 * @throws 세션에 PDF가 없으면 에러
 */
export async function exportToPdf(data: ExportData): Promise<Blob> {
  const { session, highlights, annotations, textboxes, stickers } = data

  if (!session.pdfId) {
    throw new Error('PDF가 없는 세션입니다. 먼저 PDF를 불러오세요.')
  }

  // 원본 PDF 로드
  const pdfBytes = await opfs.readPDF(session.pdfId)
  const pdfDoc   = await PDFDocument.load(pdfBytes)

  // 기본 폰트 (한글 미지원, ASCII만 — 한글 텍스트는 별도 폰트 임베딩 필요)
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const pages = pdfDoc.getPages()

  // ── 페이지별 합성 ────────────────────────────────────────
  for (let i = 0; i < pages.length; i++) {
    const page       = pages[i]
    const pageNum    = i + 1
    const { width: pw, height: ph } = page.getSize()

    drawHighlights(page, pageNum, pw, ph, highlights)
    drawAnnotations(page, pageNum, pw, ph, annotations, font)
    drawTextboxes(page, pageNum, pw, ph, textboxes, font, fontBold)
    drawStickers(page, pageNum, pw, ph, stickers, fontBold)
  }

  const saved = await pdfDoc.save()
  return new Blob([saved.buffer as ArrayBuffer], { type: 'application/pdf' })
}

// ============================================================
// 드로잉 헬퍼 함수들
// ============================================================

function drawHighlights(
  page: PDFPage,
  pageNum: number,
  pw: number,
  ph: number,
  highlights: ExportData['highlights'],
): void {
  for (const hl of highlights.filter((h) => h.pageNumber === pageNum)) {
    const { r, g, b } = HIGHLIGHT_RGB[hl.color] ?? HIGHLIGHT_RGB.yellow

    for (const rect of hl.rects) {
      const { x, y, width, height } = toPageCoords(rect, pw, ph)
      page.drawRectangle({
        x, y, width,
        height: Math.max(height, 4),   // 최소 4pt 높이
        color:   rgb(r, g, b),
        opacity: 0.35,
      })
    }
  }
}

function drawAnnotations(
  page: PDFPage,
  pageNum: number,
  pw: number,
  ph: number,
  annotations: ExportData['annotations'],
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
): void {
  const FONT_SIZE = 8
  const MARGIN    = 4

  for (const ann of annotations.filter((a) => a.pageNumber === pageNum)) {
    const { x, y } = toPageCoords(ann.coordinates, pw, ph)

    // 배경 박스
    const lines    = wrapText(ann.content, 40)
    const boxW     = Math.min(ann.coordinates.width * pw, 180)
    const boxH     = lines.length * (FONT_SIZE + 2) + MARGIN * 2

    page.drawRectangle({
      x: x - MARGIN,
      y: y - boxH + MARGIN,
      width:   boxW + MARGIN * 2,
      height:  boxH,
      color:   rgb(1, 1, 0.8),
      opacity: 0.9,
      borderColor: rgb(0.9, 0.7, 0),
      borderWidth: 0.5,
    })

    // 텍스트
    for (let li = 0; li < lines.length; li++) {
      page.drawText(lines[li], {
        x:        x,
        y:        y - FONT_SIZE - li * (FONT_SIZE + 2),
        size:     FONT_SIZE,
        font,
        color:    rgb(0.1, 0.1, 0.1),
        maxWidth: boxW,
      })
    }
  }
}

function drawTextboxes(
  page: PDFPage,
  pageNum: number,
  pw: number,
  ph: number,
  textboxes: ExportData['textboxes'],
  font:     Awaited<ReturnType<PDFDocument['embedFont']>>,
  fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
): void {
  const FONT_SIZE = 9

  for (const tb of textboxes.filter((t) => t.pageNumber === pageNum)) {
    const { x, y, width: boxW } = toPageCoords(tb.coordinates, pw, ph)

    // 수식이면 "(수식) ..." 프리픽스, 아니면 원본 텍스트
    const display  = tb.isMathMode && tb.mathLatex
      ? `[수식] ${tb.mathLatex}`
      : tb.content
    const lines    = wrapText(display, Math.floor(boxW / 6))
    const boxH     = lines.length * (FONT_SIZE + 3) + 8

    page.drawRectangle({
      x: x - 2, y: y - boxH,
      width:  boxW + 4,
      height: boxH,
      color:  rgb(0.95, 0.97, 1),
      opacity: 0.92,
      borderColor: rgb(0.4, 0.6, 1),
      borderWidth: 0.75,
    })

    const usedFont = tb.isMathMode ? fontBold : font
    for (let li = 0; li < lines.length; li++) {
      page.drawText(lines[li], {
        x,
        y: y - FONT_SIZE - li * (FONT_SIZE + 3),
        size:     FONT_SIZE,
        font:     usedFont,
        color:    rgb(0.1, 0.2, 0.5),
        maxWidth: boxW,
      })
    }
  }
}

function drawStickers(
  page: PDFPage,
  pageNum: number,
  pw: number,
  ph: number,
  stickers: ExportData['stickers'],
  fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
): void {
  for (const sticker of stickers.filter((s) => s.pageNumber === pageNum)) {
    const sx = sticker.coordinates.x * pw
    const sy = (1 - sticker.coordinates.y) * ph
    const label = STICKER_LABEL[sticker.type] ?? '[o]'

    page.drawCircle({
      x: sx, y: sy,
      size:        8,
      color:       rgb(1, 0.9, 0.2),
      borderColor: rgb(0.8, 0.6, 0),
      borderWidth: 0.5,
      opacity:     0.9,
    })

    page.drawText(label, {
      x:    sx - 6,
      y:    sy - 3,
      size: 5,
      font: fontBold,
      color: rgb(0.3, 0.2, 0),
    })
  }
}
