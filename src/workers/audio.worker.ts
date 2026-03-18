/**
 * @file workers/audio.worker.ts
 * LectureMate — 오디오 청킹 Web Worker
 *
 * ## 역할
 * 메인 스레드의 AudioWorklet 프로세서가 캡처한 원시 PCM을 받아:
 *   1. 네이티브 샘플레이트 → 16kHz 선형 보간 리샘플링
 *   2. OverlappingChunker로 5초 청크 + 앞뒤 1초 오버랩 = 7초 단위로 분할
 *   3. Float32Array를 Transferable로 메인 스레드에 전송
 *
 * ## 메인 스레드와의 분리 이유
 * `getUserMedia` / `AudioWorkletNode`는 메인 스레드에서만 사용 가능합니다.
 * 무거운 리샘플링과 버퍼 관리는 이 Worker가 담당해 메인 스레드 블로킹을 막습니다.
 *
 * ## 메시지 프로토콜
 * ```
 * 메인 → Worker:
 *   start   { sessionId, sampleRate }   녹음 세션 시작
 *   pcm     { samples: Float32Array }   AudioWorklet에서 캡처한 원시 PCM 청크
 *   stop                                녹음 종료 + 버퍼 flush
 *   pause                               일시정지 (PCM 수신 무시)
 *   resume                              재개
 *
 * Worker → 메인:
 *   chunk   { sessionId, chunkIndex, pcmData, startTime, endTime,
 *             durationWithOverlap }      7초 오버랩 청크 준비됨
 *   complete { sessionId, totalChunks } 녹음 완전 완료
 *   error   { message }                 예외 발생
 * ```
 *
 * ## 오버랩 구조 (Section 6.2)
 * ```
 * 청크 0: [        body 5s       ][post 1s]            → 6s (pre-overlap 없음)
 * 청크 1: [pre 1s][    body 5s   ][post 1s]            → 7s
 * 청크 N: [pre 1s][    body 5s   ][post 1s]            → 7s
 * flush:  [pre 1s][남은 audio ...]                     → 가변
 * ```
 */

/// <reference lib="webworker" />

import type { AudioWorkerInMessage, AudioWorkerOutMessage } from '@/types'

// ============================================================
// 상수
// ============================================================

const TARGET_SAMPLE_RATE  = 16_000   // Whisper 요구 샘플레이트
const CHUNK_DURATION      = 5        // 초 — STT 단위 청크 본체
const OVERLAP_DURATION    = 1        // 초 — 앞뒤 각 1초 오버랩

// ============================================================
// 선형 보간 리샘플러
// ============================================================

/**
 * PCM Float32Array를 입력 샘플레이트에서 16kHz로 선형 보간 다운샘플링합니다.
 * 입력이 이미 16kHz이면 복사 없이 그대로 반환합니다.
 */
function resample(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) return input

  const ratio        = TARGET_SAMPLE_RATE / inputRate
  const outputLength = Math.round(input.length * ratio)
  const output       = new Float32Array(outputLength)
  const lastIdx      = input.length - 1

  for (let i = 0; i < outputLength; i++) {
    const src  = i / ratio
    const lo   = Math.floor(src)
    const hi   = Math.min(lo + 1, lastIdx)
    const frac = src - lo
    output[i]  = input[lo] * (1 - frac) + input[hi] * frac
  }

  return output
}

// ============================================================
// OverlappingChunker
// ============================================================

/** push() / flush() 반환값 */
interface ChunkResult {
  pcmData:             Float32Array
  chunkIndex:          number
  /** 본체 시작 시각 (초, pre-overlap 제외) */
  startTime:           number
  /** 본체 종료 시각 (초, post-overlap 제외) */
  endTime:             number
  durationWithOverlap: number
}

/**
 * 16kHz PCM을 버퍼링해 오버랩 포함 청크를 생성합니다.
 *
 * 트리거 조건:
 *   - 첫 청크: bufferDuration >= 6s  (pre-overlap 없으므로 body 5s + post 1s)
 *   - 이후:    bufferDuration >= 7s  (pre 1s + body 5s + post 1s)
 *
 * retainOverlap: 청크 직후 마지막 1s를 버퍼에 보존 → 다음 청크의 pre-overlap
 */
