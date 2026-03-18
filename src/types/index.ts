/**
 * @file types/index.ts
 * LectureMate — 중앙 집중 타입 정의 (v4)
 *
 * 모든 공유 타입은 이 파일에서 import합니다:
 *   import type { Session, Tag, ... } from '@/types'
 */

import type { Patch } from 'immer'

// ============================================================
// 유틸리티 타입 (Primitive helpers)
// ============================================================

/**
 * PDF 좌표계 내 단일 점.
 * 좌표는 PDF 페이지 크기를 1×1로 정규화한 비율 값 [0, 1].
 */
export interface Point {
  x: number
  y: number
}

/**
 * PDF 좌표계 내 사각형 영역.
 * x, y는 좌상단 기준. 모든 값은 정규화된 비율 [0, 1].
 */
export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

// ============================================================
// 열거형 타입 (Enum-like literals)
// ============================================================

/**
 * 형광펜 색상.
 * 단축키: H 모드에서 1~5 숫자키로 전환.
 */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange'

/**
 * 스티커 종류.
 * 각 값은 의미 있는 이모지 아이콘과 대응됩니다.
 *
 * - important  ⭐ 중요
 * - question   ❓ 질문
 * - review     🔄 복습 필요
 * - exam       📝 시험 출제
 * - understand ✅ 이해 완료
 * - difficult  🔴 어려움
 * - custom     사용자 정의
 */
export type StickerType =
  | 'important'
  | 'question'
  | 'review'
  | 'exam'
  | 'understand'
  | 'difficult'
  | 'custom'

/**
 * 백그라운드 Job의 실행 상태.
 *
 * - pending  대기 중 (큐에 적재됨)
 * - active   현재 실행 중
 * - done     성공 완료
 * - failed   실패 (재시도 가능)
 */
export type JobStatus = 'pending' | 'active' | 'done' | 'failed'

/**
 * 백그라운드 Job 종류.
 *
 * - stt-realtime   실시간 STT 변환 청크
 * - stt-postprocess 녹음 완료 후 전체 패스 정확도 향상
 * - pdf-index      PDF 페이지 텍스트 추출 및 검색 인덱싱
 * - export         내보내기 (마크다운/HTML/PDF)
 */
export type JobType = 'stt-realtime' | 'stt-postprocess' | 'pdf-index' | 'export'

/**
 * 코드 스니펫 실행 언어.
 *
 * - python     Pyodide (CPython WASM) 실행
 * - javascript iframe sandbox 실행
 */
export type CodeLanguage = 'python' | 'javascript'

/**
 * 현재 활성화된 WASM 리소스 모드.
 * Whisper(400MB)와 Pyodide(200MB)는 동시 활성 금지.
 * ResourceManager가 이 값을 기준으로 WASM 로드/언로드를 관리합니다.
 *
 * - recording  STT Whisper 활성, Pyodide 비활성
 * - reviewing  두 WASM 모두 비활성 (PDF 탐색 모드)
 * - coding     Pyodide 활성, Whisper 비활성
 */
export type ActiveMode = 'recording' | 'reviewing' | 'coding'

/**
 * PDF 오버레이에서 사용하는 현재 도구 종류.
 *
 * - pointer     기본 포인터 (PDF 탐색, 텍스트 선택)
 * - highlighter 형광펜 (드래그로 영역 색칠)
 * - textbox     텍스트 상자 (더블클릭으로 생성)
 * - tagger      태깅 모드 (Alt+클릭 → 점 태그, 드래그 → 영역 태그)
 */
export type ToolType = 'pointer' | 'highlighter' | 'textbox' | 'tagger'

/**
 * 저장 상태 표시 (SaveStatusIndicator에서 사용).
 *
 * - idle    변경 없음
 * - dirty   미저장 변경 존재
 * - saving  IndexedDB에 커밋 중
 * - saved   최근 저장 완료
 * - error   저장 실패
 */
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/**
 * Whisper WASM 로드 및 추론 상태 (WhisperStatusBadge에서 사용).
 *
 * - idle         초기화 전
 * - loading      모델 다운로드/로드 중
 * - ready        추론 대기 중
 * - transcribing 현재 STT 추론 중
 * - error        모델 로드 또는 추론 실패
 */
