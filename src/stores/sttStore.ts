/**
 * @file stores/sttStore.ts
 * LectureMate — STT 세그먼트 인메모리 상태 (Zustand)
 *
 * 현재 녹음 세션의 실시간 STT 결과를 메모리에 보관합니다.
 * IndexedDB 저장은 useStt 훅이 담당하고,
 * 이 스토어는 STTStream 컴포넌트가 구독해 화면에 표시합니다.
 *
 * 싱글톤 사용:
 *   import { useSttStore } from '@/stores/sttStore'
 *   const segments = useSttStore((s) => s.segments)
 *
 *   // 비 React 컨텍스트:
 *   useSttStore.getState().addSegments(segs)
 */

import { create } from 'zustand'
import type { SttSegment } from '@/types'

// ============================================================
// 상태 타입
// ============================================================

interface SttState {
  /** 현재 세션의 STT 세그먼트 (startTime 오름차순 정렬) */
  segments: SttSegment[]
}

interface SttActions {
  /**
   * 새 세그먼트를 추가합니다.
   * startTime 기준으로 삽입 위치를 정렬합니다.
   */
  addSegments: (segs: SttSegment[]) => void
  /** 새 녹음 세션 시작 시 호출 — 이전 세그먼트를 전부 지웁니다 */
  clearSegments: () => void
}

// ============================================================
// Store 생성
// ============================================================

export const useSttStore = create<SttState & SttActions>()((set) => ({
  segments: [],

  addSegments: (segs) =>
    set((state) => ({
      segments: [...state.segments, ...segs].sort((a, b) => a.startTime - b.startTime),
    })),

  clearSegments: () => set({ segments: [] }),
}))
