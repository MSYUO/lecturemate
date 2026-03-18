/**
 * @file lib/timeSync.ts
 * LectureMate — 시간↔태그↔페이지 동기화 유틸리티 (Section 7 / 삼각형 동기화)
 *
 * ## 역할
 * 1. **순수 함수** — 태그 배열을 시간/페이지로 필터링
 * 2. **seekToTag** — 태그의 timestampStart + pageNumber로 스토어 이동
 * 3. **useTimeSync** — `currentTime` 변경 시 `activeTagId` 자동 갱신 훅
 *
 * ## 연동 구조
 * ```
 * WaveSurfer / useRecording
 *   └→ sessionStore.setCurrentTime(t)
 *         └→ useTimeSync (useEffect)
 *               └→ findTagsAtTime(t, tags) → setActiveTagId
 *
 * 태그 클릭 / TagTimeline / BookmarkList
 *   └→ seekToTag(tag)
 *         └→ setCurrentTime → AudioWaveform seek
 *         └→ setCurrentPage → react-pdf 페이지 이동
 *         └→ setActiveTagId → 태그 하이라이트
 * ```
 *
 * ## 점 태그 시간 창
 * 점 태그(`type === 'point'`)는 종료 시각이 없으므로
 * POINT_TAG_WINDOW_SEC(±2초) 이내이면 "현재 시간에 걸친" 태그로 간주합니다.
 */

import { useEffect } from 'react'
import { useSessionStore } from '@/stores/sessionStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import type { Tag } from '@/types'

// ============================================================
// 상수
// ============================================================

/** 점 태그 매칭에 사용할 단방향 허용 오차 (초) */
const POINT_TAG_WINDOW_SEC = 2

// ============================================================
// 순수 유틸리티 함수
// ============================================================

/**
 * 주어진 재생 시각(초)에 "걸치는" 태그를 반환합니다.
 *
 * - area / page 태그: `timestampStart <= time <= timestampEnd`
 * - point 태그:       `|timestampStart - time| <= POINT_TAG_WINDOW_SEC(2s)`
 *
 * 반환 목록은 timestampStart 오름차순으로 정렬됩니다.
 */
export function findTagsAtTime(time: number, tags: Tag[]): Tag[] {
  return tags
    .filter((tag) => {
      if (tag.type === 'point') {
        return Math.abs(tag.timestampStart - time) <= POINT_TAG_WINDOW_SEC
      }
      // area / page: end가 없으면 시작점과 동일(순간 태그)로 처리
      const end = tag.timestampEnd ?? tag.timestampStart
      return time >= tag.timestampStart && time <= end
    })
    .sort((a, b) => a.timestampStart - b.timestampStart)
}

/**
 * 특정 PDF 페이지에 속하는 태그를 반환합니다.
 *
 * 반환 목록은 timestampStart 오름차순으로 정렬됩니다.
 */
export function findTagsOnPage(page: number, tags: Tag[]): Tag[] {
  return tags
    .filter((tag) => tag.pageNumber === page)
    .sort((a, b) => a.timestampStart - b.timestampStart)
}

// ============================================================
// seekToTag — 임페러티브 함수
// ============================================================

/**
 * 태그의 위치로 오디오 재생 시각과 PDF 페이지를 동시에 이동합니다.
 *
 * 호출 순서:
 *   1. `setCurrentTime(tag.timestampStart)` → AudioWaveform.tsx의 useEffect가 WaveSurfer seek 수행
 *   2. `setCurrentPage(tag.pageNumber)` → PDFViewerPanel 페이지 이동
 *   3. `setActiveTagId(tag.id)` → 태그 하이라이트
 *
 * 컴포넌트 바깥(이벤트 핸들러 등)에서 직접 호출 가능합니다.
 */
export function seekToTag(tag: Tag): void {
  const store = useSessionStore.getState()
  store.setCurrentTime(tag.timestampStart)
  store.setCurrentPage(tag.pageNumber)
  store.setActiveTagId(tag.id)
}

// ============================================================
// useTimeSync — React 훅
// ============================================================

/**
 * `currentTime`이 변경될 때마다 `findTagsAtTime`을 실행해
 * 가장 앞에 오는 태그를 `activeTagId`로 자동 설정합니다.
 *
 * 태그가 없는 구간에서는 `activeTagId`를 null로 초기화합니다.
 * 단, `activeTagId`가 이미 seekToTag에 의해 명시적으로 설정된 경우에는
 * currentTime이 해당 태그를 벗어날 때까지 유지됩니다.
 *
 * **사용법**: App.tsx 또는 최상위 레이아웃 컴포넌트에서 한 번만 호출하세요.
 *
 * ```tsx
 * // App.tsx
 * useTimeSync()
 * ```
 */
export function useTimeSync(): void {
  const currentTime = useSessionStore((s) => s.currentTime)

  useEffect(() => {
    const tags     = useAnnotationStore.getState().tags
    const matching = findTagsAtTime(currentTime, tags)

    // 현재 activeTagId가 여전히 matching에 포함되면 유지 (깜빡임 방지)
    const currentActive = useSessionStore.getState().activeTagId
    if (currentActive !== null && matching.some((t) => t.id === currentActive)) {
      return
    }

    // 매칭된 태그 중 가장 앞의 것(또는 null)으로 activeTagId 갱신
    useSessionStore.getState().setActiveTagId(matching[0]?.id ?? null)
  }, [currentTime])
}
