/**
 * @file stores/undoRedoStore.ts
 * LectureMate — Undo/Redo 시스템 (Immer patches + Zustand)
 *
 * ## 설계 원칙
 *
 * Immer의 `produceWithPatches`로 annotationStore의 순수 데이터
 * (tags, highlights, textboxes, stickers, bookmarks, annotations)를
 * 변경하면서 forward/inverse 패치 쌍을 기록합니다.
 *
 * ### 왜 "snapshot-diff" 방식을 쓰는가?
 * annotationStore는 이미 Immer 미들웨어로 자체 뮤테이션을 처리합니다.
 * undoRedoStore가 직접 recipe를 실행하면 annotationStore의 Zustand
 * 구독자들이 업데이트를 받지 못합니다. 따라서:
 *
 *   1. `before` 스냅샷 캡처
 *   2. annotationStore의 액션 실행 (→ Zustand 구독자에게 정상 전파)
 *   3. `after` 스냅샷 캡처
 *   4. `produceWithPatches(before, draft => applySnapshot(draft, after))`로
 *      forward/inverse 패치 쌍 계산
 *   5. 패치 쌍을 `past` 스택에 push
 *
 * ### undo() / redo() 흐름
 *
 *   undo:
 *     past.pop() → inversePatches → applyPatches(currentData) → setState
 *                                                               → push to future
 *   redo:
 *     future.pop() → patches → applyPatches(currentData) → setState
 *                                                         → push to past
 *
 * ### 주의사항
 * Set(dirtyTags 등)은 `enableMapSet()`으로 지원합니다.
 * 이미 IndexedDB에 저장된 엔티티를 undo로 삭제할 경우 deletedIds에
 * 수동 추가가 필요합니다 (현재 구현은 in-memory undo에 한정).
 *
 * ## 사용법
 *
 *   // 컴포넌트에서 — undoable 뮤테이션은 undoRedoStore 래퍼를 사용
 *   import { useUndoRedoStore } from '@/stores/undoRedoStore'
 *   const { addPointTag, undo, redo, canUndo, canRedo } = useUndoRedoStore()
 *
 *   // 단축키
 *   useHotkeys('ctrl+z',       () => undo())
 *   useHotkeys('ctrl+shift+z', () => redo())
 */

import { create } from 'zustand'
import {
  enablePatches,
  enableMapSet,
  produceWithPatches,
  applyPatches,
  type Patch,
} from 'immer'
import { useAnnotationStore } from '@/stores/annotationStore'
import type { Tag, Highlight, TextBoxAnnotation, Sticker, Bookmark } from '@/types'

// Immer 플러그인 활성화 (앱 최초 import 시 한 번만 실행됨)
enablePatches()
enableMapSet()

// ============================================================
// 내부 타입
// ============================================================

/**
 * annotationStore에서 undo/redo 대상이 되는 순수 데이터 필드.
 * actions(함수)는 Immer 패치 대상에서 제외합니다.
 */
type AnnotationData = Pick<
  ReturnType<typeof useAnnotationStore.getState>,
  | 'tags'
  | 'annotations'
  | 'highlights'
  | 'textboxes'
  | 'stickers'
  | 'bookmarks'
  | 'dirtyTags'
  | 'dirtyAnnotations'
  | 'dirtyHighlights'
  | 'dirtyTextboxes'
  | 'dirtyStickers'
  | 'dirtyBookmarks'
  | 'deletedIds'
>

/**
 * 한 액션에 대한 forward + inverse 패치 쌍.
 * - patches:        redo에 사용 (앞으로 적용)
 * - inversePatches: undo에 사용 (되돌리기)
 */
interface HistoryEntry {
  /** forward patches — redo 시 `applyPatches(state, patches)` */
  patches: Patch[]
  /** inverse patches — undo 시 `applyPatches(state, inversePatches)` */
  inversePatches: Patch[]
  /** 사람이 읽을 수 있는 액션 설명 (디버깅/UI 표시용) */
  description: string
}

const MAX_HISTORY = 100

// ============================================================
// 스냅샷 유틸 (annotationStore 데이터 부분만 추출)
// ============================================================

function snapshot(): AnnotationData {
  const s = useAnnotationStore.getState()
  return {
    tags:             s.tags,
    annotations:      s.annotations,
    highlights:       s.highlights,
    textboxes:        s.textboxes,
    stickers:         s.stickers,
    bookmarks:        s.bookmarks,
    dirtyTags:        s.dirtyTags,
    dirtyAnnotations: s.dirtyAnnotations,
    dirtyHighlights:  s.dirtyHighlights,
    dirtyTextboxes:   s.dirtyTextboxes,
    dirtyStickers:    s.dirtyStickers,
    dirtyBookmarks:   s.dirtyBookmarks,
    deletedIds:       s.deletedIds,
  }
}

/** annotationStore에 AnnotationData를 병합합니다 */
function applyDataToStore(data: AnnotationData): void {
  useAnnotationStore.setState(data)
}

// ============================================================
// 상태 / 액션 타입
// ============================================================

