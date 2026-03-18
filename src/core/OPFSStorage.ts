/**
 * @file core/OPFSStorage.ts
 * LectureMate — OPFS(Origin Private File System) 래퍼 (★v4)
 *
 * 대용량 바이너리 전용 저장소.
 * IndexedDB(Dexie)는 구조화 메타데이터만 다루고,
 * 오디오 PCM 청크와 PDF 원본은 모두 이 클래스를 통해 OPFS에 저장됩니다.
 *
 * OPFS 디렉토리 구조:
 *   /audio/{sessionId}/chunk_000000.pcm  ← 5+2초 PCM Float32 청크
 *   /pdf/{pdfId}.pdf                     ← PDF 원본 바이너리
 *   /export/{filename}                   ← 내보내기 임시 파일
 *
 * 싱글톤 사용:
 *   import { opfs } from '@/core/OPFSStorage'
 *   await opfs.init()
 */


// ============================================================
// 내부 상수
// ============================================================

/** 청크 파일명 패딩 자릿수. 최대 999999 청크(≈ 69시간) 지원. */
const CHUNK_INDEX_PAD = 6

/** OPFS 최상위 디렉토리명 */
const DIRS = {
  audio: 'audio',
  pdf: 'pdf',
  export: 'export',
} as const

// ============================================================
// 타입
// ============================================================

/** `getStorageEstimate()` 반환 타입 */
export interface StorageEstimate {
  /** 현재 사용 중인 바이트 수 */
  usage: number
  /** 브라우저가 허용한 최대 저장 용량 (바이트) */
  quota: number
  /** 사용률 [0, 1] */
  ratio: number
}

/** `getSessionAudioSize()` 반환 타입 */
export interface SessionAudioInfo {
  /** 청크 파일 개수 */
  chunkCount: number
  /** 총 바이트 크기 */
  totalBytes: number
}

// ============================================================
// OPFSStorage 클래스
// ============================================================

export class OPFSStorage {
  /** OPFS 루트 핸들. `init()` 호출 전까지 null. */
  private root: FileSystemDirectoryHandle | null = null

  // ----------------------------------------------------------
  // 초기화
  // ----------------------------------------------------------

  /**
   * OPFS를 초기화하고 필수 하위 디렉토리를 생성합니다.
   * 앱 시작 시 반드시 한 번 호출해야 합니다.
   *
   * @throws OPFS를 지원하지 않는 환경에서는 에러를 던집니다.
   */
  async init(): Promise<void> {
    if (!('storage' in navigator) || !('getDirectory' in navigator.storage)) {
      throw new Error(
        'OPFS is not supported in this browser. ' +
        'LectureMate requires a modern Chromium-based browser or Firefox 111+.',
      )
    }

    this.root = await navigator.storage.getDirectory()

    // 하위 디렉토리 보장 생성 (이미 존재하면 무시)
    await Promise.all([
      this.root.getDirectoryHandle(DIRS.audio,  { create: true }),
      this.root.getDirectoryHandle(DIRS.pdf,    { create: true }),
      this.root.getDirectoryHandle(DIRS.export, { create: true }),
    ])
  }

  // ----------------------------------------------------------
  // 오디오 청크
  // ----------------------------------------------------------

  /**
   * 오디오 PCM 청크를 OPFS에 저장합니다.
   * AudioWorker에서 5+2초(오버랩 포함) 청크가 완성될 때마다 호출됩니다.
   *
   * 저장 경로: `/audio/{sessionId}/chunk_{chunkIndex:06d}.pcm`
   *
   * @param sessionId   소속 세션 ID
   * @param chunkIndex  청크 순번 (0-based)
   * @param pcmData     16kHz mono Float32 PCM 데이터 (Transferable)
   */
  async writeAudioChunk(
    sessionId: string,
    chunkIndex: number,
    pcmData: Float32Array,
  ): Promise<void> {
    this.assertReady()

    const sessionDir = await this.getOrCreateSessionAudioDir(sessionId)
    const fileHandle = await sessionDir.getFileHandle(
      this.chunkFileName(chunkIndex),
      { create: true },
    )

    const writable = await fileHandle.createWritable()
    try {
      await writable.write(pcmData.buffer as ArrayBuffer)
    } finally {
      await writable.close()
    }
  }

  /**
   * 저장된 오디오 PCM 청크를 읽어 Float32Array로 반환합니다.
   *
   * @param sessionId   소속 세션 ID
   * @param chunkIndex  청크 순번 (0-based)
   * @returns Float32 PCM 데이터
   * @throws 파일이 존재하지 않으면 DOMException(NotFoundError)
   */
  async readAudioChunk(sessionId: string, chunkIndex: number): Promise<Float32Array> {
    this.assertReady()

    const audioDir  = await this.getDir(DIRS.audio)
    const sessionDir = await audioDir.getDirectoryHandle(sessionId)
    const fileHandle = await sessionDir.getFileHandle(this.chunkFileName(chunkIndex))

    const file = await fileHandle.getFile()
    const buffer = await file.arrayBuffer()
    return new Float32Array(buffer)
  }

