/**
 * @file workers/stt.worker.ts
 * LectureMate — STT Web Worker (Section 5 / Section 6)
 *
 * ## 메시지 프로토콜
 * IN  { type: 'load' }
 *       → Transformers.js Whisper 파이프라인 로딩 시작
 *       → OUT { type: 'progress', percent: number }  (다운로드 진행 중)
 *       → OUT { type: 'ready' }                      (로딩 완료)
 *
 * IN  { type: 'transcribe'; chunkIndex; pcmData; isPostProcess }
 *       → Whisper 추론 → OverlapDeduplicator → 세션 오프셋 적용
 *       → OUT { type: 'result'; chunkIndex; segments: SttSegment[] }
 *
 * OUT { type: 'error'; message }  (언제든 발생 가능)
 *
 * ## 타임스탬프 변환
 * Whisper는 청크 상대 시각(0 = 청크 오디오 시작)을 반환합니다.
 * 세션 기준으로 변환:
 *   - 청크 0  : offset = 0
 *   - 청크 N>0: offset = N × 5 − 1  (1초 프리-오버랩을 제거)
 *
 * ## 직렬 추론 큐
 * Whisper는 무거운 WASM 연산이므로 동시 실행을 막기 위해
 * Promise 체인으로 순차 실행을 보장합니다.
 */

import { pipeline, env } from '@xenova/transformers'
import { OverlapDeduplicator } from '@/lib/overlapDeduplicator'
import type { SttWorkerInMessage, SttWorkerOutMessage, SttSegment } from '@/types'

// ============================================================
// Transformers.js 환경 설정
// ============================================================

/** 원격 모델 허용 (HuggingFace Hub) */
env.allowRemoteModels = true
/** 브라우저 캐시(Cache API) 사용 — 재시작 시 재다운로드 방지 */
env.useBrowserCache   = true

// ============================================================
// 전역 상태
// ============================================================

type WhisperPipeline = Awaited<ReturnType<typeof pipeline>>

let whisperPipeline: WhisperPipeline | null = null
const deduplicator = new OverlapDeduplicator()

/** 직렬 추론 큐 — Promise 체인으로 순차 실행 보장 */
let transcribeQueue: Promise<void> = Promise.resolve()

// ============================================================
// 진행률 집계
// ============================================================

/**
 * 여러 모델 파일이 독립적으로 다운로드되므로
 * 파일별 진행률을 Map에 저장한 뒤 평균을 보고합니다.
 */
const fileProgressMap = new Map<string, number>()

function handleProgressCallback(progressEvent: {
  status: string
  name?: string
  file?: string
  progress?: number
  loaded?: number
  total?: number
}): void {
  if (progressEvent.status === 'downloading' || progressEvent.status === 'progress') {
    const key     = progressEvent.file ?? progressEvent.name ?? 'unknown'
    const percent = progressEvent.progress ?? 0
    fileProgressMap.set(key, percent)

    // 전체 파일 평균 진행률
    const values = Array.from(fileProgressMap.values())
    const avg    = values.reduce((a, b) => a + b, 0) / values.length

    postOut({ type: 'progress', percent: Math.round(avg) })
  }
}

// ============================================================
// 헬퍼: 타입 안전 postMessage
// ============================================================

function postOut(msg: SttWorkerOutMessage): void {
  self.postMessage(msg)
}

// ============================================================
// load — Whisper 파이프라인 초기화
// ============================================================

async function loadWhisper(): Promise<void> {
  if (whisperPipeline !== null) {
    postOut({ type: 'ready' })
    return
  }

  try {
    whisperPipeline = await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-base',
      {
        quantized:         true,
        progress_callback: handleProgressCallback,
      },
    )
    deduplicator.reset()
    postOut({ type: 'ready' })
  } catch (err) {
    postOut({ type: 'error', message: String(err) })
  }
}

// ============================================================
// transcribe — 단일 청크 추론
// ============================================================

/** 청크 인덱스 N에 대한 세션 기준 오프셋(초) */
function sessionOffset(chunkIndex: number): number {
  return chunkIndex === 0 ? 0 : chunkIndex * 5 - 1
}

/** Whisper 출력을 SttSegment 배열로 변환 */
function toSegments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any,
  chunkIndex: number,
  isPostProcess: boolean,
): SttSegment[] {
  const offset = sessionOffset(chunkIndex)

  // Whisper with return_timestamps: 'word' 또는 'sentence' 사용 시
  // output.chunks: Array<{ text: string; timestamp: [number, number | null] }>
  // 없으면 전체 텍스트를 단일 세그먼트로 취급
  const chunks: Array<{ text: string; timestamp: [number, number | null] }> =
    output.chunks ?? [{ text: output.text ?? '', timestamp: [0, null] }]

  return chunks
    .filter((c) => c.text.trim().length > 0)
    .map((c, idx): SttSegment => {
      const [start, end] = c.timestamp
      const sessionStart = (start ?? 0) + offset
      const sessionEnd   = (end   ?? start ?? 0) + offset

      return {
        id:              `${chunkIndex}-${idx}-${Date.now()}`,
        sessionId:       '',   // Phase 3의 useStt 훅에서 채워집니다
        startTime:       sessionStart,
        endTime:         sessionEnd,
        text:            c.text.trim(),
        words:           c.text.trim().split(/\s+/).filter(Boolean),
        confidence:      1,    // Whisper base는 confidence를 노출하지 않음
        chunkIndex,
        isPostProcessed: isPostProcess,
        createdAt:       Date.now(),
      }
    })
}

async function doTranscribe(
  chunkIndex: number,
  pcmData: Float32Array,
  isPostProcess: boolean,
): Promise<void> {
  if (!whisperPipeline) {
    postOut({ type: 'error', message: 'Whisper 파이프라인이 초기화되지 않았습니다' })
    return
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = await (whisperPipeline as any)(pcmData, {
      language:           'korean',
      task:               'transcribe',
      return_timestamps:  true,
      // 실시간 패스: beam=1(빠름), 후처리 패스: beam=5(정확)
      num_beams:          isPostProcess ? 5 : 1,
    })

    // Whisper 출력 → SttSegment 배열
    const rawSegments = toSegments(output, chunkIndex, isPostProcess)

    // 오버랩 구간 중복 제거
    // 청크 0은 overlapDuration=0 → 그대로 통과
    const overlapDuration = chunkIndex === 0 ? 0 : 1.0
    const segments        = deduplicator.deduplicate(rawSegments, overlapDuration)

    postOut({ type: 'result', chunkIndex, segments, isPostProcess })

  } catch (err) {
    postOut({ type: 'error', message: `[청크 ${chunkIndex}] 추론 실패: ${String(err)}` })
  }
}

// ============================================================
// 메시지 핸들러
// ============================================================

self.onmessage = (e: MessageEvent<SttWorkerInMessage>) => {
  const msg = e.data

  if (msg.type === 'load') {
    loadWhisper().catch((err) => {
      postOut({ type: 'error', message: String(err) })
    })
    return
  }

  if (msg.type === 'transcribe') {
    const { chunkIndex, pcmData, isPostProcess } = msg

    // 직렬 큐에 추가 — 이전 추론이 끝난 뒤 실행
    transcribeQueue = transcribeQueue.then(() =>
      doTranscribe(chunkIndex, pcmData, isPostProcess),
    )
  }
}
