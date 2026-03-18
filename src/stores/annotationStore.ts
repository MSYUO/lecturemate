/**
 * @file stores/annotationStore.ts
 * LectureMate — 어노테이션 전역 상태 (Zustand + Immer)
 *
 * 태그, 어노테이션, 형광펜, 텍스트 상자, 스티커, 북마크를 통합 관리합니다.
 * Immer 미들웨어로 불변성을 보장하고, dirtyEntities로 변경된 항목만 추적해
 * AutoSaveManager가 최소한의 IndexedDB 쓰기만 수행할 수 있게 합니다.
 *
 * 사용:
 *   import { useAnnotationStore } from '@/stores/annotationStore'
 *   const { tags, addPointTag } = useAnnotationStore()
 *
 *   // 비 React 컨텍스트 (AutoSaveManager):
 *   const state = useAnnotationStore.getState()
 *   await db.tags.bulkPut(state.dirtyTags)
 *   useAnnotationStore.getState().clearDirty()
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  Tag,
  Annotation,
  Highlight,
  TextBoxAnnotation,
  Sticker,
  Bookmark,
  BoundingBox,
  Point,
  HighlightColor,
  StickerType,
} from '@/types'

// ============================================================
// 내부 유틸
// ============================================================

/** 중복 없는 ID Set에 추가하는 헬퍼 */
function markDirty(set: Set<string>, id: string): void {
  set.add(id)
}

/** crypto.randomUUID() 래퍼 (테스트 환경 대비) */
function newId(): string {
  return crypto.randomUUID()
}

// ============================================================
// 상태 타입
// ============================================================

interface AnnotationState {
  // ---- 엔티티 목록 ----

  /** 시간↔공간 태그 전체 (현재 세션) */
  tags: Tag[]
  /** 일반 텍스트 어노테이션 전체 */
  annotations: Annotation[]
  /** 형광펜 하이라이트 전체 */
  highlights: Highlight[]
  /** 텍스트 상자 (수식 포함) 전체 */
  textboxes: TextBoxAnnotation[]
  /** 스티커 전체 */
  stickers: Sticker[]
  /** 페이지 북마크 전체 */
  bookmarks: Bookmark[]

  // ---- 더티 엔티티 추적 (자동 저장용) ----

  /**
   * 마지막 저장 이후 추가·수정·삭제된 엔티티의 ID 집합.
   * AutoSaveManager는 이 집합을 읽어 변경된 항목만 IndexedDB에 upsert합니다.
   * 저장 완료 후 `clearDirty()`로 초기화합니다.
   *
   * 삭제된 항목은 deletedIds에 별도 추적됩니다 (bulkDelete 용).
   */
  dirtyTags: Set<string>
  dirtyAnnotations: Set<string>
  dirtyHighlights: Set<string>
  dirtyTextboxes: Set<string>
  dirtyStickers: Set<string>
  dirtyBookmarks: Set<string>

  /**
   * 삭제된 엔티티 ID (테이블별).
   * AutoSaveManager에서 `db.[table].bulkDelete(ids)` 에 사용됩니다.
   */
  deletedIds: {
    tags: Set<string>
    annotations: Set<string>
    highlights: Set<string>
    textboxes: Set<string>
    stickers: Set<string>
    bookmarks: Set<string>
  }
}

interface AnnotationActions {
  // ---- 세션 로드 / 초기화 ----

  /**
   * DB에서 읽어온 세션 전체 데이터를 스토어에 일괄 로드합니다.
   * 세션 열기 직후 한 번만 호출합니다.
   */
  loadSession: (data: {
    tags?: Tag[]
    annotations?: Annotation[]
    highlights?: Highlight[]
    textboxes?: TextBoxAnnotation[]
    stickers?: Sticker[]
    bookmarks?: Bookmark[]
  }) => void

  /** 스토어를 초기 상태로 리셋합니다 (세션 닫기) */
  resetAll: () => void

  // ---- 태그 (Tag) ----

  /**
   * 점 태그 추가 (Alt+클릭).
   * coordinates.width/height = 0, type = 'point'
   */
  addPointTag: (params: {
    sessionId: string
    pdfId: string
    pageNumber: number
    position: Point
    timestampStart: number
    label?: string
  }) => Tag

  /**
   * 영역 태그 추가 (마우스 드래그).
   * type = 'area'
   */
  addAreaTag: (params: {
    sessionId: string
    pdfId: string
    pageNumber: number
    coordinates: BoundingBox
    timestampStart: number
    timestampEnd?: number
    label?: string
  }) => Tag

  /**
   * 페이지 전체 태그 추가 (Ctrl+Space).
   * coordinates = { x:0, y:0, width:1, height:1 }, type = 'page'
   */
  addPageTag: (params: {
    sessionId: string
    pdfId: string
    pageNumber: number
    timestampStart: number
    timestampEnd?: number
    label?: string
  }) => Tag

  /** 태그 삭제 */
  deleteTag: (tagId: string) => void

