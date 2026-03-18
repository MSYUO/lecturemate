/**
 * @file core/CrashRecoveryManager.ts
 * LectureMate — WAL(Write-Ahead Log) 기반 크래시 복구 매니저
 *
 * ## WAL 흐름
 * ```
 *   1. writeIntent(operation, payload)  →  WAL에 'pending' 기록
 *   2. 실제 작업 실행
 *   3. commit(walId)                    →  WAL을 'committed' 로 업데이트
 * ```
 *
 * 앱이 2번과 3번 사이에 크래시되면:
 *   - 다음 시작 시 recover()가 'pending' 항목을 찾아 재실행
 *   - operation 타입별로 재실행 전략이 다름 (replayOperation)
 *
 * ## 사용 예시 (AutoSaveManager 등에서)
 * ```typescript
 * const walId = await crashRecovery.writeIntent('autosave', { timestamp: Date.now() })
 * try {
 *   await db.tags.bulkPut(dirtyTags)
 *   await crashRecovery.commit(walId)
 * } catch {
 *   // walId는 pending 상태로 남아 다음 시작 시 recover()가 처리
 * }
 * ```
 *
 * ## App.tsx 연결
 * ```tsx
 * useEffect(() => { crashRecovery.recover() }, [])
 * ```
 */

import { db } from '@/db/schema'
import type {
  WALEntry,
  Tag,
  Highlight,
  TextBoxAnnotation,
  Sticker,
  Bookmark,
  Annotation,
} from '@/types'

// ============================================================
// WAL operation 타입
// ============================================================

/**
 * WAL에 기록될 수 있는 operation 문자열.
 * 각 타입마다 replayOperation 내부에 전용 재실행 로직이 있습니다.
 *
 * - autosave          AutoSaveManager의 전체 어노테이션 저장
 * - add* / delete*    개별 엔티티 추가/삭제
 */
export type WALOperation =
  | 'autosave'
  | 'addTag'        | 'deleteTag'
  | 'addHighlight'  | 'deleteHighlight'
  | 'addTextbox'    | 'deleteTextbox'
  | 'addSticker'    | 'deleteSticker'
  | 'addBookmark'   | 'deleteBookmark'
  | 'addAnnotation' | 'deleteAnnotation'

// ============================================================
// CrashRecoveryManager (클래스)
// ============================================================

class CrashRecoveryManager {

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * 작업 시작 전 WAL intent를 기록합니다.
   * 반환된 walId를 commit(walId)에 넘겨 완료를 표시하세요.
   *
   * @param operation  작업 종류 (WALOperation 문자열)
   * @param payload    재실행에 필요한 데이터
   * @returns walId    — commit() / rollback() 에 사용
   */
  async writeIntent(
    operation: WALOperation | string,
    payload:   Record<string, unknown>,
  ): Promise<string> {
    // ++id (auto-increment) 이므로 id 필드는 빈 값으로 전달
    // Dexie가 숫자 키를 자동 생성합니다
    const key = await db.wal.add({
      id:          '' as string,
      operation,
      status:      'pending',
      payload,
      createdAt:   Date.now(),
      committedAt: null,
    } satisfies WALEntry)

    return String(key)
  }

  /**
   * 작업이 성공적으로 완료됐을 때 WAL을 committed로 표시합니다.
   * @param walId  writeIntent()가 반환한 ID 문자열
   */
  async commit(walId: string): Promise<void> {
    // ++id 키는 런타임에 숫자이므로 Number()로 변환
    await db.wal.update(Number(walId) as unknown as string, {
      status:      'committed',
      committedAt: Date.now(),
    })
  }

  /**
   * 앱 시작 시 한 번 호출합니다.
   * 미완료(pending) WAL 항목을 찾아 순서대로 재실행합니다.
   * 재실행에 실패한 항목은 rolledback으로 표시합니다.
   */
  async recover(): Promise<void> {
    let pending: WALEntry[]

    try {
      pending = await db.wal
        .where('status')
        .equals('pending')
        .sortBy('createdAt')
    } catch (e) {
      console.error('[CrashRecovery] WAL 조회 실패:', e)
      return
    }

    if (pending.length === 0) return

    console.warn(
      `[CrashRecovery] 미완료 WAL ${pending.length}건 감지 — 복구 시작`,
    )

    for (const entry of pending) {
      try {
        await this.replayOperation(entry)
      } catch (e) {
        console.error(
          `[CrashRecovery] 재실행 실패 (op=${entry.operation}, id=${entry.id}):`,
          e,
        )
        await this._markRolledBack(entry)
      }
    }

    console.info('[CrashRecovery] 복구 완료')
  }

