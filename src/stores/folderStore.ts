/**
 * @file stores/folderStore.ts
 * LectureMate — 폴더 관리 스토어 (굿노트 스타일)
 *
 * 폴더는 계층 구조(parentId)로 관리되며 IndexedDB에 영속됩니다.
 * currentFolderId로 현재 탐색 위치를 추적하고
 * getBreadcrumb()으로 루트까지의 경로를 반환합니다.
 */

import { create } from 'zustand'
import { db } from '@/db/schema'
import type { Folder } from '@/types'

// ============================================================
// 폴더 기본 색상 팔레트
// ============================================================

export const FOLDER_COLORS = [
  '#3182F6', // 토스 블루
  '#05C46B', // 그린
  '#F0B429', // 앰버
  '#F03E3E', // 레드
  '#CC5DE8', // 퍼플
  '#20C997', // 틸
  '#FF6B6B', // 코랄
  '#4DABF7', // 스카이 블루
]

// ============================================================
// 상태 / 액션 타입
// ============================================================

interface FolderState {
  /** 전체 폴더 목록 (평탄화, DB와 동기화) */
  folders: Folder[]
  /** 현재 탐색 중인 폴더 ID. null이면 루트 */
  currentFolderId: string | null
  /** DB 로드 완료 여부 */
  isLoaded: boolean
}

interface FolderActions {
  /** 앱 시작 시 DB에서 전체 폴더 로드 */
  loadFolders(): Promise<void>

  /** 폴더 생성. color 미지정 시 팔레트에서 자동 배정 */
  createFolder(params: {
    name: string
    parentId: string | null
    color?: string
  }): Promise<Folder>

  /** 폴더 이름 변경 */
  renameFolder(id: string, name: string): Promise<void>

  /** 폴더 색상 변경 */
  setFolderColor(id: string, color: string): Promise<void>

  /** 폴더 삭제 (하위 폴더·세션은 부모로 이동) */
  deleteFolder(id: string): Promise<void>

  /** 폴더를 다른 폴더로 이동 */
  moveFolder(id: string, parentId: string | null): Promise<void>

  /** 세션을 폴더로 이동 */
  moveSession(sessionId: string, folderId: string | null): Promise<void>

  /** 현재 탐색 폴더 변경 */
  setCurrentFolderId(id: string | null): void

  /**
   * 현재 폴더까지의 breadcrumb 경로 반환 (루트→현재 순서).
   * 루트면 빈 배열.
   */
  getBreadcrumb(): Folder[]

  /** 특정 폴더의 직계 자식 폴더 목록 */
  getChildFolders(parentId: string | null): Folder[]
}

// ============================================================
// 내부 유틸
// ============================================================

function newId(): string {
  return crypto.randomUUID()
}

// ============================================================
// Store
// ============================================================

export const useFolderStore = create<FolderState & FolderActions>()((set, get) => ({
  folders: [],
  currentFolderId: null,
  isLoaded: false,

  // ---- 로드 ----

  loadFolders: async () => {
    const folders = await db.folders.orderBy('createdAt').toArray()
    set({ folders, isLoaded: true })
  },

  // ---- 생성 ----

  createFolder: async ({ name, parentId, color }) => {
    const { folders } = get()
    // 색상 자동 배정: 같은 부모 내 자식 수로 팔레트 인덱스 결정
    const siblingCount = folders.filter((f) => f.parentId === parentId).length
    const assignedColor = color ?? FOLDER_COLORS[siblingCount % FOLDER_COLORS.length]

    const folder: Folder = {
      id:        newId(),
      name,
      parentId,
      color:     assignedColor,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await db.folders.add(folder)
    set((s) => ({ folders: [...s.folders, folder] }))
    return folder
  },

  // ---- 이름 변경 ----

  renameFolder: async (id, name) => {
    const updatedAt = Date.now()
    await db.folders.update(id, { name, updatedAt })
    set((s) => ({
      folders: s.folders.map((f) =>
        f.id === id ? { ...f, name, updatedAt } : f,
      ),
    }))
  },

  // ---- 색상 변경 ----

  setFolderColor: async (id, color) => {
    const updatedAt = Date.now()
    await db.folders.update(id, { color, updatedAt })
    set((s) => ({
      folders: s.folders.map((f) =>
        f.id === id ? { ...f, color, updatedAt } : f,
      ),
    }))
  },

  // ---- 삭제 ----

  deleteFolder: async (id) => {
    const { folders, currentFolderId } = get()

    // 재귀적으로 모든 하위 폴더 ID 수집
    const collectDescendants = (fid: string): string[] => {
      const children = folders.filter((f) => f.parentId === fid)
      return [fid, ...children.flatMap((c) => collectDescendants(c.id))]
    }
    const idsToDelete = collectDescendants(id)
    const parentId = folders.find((f) => f.id === id)?.parentId ?? null

    // 하위 폴더들 안의 세션을 부모 폴더로 이동
    for (const fid of idsToDelete) {
      await db.sessions
        .where('folderId')
        .equals(fid)
        .modify({ folderId: parentId })
    }

    // 폴더 삭제
    await db.folders.bulkDelete(idsToDelete)
    set((s) => ({
      folders: s.folders.filter((f) => !idsToDelete.includes(f.id)),
      // 삭제된 폴더를 탐색 중이었다면 부모로 이동
      currentFolderId:
        idsToDelete.includes(currentFolderId ?? '')
          ? parentId
          : currentFolderId,
    }))
  },

  // ---- 폴더 이동 ----

  moveFolder: async (id, parentId) => {
    // 자기 자신이나 하위로 이동 불가 방어
    if (id === parentId) return
    const updatedAt = Date.now()
    await db.folders.update(id, { parentId, updatedAt })
    set((s) => ({
      folders: s.folders.map((f) =>
        f.id === id ? { ...f, parentId, updatedAt } : f,
      ),
    }))
  },

  // ---- 세션 이동 ----

  moveSession: async (sessionId, folderId) => {
    await db.sessions.update(sessionId, { folderId })
  },

  // ---- 탐색 ----

  setCurrentFolderId: (id) => set({ currentFolderId: id }),

  getBreadcrumb: () => {
    const { folders, currentFolderId } = get()
    if (!currentFolderId) return []
    const path: Folder[] = []
    let current: Folder | undefined = folders.find((f) => f.id === currentFolderId)
    while (current) {
      path.unshift(current)
      current = current.parentId
        ? folders.find((f) => f.id === current!.parentId)
        : undefined
    }
    return path
  },

  getChildFolders: (parentId) => {
    return get().folders.filter((f) => f.parentId === parentId)
  },
}))
