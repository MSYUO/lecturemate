/**
 * @file hooks/useRecording.ts
 * LectureMate — 마이크 녹음 + 오디오 청킹 훅
 *
 * ## 구조
 * ```
 * 마이크 (getUserMedia)
 *   ↓ MediaStream
 * AudioContext → AudioWorkletNode (lm-pcm)
 *   ↓ Float32Array (Transferable, ~100ms 청크)
 * audio.worker.ts → 리샘플링(16kHz) + OverlappingChunker
 *   ↓ 7초 오버랩 청크
 * OPFS (PCM 파일) + WAL 보호
 * console.log → [Phase 3] STT Worker 연결 예정
 * ```
 *
 * MediaRecorder는 별도로 WebM Blob 녹화 → OPFS /audio/{sid}/recording.webm
 *
 * ## 사용
 * ```tsx
 * const { isRecording, isPaused, duration, startRecording, stopRecording,
 *         pauseRecording, resumeRecording } = useRecording()
 * ```
 *
 * ## 주의
 * - AudioContext / AudioWorklet / MediaRecorder는 메인 스레드에서만 사용 가능
 * - PCM 리샘플링 / 청킹은 audio.worker.ts가 담당 (메인 스레드 블로킹 없음)
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useSessionStore } from '@/stores/sessionStore'
import { opfs } from '@/core/OPFSStorage'
import { crashRecovery } from '@/core/CrashRecoveryManager'
import { onChunkReady } from '@/hooks/useStt'
import type { AudioWorkerInMessage, AudioWorkerOutMessage } from '@/types'

// ============================================================
// AudioWorklet 인라인 프로세서
// ============================================================

/**
 * AudioWorklet 처리기 소스 코드.
 * Blob URL로 로드되므로 별도 파일 불필요.
 *
 * 128-sample 프레임을 ~100ms 단위로 누적했다가 포트로 전송합니다.
 * `sampleRate`는 AudioWorklet 전역 변수 (AudioContext.sampleRate 값).
 */
const WORKLET_CODE = /* js */`
class LMPCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._len = 0;
    // ~100ms 분량 누적 후 전송 (48kHz → 4800 samples)
    this._cap = Math.ceil(sampleRate / 10);
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch && ch.length > 0) {
      // 128-sample 프레임 복사 (원본 버퍼는 재사용됨)
      this._buf.push(new Float32Array(ch));
      this._len += ch.length;
      if (this._len >= this._cap) {
        const out = new Float32Array(this._len);
        let off = 0;
        for (const b of this._buf) { out.set(b, off); off += b.length; }
        // Transferable 전송 → 복사 비용 없음
        this.port.postMessage(out, [out.buffer]);
        this._buf = [];
        this._len = 0;
      }
    }
    return true; // 계속 실행
  }
}
registerProcessor('lm-pcm', LMPCMProcessor);
`

// ============================================================
// 모듈 레벨 live stream (AudioWaveform 시각화용)
// ============================================================

/**
 * 현재 녹음 중인 MediaStream (없으면 null).
 * AudioWaveform 컴포넌트가 live 파형에 사용합니다.
 */
export let _liveStream: MediaStream | null = null

// ============================================================
// useRecording 훅
// ============================================================

export interface UseRecordingReturn {
  isRecording:     boolean
  isPaused:        boolean
  /** 녹음 경과 시간 (초). 일시정지 중에는 증가하지 않음 */
  duration:        number
  startRecording:  () => Promise<void>
  stopRecording:   () => void
  pauseRecording:  () => void
  resumeRecording: () => void
}