export type WhisperStatus = 'idle' | 'loading' | 'ready' | 'transcribing' | 'error'

/**
 * 내보내기 파일 형식.
 */
export type ExportFormat = 'pdf_annotated' | 'markdown' | 'html' | 'json'

// ============================================================
// 핵심 엔티티 (Core entities — Dexie Table 타입)
// ============================================================

/**
 * 학습 세션.
 * PDF 파일 1개와 녹음 1회를 묶는 최상위 컨테이너.
 * 모든 태그, 어노테이션, STT 세그먼트는 sessionId로 연결됩니다.
 */
export interface Session {
  /** 자동 증가 ID (Dexie ++id) */
  id: string
  /** 연결된 PDF 파일 식별자 (OPFS /pdf/{pdfId}.pdf) */
  pdfId: string | null
  /** 사용자 지정 세션 제목 */
  title: string
  /** 총 녹음 시간 (초) */
  duration: number
  /** 녹음 시작 Unix 타임스탬프 (ms) */
  createdAt: number
  /** 마지막 수정 Unix 타임스탬프 (ms) */
  updatedAt: number
  /** 오디오 OPFS 파일 삭제 여부 (용량 관리 정책에 의해 삭제된 경우 true) */
  audioDeleted?: boolean
}

/**
 * PDF 위에 찍은 태그 (시간 ↔ 공간 동기화의 핵심).
 * 태깅 모드에서 마우스로 생성하며 오디오 타임스탬프와 연결됩니다.
 *
 * type:
 * - point  Alt+클릭으로 생성한 점 태그 (좌표 1개)
 * - area   드래그로 생성한 영역 태그 (BoundingBox)
 * - page   Ctrl+Space로 생성한 페이지 전체 태그
 */
export interface Tag {
  /** 자동 증가 ID */
  id: string
  /** 소속 세션 */
  sessionId: string
  /** 소속 PDF */
  pdfId: string
  /** 태그가 찍힌 PDF 페이지 번호 (1-based) */
  pageNumber: number
  /** 태그 종류 */
  type: 'point' | 'area' | 'page'
  /** 태그 위치 (정규화 좌표 [0,1]). point 태그는 width/height = 0 */
  coordinates: BoundingBox
  /** 태그 생성 시점의 오디오 재생 위치 (초) */
  timestampStart: number
  /** 태그 종료 시점 (area/page 태그의 경우 발화 끝까지) */
  timestampEnd?: number
  /** 자동 태깅 여부 (STT 결과로 자동 생성된 경우 true) */
  autoTagged: boolean
  /** 사용자 레이블 (선택 사항) */
  label?: string
  /** 생성 시각 (ms) */
  createdAt: number
}

/**
 * 일반 어노테이션 (태그와 연결된 텍스트/필기 메모).
 * TextBoxAnnotation과 달리 수식 변환 없이 단순 텍스트만 저장합니다.
 */
export interface Annotation {
  /** 자동 증가 ID */
  id: string
  /** 소속 세션 */
  sessionId: string
  /** 소속 PDF */
  pdfId: string
  /** 어노테이션이 위치한 페이지 (1-based) */
  pageNumber: number
  /** 어노테이션 위치 및 크기 (정규화 좌표) */
  coordinates: BoundingBox
  /** 텍스트 내용 */
  content: string
  /** 연결된 태그 ID (선택 사항) */
  linkedTagId?: string
  /** 생성 시각 (ms) */
  createdAt: number
  /** 수정 시각 (ms) */
  updatedAt: number
}

/**
 * 텍스트 상자 어노테이션 (★v4 핵심).
 * PDF 위에 더블클릭으로 생성하며 수식 자동 변환을 지원합니다.
 *
 * 수식 파이프라인:
 *   자연어 입력 → mathParser → LaTeX → KaTeX 렌더링
 *   예: "시그마 i=1 에서 n" → "\sum_{i=1}^{n}"
 */