  // ---- 텍스트 상자 (TextBoxAnnotation) ----

  /**
   * 텍스트 상자 추가 (더블클릭으로 생성).
   * 기본값: isMathMode=false, content=''
   */
  addTextBox: (params: {
    sessionId: string
    pdfId: string
    pageNumber: number
    coordinates: BoundingBox
    linkedTagId?: string
  }) => TextBoxAnnotation

  /**
   * 텍스트 상자 내용/위치/수식 상태를 업데이트합니다.
   * 변경된 필드만 전달하면 됩니다 (Partial).
   */
  updateTextBox: (
    id: string,
    patch: Partial<
      Pick<
        TextBoxAnnotation,
        'content' | 'mathLatex' | 'isMathMode' | 'coordinates'
      >
    >,
  ) => void

  /** 텍스트 상자 삭제 */
  deleteTextBox: (id: string) => void

  // ---- 형광펜 (Highlight) ----

  /**
   * 형광펜 하이라이트 추가.
   * 멀티라인 선택 시 rects 배열에 줄별 BoundingBox를 모두 전달합니다.
   */
  addHighlight: (params: {
    sessionId: string
    pdfId: string
    pageNumber: number
    color: HighlightColor
    rects: BoundingBox[]
    linkedTagId?: string
    note?: string
  }) => Highlight

  /** 형광펜 메모 업데이트 */
  updateHighlightNote: (id: string, note: string) => void

  /** 형광펜 삭제 */
  deleteHighlight: (id: string) => void

  // ---- 스티커 (Sticker) ----

  /** 스티커 배치 (클릭으로 PDF 위 배치) */
  addSticker: (params: {
    sessionId: string
    pdfId: string
    pageNumber: number
    type: StickerType
    coordinates: Point
    label?: string
  }) => Sticker

  /** 스티커 삭제 */
  deleteSticker: (id: string) => void

  // ---- 북마크 (Bookmark) ----

  /** 페이지 북마크 추가 (Ctrl+B) */
  addBookmark: (params: {
    sessionId: string
    pdfId: string
    pageNumber: number
    title: string
    color?: string
  }) => Bookmark

  /** 북마크 삭제 */
  deleteBookmark: (id: string) => void

  // ---- 더티 관리 ----

  /**
   * 저장 완료 후 호출합니다.
   * 모든 dirty Set과 deletedIds를 비웁니다.
   */
  clearDirty: () => void
}

// ============================================================
// 초기 상태
// ============================================================

const emptyDirty = () => ({
  dirtyTags: new Set<string>(),
  dirtyAnnotations: new Set<string>(),
  dirtyHighlights: new Set<string>(),
  dirtyTextboxes: new Set<string>(),
  dirtyStickers: new Set<string>(),
  dirtyBookmarks: new Set<string>(),
  deletedIds: {
    tags: new Set<string>(),
    annotations: new Set<string>(),
    highlights: new Set<string>(),
    textboxes: new Set<string>(),
    stickers: new Set<string>(),
    bookmarks: new Set<string>(),
  },
})

const INITIAL_STATE: AnnotationState = {
  tags: [],
  annotations: [],
  highlights: [],
  textboxes: [],
  stickers: [],
  bookmarks: [],
  ...emptyDirty(),
}

// ============================================================
// Store 생성 (Immer 미들웨어 적용)
// ============================================================