export function useRecording(): UseRecordingReturn {

  // ---- React 로컬 상태 ----
  const [duration, setDuration] = useState(0)

  // ---- refs (렌더 사이클 무관하게 최신 값 유지) ----
  const workerRef        = useRef<Worker | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioCtxRef      = useRef<AudioContext | null>(null)
  const streamRef        = useRef<MediaStream | null>(null)
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationRef      = useRef(0)
  const sessionIdRef     = useRef('')
  const webmChunksRef    = useRef<Blob[]>([])

  // ---- sessionStore 구독 ----
  const isRecording = useSessionStore((s) => s.isRecording)
  const isPaused    = useSessionStore((s) => s.isPaused)

  // ============================================================
  // 내부 헬퍼
  // ============================================================

  const _clearTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  const _startTimer = () => {
    _clearTimer()
    timerRef.current = setInterval(() => {
      durationRef.current += 1
      setDuration(durationRef.current)
      useSessionStore.getState().setCurrentTime(durationRef.current)
    }, 1000)
  }

  /** WebM Blob을 OPFS /audio/{sessionId}/recording.webm 에 저장 */
  const _saveWebm = async (sessionId: string, chunks: Blob[], mimeType: string) => {
    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
    try {
      const buf      = await blob.arrayBuffer()
      const root     = await navigator.storage.getDirectory()
      const audioDir = await root.getDirectoryHandle('audio', { create: true })
      const sesDir   = await audioDir.getDirectoryHandle(sessionId, { create: true })
      const fh       = await sesDir.getFileHandle('recording.webm', { create: true })
      const writable = await fh.createWritable()
      await writable.write(buf)
      await writable.close()
      console.log(
        `[Recording] WebM saved → /audio/${sessionId}/recording.webm`,
        `(${(buf.byteLength / 1024).toFixed(1)} KB)`,
      )
    } catch (err) {
      console.error('[Recording] WebM save failed:', err)
    }
  }

  // ============================================================
  // startRecording
  // ============================================================

  const startRecording = useCallback(async () => {
    try {
      // 0. OPFS 초기화 (이미 초기화된 경우 무시)
      try { await opfs.init() } catch { /* already initialized */ }

      // 1. 마이크 권한 요청
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream
      _liveStream = stream

      // 2. AudioContext 생성
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx

      // 3. 인라인 AudioWorklet 프로세서 로드
      const blob      = new Blob([WORKLET_CODE], { type: 'application/javascript' })
      const blobUrl   = URL.createObjectURL(blob)
      await audioCtx.audioWorklet.addModule(blobUrl)
      URL.revokeObjectURL(blobUrl)

      // 4. 오디오 그래프 구성
      //    source → workletNode → silentGain(0) → destination
      //    (silentGain으로 모니터링 방지 + worklet keep-alive 보장)
      const source      = audioCtx.createMediaStreamSource(stream)
      const workletNode = new AudioWorkletNode(audioCtx, 'lm-pcm')
      const silentGain  = audioCtx.createGain()
      silentGain.gain.value = 0
      source.connect(workletNode)
      workletNode.connect(silentGain)
      silentGain.connect(audioCtx.destination)

      // 5. audio.worker.ts 생성
      const worker = new Worker(
        new URL('../workers/audio.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker

      const sid = useSessionStore.getState().sessionId ?? crypto.randomUUID()
      sessionIdRef.current = sid

      // 6. Worker 초기화
      worker.postMessage({
        type:       'start',
        sessionId:  sid,
        sampleRate: audioCtx.sampleRate,
      } satisfies AudioWorkerInMessage)

      // 7. AudioWorklet → Worker PCM 전달 (Transferable, 복사 없음)
      workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (workerRef.current && e.data instanceof Float32Array) {
          const samples = e.data
          workerRef.current.postMessage(
            { type: 'pcm', samples } satisfies AudioWorkerInMessage,
            [samples.buffer],
          )
        }
      }

      // 8. Worker → 메인 스레드 메시지 처리
      worker.onmessage = async (e: MessageEvent<AudioWorkerOutMessage>) => {
        const msg = e.data

        if (msg.type === 'chunk') {
          // WAL intent 기록 → OPFS 저장 → commit
          const walId = await crashRecovery.writeIntent('addAudioChunk', {
            sessionId:  msg.sessionId,
            chunkIndex: msg.chunkIndex,
          })
          try {
            await opfs.writeAudioChunk(msg.sessionId, msg.chunkIndex, msg.pcmData)
            await crashRecovery.commit(walId)
            // STT Worker로 청크 전달 (useStt 훅이 마운트된 경우에만 동작)
            onChunkReady(msg.pcmData, msg.chunkIndex, false)
          } catch (err) {
            console.error('[Recording] chunk write failed:', err)
          }

        } else if (msg.type === 'complete') {
          console.log('[Recording] complete — totalChunks:', msg.totalChunks)
          // Worker는 complete 후 자동으로 더 이상 메시지를 보내지 않음
          // (terminate는 stop 이후 약간의 여유를 두고 처리)
          setTimeout(() => {
            worker.terminate()
            if (workerRef.current === worker) workerRef.current = null
          }, 500)

        } else if (msg.type === 'error') {
          console.error('[AudioWorker] error:', msg.message)
        }
      }

      worker.onerror = (e) => {
        console.error('[AudioWorker] uncaught error:', e)
      }

      // 9. MediaRecorder (WebM Blob — 재생용)
      webmChunksRef.current = []
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = mr

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) webmChunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        _saveWebm(sessionIdRef.current, webmChunksRef.current, mimeType)
      }
      mr.start(1000) // 1초 timeslice

      // 10. 타이머 시작
      durationRef.current = 0
      setDuration(0)
      _startTimer()

      // 11. Store 업데이트
      useSessionStore.getState().setIsRecording(true)
      useSessionStore.getState().setIsPaused(false)

    } catch (err) {
      console.error('[Recording] startRecording failed:', err)
      useSessionStore.getState().setIsRecording(false)
    }
  }, [])

  // ============================================================
  // stopRecording
  // ============================================================

  const stopRecording = useCallback(() => {
    _clearTimer()

    // MediaRecorder 정지 → onstop에서 WebM 저장
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null

    // Worker flush 요청 → complete 수신 후 자동 terminate
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'stop' } satisfies AudioWorkerInMessage)
    }

    // 오디오 그래프 정리
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    _liveStream = null

    audioCtxRef.current?.close()
    audioCtxRef.current = null

    // Store 업데이트
    useSessionStore.getState().setIsRecording(false)
    useSessionStore.getState().setIsPaused(false)
  }, [])

  // ============================================================
  // pauseRecording / resumeRecording
  // ============================================================

  const pauseRecording = useCallback(() => {
    const { isRecording: rec, isPaused: paused } = useSessionStore.getState()
    if (!rec || paused) return

    mediaRecorderRef.current?.pause()
    workerRef.current?.postMessage({ type: 'pause' } satisfies AudioWorkerInMessage)
    _clearTimer()
    useSessionStore.getState().setIsPaused(true)
  }, [])

  const resumeRecording = useCallback(() => {
    const { isRecording: rec, isPaused: paused } = useSessionStore.getState()
    if (!rec || !paused) return

    mediaRecorderRef.current?.resume()
    workerRef.current?.postMessage({ type: 'resume' } satisfies AudioWorkerInMessage)
    _startTimer()
    useSessionStore.getState().setIsPaused(false)
  }, [])

  // ============================================================
  // 언마운트 정리
  // ============================================================

  useEffect(() => {
    return () => {
      _clearTimer()
      workerRef.current?.terminate()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      audioCtxRef.current?.close()
      _liveStream = null
    }
  }, [])

  // ============================================================

  return {
    isRecording,
    isPaused,
    duration,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
  }
}