interface UndoRedoState {
  /**
   * 실행된 액션 스택 (가장 최근 액션이 마지막 원소).
   * undo 시 마지막 원소를 pop하여 inversePatches를 적용합니다.
   * 최대 MAX_HISTORY(100) 항목 유지.
   */
  past: HistoryEntry[]
  /**
   * 취소된 액션 스택 (undo 후 future에 push).
   * redo 시 마지막 원소를 pop하여 patches를 적용합니다.
   * 새 액션이 실행되면 즉시 비워집니다.
   */
  future: HistoryEntry[]
}

interface UndoRedoActions {
  // ---- 핵심 메커니즘 ----

  /**
   * [내부용] 패치 쌍을 past에 직접 기록합니다.
   * 래퍼 함수들이 snapshot-diff 후 호출합니다.
   */
  _record: (entry: HistoryEntry) => void

  /**
   * 마지막 액션을 취소합니다 (Ctrl+Z).
   * past.pop() → inversePatches 적용 → future.push()
   */
  undo: () => void

  /**
   * 취소된 액션을 다시 실행합니다 (Ctrl+Shift+Z).
   * future.pop() → patches 적용 → past.push()
   */
  redo: () => void

  /** Undo/Redo 스택을 모두 비웁니다 (세션 닫기 시 호출) */
  clear: () => void

  // ---- Undoable 뮤테이션 래퍼 ----
  // annotationStore의 동일 액션을 래핑합니다.
  // 컴포넌트는 annotationStore 대신 이 래퍼를 호출해야 합니다.

  /** [Undoable] 점 태그 추가 (Alt+클릭) */
  addPointTag:  (params: Parameters<ReturnType<typeof useAnnotationStore.getState>['addPointTag']>[0])  => Tag
  /** [Undoable] 영역 태그 추가 (드래그) */
  addAreaTag:   (params: Parameters<ReturnType<typeof useAnnotationStore.getState>['addAreaTag']>[0])   => Tag
  /** [Undoable] 페이지 전체 태그 추가 (Ctrl+Space) */
  addPageTag:   (params: Parameters<ReturnType<typeof useAnnotationStore.getState>['addPageTag']>[0])   => Tag
  /** [Undoable] 태그 삭제 */
  deleteTag:    (tagId: string) => void

  /** [Undoable] 텍스트 상자 추가 (더블클릭) */
  addTextBox:    (params: Parameters<ReturnType<typeof useAnnotationStore.getState>['addTextBox']>[0])    => TextBoxAnnotation
  /** [Undoable] 텍스트 상자 내용·위치 수정 */
  updateTextBox: (id: string, patch: Parameters<ReturnType<typeof useAnnotationStore.getState>['updateTextBox']>[1]) => void
  /** [Undoable] 텍스트 상자 삭제 */
  deleteTextBox: (id: string) => void

  /** [Undoable] 형광펜 추가 */
  addHighlight:        (params: Parameters<ReturnType<typeof useAnnotationStore.getState>['addHighlight']>[0])        => Highlight
  /** [Undoable] 형광펜 메모 수정 */
  updateHighlightNote: (id: string, note: string) => void
  /** [Undoable] 형광펜 삭제 */
  deleteHighlight:     (id: string) => void

  /** [Undoable] 스티커 배치 */
  addSticker:    (params: Parameters<ReturnType<typeof useAnnotationStore.getState>['addSticker']>[0])    => Sticker
  /** [Undoable] 스티커 삭제 */
  deleteSticker: (id: string) => void

  /** [Undoable] 북마크 추가 */
  addBookmark:    (params: Parameters<ReturnType<typeof useAnnotationStore.getState>['addBookmark']>[0])    => Bookmark
  /** [Undoable] 북마크 삭제 */
  deleteBookmark: (id: string) => void
}

// ============================================================
// 헬퍼: snapshot-diff 래퍼 생성
// ============================================================

/**
 * annotationStore 액션을 래핑해 undo/redo 패치를 자동 기록합니다.
 *
 * 흐름:
 *   1. 액션 실행 전 스냅샷(before)
 *   2. annotationStore 액션 실행 (→ Zustand 구독자 정상 업데이트)
 *   3. 액션 실행 후 스냅샷(after)
 *   4. before→after 사이의 Immer 패치 쌍 계산
 *   5. `_record()` 호출로 past에 push
 */
function withUndo<TResult>(
  action: () => TResult,
  description: string,
): TResult {
  const before = snapshot()
  const result = action()
  const after  = snapshot()

  const [, patches, inversePatches] = produceWithPatches(
    before,
    (draft) => {
      // before → after 전환을 Immer draft에 반영해 패치를 추출합니다.
      // 각 배열/Set은 참조 교체로 처리하면 Immer가 정확한 패치를 생성합니다.
      draft.tags             = after.tags
      draft.annotations      = after.annotations
      draft.highlights       = after.highlights
      draft.textboxes        = after.textboxes
      draft.stickers         = after.stickers
      draft.bookmarks        = after.bookmarks
      draft.dirtyTags        = after.dirtyTags
      draft.dirtyAnnotations = after.dirtyAnnotations
      draft.dirtyHighlights  = after.dirtyHighlights
      draft.dirtyTextboxes   = after.dirtyTextboxes
      draft.dirtyStickers    = after.dirtyStickers
      draft.dirtyBookmarks   = after.dirtyBookmarks
      draft.deletedIds       = after.deletedIds
    },
  )

  // 실제 변경이 없으면 기록하지 않습니다 (no-op 액션)
  if (patches.length === 0) return result

  useUndoRedoStore.getState()._record({ patches, inversePatches, description })
  return result
}

