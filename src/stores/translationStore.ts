/**
 * @file stores/translationStore.ts
 * LectureMate — 번역 결과 관리 스토어
 *
 * 세션별 번역 결과를 IndexedDB에 영속하고 Zustand로 관리합니다.
 * 환경 설정(defaultTargetLang, defaultDisplayMode, autoDetectSource)은
 * localStorage에 저장합니다.
 */

import { create } from 'zustand'
import { db } from '@/db/schema'
import type { TranslationResult } from '@/types'

// ============================================================
// localStorage 헬퍼
// ============================================================

function ls(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}
function lsBool(key: string, fallback: boolean): boolean {
  const v = ls(key, '')
  return v === '' ? fallback : v === 'true'
}

const KEY_LANG         = 'lecturemate:defaultTargetLang'
const KEY_DISPLAY_MODE = 'lecturemate:defaultDisplayMode'
const KEY_AUTO_DETECT  = 'lecturemate:autoDetectSource'

// ============================================================
// 상태 / 액션 타입
// ============================================================

interface TranslationState {
  /** 현재 세션의 번역 결과 목록 */
  translations: TranslationResult[]
  /** 사용자 기본 번역 언어 */
  defaultTargetLang: string
  /** 번역 결과 기본 표시 모드 */
  defaultDisplayMode: 'overlay' | 'panel'
  /** 소스 언어 자동 감지 여부 */
  autoDetectSource: boolean
  /** DB 로드 완료 여부 */
  isLoaded: boolean
  /** 오버레이 깜빡임 대상 ID (null이면 비활성) */
  focusedTranslationId: string | null
}

interface TranslationActions {
  loadTranslations(sessionId: string): Promise<void>
  addTranslation(result: Omit<TranslationResult, 'id' | 'createdAt'>): Promise<TranslationResult>
  removeTranslation(id: string): Promise<void>
  updateTranslatedText(id: string, translatedText: string): Promise<void>
  /** 개별 카드 표시 모드 전환 */
  toggleDisplayMode(id: string, mode: 'overlay' | 'panel'): void
  /** 전체 번역 결과를 한 번에 같은 모드로 전환 + defaultDisplayMode 갱신 */
  setAllDisplayMode(mode: 'overlay' | 'panel'): void
  setDefaultTargetLang(lang: string): void
  setDefaultDisplayMode(mode: 'overlay' | 'panel'): void
  setAutoDetectSource(v: boolean): void
  setFocusedTranslationId(id: string | null): void
}

// ============================================================
// Store
// ============================================================

export const useTranslationStore = create<TranslationState & TranslationActions>()(
  (set, get) => ({
    translations:         [],
    defaultTargetLang:    ls(KEY_LANG, 'ko'),
    defaultDisplayMode:   ls(KEY_DISPLAY_MODE, 'overlay') as 'overlay' | 'panel',
    autoDetectSource:     lsBool(KEY_AUTO_DETECT, true),
    isLoaded:             false,
    focusedTranslationId: null,

    loadTranslations: async (sessionId) => {
      const results = await db.translations
        .where('sessionId').equals(sessionId).sortBy('createdAt')
      set({ translations: results, isLoaded: true })
    },

    addTranslation: async (data) => {
      const result: TranslationResult = {
        ...data,
        id:        crypto.randomUUID(),
        createdAt: Date.now(),
      }
      await db.translations.add(result)
      set((s) => ({ translations: [...s.translations, result] }))
      return result
    },

    removeTranslation: async (id) => {
      await db.translations.delete(id)
      set((s) => ({ translations: s.translations.filter((t) => t.id !== id) }))
    },

    updateTranslatedText: async (id, translatedText) => {
      await db.translations.update(id, { translatedText })
      set((s) => ({
        translations: s.translations.map((t) =>
          t.id === id ? { ...t, translatedText } : t,
        ),
      }))
    },

    toggleDisplayMode: (id, mode) => {
      void db.translations.update(id, { displayMode: mode })
      set((s) => ({
        translations: s.translations.map((t) =>
          t.id === id ? { ...t, displayMode: mode } : t,
        ),
      }))
    },

    setAllDisplayMode: (mode) => {
      lsSet(KEY_DISPLAY_MODE, mode)
      const ids = get().translations.map((t) => t.id)
      set((s) => ({
        defaultDisplayMode: mode,
        translations: s.translations.map((t) => ({ ...t, displayMode: mode })),
      }))
      ids.forEach((id) => void db.translations.update(id, { displayMode: mode }))
    },

    setDefaultTargetLang: (lang) => {
      lsSet(KEY_LANG, lang)
      set({ defaultTargetLang: lang })
    },

    setDefaultDisplayMode: (mode) => {
      lsSet(KEY_DISPLAY_MODE, mode)
      set({ defaultDisplayMode: mode })
    },

    setAutoDetectSource: (v) => {
      lsSet(KEY_AUTO_DETECT, String(v))
      set({ autoDetectSource: v })
    },

    setFocusedTranslationId: (id) => set({ focusedTranslationId: id }),
  }),
)
