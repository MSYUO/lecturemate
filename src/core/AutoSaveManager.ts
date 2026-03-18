/**
 * @file core/AutoSaveManager.ts
 * LectureMate — 자동 저장 관리자
 *
 * ## 저장 파이프라인 (WAL 패턴)
 *
 *   markDirty()
 *     └→ setSaveStatus('pending')
 *     └→ 디바운스 타이머 재설정 (3초)
 *           └→ [3초 경과, 추가 변경 없음]
 *                 └→ save()
 *                       ├─ 1. WAL intent 기록 (status: 'pending')
 *                       ├─ 2. Dexie 트랜잭션: bulkPut(dirty) + bulkDelete(deleted)
 *                       ├─ 3. WAL commit (status: 'committed')
 *                       ├─ 4. annotationStore.clearDirty()
 *                       └─ 5. setSaveStatus('saved')
 *
 * ## 크래시 복구
 *   앱 재시작 시 CrashRecoveryManager가 WAL에서 status='pending' 항목을
 *   탐색해 재처리합니다. (CrashRecoveryManager 구현 참조)
 *
 * ## 재시도 정책
 *   저장 실패 시 setSaveStatus('error') + 5초 후 자동 재시도.
 *   재시도 중 markDirty()가 호출되면 기존 재시도 타이머는 취소됩니다.
 *
 * ## 싱글톤 사용
 *   import { autoSave } from '@/core/AutoSaveManager'
 *   autoSave.markDirty()
 */

import { db } from '@/db/schema'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useSessionStore } from '@/stores/sessionStore'

// ============================================================
// 상수
// ============================================================

const DEBOUNCE_MS = 3_000    // 마지막 변경 후 3초 대기
const RETRY_MS   = 5_000    // 저장 실패 후 5초 재시도
const WAL_OP     = 'autosave'

// ============================================================
// AutoSaveManager
// ============================================================

export class AutoSaveManager {
  /** 마지막 저장 이후 미저장 변경이 존재하는지 여부 */
  private isDirty = false

  /** 디바운스 타이머 핸들 */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  /** 재시도 타이머 핸들 */
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  /** 현재 save() 실행 중 여부 (중복 실행 방지) */
  private isSaving = false

  // ----------------------------------------------------------
  // 공개 API
  // ----------------------------------------------------------

