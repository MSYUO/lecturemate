/**
 * @file hooks/useSearch.ts
 * LectureMate — 통합 검색 훅
 *
 * ## 검색 소스 (5개 Fuse.js 인스턴스)
 * | source     | 테이블              | 검색 필드            |
 * |------------|---------------------|----------------------|
 * | stt        | db.sttSegments      | text                 |
 * | annotation | db.textboxes        | content              |
 * | pdfText    | db.pdfTextIndex     | text                 |
 * | code       | db.codeSnippets     | source, output       |
 * | math       | db.mathExpressions  | originalText, latex  |
 *
 * ## 흐름
 * 1. isSearchOpen → true: IndexedDB에서 전체 데이터 로드, Fuse 인스턴스 빌드
 * 2. query 변경 (디바운스 300ms): 5개 인스턴스 동시 검색 → 통합 정렬
 * 3. searchStore.setResults() 업데이트
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
  CodeSnippet,
  MathExpression,
} from '@/types'

// ============================================================
// Fuse.js 공통 옵션
// ============================================================

const FUSE_BASE_OPTIONS = {
  includeScore:     true,
  threshold:        0.4,    // 0 = 완벽 일치, 1 = 무조건 매칭
  minMatchCharLength: 2,
  ignoreLocation:   true,   // 텍스트 전체에서 검색 (위치 무관)
}

// ============================================================
// 결과 변환 헬퍼
// ============================================================

function fuseScore(raw: number | undefined): number {
  // Fuse score: 0 = perfect. 우리 SearchResult.score: 1 = perfect.
  return 1 - (raw ?? 1)
}

// ============================================================
// useSearch
// ============================================================

export function useSearch(): void {
  const setResults  = useSearchStore((s) => s.setResults)
  const isOpen      = useSearchStore((s) => s.isSearchOpen)
  const query       = useSearchStore((s) => s.query)

  // Fuse 인스턴스 캐시
  const fuseStt    = useRef<Fuse<SttSegment> | null>(null)
  const fuseAnnot  = useRef<Fuse<TextBoxAnnotation> | null>(null)
  const fusePdf    = useRef<Fuse<PdfPageText> | null>(null)
  const fuseCode   = useRef<Fuse<CodeSnippet> | null>(null)
  const fuseMath   = useRef<Fuse<MathExpression> | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // MemoryGuard가 메모리 압박 시 호출할 수 있도록 정리 콜백 등록
  useEffect(() => {
    registerFuseDisposer(() => {
      fuseStt.current   = null
      fuseAnnot.current = null
      fusePdf.current   = null
      fuseCode.current  = null
      fuseMath.current  = null
    })
  }, [])

  // ----------------------------------------------------------
  // 인덱스 빌드
  // ----------------------------------------------------------

  const buildIndexes = useCallback(async () => {
    const { sessionId, pdfId } = useSessionStore.getState()

    // 1. STT 세그먼트 (현재 세션)
    const sttData = sessionId
      ? await db.sttSegments.where('sessionId').equals(sessionId).toArray()
      : await db.sttSegments.toArray()
    fuseStt.current = new Fuse(sttData, {
      ...FUSE_BASE_OPTIONS,
      keys: [{ name: 'text', weight: 1 }],
    })

    // 2. 텍스트 상자 어노테이션 (현재 PDF)
    const annotData = pdfId
      ? await db.textboxes.where('pdfId').equals(pdfId).toArray()
      : await db.textboxes.toArray()
    fuseAnnot.current = new Fuse(annotData, {
      ...FUSE_BASE_OPTIONS,
      keys: [{ name: 'content', weight: 1 }],
    })

    // 3. PDF 텍스트 (현재 PDF)
    const pdfData = pdfId
      ? await db.pdfTextIndex.where('pdfId').equals(pdfId).toArray()
      : await db.pdfTextIndex.toArray()
    fusePdf.current = new Fuse(pdfData, {
      ...FUSE_BASE_OPTIONS,
      keys: [{ name: 'text', weight: 1 }],
    })

    // 4. 코드 스니펫 (현재 세션)
    const codeData = sessionId
      ? await db.codeSnippets.where('sessionId').equals(sessionId).toArray()
      : await db.codeSnippets.toArray()
    fuseCode.current = new Fuse(codeData, {
      ...FUSE_BASE_OPTIONS,
      keys: [
        { name: 'source', weight: 0.8 },
        { name: 'output', weight: 0.2 },
      ],
    })

    // 5. 수식
    const mathData = await db.mathExpressions.toArray()
    fuseMath.current = new Fuse(mathData, {
      ...FUSE_BASE_OPTIONS,
      keys: [
        { name: 'originalText', weight: 0.6 },
        { name: 'latex',        weight: 0.4 },
      ],
    })
  }, [])

  // 검색창이 열릴 때 인덱스 빌드
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

      // STT
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

      // 어노테이션 (텍스트 상자)
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

      // PDF 텍스트
      fusePdf.current?.search(query).forEach((r) => {
        const p = r.item
        results.push({
          source:     'pdfText',
          text:       p.text,
          pageNumber: p.pageNumber,
          score:      fuseScore(r.score),
        })
      })

      // 코드 스니펫
      fuseCode.current?.search(query).forEach((r) => {
        const c = r.item
        results.push({
          source:       'code',
          text:         c.source,
          pageNumber:   c.pageNumber ?? 0,
          codeLanguage: c.language,
          score:        fuseScore(r.score),
        })
      })

      // 수식
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

      // score 내림차순 정렬 후 최대 50건
      results.sort((a, b) => b.score - a.score)
      setResults(results.slice(0, 50))
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, setResults])
}