  /**
   * 세션에 저장된 오디오 청크 메타데이터를 열거합니다.
   * 재생, 후처리 패스, 내보내기 시 청크 목록 확인에 사용됩니다.
   *
   * @param sessionId 소속 세션 ID
   * @returns 청크 인덱스 목록 (오름차순 정렬)
   */
  async listAudioChunks(sessionId: string): Promise<number[]> {
    this.assertReady()

    const audioDir = await this.getDir(DIRS.audio)

    let sessionDir: FileSystemDirectoryHandle
    try {
      sessionDir = await audioDir.getDirectoryHandle(sessionId)
    } catch {
      return [] // 세션 디렉토리 없음 = 청크 없음
    }

    const indices: number[] = []
    // FileSystemDirectoryHandle is AsyncIterable but TS dom lib may lack entries() overload
    const iter = sessionDir as unknown as AsyncIterable<[string, FileSystemHandle]>
    for await (const [name] of iter) {
      const match = name.match(/^chunk_(\d{6})\.pcm$/)
      if (match) {
        indices.push(parseInt(match[1], 10))
      }
    }

    return indices.sort((a, b) => a - b)
  }

  /**
   * 세션 오디오 디렉토리의 총 크기를 계산합니다.
   * StorageManager의 스마트 정리에서 freed bytes 집계에 사용됩니다.
   *
   * @param sessionId 소속 세션 ID
   */
  async getSessionAudioSize(sessionId: string): Promise<SessionAudioInfo> {
    this.assertReady()

    const audioDir = await this.getDir(DIRS.audio)

    let sessionDir: FileSystemDirectoryHandle
    try {
      sessionDir = await audioDir.getDirectoryHandle(sessionId)
    } catch {
      return { chunkCount: 0, totalBytes: 0 }
    }

    let chunkCount = 0
    let totalBytes = 0

    const iter2 = sessionDir as unknown as AsyncIterable<[string, FileSystemHandle]>
    for await (const [, handle] of iter2) {
      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile()
        totalBytes += file.size
        chunkCount++
      }
    }