  /**
   * 변경 감지 신호를 보냅니다.
   * annotationStore 구독자(useAutoSave hook)가 변경을 감지하면 호출합니다.
   *
   * 3초 디바운스를 적용하여 연속 변경 시 마지막 변경으로부터 3초 뒤 저장합니다.
   */
  markDirty(): void {
    this.isDirty = true

    useSessionStore.getState().setSaveStatus('pending')

    // 기존 재시도 타이머 취소 (새 변경이 생겼으니 재시도 불필요)
    this.clearRetryTimer()

    // 디바운스 재설정
    this.clearDebounceTimer()
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.save()
    }, DEBOUNCE_MS)
  }

  /**
   * 즉시 저장을 강제합니다 (Ctrl+S 수동 저장).
   * 디바운스를 무시하고 바로 save()를 실행합니다.
   */
  async flush(): Promise<void> {
    this.clearDebounceTimer()
    this.clearRetryTimer()
    await this.save()
  }

  /**
   * 타이머를 모두 정리합니다 (세션 닫기 / 앱 종료 시 호출).
   * 미저장 변경이 있으면 마지막으로 save()를 실행합니다.
   */
  async dispose(): Promise<void> {
    this.clearDebounceTimer()
    this.clearRetryTimer()
    if (this.isDirty) {
      await this.save()
    }
  }

  // ----------------------------------------------------------
  // 저장 로직
  // ----------------------------------------------------------

  /**
   * WAL 패턴으로 annotationStore의 dirty 엔티티를 IndexedDB에 커밋합니다.
   *
   * @internal
   */
  private async save(): Promise<void> {
    if (!this.isDirty)  return
    if (this.isSaving)  return   // 중복 실행 방지

    this.isSaving = true
    let walId: string | null = null

    try {
      // ── 1. WAL intent 기록 ─────────────────────────────────
      walId = await this.writeWalIntent()

      // ── 2. 저장할 데이터 수집 ─────────────────────────────
      const state = useAnnotationStore.getState()

      const toSave = {
        tags:        state.tags.filter(e        => state.dirtyTags.has(e.id)),
        annotations: state.annotations.filter(e => state.dirtyAnnotations.has(e.id)),
        highlights:  state.highlights.filter(e  => state.dirtyHighlights.has(e.id)),
        textboxes:   state.textboxes.filter(e   => state.dirtyTextboxes.has(e.id)),
        stickers:    state.stickers.filter(e    => state.dirtyStickers.has(e.id)),
        bookmarks:   state.bookmarks.filter(e   => state.dirtyBookmarks.has(e.id)),
      }

      const toDelete = {
        tags:        [...state.deletedIds.tags],
        annotations: [...state.deletedIds.annotations],
        highlights:  [...state.deletedIds.highlights],
        textboxes:   [...state.deletedIds.textboxes],
        stickers:    [...state.deletedIds.stickers],
        bookmarks:   [...state.deletedIds.bookmarks],
      }

      // 실제로 변경된 항목이 하나도 없으면 조용히 종료
      const hasWork =
        Object.values(toSave).some(arr => arr.length > 0) ||
        Object.values(toDelete).some(arr => arr.length > 0)

      if (!hasWork) {
        await this.commitWal(walId)
        this.isDirty = false
        useSessionStore.getState().setSaveStatus('saved')
        return
      }

      // ── 3. Dexie 트랜잭션: upsert + delete ───────────────
      await db.transaction(
        'rw',
        [db.tags, db.annotations, db.highlights, db.textboxes, db.stickers, db.bookmarks],
        async () => {
          // Upsert (추가 또는 수정)
          if (toSave.tags.length)        await db.tags.bulkPut(toSave.tags)
          if (toSave.annotations.length) await db.annotations.bulkPut(toSave.annotations)
          if (toSave.highlights.length)  await db.highlights.bulkPut(toSave.highlights)
          if (toSave.textboxes.length)   await db.textboxes.bulkPut(toSave.textboxes)
          if (toSave.stickers.length)    await db.stickers.bulkPut(toSave.stickers)
          if (toSave.bookmarks.length)   await db.bookmarks.bulkPut(toSave.bookmarks)

          // Delete (삭제 처리)
          if (toDelete.tags.length)        await db.tags.bulkDelete(toDelete.tags)
          if (toDelete.annotations.length) await db.annotations.bulkDelete(toDelete.annotations)
          if (toDelete.highlights.length)  await db.highlights.bulkDelete(toDelete.highlights)
          if (toDelete.textboxes.length)   await db.textboxes.bulkDelete(toDelete.textboxes)
          if (toDelete.stickers.length)    await db.stickers.bulkDelete(toDelete.stickers)
          if (toDelete.bookmarks.length)   await db.bookmarks.bulkDelete(toDelete.bookmarks)
        },
      )

      // ── 4. WAL commit ──────────────────────────────────────
      await this.commitWal(walId)
      walId = null

      // ── 5. 인메모리 dirty 상태 초기화 ─────────────────────
      useAnnotationStore.getState().clearDirty()
      this.isDirty = false

      useSessionStore.getState().setSaveStatus('saved')

    } catch (err) {
      console.error('[AutoSaveManager] save failed:', err)

      // WAL이 committed 되지 않은 채로 남아있으면 CrashRecoveryManager가 처리
      useSessionStore.getState().setSaveStatus('error')

      // 5초 후 자동 재시도
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        void this.save()
      }, RETRY_MS)

    } finally {
      this.isSaving = false
    }
  }

  // ----------------------------------------------------------
  // WAL 헬퍼
  // ----------------------------------------------------------

  /**
   * WAL에 pending intent를 기록하고 생성된 WAL 항목의 ID를 반환합니다.
   */
  private async writeWalIntent(): Promise<string> {
    const id = crypto.randomUUID()
    await db.wal.add({
      id,
      operation: WAL_OP,
      status: 'pending',
      payload: { timestamp: Date.now() },
      createdAt: Date.now(),
      committedAt: null,
    })
    return id
  }

  /**
   * WAL 항목을 committed 상태로 업데이트합니다.
   * 이 호출이 완료되기 전에 크래시가 발생하면 CrashRecoveryManager가 재처리합니다.
   */
  private async commitWal(walId: string): Promise<void> {
    await db.wal.update(walId, {
      status: 'committed',
      committedAt: Date.now(),
    })
  }

  // ----------------------------------------------------------
  // 타이머 정리 헬퍼
  // ----------------------------------------------------------

  private clearDebounceTimer(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }
}

// ============================================================
// 싱글톤 인스턴스
// ============================================================

/**
 * LectureMate AutoSaveManager 싱글톤.
 *
 * @example
 * import { autoSave } from '@/core/AutoSaveManager'
 *
 * // 변경 발생 시 (useAutoSave hook이 자동 호출)
 * autoSave.markDirty()
 *
 * // 수동 저장 (Ctrl+S)
 * await autoSave.flush()
 *
 * // 세션 종료 시
 * await autoSave.dispose()
 */
export const autoSave = new AutoSaveManager()
