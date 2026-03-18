/**
 * @file lib/overlapDeduplicator.ts
 * LectureMate — 오버랩 중복 제거 (Section 6.3)
 *
 * ## 문제
 * audio.worker.ts의 OverlappingChunker는 Whisper 문장 경계 보호를 위해
 * 이전 청크 끝 1초를 다음 청크 앞에 붙여서 전달합니다.
 * 따라서 인접 청크의 STT 결과가 겹칩니다:
 *
 * ```
 * 청크 0 결과:  "이 공식은 중간고사에"
 * 청크 1 결과:  "중간고사에 무조건 나옵니다"
 *               ▲▲▲▲▲▲▲▲▲▲▲ ← 1초 프리-오버랩 중복
 * ```
 *
 * ## 해결
 * `OverlapDeduplicator.deduplicate()`:
 * - 프리-오버랩 구간(startTime < overlapDuration)의 세그먼트를
 *   이전 청크 끝 텍스트와 레벤슈타인 유사도로 비교
 * - 80% 이상 일치 → 중복으로 간주하고 제거
 *
 * ## 순수 함수 export
 * - `levenshteinDistance(a, b)`: 편집 거리
 * - `levenshteinSimilarity(a, b)`: [0, 1] 정규화 유사도
 */

import type { SttSegment } from '@/types'

// ============================================================
// 레벤슈타인 거리 / 유사도
// ============================================================

/**
 * 두 문자열 사이의 레벤슈타인 편집 거리를 계산합니다.
 * 1D 슬라이딩 배열로 공간 O(min(m,n))을 사용합니다.
 */
export function levenshteinDistance(a: string, b: string): number {
  // 짧은 문자열을 행으로 사용해 메모리 최소화
  if (a.length < b.length) [a, b] = [b, a]

  const m = a.length
  const n = b.length
  if (n === 0) return m
  if (m === 0) return n

  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array<number>(n + 1)

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1,          // 삽입
        prev[j]     + 1,          // 삭제
        prev[j - 1] + cost,       // 교체
      )
    }
    // 버퍼 스왑 (할당 없이 참조만 교체)
    const tmp = prev
    prev = curr
    curr = tmp
  }

  return prev[n]
}

/**
 * 두 문자열의 레벤슈타인 유사도를 [0, 1] 범위로 반환합니다.
 * 1.0 = 완전 일치, 0.0 = 완전 불일치.
 *
 * @example
 * levenshteinSimilarity('중간고사에', '중간고사에')  // 1.0
 * levenshteinSimilarity('중간고사에', '기말고사에')  // ≈ 0.6
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshteinDistance(a, b) / maxLen
}

// ============================================================
// OverlapDeduplicator
// ============================================================

/** 레벤슈타인 유사도가 이 값 이상이면 중복으로 판정 */
const DUPLICATE_THRESHOLD = 0.8
/** 비교에 사용할 텍스트 창 크기 (글자 수) */
const WINDOW_SIZE = 30

/**
 * 연속된 청크 간 오버랩 구간의 중복 세그먼트를 제거합니다.
 *
 * 인스턴스는 하나의 녹음 세션 동안 재사용합니다.
 * 새 세션 시작 시 `reset()`을 호출하세요.
 *
 * ## 사용 예시 (stt.worker.ts)
 * ```typescript
 * const dedup = new OverlapDeduplicator()
 *
 * // 청크마다
 * const cleaned = dedup.deduplicate(rawSegments, OVERLAP_DURATION)
 * ```
 */
export class OverlapDeduplicator {
  /** 이전 청크 결과의 마지막 텍스트 (비교 기준) */
  private previousEndText = ''

  /**
   * 현재 청크의 세그먼트에서 오버랩 중복을 제거합니다.
   *
   * @param segments        Whisper가 반환한 세그먼트 배열 (청크 상대 startTime)
   * @param overlapDuration 프리-오버랩 구간 길이 (초). 청크 0이면 0을 전달
   * @returns 중복 제거된 세그먼트 배열
   */
  deduplicate(segments: SttSegment[], overlapDuration: number): SttSegment[] {
    if (segments.length === 0) return segments

    // 첫 청크 또는 오버랩이 없는 경우: 중복 제거 없이 통과
    if (!this.previousEndText || overlapDuration <= 0) {
      this._updatePreviousEnd(segments)
      return segments
    }

    // 오버랩 구간(startTime < overlapDuration) 세그먼트 중 중복 제거
    const deduped = segments.filter((seg) => {
      if (seg.startTime >= overlapDuration) return true  // 오버랩 밖: 항상 유지
      return !this._isDuplicate(seg.text)                // 오버랩 안: 중복 여부 확인
    })

    this._updatePreviousEnd(segments)
    return deduped
  }

  /** 세션 초기화 (새 녹음 시작 시 호출) */
  reset(): void {
    this.previousEndText = ''
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  /**
   * 텍스트가 이전 청크 끝과 중복인지 판정합니다.
   * `previousEndText`의 마지막 WINDOW_SIZE 글자와
   * `text`의 앞 WINDOW_SIZE 글자를 비교합니다.
   */
  private _isDuplicate(text: string): boolean {
    const prev = this.previousEndText.slice(-WINDOW_SIZE)
    const curr = text.slice(0, WINDOW_SIZE)
    return levenshteinSimilarity(prev, curr) > DUPLICATE_THRESHOLD
  }

  /** 다음 청크 비교를 위해 현재 청크의 끝 텍스트를 저장합니다 */
  private _updatePreviousEnd(segments: SttSegment[]): void {
    const allText = segments.map((s) => s.text).join(' ')
    this.previousEndText = allText.slice(-WINDOW_SIZE * 2)
  }
}