// ============================================================
// Store 생성
// ============================================================

export const useUndoRedoStore = create<UndoRedoState & UndoRedoActions>()(
  (set, get) => ({
    past:   [],
    future: [],

    // ---- 핵심 메커니즘 ----

    _record: (entry) =>
      set((state) => {
        // FIFO: 최대 MAX_HISTORY 유지
        if (state.past.length >= MAX_HISTORY) {
          state.past = state.past.slice(1)
        }
        return {
          past:   [...state.past, entry],
          future: [],   // 새 액션 → redo 스택 초기화
        }
      }),

    undo: () => {
      const { past, future } = get()
      if (past.length === 0) return

      const entry       = past[past.length - 1]
      const currentData = snapshot()
      const prevData    = applyPatches(currentData, entry.inversePatches)

      applyDataToStore(prevData)

      set({
        past:   past.slice(0, -1),
        future: [...future, entry],
      })
    },

    redo: () => {
      const { past, future } = get()
      if (future.length === 0) return

      const entry       = future[future.length - 1]
      const currentData = snapshot()
      const nextData    = applyPatches(currentData, entry.patches)

      applyDataToStore(nextData)

      set({
        past:   [...past, entry],
        future: future.slice(0, -1),
      })
    },

    clear: () => set({ past: [], future: [] }),

    // ---- Undoable 뮤테이션 래퍼 ----

    addPointTag: (params) =>
      withUndo(
        () => useAnnotationStore.getState().addPointTag(params),
        '점 태그 추가',
      ),

    addAreaTag: (params) =>
      withUndo(
        () => useAnnotationStore.getState().addAreaTag(params),
        '영역 태그 추가',
      ),

    addPageTag: (params) =>
      withUndo(
        () => useAnnotationStore.getState().addPageTag(params),
        '페이지 태그 추가',
      ),

    deleteTag: (tagId) =>
      withUndo(
        () => useAnnotationStore.getState().deleteTag(tagId),
        '태그 삭제',
      ),

    addTextBox: (params) =>
      withUndo(
        () => useAnnotationStore.getState().addTextBox(params),
        '텍스트 상자 추가',
      ),

    updateTextBox: (id, patch) =>
      withUndo(
        () => useAnnotationStore.getState().updateTextBox(id, patch),
        '텍스트 상자 수정',
      ),

    deleteTextBox: (id) =>
      withUndo(
        () => useAnnotationStore.getState().deleteTextBox(id),
        '텍스트 상자 삭제',
      ),

    addHighlight: (params) =>
      withUndo(
        () => useAnnotationStore.getState().addHighlight(params),
        '형광펜 추가',
      ),

    updateHighlightNote: (id, note) =>
      withUndo(
        () => useAnnotationStore.getState().updateHighlightNote(id, note),
        '형광펜 메모 수정',
      ),

    deleteHighlight: (id) =>
      withUndo(
        () => useAnnotationStore.getState().deleteHighlight(id),
        '형광펜 삭제',
      ),

    addSticker: (params) =>
      withUndo(
        () => useAnnotationStore.getState().addSticker(params),
        '스티커 배치',
      ),

    deleteSticker: (id) =>
      withUndo(
        () => useAnnotationStore.getState().deleteSticker(id),
        '스티커 삭제',
      ),

    addBookmark: (params) =>
      withUndo(
        () => useAnnotationStore.getState().addBookmark(params),
        '북마크 추가',
      ),

    deleteBookmark: (id) =>
      withUndo(
        () => useAnnotationStore.getState().deleteBookmark(id),
        '북마크 삭제',
      ),
  }),
)

// ============================================================
// 선택자 (computed)
// ============================================================

/** undo 가능 여부 (past 스택이 비어있지 않은 경우) */
export const selectCanUndo = (s: UndoRedoState): boolean => s.past.length > 0

/** redo 가능 여부 (future 스택이 비어있지 않은 경우) */
export const selectCanRedo = (s: UndoRedoState): boolean => s.future.length > 0

/**
 * 현재 undo 스택의 최상단 액션 설명 (UI에서 "실행 취소: 태그 추가" 표시용)
 */
export const selectLastActionDescription = (s: UndoRedoState): string | null =>
  s.past.length > 0 ? s.past[s.past.length - 1].description : null

/**
 * undo/redo 모두 가능한 상태를 한 번에 구독하는 편의 선택자.
 *
 * @example
 * const { canUndo, canRedo } = useUndoRedoStore(selectUndoRedo)
 */
export const selectUndoRedo = (s: UndoRedoState & UndoRedoActions) => ({
  canUndo:  selectCanUndo(s),
  canRedo:  selectCanRedo(s),
  undo:     s.undo,
  redo:     s.redo,
})