class OverlappingChunker {
  private buffer: Float32Array[] = []
  private bufferDuration          = 0   // 현재 버퍼 총 길이 (초)
  private chunkIndex              = 0   // 발행된 청크 수
  private hasPreOverlap           = false

  reset(): void {
    this.buffer        = []
    this.bufferDuration = 0
    this.chunkIndex    = 0
    this.hasPreOverlap  = false
  }

  /**
   * 16kHz PCM 데이터를 추가하고, 청크가 완성됐으면 반환합니다.
   * 청크가 아직 준비되지 않았으면 null을 반환합니다.
   */
  push(pcmData: Float32Array): ChunkResult | null {
    this.buffer.push(pcmData)
    this.bufferDuration += pcmData.length / TARGET_SAMPLE_RATE

    // 첫 청크: 6s, 이후: 7s (pre 1 + body 5 + post 1)
    const threshold = this.hasPreOverlap
      ? CHUNK_DURATION + 2 * OVERLAP_DURATION   // 7s
      : CHUNK_DURATION + OVERLAP_DURATION        // 6s

    if (this.bufferDuration < threshold) return null

    return this._emitChunk(false)
  }

  /**
   * 녹음 종료 시 남은 버퍼를 모두 소진합니다.
   * 정규 청크를 먼저 처리한 뒤 남은 잔여 데이터를 flush합니다.
   */
  flush(): ChunkResult[] {
    const results: ChunkResult[] = []

    // 아직 임계치를 넘은 정규 청크가 있으면 먼저 처리
    let threshold = this.hasPreOverlap
      ? CHUNK_DURATION + 2 * OVERLAP_DURATION
      : CHUNK_DURATION + OVERLAP_DURATION

    while (this.bufferDuration >= threshold) {
      results.push(this._emitChunk(false))
      threshold = CHUNK_DURATION + 2 * OVERLAP_DURATION // 두 번째부터는 항상 7s
    }

    // 잔여 데이터가 0.1s 이상이면 마지막 짧은 청크로 flush
    if (this.bufferDuration >= 0.1) {
      results.push(this._emitChunk(true))
    }

    return results
  }

  get totalChunks(): number { return this.chunkIndex }

  // ----------------------------------------------------------
  // 내부 헬퍼
  // ----------------------------------------------------------

  /** 버퍼에서 청크를 추출하고 남은 데이터와 pre-overlap을 재설정합니다. */
  private _emitChunk(isFinal: boolean): ChunkResult {
    const flat = this._flatten()

    // 추출할 샘플 수
    const chunkSamples = isFinal
      ? flat.length
      : this.hasPreOverlap
        ? (CHUNK_DURATION + 2 * OVERLAP_DURATION) * TARGET_SAMPLE_RATE   // 112_000
        : (CHUNK_DURATION + OVERLAP_DURATION)      * TARGET_SAMPLE_RATE  //  96_000

    const chunk     = flat.slice(0, Math.min(flat.length, chunkSamples))
    const remaining = flat.slice(chunk.length)   // 청크 이후 잉여 데이터

    const overlapSamples = OVERLAP_DURATION * TARGET_SAMPLE_RATE  // 16_000

    if (!isFinal && chunk.length >= overlapSamples) {
      // 마지막 1s를 pre-overlap으로 보존
      const retained = chunk.slice(chunk.length - overlapSamples)
      this.buffer         = remaining.length > 0 ? [retained, remaining] : [retained]
      this.bufferDuration = (retained.length + remaining.length) / TARGET_SAMPLE_RATE
      this.hasPreOverlap  = true
    } else {
      // 최종 청크 또는 너무 짧아 overlap 보존 불가 → 버퍼 완전 초기화
      this.buffer         = remaining.length > 0 ? [remaining] : []
      this.bufferDuration = remaining.length / TARGET_SAMPLE_RATE
    }

    const index     = this.chunkIndex++
    const startTime = index * CHUNK_DURATION               // pre-overlap 제외 본체 시작
    const endTime   = startTime + CHUNK_DURATION           // 본체 종료 (flush는 짧을 수 있음)

    return {
      pcmData:             chunk,
      chunkIndex:          index,
      startTime,
      endTime:             isFinal
        ? startTime + Math.max(0, chunk.length / TARGET_SAMPLE_RATE - OVERLAP_DURATION)
        : endTime,
      durationWithOverlap: chunk.length / TARGET_SAMPLE_RATE,
    }
  }

