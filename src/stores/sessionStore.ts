/**
 * @file stores/sessionStore.ts
 * LectureMate — 세션·UI 전역 상태 (Zustand)
 *
 * 역할:
 *   - 현재 세션/PDF 식별자 관리
 *   - 시간↔페이지↔태그 동기화 삼각형(currentTime, currentPage, activeTagId)
 *   - 녹음 상태, 태깅 모드, 활성 도구 관리
 *   - Whisper 로딩 상태 및 자동 저장 상태 표시
 *
 * 사용:
 *   import { useSessionStore } from '@/stores/sessionStore'
 *   const { currentTime, setCurrentTime } = useSessionStore()
 *
 *   // Worker / 비 React 컨텍스트에서:
 *   useSessionStore.getState().setWhisperStatus('ready')
 */

import { create } from 'zustand'
import type { ToolType, WhisperStatus, HighlightColor } from '@/types'

// ============================================================
// 상태 타입 정의
// ============================================================

/**
 * saveStatus — AutoSaveManager가 관리하는 저장 상태.
 *
 * - saved    최근 저장 완료 (변경 없음)
 * - pending  변경 감지됨, 3초 디바운스 대기 중 또는 저장 중
 * - error    저장 실패 (재시도 예정)
 */
export type SaveStatus = 'saved' | 'pending' | 'error'

interface SessionState {
  // ---- 세션 / PDF 식별자 ----

  /** 현재 열려 있는 세션 ID. 세션 없음이면 null */
  sessionId: string | null
  /** 현재 열려 있는 PDF ID (OPFS /pdf/{pdfId}.pdf). 없으면 null */
  pdfId: string | null

  // ---- 녹음 상태 ----

  /** 녹음 진행 중 여부 */
  isRecording: boolean
  /** 녹음 일시 정지 여부 (isRecording=true 일 때만 유효) */
  isPaused: boolean

  // ---- 동기화 삼각형 (시간↔페이지↔태그) ----

  /**
   * 현재 오디오 재생/녹음 위치 (초).
   * WaveSurfer 재생 커서 또는 녹음 경과 시간과 동기화됩니다.
   * STT 세그먼트, 태그의 타임스탬프를 이 값으로 탐색합니다.
   */
  currentTime: number
  /**
   * 현재 PDF 표시 페이지 (1-based).
   * react-pdf Document의 pageNumber 프롭과 양방향 동기화됩니다.
   */
  currentPage: number
  /**
   * 현재 선택/포커스된 태그 ID.
   * 태그 클릭 → currentTime/currentPage 이동,
   * STT 세그먼트 클릭 → activeTagId 하이라이트에 사용됩니다.
   */
  activeTagId: string | null

  // ---- 태깅 모드 / 도구 ----

  /**
   * 태깅 모드 활성 여부.
   * true: 마우스 클릭/드래그가 태그 생성으로 작동 (커서 십자모양).
   * false: 일반 PDF 탐색 모드.
   * 단축키: Tab
   */
  isTaggingMode: boolean
  /**
   * 현재 활성 도구.
   * Toolbar의 [V][H][T][S] 버튼 및 단축키와 연동됩니다.
   */
  activeToolType: ToolType

  // ---- Whisper 상태 ----

  /**
   * Whisper WASM 모델 상태.
   * PreWarmingManager와 STTWorker 메시지에 의해 업데이트됩니다.
   * WhisperStatusBadge 컴포넌트가 구독합니다.
   */
  whisperStatus: WhisperStatus
  /** Whisper 모델 로딩 진행률 [0, 100]. loading 상태일 때만 유효 */
  whisperProgress: number

  // ---- 자동 저장 상태 ----

  /**
   * 자동 저장 상태.
   * AutoSaveManager → setSaveStatus() 로 업데이트됩니다.
   * SaveStatusIndicator 컴포넌트가 구독합니다.
   */
  saveStatus: SaveStatus

  /**
   * 현재 선택된 형광펜 색상.
   * H 키 + 1~5 숫자키로 변경합니다.
   */
  activeHighlightColor: HighlightColor
}

interface SessionActions {
  // ---- 세션 / PDF ----

  /** 세션을 열거나 초기화합니다 */
  openSession: (sessionId: string, pdfId: string | null) => void
  /** 세션을 닫고 상태를 초기화합니다 */
  closeSession: () => void
  setSessionId: (id: string | null) => void
  setPdfId: (id: string | null) => void

  // ---- 녹음 ----

  setIsRecording: (recording: boolean) => void
  setIsPaused: (paused: boolean) => void
  /** 녹음 시작/정지 토글 */
  toggleRecording: () => void

  // ---- 동기화 삼각형 ----