export interface TextBoxAnnotation {
  /** 자동 증가 ID */
  id: string
  /** 소속 세션 */
  sessionId: string
  /** 소속 PDF */
  pdfId: string
  /** 위치한 페이지 (1-based) */
  pageNumber: number
  /** 위치 및 크기 (정규화 좌표) */
  coordinates: BoundingBox
  /** 사용자가 입력한 원본 텍스트 */
  content: string
  /** 변환된 LaTeX 문자열 (수식 모드일 때만 존재) */
  mathLatex?: string
  /** 수식 모드 여부. true이면 KaTeX로 렌더링 */
  isMathMode: boolean
  /** 연결된 태그 ID (선택 사항) */
  linkedTagId?: string
  /** 생성 시각 (ms) */
  createdAt: number
  /** 수정 시각 (ms) */
  updatedAt: number
}

/**
 * 형광펜 하이라이트 (★v4 신규).
 * PDF 텍스트 위에 반투명 색상 오버레이를 적용합니다.
 * 여러 줄에 걸친 선택을 지원하기 위해 rects 배열을 사용합니다.
 */
export interface Highlight {
  /** 자동 증가 ID */
  id: string
  /** 소속 세션 */
  sessionId: string
  /** 소속 PDF */
  pdfId: string
  /** 위치한 페이지 (1-based) */
  pageNumber: number
  /** 5가지 형광펜 색상 */
  color: HighlightColor
  /**
   * 하이라이트 영역 목록.
   * 멀티라인 텍스트 선택 시 각 줄마다 별도 rect가 생성됩니다.
   */
  rects: BoundingBox[]
  /** 연결된 태그 ID (선택 사항) */
  linkedTagId?: string
  /** 형광펜에 추가한 메모 (우클릭 → 메모 팝업) */
  note?: string
  /** 생성 시각 (ms) */
  createdAt: number
}

/**
 * 스티커 / 라벨 (★v4 신규).
 * PDF 위 특정 좌표에 의미 있는 아이콘을 배치합니다.
 * 검색 및 필터링("시험 출제 스티커만 모아보기")에 활용됩니다.
 */
export interface Sticker {
  /** 자동 증가 ID */
  id: string
  /** 소속 세션 */
  sessionId: string
  /** 소속 PDF */
  pdfId: string
  /** 위치한 페이지 (1-based) */
  pageNumber: number
  /** 스티커 종류 */
  type: StickerType
  /** 스티커 중심 좌표 (정규화) */
  coordinates: Point
  /** 사용자 정의 레이블 텍스트 (선택 사항) */
  label?: string
  /** 생성 시각 (ms) */
  createdAt: number
}

/**
 * 페이지 북마크 (★v4 신규).
 * Ctrl+B로 현재 페이지를 북마크하고 사이드바에서 빠르게 이동합니다.
 * PDF 좌측에 색깔 탭으로 시각화됩니다.
 */
export interface Bookmark {
  /** 자동 증가 ID */
  id: string
  /** 소속 세션 */
  sessionId: string
  /** 소속 PDF */
  pdfId: string
  /** 북마크된 페이지 (1-based) */
  pageNumber: number
  /** 북마크 제목 (예: "Chapter 3: 확률분포") */
  title: string
  /** 북마크 탭 색상 (CSS 컬러 문자열, 선택 사항) */
  color?: string
  /** 생성 시각 (ms) */
  createdAt: number
}

// ============================================================
// STT / 오디오 (Speech-to-Text & Audio)
// ============================================================

/**
 * STT 변환 결과 세그먼트.
 * 한 청크에서 여러 세그먼트가 생성될 수 있습니다.
 * 오버랩 중복 제거(OverlapDeduplicator) 후 저장됩니다.
 */
export interface SttSegment {
  /** 자동 증가 ID */
  id: string
  /** 소속 세션 */
  sessionId: string
  /** 세그먼트 발화 시작 시각 (초, 세션 기준) */
  startTime: number
  /** 세그먼트 발화 종료 시각 (초, 세션 기준) */
  endTime: number
  /** 변환된 텍스트 전체 */
  text: string
  /**
   * 단어 단위 토큰 목록.
   * Dexie 인덱스: `*words` (멀티엔트리 인덱스)로 단어 검색 지원.
   */
  words: string[]
  /** Whisper 신뢰도 [0, 1]. 낮을수록 불확실한 발화 */
  confidence: number
  /** 원본 청크 인덱스 (오버랩 추적용) */
  chunkIndex: number
  /**
   * 후처리(beam=5) 결과로 교체된 여부.
   * true이면 실시간 패스 결과를 덮어쓴 확정 세그먼트.
   */
  isPostProcessed: boolean
  /** 생성 시각 (ms) */
  createdAt: number
}

