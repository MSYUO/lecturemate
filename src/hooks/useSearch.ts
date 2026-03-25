/**
 * @file hooks/useSearch.ts
 * LectureMate — 통합 검색 훅
 *
 * ## 검색 소스 (4개 Fuse.js 인스턴스)
 * | source     | 테이블              | 검색 필드            |
 * |------------|---------------------|----------------------|
 * | stt        | db.sttSegments      | text                 |
 * | annotation | db.textboxes        | content              |
 * | pdfText    | db.pdfTextIndex     | text                 |
 * | math       | db.mathExpressions  | originalText, latex  |
 *
 * ## 마운트 위치
 * App.tsx 최상위 — 앱 전체에서 한 번만 마운트.
 */

import { useEffect, useRef, useCallback } from 'react'
import Fuse from 'fuse.js'
import { db } from '@/db/schema'
import { useSearchStore, registerFuseDisposer } from '@/stores/searchStore'
import { useSessionStore } from '@/stores/sessionStore'
import type {
  SearchResult,
  SttSegment,
  TextBoxAnnotation,
  PdfPageText,
  MathExpression,
} from '@/types'

// ============================================================
// Fuse.js 공통 옵션
// ============================================================

const FUSE_BASE_OPTIONS = {
  includeScore:     true,
  threshold:        0.4,
  minMatchCharLength: 2,
  ignoreLocation:   true,
}

// ============================================================
// 결과 변환 헬퍼
// ============================================================

function fuseScore(raw: number | undefined): number {
  return 1 - (raw ?? 1)
}

// ============================================================
// useSearch
// ============================================================

export function useSearch(): void {
  const setResults  = useSearchStore((s) => s.setResults)
  const isOpen      = useSearchStore((s) => s.isSearchOpen)
  const query       = useSearchStore((s) => s.query)

  const fuseStt   = useRef<Fuse<SttSegment> | null>(null)
  const fuseAnnot = useRef<Fuse<TextBoxAnnotation> | null>(null)
  const fusePdf   = useRef<Fuse<PdfPageText> | null>(null)
  const fuseMath  = useRef<Fuse<MathExpression> | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    registerFuseDisposer(() => {
      fuseStt.current   = null
      fuseAnnot.current = null
      fusePdf.current   = null
      fuseMath.current  = null
    })
  }, [])

  // ----------------------------------------------------------
  // 인덱스 빌드
  // ----------------------------------------------------------

  const buildIndexes = useCallback(async () => {
    const { sessionId, pdfId } = useSessionStore.getState()

    const sttData = sessionId
      ? await db.sttSegments.where('sessionId').equals(sessionId).toArray()
      : await db.sttSegments.toArray()
    fuseStt.current = new Fuse(sttData, {
      ...FUSE_BASE_OPTIONS,
      keys: [{ name: 'text', weight: 1 }],
    })

    const annotData = pdfId
      ? await db.textboxes.where('pdfId').equals(pdfId).toArray()
      : await db.textboxes.toArray()
    fuseAnnot.current = new Fuse(annotData, {
      ...FUSE_BASE_OPTIONS,
      keys: [{ name: 'content', weight: 1 }],
    })

    const pdfData = pdfId
      ? await db.pdfTextIndex.where('pdfId').equals(pdfId).toArray()
      : await db.pdfTextIndex.toArray()
    fusePdf.current = new Fuse(pdfData, {
      ...FUSE_BASE_OPTIONS,
      keys: [{ name: 'text', weight: 1 }],
    })

    const mathData = await db.mathExpressions.toArray()
    fuseMath.current = new Fuse(mathData, {
      ...FUSE_BASE_OPTIONS,
      keys: [
        { name: 'originalText', weight: 0.6 },
        { name: 'latex',        weight: 0.4 },
      ],
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return
    buildIndexes().catch((err) =>
      console.error('[useSearch] 인덱스 빌드 실패:', err),
    )
  }, [isOpen, buildIndexes])

  // ----------------------------------------------------------
  // 검색 실행 (디바운스 300ms)
  // ----------------------------------------------------------

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query.trim()) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(() => {
      const results: SearchResult[] = []

      fuseStt.current?.search(query).forEach((r) => {
        const seg = r.item
        results.push({
          source:         'stt',
          text:           seg.text,
          pageNumber:     0,
          timestampStart: seg.startTime,
          score:          fuseScore(r.score),
        })
      })

      fuseAnnot.current?.search(query).forEach((r) => {
        const a = r.item
        results.push({
          source:      'annotation',
          text:        a.content,
          pageNumber:  a.pageNumber,
          coordinates: { x: a.coordinates.x, y: a.coordinates.y },
          mathLatex:   a.mathLatex,
          score:       fuseScore(r.score),
        })
      })

      fusePdf.current?.search(query).forEach((r) => {
        const p = r.item
        results.push({
          source:     'pdfText',
          text:       p.text,
          pageNumber: p.pageNumber,
          score:      fuseScore(r.score),
        })
      })

      fuseMath.current?.search(query).forEach((r) => {
        const m = r.item
        results.push({
          source:     'math',
          text:       m.originalText,
          pageNumber: 0,
          mathLatex:  m.latex,
          score:      fuseScore(r.score),
        })
      })

      results.sort((a, b) => b.score - a.score)
      setResults(results.slice(0, 50))
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, setResults])
}