  /** 분산된 buffer 배열을 단일 Float32Array로 합칩니다. */
  private _flatten(): Float32Array {
    const total  = this.buffer.reduce((sum, b) => sum + b.length, 0)
    const flat   = new Float32Array(total)
    let   offset = 0
    for (const b of this.buffer) {
      flat.set(b, offset)
      offset += b.length
    }
    return flat
  }
}

// ============================================================
// Worker 전역 상태
// ============================================================

let sessionId:       string | null = null
let inputSampleRate: number        = 44_100
let isRecording:     boolean       = false
let isPaused:        boolean       = false

const chunker = new OverlappingChunker()

// ============================================================
// 메시지 발신 헬퍼
// ============================================================

/** AudioWorkerOutMessage를 메인 스레드로 전송합니다. */
function send(msg: AudioWorkerOutMessage): void {
  if (msg.type === 'chunk') {
    // pcmData.buffer를 Transferable로 이전 → 복사 비용 제거
    ;(self as DedicatedWorkerGlobalScope).postMessage(msg, [msg.pcmData.buffer])
  } else {
    ;(self as DedicatedWorkerGlobalScope).postMessage(msg)
  }
}

/** ChunkResult를 'chunk' 메시지로 변환해 전송합니다. */
function sendChunk(result: ChunkResult): void {
  if (sessionId === null) return
  send({
    type:                'chunk',
    sessionId,
    chunkIndex:          result.chunkIndex,
    pcmData:             result.pcmData,
    startTime:           result.startTime,
    endTime:             result.endTime,
    durationWithOverlap: result.durationWithOverlap,
  })
}

// ============================================================
// 메시지 수신 핸들러
// ============================================================

;(self as DedicatedWorkerGlobalScope).onmessage = (
  e: MessageEvent<AudioWorkerInMessage>,
) => {
  const msg = e.data

  try {
    switch (msg.type) {

      // ── START: 새 세션 초기화 ──────────────────────────────
      case 'start': {
        sessionId       = msg.sessionId
        inputSampleRate = msg.sampleRate
        isRecording     = true
        isPaused        = false
        chunker.reset()
        break
      }

      // ── PCM: AudioWorklet에서 전달된 원시 데이터 ──────────
      // 메인 스레드 흐름:
      //   getUserMedia → AudioContext → AudioWorkletNode → processor.port.postMessage
      //   → hook이 Worker에 { type:'pcm', samples } 전달
      case 'pcm': {
        if (!isRecording || isPaused) break

        // 1. 네이티브 샘플레이트 → 16kHz 리샘플링
        const resampled = resample(msg.samples, inputSampleRate)

        // 2. 오버랩 청커에 추가; 임계치 도달 시 7초 청크 반환
        const result = chunker.push(resampled)
        if (result !== null) sendChunk(result)
        break
      }

      // ── PAUSE: 버퍼는 유지하고 새 PCM 무시 ───────────────
      case 'pause': {
        isPaused = true
        break
      }

      // ── RESUME: 재개 ──────────────────────────────────────
      case 'resume': {
        isPaused = false
        break
      }

      // ── STOP: 버퍼 flush 후 완료 신호 ────────────────────
      case 'stop': {
        isRecording = false
        isPaused    = false

        // 남은 버퍼를 모두 청크로 발행 (짧은 잔여 포함)
        const finalChunks = chunker.flush()
        for (const c of finalChunks) sendChunk(c)

        // 녹음 완료 신호
        send({
          type:        'complete',
          sessionId:   sessionId ?? '',
          totalChunks: chunker.totalChunks,
        })

        sessionId = null
        break
      }
    }
  } catch (err) {
    send({
      type:    'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