  /**
   * 오디오 재생/녹음 시간을 업데이트합니다.
   * 시간 변화에 따라 연관 태그와 PDF 페이지를 추적합니다.
   */
  setCurrentTime: (time: number) => void
  /**
   * PDF 현재 페이지를 업데이트합니다.
   * react-pdf onPageChange 콜백에서 호출합니다.
   */
  setCurrentPage: (page: number) => void
  /**
   * 활성 태그를 설정합니다.
   * null 전달 시 선택 해제합니다.
   */
  setActiveTagId: (tagId: string | null) => void

  // ---- 태깅 모드 / 도구 ----

  /** 태깅 모드를 ON/OFF 토글합니다 (Tab 단축키) */
  toggleTaggingMode: () => void
  setIsTaggingMode: (mode: boolean) => void
  /** 활성 도구를 변경합니다 (V/H/T/S 단축키) */
  setActiveTool: (tool: ToolType) => void

  /** 형광펜 색상 변경 (H+1~5) */
  setActiveHighlightColor: (color: HighlightColor) => void

  // ---- Whisper ----

  /**
   * Whisper 상태를 업데이트합니다.
   * STTWorker 메시지 핸들러 또는 PreWarmingManager에서 호출합니다.
   *
   * @param status   새 상태
   * @param progress loading 상태일 때의 진행률 [0, 100]
   */
  setWhisperStatus: (status: WhisperStatus, progress?: number) => void

  // ---- 저장 상태 ----

  /**
   * 자동 저장 상태를 업데이트합니다.
   * AutoSaveManager에서 호출합니다.
   */
  setSaveStatus: (status: SaveStatus) => void

  // ---- Escape / deselect ----

  /**
   * Escape 키 동작: 선택 해제 + 포인터 도구로 전환.
   */
  deselect: () => void
}

// ============================================================
// 초기 상태
// ============================================================

const INITIAL_STATE: SessionState = {
  sessionId: null,
  pdfId: null,
  isRecording: false,
  isPaused: false,
  currentTime: 0,
  currentPage: 1,
  activeTagId: null,
  isTaggingMode: false,
  activeToolType: 'pointer',
  activeHighlightColor: 'yellow' as HighlightColor,
  whisperStatus: 'idle',
  whisperProgress: 0,
  saveStatus: 'saved',
}

// ============================================================
// Store 생성
// ============================================================

export const useSessionStore = create<SessionState & SessionActions>()((set, get) => ({
  ...INITIAL_STATE,

  // ---- 세션 / PDF ----

  openSession: (sessionId, pdfId) =>
    set({
      ...INITIAL_STATE,
      sessionId,
      pdfId,
      currentPage: 1,
      currentTime: 0,
    }),

  closeSession: () => set(INITIAL_STATE),

  setSessionId: (id) => set({ sessionId: id }),

  setPdfId: (id) => set({ pdfId: id }),

  // ---- 녹음 ----

  setIsRecording: (recording) =>
    set({ isRecording: recording, isPaused: recording ? get().isPaused : false }),

  setIsPaused: (paused) => set({ isPaused: paused }),

  toggleRecording: () => {
    const { isRecording } = get()
    set({ isRecording: !isRecording, isPaused: false })
  },

  // ---- 동기화 삼각형 ----

  setCurrentTime: (time) => set({ currentTime: time }),

  setCurrentPage: (page) => set({ currentPage: page }),

  setActiveTagId: (tagId) => set({ activeTagId: tagId }),

  // ---- 태깅 모드 / 도구 ----

  toggleTaggingMode: () =>
    set((state) => ({ isTaggingMode: !state.isTaggingMode })),

  setIsTaggingMode: (mode) => set({ isTaggingMode: mode }),

  setActiveTool: (tool) =>
    set({
      activeToolType: tool,
      // 태거 도구로 전환하면 태깅 모드 자동 활성화
      isTaggingMode: tool === 'tagger' ? true : get().isTaggingMode,
    }),

  setActiveHighlightColor: (color) => set({ activeHighlightColor: color }),

  // ---- Whisper ----

  setWhisperStatus: (status, progress = 0) =>
    set({ whisperStatus: status, whisperProgress: progress }),

  // ---- 저장 상태 ----

  setSaveStatus: (status) => set({ saveStatus: status }),

  // ---- Escape / deselect ----

  deselect: () =>
    set({ activeTagId: null, activeToolType: 'pointer', isTaggingMode: false }),
}))

// ============================================================
// 선택자 (파생 상태 / selector helpers)
// ============================================================

/** 세션이 활성화되어 있는지 (sessionId가 있는 경우) */
export const selectIsSessionOpen = (s: SessionState) => s.sessionId !== null

/** 녹음 중이고 일시 정지되지 않은 경우 true */
export const selectIsActiveRecording = (s: SessionState) =>
  s.isRecording && !s.isPaused