  // ----------------------------------------------------------
  // replayOperation — operation 타입별 재실행 전략
  // ----------------------------------------------------------

  /**
   * 개별 WAL 항목을 operation 타입에 따라 재실행합니다.
   * 외부에서 직접 호출할 수도 있습니다 (테스트 등).
   */
  async replayOperation(entry: WALEntry): Promise<void> {
    const { operation, payload } = entry

    switch (operation) {

      // ── autosave ──────────────────────────────────────────
      // AutoSaveManager의 bulk save 도중 크래시된 경우.
      // 재시작 후 Zustand 상태는 비어 있으므로 재실행 불가.
      // IndexedDB에 이미 저장된 데이터를 그대로 사용하고 롤백 처리.
      case 'autosave':
        console.warn('[CrashRecovery] autosave 미완료 감지 — 직전 저장 데이터 유지, 롤백 처리')
        await this._markRolledBack(entry)
        break

      // ── Tag ───────────────────────────────────────────────
      case 'addTag':
        await db.tags.put(payload as unknown as Tag)
        await this._markCommitted(entry)
        break

      case 'deleteTag':
        if (typeof payload.id === 'string') await db.tags.delete(payload.id)
        await this._markCommitted(entry)
        break

      // ── Highlight ─────────────────────────────────────────
      case 'addHighlight':
        await db.highlights.put(payload as unknown as Highlight)
        await this._markCommitted(entry)
        break

      case 'deleteHighlight':
        if (typeof payload.id === 'string') await db.highlights.delete(payload.id)
        await this._markCommitted(entry)
        break

      // ── TextBox ───────────────────────────────────────────
      case 'addTextbox':
        await db.textboxes.put(payload as unknown as TextBoxAnnotation)
        await this._markCommitted(entry)
        break

      case 'deleteTextbox':
        if (typeof payload.id === 'string') await db.textboxes.delete(payload.id)
        await this._markCommitted(entry)
        break

      // ── Sticker ───────────────────────────────────────────
      case 'addSticker':
        await db.stickers.put(payload as unknown as Sticker)
        await this._markCommitted(entry)
        break

      case 'deleteSticker':
        if (typeof payload.id === 'string') await db.stickers.delete(payload.id)
        await this._markCommitted(entry)
        break

      // ── Bookmark ──────────────────────────────────────────
      case 'addBookmark':
        await db.bookmarks.put(payload as unknown as Bookmark)
        await this._markCommitted(entry)
        break

      case 'deleteBookmark':
        if (typeof payload.id === 'string') await db.bookmarks.delete(payload.id)
        await this._markCommitted(entry)
        break

      // ── Annotation ────────────────────────────────────────
      case 'addAnnotation':
        await db.annotations.put(payload as unknown as Annotation)
        await this._markCommitted(entry)
        break

      case 'deleteAnnotation':
        if (typeof payload.id === 'string') await db.annotations.delete(payload.id)
        await this._markCommitted(entry)
        break

      // ── 알 수 없는 operation ──────────────────────────────
      default:
        console.warn(`[CrashRecovery] 알 수 없는 operation '${operation}' — 롤백 처리`)
        await this._markRolledBack(entry)
        break
    }
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  /** WAL 항목을 committed로 업데이트 */
  private async _markCommitted(entry: WALEntry): Promise<void> {
    // entry.id는 런타임에 Dexie가 할당한 숫자 키
    await db.wal.update(entry.id as unknown as number, {
      status:      'committed',
      committedAt: Date.now(),
    })
  }

  /** WAL 항목을 rolledback으로 업데이트 */
  private async _markRolledBack(entry: WALEntry): Promise<void> {
    await db.wal.update(entry.id as unknown as number, {
      status:      'rolledback',
      committedAt: Date.now(),
    })
  }
}

// ============================================================
// 싱글톤 — 앱 전역에서 동일 인스턴스 사용
// ============================================================

/**
 * CrashRecoveryManager 싱글톤.
 *
 * @example
 * import { crashRecovery } from '@/core/CrashRecoveryManager'
 *
 * // 쓰기 작업 전
 * const walId = await crashRecovery.writeIntent('addTag', { ...tagData })
 * await db.tags.add(tag)
 * await crashRecovery.commit(walId)
 *
 * // 앱 시작 시 (App.tsx)
 * useEffect(() => { crashRecovery.recover() }, [])
 */
export const crashRecovery = new CrashRecoveryManager()
