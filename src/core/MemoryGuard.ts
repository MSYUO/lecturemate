/**
 * @file core/MemoryGuard.ts
 * LectureMate — 메모리 자동 방어 (Section 6.5)
 *
 * ## 동작
 * 10초마다 `performance.memory.usedJSHeapSize`를 확인하고
 * 임계값 초과 시 단계적 방어 조치를 취합니다.
 *
 * | 임계값   | 수준    | 조치                                                        |
 * |----------|---------|-------------------------------------------------------------|
 * | 1.5 GB   | 경고    | Fuse.js 인덱스 해제, 비활성 PDF 페이지 해제 요청            |
 * | 1.8 GB   | 긴급    | ResourceManager.emergencyCleanup() 호출                     |
 *
 * ## 레벨 전환
 * 같은 레벨이 유지되는 동안에는 조치를 반복 호출하지 않습니다.
 * 다만 긴급(`critical`) 상태가 60초 이상 지속되면 재호출합니다.
 *
 * ## performance.memory 가용성
 * Chromium 계열(Chrome, Edge)에서만 지원됩니다.
 * 미지원 환경(Firefox, Safari)에서는 조용히 no-op 처리됩니다.
 *
 * ## PDF 페이지 해제
 * `'lm:release-pdf-pages'` 커스텀 이벤트를 발행합니다.
 * PDFViewerPanel이 수신해 현재 페이지 ±2 외 렌더링을 해제합니다.
 *
 * ## 싱글톤 사용
 * ```typescript
 * // App.tsx
 * useEffect(() => {
 *   memoryGuard.start()
 *   return () => memoryGuard.stop()
 * }, [])
 * ```
 */

import { resourceManager } from '@/core/ResourceManager'
import { useSearchStore, disposeFuseIndexes } from '@/stores/searchStore'

// ============================================================
// 상수
// ============================================================

/** JS 힙 경고 임계값 (1.5 GB) */
const WARN_BYTES = 1.5 * 1_073_741_824
/** JS 힙 긴급 임계값 (1.8 GB) */
const CRIT_BYTES = 1.8 * 1_073_741_824
/** 체크 주기 (ms) */
const CHECK_INTERVAL_MS = 10_000
/** 긴급 조치 재발동 최소 간격 (ms) */
const CRIT_COOLDOWN_MS  = 60_000

// ============================================================
// 타입
// ============================================================

type MemoryLevel = 'ok' | 'warn' | 'critical'

// ============================================================
// MemoryGuard
// ============================================================

export class MemoryGuard {

  private intervalId:    ReturnType<typeof setInterval> | null = null
  private lastLevel:     MemoryLevel = 'ok'
  private lastCriticalAt = 0

  // ----------------------------------------------------------
  // 공개 API
  // ----------------------------------------------------------

  /**
   * 주기적 메모리 체크를 시작합니다.
   * 이미 실행 중이면 즉시 반환합니다.
   * App.tsx `useEffect`에서 한 번만 호출하세요.
   */
  start(): void {
    if (this.intervalId !== null) return
    this.intervalId = setInterval(() => this.check(), CHECK_INTERVAL_MS)
    console.info('[MemoryGuard] 시작 (10초 주기)')
  }

  /**
   * 주기적 체크를 중단합니다.
   * App.tsx cleanup 또는 테스트 정리 시 호출하세요.
   */
  stop(): void {
    if (this.intervalId === null) return
    clearInterval(this.intervalId)
    this.intervalId = null
    console.info('[MemoryGuard] 중단')
  }

  // ----------------------------------------------------------
  // 체크 루프
  // ----------------------------------------------------------

  private check(): void {
    const bytes = this.heapUsed()
    if (bytes === null) return   // performance.memory 미지원 → no-op

    const level = this.classify(bytes)

    if (import.meta.env.DEV) {
      console.debug(
        `[MemoryGuard] heap=${(bytes / 1_073_741_824).toFixed(2)} GB  level=${level}`,
      )
    }

    // 레벨 전환 시 or 긴급 쿨다운 만료 시 조치
    if (level === 'critical') {
      const now = Date.now()
      if (this.lastLevel !== 'critical' || now - this.lastCriticalAt >= CRIT_COOLDOWN_MS) {
        this.lastCriticalAt = now
        this.handleCritical(bytes)
      }
    } else if (level === 'warn' && this.lastLevel === 'ok') {
      this.handleWarn(bytes)
    }

    this.lastLevel = level
  }

  // ----------------------------------------------------------
  // 경고 조치 (1.5 GB)
  // ----------------------------------------------------------

  private handleWarn(bytes: number): void {
    console.warn(
      `[MemoryGuard] ⚠️ 메모리 경고 ${(bytes / 1_073_741_824).toFixed(2)} GB — ` +
      'Fuse.js 인덱스 축소, 비활성 PDF 페이지 해제',
    )

    // 1. Fuse.js 인스턴스 null 처리 (다음 검색창 열기 시 재빌드)
    disposeFuseIndexes()
    useSearchStore.getState().clearResults()

    // 2. PDF 뷰어에 비활성 페이지 해제 요청
    //    PDFViewerPanel이 'lm:release-pdf-pages' 이벤트를 수신해
    //    현재 페이지 ±2 외 렌더링을 해제합니다.
    window.dispatchEvent(new CustomEvent('lm:release-pdf-pages'))
  }

  // ----------------------------------------------------------
  // 긴급 조치 (1.8 GB)
  // ----------------------------------------------------------

  private handleCritical(bytes: number): void {
    console.error(
      `[MemoryGuard] 🚨 메모리 긴급 ${(bytes / 1_073_741_824).toFixed(2)} GB — ` +
      'ResourceManager.emergencyCleanup() 호출',
    )
    resourceManager.emergencyCleanup()
  }

  // ----------------------------------------------------------
  // 헬퍼
  // ----------------------------------------------------------

  /**
   * 현재 JS 힙 사용량(bytes)을 반환합니다.
   * `performance.memory`는 Chromium 전용 비표준 API입니다.
   * 미지원 환경에서는 `null`을 반환합니다.
   */
  private heapUsed(): number | null {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    return mem?.usedJSHeapSize ?? null
  }

  private classify(bytes: number): MemoryLevel {
    if (bytes >= CRIT_BYTES) return 'critical'
    if (bytes >= WARN_BYTES) return 'warn'
    return 'ok'
  }
}

// ============================================================
// 싱글톤
// ============================================================

/**
 * MemoryGuard 싱글톤.
 *
 * @example
 * // App.tsx
 * useEffect(() => {
 *   memoryGuard.start()
 *   return () => memoryGuard.stop()
 * }, [])
 */
export const memoryGuard = new MemoryGuard()
