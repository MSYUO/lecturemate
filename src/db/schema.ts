/**
 * @file db/schema.ts
 * LectureMate — Dexie.js v3 데이터베이스 스키마 (v4)
 *
 * 저장 전략:
 *   - IndexedDB (이 파일): 작고 자주 쿼리되는 구조화 데이터
 *   - OPFS (OPFSStorage.ts): 오디오 PCM, PDF 원본 등 대용량 바이너리
 *
 * 싱글톤 사용:
 *   import { db } from '@/db/schema'
 */

import Dexie, { type Table } from 'dexie'
import type {
  Session,
  Tag,
  Annotation,
  TextBoxAnnotation,
  Highlight,
  Sticker,
  Bookmark,
  SttSegment,
  PdfPageText,
  Job,
  CodeSnippet,
  MathExpression,
  WALEntry,
  UndoPatch,
} from '@/types'

// ============================================================
// DB 클래스 정의
// ============================================================

class LectureMateDB extends Dexie {
  // ---- 세션 / 태그 / 어노테이션 ----
  /** 학습 세션 (최상위 컨테이너) */
  sessions!: Table<Session>
  /** PDF 위에 찍은 시간↔공간 태그 */
  tags!: Table<Tag>
  /** 일반 텍스트 어노테이션 */
  annotations!: Table<Annotation>

  // ---- 형광펜 / 텍스트 상자 / 스티커 / 북마크 (★v4) ----
  /** 형광펜 하이라이트 */
  highlights!: Table<Highlight>
  /** 더블클릭 텍스트 상자 (수식 변환 포함) */
  textboxes!: Table<TextBoxAnnotation>
  /** 스티커 / 라벨 */
  stickers!: Table<Sticker>
  /** 페이지 북마크 */
  bookmarks!: Table<Bookmark>

  // ---- STT / PDF 인덱스 ----
  /** Whisper STT 변환 결과 세그먼트 */
  sttSegments!: Table<SttSegment>
  /** PDF 페이지 텍스트 추출 인덱스 (Fuse.js 검색 소스) */
  pdfTextIndex!: Table<PdfPageText>

  // ---- 작업 큐 / 코드 ----
  /** 백그라운드 Job 큐 (STT, PDF 인덱싱, 내보내기) */
  pendingJobs!: Table<Job>
  /** Monaco 에디터 코드 스니펫 */
  codeSnippets!: Table<CodeSnippet>

  // ---- 수식 / 복구 / 히스토리 (★v4) ----
  /** 자연어→LaTeX 변환 결과 */
  mathExpressions!: Table<MathExpression>
  /** WAL (Write-Ahead Log) — 크래시 복구 */
  wal!: Table<WALEntry>
  /** Immer 패치 기반 Undo/Redo 히스토리 */
  undoHistory!: Table<UndoPatch>

  constructor() {
    super('LectureMateDB')

    /**
     * 인덱스 표기법:
     *   ++id        자동 증가 primary key
     *   [a+b]       복합 인덱스
     *   *field      멀티엔트리 인덱스 (배열 원소 개별 인덱싱)
     *   &field      유니크 인덱스
     *
     * ※ stores()에 명시되지 않은 필드도 저장됩니다.
     *   쿼리 성능이 필요한 필드만 인덱스로 등록합니다.
     */
    this.version(3).stores({
      // 세션: pdfId로 PDF별 세션 목록, createdAt으로 최신순 정렬
      sessions: '++id, pdfId, createdAt',

      // 태그: sessionId+pageNumber 복합 쿼리, type별 필터, 타임스탬프 범위 검색
      tags: '++id, sessionId, pdfId, pageNumber, type, timestampStart',

      // 어노테이션: 태그와 연결(linkedTagId), 페이지별 필터
      annotations: '++id, sessionId, pdfId, pageNumber, linkedTagId',

      // 형광펜: 색상별 필터, 페이지별 조회
      highlights: '++id, sessionId, pdfId, pageNumber, color',

      // 텍스트 상자: isMathMode 필터 (수식만 모아보기)
      textboxes: '++id, sessionId, pdfId, pageNumber, isMathMode',

      // 스티커: 종류별 필터 ("시험 출제" 스티커만 모아보기)
      stickers: '++id, sessionId, pdfId, pageNumber, type',

      // 북마크: 페이지 이동용, 세션별 목록
      bookmarks: '++id, sessionId, pdfId, pageNumber',

      // STT: 타임스탬프 범위 쿼리, *words 멀티엔트리 인덱스로 단어 검색
      sttSegments: '++id, sessionId, startTime, endTime, *words',

      // PDF 텍스트 인덱스: pdfId+pageNumber 페이지별 조회
      pdfTextIndex: '++id, pdfId, pageNumber',

      // Job 큐: type/status 필터로 대기 작업 조회, 생성순 처리
      pendingJobs: '++id, sessionId, type, status, createdAt',

      // 코드 스니펫: 언어별 필터, 페이지 연결
      codeSnippets: '++id, sessionId, pdfId, pageNumber, language',

      // 수식: textboxId로 텍스트 상자와 1:N 연결, latex 인덱스로 중복 감지
      mathExpressions: '++id, textboxId, latex',

      // WAL: operation 타입별 조회, status로 미완료(pending) 항목 복구
      wal: '++id, operation, status, createdAt',

      // Undo 히스토리: 세션별, 시간순 정렬
      undoHistory: '++id, sessionId, createdAt',
    })
  }
}

// ============================================================
// 싱글톤 인스턴스
// ============================================================

/**
 * LectureMate IndexedDB 싱글톤.
 *
 * @example
 * import { db } from '@/db/schema'
 *
 * const sessions = await db.sessions.orderBy('createdAt').reverse().toArray()
 * const tags = await db.tags.where('sessionId').equals(id).toArray()
 */
export const db = new LectureMateDB()

/** 타입 추론을 위한 DB 클래스 재노출 */
export type { LectureMateDB }