/**
 * OPFS에 저장되는 5초 오디오 청크 메타데이터.
 * 실제 PCM 데이터는 OPFS /audio/{sessionId}/chunk_{index}.pcm에 저장됩니다.
 * IndexedDB에는 이 메타 객체만 보관합니다.
 */
export interface AudioChunk {
  /** 청크 인덱스 (0-based, 파일명과 동일) */
  index: number
  /** 소속 세션 */
  sessionId: string
  /** 청크 오디오 시작 시각 (초, 세션 기준) */
  startTime: number
  /** 청크 오디오 종료 시각 (초, 세션 기준) */
  endTime: number
  /**
   * 앞뒤 오버랩을 포함한 실제 청크 길이 (초).
   * 본체 5초 + 앞 1초 + 뒤 1초 = 7초.
   */
  durationWithOverlap: number
  /** OPFS 파일 경로 (OPFS 루트 기준 상대 경로) */
  opfsPath: string
  /** 저장 완료 여부 */
  saved: boolean
}

// ============================================================
// PDF 텍스트 인덱스
// ============================================================

/**
 * PDF 페이지 텍스트 추출 결과 (검색 인덱싱용).
 * pdf.worker.ts에서 PDF.js를 통해 추출되어 Dexie에 저장됩니다.
 */
export interface PdfPageText {
  /** 자동 증가 ID */
  id: string
  /** 소속 PDF */
  pdfId: string
  /** 페이지 번호 (1-based) */
  pageNumber: number
  /** 추출된 텍스트 전문 */
  text: string
  /** 추출 완료 시각 (ms) */
  extractedAt: number
}

// ============================================================
// 작업 큐 (Job Queue)
// ============================================================

/**
 * 백그라운드 작업 항목.
 * JobScheduler가 큐를 관리하며 우선순위에 따라 순차 실행합니다.
 * 네트워크 없이 로컬에서만 실행되므로 크래시 복구(WAL)와 연동됩니다.
 */
export interface Job {
  /** 자동 증가 ID */
  id: string
  /** 작업 종류 */
  type: JobType
  /** 작업 실행 상태 */
  status: JobStatus
  /** 소속 세션 */
  sessionId: string
  /**
   * 작업 수행에 필요한 입력 데이터.
   * type별로 구조가 다릅니다:
   *   - stt-*:      { chunkIndex: number }
   *   - pdf-index:  { pdfId: string }
   *   - export:     { format: ExportFormat }
   */
  payload: Record<string, unknown>
  /** 재시도 횟수 (최대 3회) */
  retries: number
  /** 마지막 오류 메시지 */
  lastError?: string
  /** 생성 시각 (ms) */
  createdAt: number
  /** 마지막 상태 변경 시각 (ms) */
  updatedAt: number
}

// ============================================================
// WAL (Write-Ahead Log)
// ============================================================

/**
 * WAL(Write-Ahead Log) 엔트리.
 * 모든 쓰기 작업은 "intent 기록 → 실행 → commit" 순으로 처리됩니다.
 * 앱 충돌 시 uncommitted 엔트리를 감지해 자동 복구합니다.
 *
 * 흐름:
 *   1. WAL intent 기록 (committedAt = null)
 *   2. 실제 데이터 저장 실행
 *   3. WAL.committedAt 업데이트 (commit)
 */
export interface WALEntry {
  /** 자동 증가 ID */
  id: string
  /**
   * 작업 이름 (예: 'writeAudioChunk', 'saveTag', 'deleteHighlight').
   * Dexie 인덱스: `operation`으로 타입별 조회 지원.
   */
  operation: string
  /**
   * 작업 상태.
   * - pending   실행 전 (intent만 기록된 상태)
   * - committed 성공적으로 완료됨
   * - rolledback 롤백 완료
   */
  status: 'pending' | 'committed' | 'rolledback'
  /**
   * 롤백에 필요한 데이터.
   * 각 operation마다 구조가 다릅니다.
   */
  payload: Record<string, unknown>
  /** WAL 기록 시각 (ms) */
  createdAt: number
  /** 커밋 완료 시각 (ms). null이면 아직 미완료 → 복구 대상 */
  committedAt: number | null
}