    return { chunkCount, totalBytes }
  }

  /**
   * 세션에 속한 오디오 청크를 모두 삭제합니다.
   * STT 변환이 완료된 오래된 세션의 용량 회수에 사용됩니다.
   * IndexedDB의 세션 메타데이터(태그, STT, 필기)는 보존됩니다.
   *
   * @param sessionId 삭제할 세션 ID
   */
  async deleteSessionAudio(sessionId: string): Promise<void> {
    this.assertReady()

    const audioDir = await this.getDir(DIRS.audio)
    try {
      await audioDir.removeEntry(sessionId, { recursive: true })
    } catch (e) {
      // NotFoundError는 무시 (이미 삭제된 경우)
      if (!(e instanceof DOMException) || e.name !== 'NotFoundError') {
        throw e
      }
    }
  }

  // ----------------------------------------------------------
  // PDF
  // ----------------------------------------------------------

  /**
   * PDF 원본 파일을 OPFS에 저장합니다.
   * 사용자가 PDF를 불러올 때 호출됩니다.
   *
   * 저장 경로: `/pdf/{pdfId}.pdf`
   *
   * @param pdfId       PDF 식별자 (UUID 권장)
   * @param arrayBuffer PDF 파일 바이너리
   */
  async writePDF(pdfId: string, arrayBuffer: ArrayBuffer): Promise<void> {
    this.assertReady()

    const pdfDir    = await this.getDir(DIRS.pdf)
    const fileHandle = await pdfDir.getFileHandle(`${pdfId}.pdf`, { create: true })

    const writable = await fileHandle.createWritable()
    try {
      await writable.write(arrayBuffer)
    } finally {
      await writable.close()
    }
  }

  /**
   * 저장된 PDF를 읽어 ArrayBuffer로 반환합니다.
   *
   * @param pdfId PDF 식별자
   * @returns PDF 파일 바이너리
   * @throws 파일이 존재하지 않으면 DOMException(NotFoundError)
   */
  async readPDF(pdfId: string): Promise<ArrayBuffer> {
    this.assertReady()

    const pdfDir    = await this.getDir(DIRS.pdf)
    const fileHandle = await pdfDir.getFileHandle(`${pdfId}.pdf`)
    const file       = await fileHandle.getFile()
    return file.arrayBuffer()
  }

  /**
   * 저장된 PDF를 삭제합니다.
   *
   * @param pdfId PDF 식별자
   */
  async deletePDF(pdfId: string): Promise<void> {
    this.assertReady()

    const pdfDir = await this.getDir(DIRS.pdf)
    try {
      await pdfDir.removeEntry(`${pdfId}.pdf`)
    } catch (e) {
      if (!(e instanceof DOMException) || e.name !== 'NotFoundError') {
        throw e
      }
    }
  }

  // ----------------------------------------------------------
  // 내보내기 임시 파일
  // ----------------------------------------------------------

  /**
   * 내보내기 임시 파일을 OPFS에 씁니다.
   * 내보내기 완료 후 `deleteExport()`로 정리합니다.
   *
   * @param filename   파일명 (예: "session_2024-01-15.md")
   * @param data       파일 내용 (string 또는 ArrayBuffer)
   */
  async writeExport(filename: string, data: string | ArrayBuffer): Promise<void> {
    this.assertReady()

    const exportDir  = await this.getDir(DIRS.export)
    const fileHandle = await exportDir.getFileHandle(filename, { create: true })

    const writable = await fileHandle.createWritable()
    try {
      await writable.write(data)
    } finally {
      await writable.close()
    }
  }

  /**
   * 내보내기 임시 파일을 읽어 Blob으로 반환합니다.
   * 사용자에게 다운로드를 제공할 때 `URL.createObjectURL(blob)`과 함께 사용합니다.
   *
   * @param filename 파일명
   */
  async readExport(filename: string): Promise<Blob> {
    this.assertReady()

    const exportDir  = await this.getDir(DIRS.export)
    const fileHandle = await exportDir.getFileHandle(filename)
    return fileHandle.getFile()
  }

  /**
   * 내보내기 임시 파일을 삭제합니다.
   *
   * @param filename 파일명
   */
  async deleteExport(filename: string): Promise<void> {
    this.assertReady()

    const exportDir = await this.getDir(DIRS.export)
    try {
      await exportDir.removeEntry(filename)
    } catch (e) {
      if (!(e instanceof DOMException) || e.name !== 'NotFoundError') {
        throw e
      }
    }
  }

  // ----------------------------------------------------------
  // 저장 용량 조회
  // ----------------------------------------------------------

  /**
   * OPFS 저장 사용량과 쿼터를 조회합니다.
   * StorageUsageBar 컴포넌트와 StorageManager의 임계치 경고에 사용됩니다.
   *
   * 임계치:
   *   70% → 상태바 경고 아이콘
   *   85% → 자동 정리 제안 다이얼로그
   *
   * @returns usage(사용 바이트), quota(최대 바이트), ratio(사용률 0~1)
   */
  async getStorageEstimate(): Promise<StorageEstimate> {
    const estimate = await navigator.storage.estimate()
    const usage    = estimate.usage  ?? 0
    const quota    = estimate.quota  ?? 0
    const ratio    = quota > 0 ? usage / quota : 0

    return { usage, quota, ratio }
  }

  // ----------------------------------------------------------
  // 유틸리티 (private)
  // ----------------------------------------------------------

  /** `init()` 호출 여부를 확인합니다. */
  private assertReady(): void {
    if (!this.root) {
      throw new Error(
        'OPFSStorage is not initialized. Call `await opfs.init()` first.',
      )
    }
  }

  /** 최상위 디렉토리 핸들을 반환합니다. */
  private async getDir(
    name: (typeof DIRS)[keyof typeof DIRS],
  ): Promise<FileSystemDirectoryHandle> {
    return this.root!.getDirectoryHandle(name, { create: true })
  }

  /** 세션 오디오 하위 디렉토리를 반환합니다 (없으면 생성). */
  private async getOrCreateSessionAudioDir(
    sessionId: string,
  ): Promise<FileSystemDirectoryHandle> {
    const audioDir = await this.getDir(DIRS.audio)
    return audioDir.getDirectoryHandle(sessionId, { create: true })
  }

  /**
   * 청크 인덱스로 파일명을 생성합니다.
   * 예: `chunkFileName(42)` → `"chunk_000042.pcm"`
   */
  private chunkFileName(index: number): string {
    return `chunk_${String(index).padStart(CHUNK_INDEX_PAD, '0')}.pcm`
  }
}

// ============================================================
// 싱글톤 인스턴스
// ============================================================

/**
 * LectureMate OPFS 싱글톤.
 * 앱 시작 시 `await opfs.init()`을 반드시 호출하세요.
 *
 * @example
 * import { opfs } from '@/core/OPFSStorage'
 *
 * // 앱 마운트 시 초기화
 * await opfs.init()
 *
 * // 오디오 청크 저장 (AudioWorker 메시지 수신 후)
 * await opfs.writeAudioChunk(sessionId, chunkIndex, pcmData)
 *
 * // 용량 확인
 * const { ratio } = await opfs.getStorageEstimate()
 * if (ratio > 0.85) showCleanupDialog()
 */
export const opfs = new OPFSStorage()
