/**
 * @file stores/codeStore.ts
 * LectureMate — 코드 에디터 상태 (Section 5 / Section 10)
 *
 * ## 상태
 * - editorLanguage   Monaco 에디터 언어 (Python / JavaScript / TypeScript)
 * - source           현재 편집 중인 소스 코드
 * - stdoutLines      stdout 출력 줄 배열 (최대 1000줄)
 * - stderrLines      stderr / 오류 줄 배열
 * - executionTime    마지막 실행 소요 시간 (ms)
 * - runStatus        실행 상태 ('idle' | 'running' | 'ok' | 'error' | 'timeout')
 * - pyodideStatus    Pyodide 로딩 상태
 * - pyodideProgress  Pyodide 로딩 진행률 (0-100)
 * - codeSnippets     저장된 코드 스니펫 목록 (최신순)
 */

import { create } from 'zustand'
import type { CodeSnippet } from '@/types'

// ============================================================
// 타입
// ============================================================

export type PyodideStatus = 'idle' | 'loading' | 'ready' | 'error'

export type RunStatus = 'idle' | 'running' | 'ok' | 'error' | 'timeout'

/**
 * Monaco 에디터에서 선택 가능한 언어.
 * TypeScript는 Monaco 문법 강조에만 사용되며 실행 시 JavaScript로 처리됩니다.
 */
export type EditorLanguage = 'python' | 'javascript' | 'typescript'

// ============================================================
// State & Actions
// ============================================================

interface CodeState {
  editorLanguage:  EditorLanguage
  source:          string
  stdoutLines:     string[]
  stderrLines:     string[]
  executionTime:   number | null
  runStatus:       RunStatus
  pyodideStatus:   PyodideStatus
  pyodideProgress: number
  /** 저장된 코드 스니펫 목록 (최신순) */
  codeSnippets:    CodeSnippet[]
}

interface CodeActions {
  setEditorLanguage:  (lang: EditorLanguage) => void
  setSource:          (source: string) => void
  setPyodideStatus:   (status: PyodideStatus, progress?: number) => void
  appendStdout:       (text: string) => void
  appendStderr:       (text: string) => void
  clearOutput:        () => void
  setRunStatus:       (status: RunStatus, executionTime?: number) => void
  /** 현재 소스/언어를 스니펫으로 저장합니다. */
  saveSnippet:        (meta?: { sessionId?: string; pdfId?: string; pageNumber?: number }) => void
  /** 스니펫을 에디터로 로드합니다 (source + language 복원). */
  loadSnippet:        (id: string) => void
  /** 스니펫을 삭제합니다. */
  deleteSnippet:      (id: string) => void
}

// ============================================================
// Store
// ============================================================

export const useCodeStore = create<CodeState & CodeActions>()((set, get) => ({
  editorLanguage:  'python',
  source:          '',
  stdoutLines:     [],
  stderrLines:     [],
  executionTime:   null,
  runStatus:       'idle',
  pyodideStatus:   'idle',
  pyodideProgress: 0,
  codeSnippets:    [],

  setEditorLanguage: (lang)             => set({ editorLanguage: lang }),
  setSource:         (source)           => set({ source }),
  setPyodideStatus:  (status, progress) => set((s) => ({
    pyodideStatus:   status,
    pyodideProgress: progress ?? s.pyodideProgress,
  })),
  appendStdout: (text) => set((s) => ({ stdoutLines: [...s.stdoutLines, text] })),
  appendStderr: (text) => set((s) => ({ stderrLines: [...s.stderrLines, text] })),
  clearOutput:  ()     => set({ stdoutLines: [], stderrLines: [], executionTime: null }),
  setRunStatus: (status, executionTime) => set({
    runStatus: status,
    executionTime: executionTime ?? null,
  }),

  saveSnippet: (meta = {}) => {
    const s   = get()
    const now = Date.now()
    // TypeScript는 실행 시 JavaScript로 처리되므로 'javascript'로 저장
    const lang: CodeSnippet['language'] =
      s.editorLanguage === 'python' ? 'python' : 'javascript'
    const snippet: CodeSnippet = {
      id:          crypto.randomUUID(),
      sessionId:   meta.sessionId ?? '',
      pdfId:       meta.pdfId,
      pageNumber:  meta.pageNumber,
      language:    lang,
      source:      s.source,
      executedAt:  s.runStatus === 'ok' ? now : null,
      createdAt:   now,
      updatedAt:   now,
    }
    set((prev) => ({ codeSnippets: [snippet, ...prev.codeSnippets] }))
  },

  loadSnippet: (id) => {
    const snippet = get().codeSnippets.find((sn) => sn.id === id)
    if (!snippet) return
    set({ source: snippet.source, editorLanguage: snippet.language })
  },

  deleteSnippet: (id) =>
    set((s) => ({ codeSnippets: s.codeSnippets.filter((sn) => sn.id !== id) })),
}))