// ============================================================
// 코드 스니펫
// ============================================================

/**
 * Monaco 에디터에서 작성·실행한 코드 스니펫.
 * PDF 페이지와 연결되어 "이 슬라이드에서 작성한 코드" 검색이 가능합니다.
 */
export interface CodeSnippet {
  /** 자동 증가 ID */
  id: string
  /** 소속 세션 */
  sessionId: string
  /** 연결된 PDF (선택 사항) */
  pdfId?: string
  /** 연결된 페이지 (1-based, 선택 사항) */
  pageNumber?: number
  /** 프로그래밍 언어 */
  language: CodeLanguage
  /** 소스 코드 */
  source: string
  /** 마지막 실행 표준 출력 결과 */
  output?: string
  /** 마지막 실행 오류 메시지 */
  error?: string
  /** 마지막 실행 시각 (ms). null이면 한 번도 실행 안 됨 */
  executedAt: number | null
  /** 생성 시각 (ms) */
  createdAt: number
  /** 수정 시각 (ms) */
  updatedAt: number
}

// ============================================================
// 수식 (Math Expression)
// ============================================================

/**
 * 자연어 → LaTeX 변환 결과 (★v4 신규).
 * TextBoxAnnotation의 수식 파이프라인에서 생성됩니다.
 *
 * 파이프라인:
 *   사용자 입력 → mathParser → MathExpression (저장) → KaTeX 렌더링
 */
export interface MathExpression {
  /** 자동 증가 ID */
  id: string
  /** 원본 TextBoxAnnotation ID */
  textboxId: string
  /**
   * 사용자가 입력한 자연어 원문.
   * 예: "시그마 i=1 에서 n"
   */
  originalText: string
  /**
   * 변환된 LaTeX 문자열.
   * 예: "\\sum_{i=1}^{n}"
   */
  latex: string
  /**
   * 사용자가 $$ ... $$ 형식으로 직접 LaTeX를 입력한 경우 true.
   * false이면 mathParser가 자동 변환한 결과.
   */
  isManualLatex: boolean
  /** 생성 시각 (ms) */
  createdAt: number
}

// ============================================================
// Undo / Redo (★v4 신규)
// ============================================================

/**
 * Immer 패치 기반 Undo 히스토리 레코드.
 * `produceWithPatches`로 생성된 역방향 패치를 저장합니다.
 * 최대 100단계 유지. 101번째 액션 시 가장 오래된 항목 제거(FIFO).
 *
 * Undo 가능 액션: 텍스트 상자 생성/삭제/이동/수정, 태그 생성/삭제,
 *                형광펜 생성/삭제, 스티커 배치/제거, DnD (STT→PDF)
 * Undo 불가 액션: 녹음 시작/정지, STT 변환 결과, 세션 삭제
 */
export interface UndoPatch {
  /** 자동 증가 ID */
  id: string
  /** 소속 세션 */
  sessionId: string
  /** 사람이 읽을 수 있는 액션 설명 (예: "텍스트 상자 이동") */
  description: string
  /**
   * Immer 역방향 패치 (Undo용).
   * `applyPatches(state, inversePatches)`로 이전 상태 복원.
   */
  inversePatches: Patch[]
  /**
   * Immer 정방향 패치 (Redo용).
   * `applyPatches(state, patches)`로 액션 재적용.
   */
  patches: Patch[]
  /** 액션 발생 시각 (ms) */
  createdAt: number
}

// ============================================================
// 검색 (Search)
// ============================================================

/**
 * 4차원 통합 검색 결과 항목.
 * Fuse.js 5개 인스턴스(STT / 어노테이션 / PDF 원문 / 코드 / 수식)의
 * 결과를 score 기준으로 통합 정렬한 단일 결과 타입입니다.
 */
