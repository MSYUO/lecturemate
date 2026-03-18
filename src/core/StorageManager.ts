/**
 * @file core/StorageManager.ts
 * LectureMate — OPFS 용량 관리 (Section 4.4)
 *
 * ## 역할
 * 1. **checkAndWarn()**: 저장 사용률을 조회해 `storageStore`를 업데이트합니다.
 *    - ≥ 70%: warn 레벨 (StorageUsageBar가 주황으로 변함)
 *    - ≥ 85%: danger 레벨 (StorageUsageBar가 빨강 + "정리 제안" 버튼 표시)
 *
 * 2. **smartCleanup(olderThanDays)**: STT 변환이 완료된 오래된 세션의
 *    오디오 원본만 삭제합니다. 태그·STT·필기 메타데이터는 보존됩니다.
 *    삭제 후 세션에 `audioDeleted: true` 플래그를 씁니다.
 *
 * ## 스마트 정리 조건
 * 다음 조건을 모두 만족하는 세션만 삭제합니다.
 * 1. `createdAt` < 현재 시각 − `olderThanDays` × 86400초
 * 2. `audioDeleted !== true` (아직 삭제 안 된 세션)
 * 3. pending/active 상태의 Job이 없음 (STT 완료)
 * 4. sttSegments가 1개 이상 존재 (실제로 변환이 실행됨)
 *
 * ## 싱글톤 사용
 * ```typescript
 * import { storageManager } from '@/core/StorageManager'
 *
 * // 30초마다 체크
 * await storageManager.checkAndWarn()
 *
 * // 정리 버튼 클릭 시
 * const freedBytes = await storageManager.smartCleanup(30)
 * ```
 */

import { opfs } from '@/core/OPFSStorage'
import { db } from '@/db/schema'
import { useStorageStore } from '@/stores/storageStore'

// ============================================================
// 상수
// ============================================================

const WARN_RATIO   = 0.70
const DANGER_RATIO = 0.85

// ============================================================
// StorageManager
// ============================================================

export class StorageManager {

  // ----------------------------------------------------------
  // checkAndWarn — 용량 체크 + storageStore 업데이트
  // ----------------------------------------------------------

  /**
   * OPFS 저장 사용량을 조회하고 `storageStore`를 업데이트합니다.
   *
   * StorageUsageBar가 30초마다 호출합니다.
   * 결과적으로:
   * - `level: 'warn'`   (≥ 70%) → StorageUsageBar 주황 + 경고 텍스트
   * - `level: 'danger'` (≥ 85%) → StorageUsageBar 빨강 + "정리 제안" 버튼
   */
  async checkAndWarn(): Promise<void> {
    try {
      const { usage, quota } = await opfs.getStorageEstimate()
      useStorageStore.getState()._setEstimate(usage, quota)

      const ratio = quota > 0 ? usage / quota : 0

      if (ratio >= DANGER_RATIO) {
        console.warn(
          `[StorageManager] ⚠️ 저장 공간 위험 ${(ratio * 100).toFixed(1)}% — ` +
          '스마트 정리를 권장합니다.',
        )
      } else if (ratio >= WARN_RATIO) {
        console.info(
          `[StorageManager] 저장 공간 경고 ${(ratio * 100).toFixed(1)}%`,
        )
      }
    } catch (err) {
      console.error('[StorageManager] 용량 조회 실패:', err)
    }
  }

  // ----------------------------------------------------------
  // smartCleanup — STT 완료 오래된 세션 오디오 삭제
  // ----------------------------------------------------------

  /**
   * STT 변환이 완료된 오래된 세션의 오디오 원본만 삭제합니다.
   * 태그·STT 세그먼트·필기 등 메타데이터는 보존됩니다.
   *
   * @param olderThanDays 기준일 (기본값: 30일). 이보다 오래된 세션을 대상으로 합니다.
   * @returns 회수된 바이트 수
   */
  async smartCleanup(olderThanDays = 30): Promise<number> {
    useStorageStore.getState()._setCleaningUp(true)

    let freedBytes = 0

    try {
      const cutoff   = Date.now() - olderThanDays * 86_400_000
      const sessions = await db.sessions.where('createdAt').below(cutoff).toArray()

      for (const session of sessions) {
        // 이미 정리된 세션 건너뜀
        if (session.audioDeleted) continue

        // 진행 중인 작업이 남아 있으면 건너뜀 (STT 미완료)
        const incompleteCount = await db.pendingJobs
          .where('sessionId').equals(session.id)
          .filter((j) => j.status === 'pending' || j.status === 'active')
          .count()
        if (incompleteCount > 0) continue

        // STT 변환 결과가 하나도 없으면 건너뜀 (STT 미실행)
        const sttCount = await db.sttSegments
          .where('sessionId').equals(session.id)
          .count()
        if (sttCount === 0) continue

        // 삭제할 오디오 크기 집계
        const { totalBytes } = await opfs.getSessionAudioSize(session.id)

        // OPFS에서 오디오 청크 디렉토리 삭제
        await opfs.deleteSessionAudio(session.id)

        // IndexedDB 세션 레코드에 삭제 플래그 기록
        await db.sessions.update(session.id, { audioDeleted: true })

        freedBytes += totalBytes
        console.info(
          `[StorageManager] 세션 ${session.id.slice(0, 6)} 오디오 삭제 ` +
          `(${this.formatBytes(totalBytes)})`,
        )
      }

      console.info(
        `[StorageManager] 스마트 정리 완료 — 총 ${this.formatBytes(freedBytes)} 회수`,
      )

      // 정리 후 사용량 재조회
      await this.checkAndWarn()

    } catch (err) {
      console.error('[StorageManager] 스마트 정리 실패:', err)
    } finally {
      useStorageStore.getState()._setCleaningUp(false)
    }

    return freedBytes
  }

  // ----------------------------------------------------------
  // 헬퍼
  // ----------------------------------------------------------

  private formatBytes(bytes: number): string {
    if (bytes < 1024)                return `${bytes} B`
    if (bytes < 1_048_576)           return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1_073_741_824)       return `${(bytes / 1_048_576).toFixed(1)} MB`
    return `${(bytes / 1_073_741_824).toFixed(2)} GB`
  }
}

// ============================================================
// 싱글톤
// ============================================================

/**
 * StorageManager 싱글톤.
 *
 * @example
 * // StorageUsageBar — 30초 폴링
 * await storageManager.checkAndWarn()
 *
 * // 정리 버튼 클릭 시
 * await storageManager.smartCleanup(30)
 */
export const storageManager = new StorageManager()
