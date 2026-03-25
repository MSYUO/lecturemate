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
  Folder,
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
  MathExpression,
  WALEntry,
  UndoPatch,
  TranslationResult,
} from '@/types'

// ============================================================
// DB 클래스 정의
// ============================================================

class LectureMateDB extends Dexie {
  // ---- 폴더 ----
  /** 굿노트 스타일 폴더 (계층적 세션 분류) */
  folders!: Table<Folder>

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

  // ---- 작업 큐 ----
  /** 백그라운드 Job 큐 (STT, PDF 인덱싱, 내보내기) */
  pendingJobs!: Table<Job>

  // ---- 수식 / 복구 / 히스토리 (★v4) ----
  /** 자연어→LaTeX 변환 결과 */
  mathExpressions!: Table<MathExpression>
  /** WAL (Write-Ahead Log) — 크래시 복구 */
  wal!: Table<WALEntry>
  /** Immer 패치 기반 Undo/Redo 히스토리 */
  undoHistory!: Table<UndoPatch>

  // ---- 번역 ----
  /** PDF 영역 선택 번역 결과 */
  translations!: Table<TranslationResult>

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
      sessions: '++id, pdfId, createdAt',
      tags: '++id, sessionId, pdfId, pageNumber, type, timestampStart',
      annotations: '++id, sessionId, pdfId, pageNumber, linkedTagId',
      highlights: '++id, sessionId, pdfId, pageNumber, color',
      textboxes: '++id, sessionId, pdfId, pageNumber, isMathMode',
      stickers: '++id, sessionId, pdfId, pageNumber, type',
      bookmarks: '++id, sessionId, pdfId, pageNumber',
      sttSegments: '++id, sessionId, startTime, endTime, *words',
      pdfTextIndex: '++id, pdfId, pageNumber',
      pendingJobs: '++id, sessionId, type, status, createdAt',
      mathExpressions: '++id, textboxId, latex',
      wal: '++id, operation, status, createdAt',
      undoHistory: '++id, sessionId, createdAt',
    })

    // v4: folders 테이블 신규 + sessions에 folderId 인덱스 추가
    // Dexie 마이그레이션: 변경된 테이블만 명시하면 나머지는 v3 스키마 유지
    this.version(4).stores({
      folders:  '++id, parentId, createdAt',
      sessions: '++id, pdfId, folderId, createdAt',
    })

    // v5: translations 테이블 신규
    this.version(5).stores({
      translations: '++id, sessionId, pdfId, pageNumber, createdAt',
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