export const useAnnotationStore = create<AnnotationState & AnnotationActions>()(
  immer((set, _get) => ({
    ...INITIAL_STATE,

    // ---- 세션 로드 / 초기화 ----

    loadSession: (data) =>
      set((state) => {
        if (data.tags)        state.tags        = data.tags
        if (data.annotations) state.annotations = data.annotations
        if (data.highlights)  state.highlights  = data.highlights
        if (data.textboxes)   state.textboxes   = data.textboxes
        if (data.stickers)    state.stickers    = data.stickers
        if (data.bookmarks)   state.bookmarks   = data.bookmarks
        // 로드 직후는 더티 없음
        Object.assign(state, emptyDirty())
      }),

    resetAll: () => set(() => ({ ...INITIAL_STATE, ...emptyDirty() })),

    // ---- 태그 ----

    addPointTag: (params) => {
      const tag: Tag = {
        id: newId(),
        type: 'point',
        coordinates: { x: params.position.x, y: params.position.y, width: 0, height: 0 },
        autoTagged: false,
        createdAt: Date.now(),
        timestampEnd: undefined,
        ...params,
      }
      set((state) => {
        state.tags.push(tag)
        markDirty(state.dirtyTags, tag.id)
      })
      return tag
    },

    addAreaTag: (params) => {
      const tag: Tag = {
        id: newId(),
        type: 'area',
        autoTagged: false,
        createdAt: Date.now(),
        ...params,
      }
      set((state) => {
        state.tags.push(tag)
        markDirty(state.dirtyTags, tag.id)
      })
      return tag
    },

    addPageTag: (params) => {
      const tag: Tag = {
        id: newId(),
        type: 'page',
        coordinates: { x: 0, y: 0, width: 1, height: 1 },
        autoTagged: false,
        createdAt: Date.now(),
        ...params,
      }
      set((state) => {
        state.tags.push(tag)
        markDirty(state.dirtyTags, tag.id)
      })
      return tag
    },

    deleteTag: (tagId) =>
      set((state) => {
        state.tags = state.tags.filter((t) => t.id !== tagId)
        state.dirtyTags.delete(tagId)
        state.deletedIds.tags.add(tagId)
      }),

    // ---- 텍스트 상자 ----

    addTextBox: (params) => {
      const textbox: TextBoxAnnotation = {
        id: newId(),
        content: '',
        isMathMode: false,
        mathLatex: undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...params,
      }
      set((state) => {
        state.textboxes.push(textbox)
        markDirty(state.dirtyTextboxes, textbox.id)
      })
      return textbox
    },

    updateTextBox: (id, patch) =>
      set((state) => {
        const tb = state.textboxes.find((t) => t.id === id)
        if (!tb) return
        Object.assign(tb, patch, { updatedAt: Date.now() })
        markDirty(state.dirtyTextboxes, id)
      }),

    deleteTextBox: (id) =>
      set((state) => {
        state.textboxes = state.textboxes.filter((t) => t.id !== id)
        state.dirtyTextboxes.delete(id)
        state.deletedIds.textboxes.add(id)
      }),

    // ---- 형광펜 ----

    addHighlight: (params) => {
      const highlight: Highlight = {
        id: newId(),
        createdAt: Date.now(),
        ...params,
      }
      set((state) => {
        state.highlights.push(highlight)
        markDirty(state.dirtyHighlights, highlight.id)
      })
      return highlight
    },

    updateHighlightNote: (id, note) =>
      set((state) => {
        const hl = state.highlights.find((h) => h.id === id)
        if (!hl) return
        hl.note = note
        markDirty(state.dirtyHighlights, id)
      }),

    deleteHighlight: (id) =>
      set((state) => {
        state.highlights = state.highlights.filter((h) => h.id !== id)
        state.dirtyHighlights.delete(id)
        state.deletedIds.highlights.add(id)
      }),

    // ---- 스티커 ----

    addSticker: (params) => {
      const sticker: Sticker = {
        id: newId(),
        createdAt: Date.now(),
        ...params,
      }
      set((state) => {
        state.stickers.push(sticker)
        markDirty(state.dirtyStickers, sticker.id)
      })
      return sticker
    },

    deleteSticker: (id) =>
      set((state) => {
        state.stickers = state.stickers.filter((s) => s.id !== id)
        state.dirtyStickers.delete(id)
        state.deletedIds.stickers.add(id)
      }),

    // ---- 북마크 ----

    addBookmark: (params) => {
      const bookmark: Bookmark = {
        id: newId(),
        createdAt: Date.now(),
        ...params,
      }
      set((state) => {
        state.bookmarks.push(bookmark)
        markDirty(state.dirtyBookmarks, bookmark.id)
      })
      return bookmark
    },

    deleteBookmark: (id) =>
      set((state) => {
        state.bookmarks = state.bookmarks.filter((b) => b.id !== id)
        state.dirtyBookmarks.delete(id)
        state.deletedIds.bookmarks.add(id)
      }),

    // ---- 더티 초기화 ----

    clearDirty: () =>
      set((state) => {
        Object.assign(state, emptyDirty())
      }),
  })),
)

// ============================================================
// 선택자 (selector helpers)
// ============================================================

/** 특정 페이지의 태그만 반환 */
export const selectTagsByPage = (pageNumber: number) => (s: AnnotationState) =>
  s.tags.filter((t) => t.pageNumber === pageNumber)

/** 특정 페이지의 형광펜만 반환 */
export const selectHighlightsByPage = (pageNumber: number) => (s: AnnotationState) =>
  s.highlights.filter((h) => h.pageNumber === pageNumber)

/** 특정 페이지의 텍스트 상자만 반환 */
export const selectTextboxesByPage = (pageNumber: number) => (s: AnnotationState) =>
  s.textboxes.filter((tb) => tb.pageNumber === pageNumber)

/** 특정 페이지의 스티커만 반환 */
export const selectStickersByPage = (pageNumber: number) => (s: AnnotationState) =>
  s.stickers.filter((s) => s.pageNumber === pageNumber)

/** 더티 엔티티가 하나라도 있으면 true (AutoSaveManager 트리거 판단용) */
export const selectHasDirty = (s: AnnotationState) =>
  s.dirtyTags.size > 0 ||
  s.dirtyAnnotations.size > 0 ||
  s.dirtyHighlights.size > 0 ||
  s.dirtyTextboxes.size > 0 ||
  s.dirtyStickers.size > 0 ||
  s.dirtyBookmarks.size > 0