export interface SearchResult {
  /**
   * 결과 출처.
   * - stt        STT 변환 텍스트
   * - annotation 텍스트 상자 / 일반 어노테이션
   * - pdfText    PDF 원문 추출 텍스트
   * - code       코드 스니펫 (소스 + 출력)
   * - math       수식 원문 및 LaTeX
   */
  source: 'stt' | 'annotation' | 'pdfText' | 'code' | 'math'
  /** 매칭된 텍스트 (하이라이트 전 원문) */
  text: string
  /** 매칭된 PDF 페이지 번호 (1-based). 없으면 0 */
  pageNumber: number
  /** PDF 내 좌표 (포커싱 이동용, 선택 사항) */
  coordinates?: Point
  /** 연관 오디오 타임스탬프 시작 (초, 선택 사항) */
  timestampStart?: number
  /** Fuse.js 유사도 점수 [0, 1]. 높을수록 관련성 높음 */
  score: number
  /** code 소스일 때 프로그래밍 언어 */
  codeLanguage?: CodeLanguage
  /** math 소스일 때 LaTeX 문자열 */
  mathLatex?: string
  /** 스티커 필터링 시 사용 (선택 사항) */
  stickerType?: StickerType
}

// ============================================================
// Worker 메시지 (postMessage 통신 타입)
// ============================================================

/**
 * AudioWorker → 메인 스레드 메시지.
 * 5+2초(오버랩 포함) 청크가 완성될 때마다 전송됩니다.
 */
export type AudioWorkerInMessage =
  | { type: 'start'; sessionId: string; sampleRate: number }
  /**
   * 메인 스레드 AudioWorklet 프로세서에서 캡처한 원시 PCM 데이터.
   * Worker 내부에서 16kHz 리샘플링 + 오버랩 청킹을 수행합니다.
   * samples는 Transferable로 전송되어 복사 비용이 없습니다.
   */
  | { type: 'pcm'; samples: Float32Array }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }

export type AudioWorkerOutMessage =
  | {
      type: 'chunk'
      sessionId: string
      chunkIndex: number
      /** PCM Float32 데이터 @ 16kHz (Transferable로 전송) */
      pcmData: Float32Array
      /** 본체 시작 시각 (초, 세션 기준) — pre-overlap 제외 */
      startTime: number
      /** 본체 종료 시각 (초, 세션 기준) — post-overlap 제외 */
      endTime: number
      /** pcmData의 실제 길이 (초) — pre/post overlap 포함 */
      durationWithOverlap: number
    }
  | {
      type: 'complete'
      sessionId: string
      /** 총 발행된 청크 수 (flush 포함) */
      totalChunks: number
    }
  | { type: 'error'; message: string }

/**
 * STTWorker ↔ 메인 스레드 메시지.
 */
export type SttWorkerInMessage =
  | { type: 'load' }
  | { type: 'transcribe'; chunkIndex: number; pcmData: Float32Array; isPostProcess: boolean }

export type SttWorkerOutMessage =
  | { type: 'ready' }
  | { type: 'progress'; percent: number }
  | { type: 'result'; chunkIndex: number; segments: SttSegment[]; isPostProcess: boolean }
  | { type: 'error'; message: string }

/**
 * PDFWorker ↔ 메인 스레드 메시지.
 */
export type PdfWorkerInMessage =
  | { type: 'extract'; pdfId: string; arrayBuffer: ArrayBuffer; pageCount: number }

export type PdfWorkerOutMessage =
  | { type: 'page-text'; pdfId: string; pageNumber: number; text: string }
  | { type: 'done'; pdfId: string }
  | { type: 'error'; message: string }

/**
 * CodeRunnerWorker ↔ 메인 스레드 메시지.
 */
export type CodeRunnerInMessage =
  | { type: 'init' }
  | { type: 'run'; snippetId: string; language: CodeLanguage; source: string }
  | { type: 'interrupt' }

export type CodeRunnerOutMessage =
  | { type: 'progress'; percent: number }
  | { type: 'ready' }
  | { type: 'output'; snippetId: string; text: string }
  | { type: 'stderr'; snippetId: string; text: string }
  | { type: 'error'; snippetId: string; message: string }
  | { type: 'result'; snippetId: string; executionTime: number; status: 'ok' | 'error' | 'timeout' }

/** JS 샌드박스 실행 결과 */
export interface JsSandboxResult {
  stdout:        string[]
  stderr:        string[]
  executionTime: number
  status:        'ok' | 'error' | 'timeout'
}
