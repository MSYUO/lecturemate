/**
 * @file workers/pdf.worker.ts
 * LectureMate — PDF 텍스트 추출 Web Worker
 *
 * ## 메시지 프로토콜
 * IN  { type: 'extract'; pdfId; arrayBuffer; pageCount }
 *       → 각 페이지 텍스트 추출
 *       → OUT { type: 'page-text'; pdfId; pageNumber; text }  (페이지마다)
 *       → OUT { type: 'done'; pdfId }                         (전체 완료)
 *
 * OUT { type: 'error'; message }  (언제든 발생 가능)
 *
 * ## 저장
 * 각 페이지 텍스트를 IndexedDB pdfTextIndex 테이블에 put.
 * 추출 전에 기존 레코드를 삭제하지 않으므로 재시작 시 중복 저장될 수 있음 —
 * 메인 스레드(PDFViewerPanel)에서 이미 완료된 pdfId는 전송하지 않아야 함.
 *
 * ## PDF.js 설정
 * 이미 Worker 컨텍스트 안이므로 PDF.js의 sub-Worker를 비활성화합니다.
 * workerSrc = '' → FakeWorker 모드 (같은 스레드 내 동기 실행)
 */

import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { db } from '@/db/schema'
import type { PdfWorkerInMessage, PdfWorkerOutMessage, PdfPageText } from '@/types'

// ============================================================
// PDF.js 설정 — sub-Worker 비활성화 (이미 Worker 컨텍스트)
// ============================================================

// Worker 컨텍스트 안에서는 sub-Worker를 띄울 수 없으므로
// workerSrc를 빈 문자열로 설정해 FakeWorker 모드로 동작시킵니다.
GlobalWorkerOptions.workerSrc = ''

// ============================================================
// 헬퍼
// ============================================================

function postOut(msg: PdfWorkerOutMessage): void {
  self.postMessage(msg)
}

// ============================================================
// 메시지 핸들러
// ============================================================

self.onmessage = async (e: MessageEvent<PdfWorkerInMessage>): Promise<void> => {
  const msg = e.data
  if (msg.type !== 'extract') return

  const { pdfId, arrayBuffer, pageCount } = msg

  let doc: PDFDocumentProxy
  try {
    doc = await getDocument({ data: arrayBuffer }).promise
  } catch (err) {
    postOut({ type: 'error', message: `PDF 로딩 실패: ${String(err)}` })
    return
  }

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    try {
      const page    = await doc.getPage(pageNum)
      const content = await page.getTextContent()

      // TextItem 배열을 공백으로 이어 붙임 (hasEOL이 true인 항목 뒤에는 개행)
      const text = content.items
        .map((item: TextItem | { type: string }) => {
          if ('str' in item) {
            return (item as TextItem).hasEOL ? (item as TextItem).str + '\n' : (item as TextItem).str
          }
          return ''
        })
        .join('')
        .replace(/\n{3,}/g, '\n\n')   // 과도한 빈 줄 정리
        .trim()

      // IndexedDB에 저장 (pdfId + pageNumber 조합으로 upsert)
      const record: PdfPageText = {
        id:          `${pdfId}-p${pageNum}`,   // 결정적 ID — 재시도 시 덮어쓰기
        pdfId,
        pageNumber:  pageNum,
        text,
        extractedAt: Date.now(),
      }
      await db.pdfTextIndex.put(record)

      postOut({ type: 'page-text', pdfId, pageNumber: pageNum, text })

    } catch (err) {
      // 단일 페이지 실패는 전체를 중단하지 않고 경고만 남김
      console.warn(`[pdf.worker] 페이지 ${pageNum} 추출 실패:`, err)
      postOut({ type: 'page-text', pdfId, pageNumber: pageNum, text: '' })
    }
  }

  doc.destroy()
  postOut({ type: 'done', pdfId })
}
