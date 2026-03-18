/**
 * @file components/audio/AudioWaveform.tsx
 * LectureMate — 오디오 파형 시각화 컴포넌트
 *
 * ## 동작 모드
 * 1. **녹음 모드** (`isRecording=true`):
 *    WaveSurfer RecordPlugin — _liveStream을 실시간 스크롤 파형으로 표시.
 * 2. **재생 모드** (`audioUrl` 제공):
 *    표준 WaveSurfer — 녹음된 WebM/PCM 오디오 파형 + 클릭 탐색.
 * 3. **유휴 모드**: 빈 파형 자리 표시자 표시.
 *
 * ## sessionStore 동기화
 * - 재생 중 `timeupdate` → `setCurrentTime()`
 * - 외부에서 `currentTime`이 변경되면 → WaveSurfer `seekTo()` (점프 없음, 1s 이상 차이날 때만)
 */

import { useEffect, useRef, useCallback } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js'
import { useSessionStore } from '@/stores/sessionStore'
import { _liveStream } from '@/hooks/useRecording'

// ============================================================
// Props
// ============================================================

interface AudioWaveformProps {
  /** 재생 모드: OPFS 또는 Blob URL. 미제공 시 유휴/녹음 모드 */
  audioUrl?: string
  height?: number
}

// ============================================================
// AudioWaveform
// ============================================================

export function AudioWaveform({ audioUrl, height = 64 }: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef        = useRef<WaveSurfer | null>(null)
  const recordRef    = useRef<InstanceType<typeof RecordPlugin> | null>(null)
  const seekingRef   = useRef(false)   // 외부 seek 중 루프 방지

  const isRecording  = useSessionStore((s) => s.isRecording)
  const isPaused     = useSessionStore((s) => s.isPaused)
  const currentTime  = useSessionStore((s) => s.currentTime)
  const setCurrentTime = useSessionStore((s) => s.setCurrentTime)

  // ============================================================
  // WaveSurfer 공통 옵션
  // ============================================================

  const commonOptions = {
    height,
    waveColor:     'var(--text-tertiary, #6b7280)',
    progressColor: 'var(--accent-blue, #3b82f6)',
    cursorColor:   'var(--accent-blue, #3b82f6)',
    cursorWidth:   2,
    normalize:     true,
    interact:      true,
  }

  // ============================================================
  // 녹음 모드: RecordPlugin 파형
  // ============================================================

  const startLiveWaveform = useCallback(() => {
    if (!containerRef.current) return
    if (wsRef.current) { wsRef.current.destroy(); wsRef.current = null }

    const ws = WaveSurfer.create({
      ...commonOptions,
      container: containerRef.current,
      url:       undefined,
    })

    const record = ws.registerPlugin(
      RecordPlugin.create({
        scrollingWaveform:       true,
        scrollingWaveformWindow: 5,   // 5초 슬라이딩 윈도우
        renderRecordedAudio:     false,
      }),
    )

    // useRecording이 이미 캡처한 스트림을 재사용 → 이중 마이크 요청 없음
    if (_liveStream) {
      record.renderMicStream(_liveStream)
    }

    wsRef.current     = ws
    recordRef.current = record
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stopLiveWaveform = useCallback(() => {
    if (recordRef.current) {
      try { recordRef.current.stopMic() } catch { /* already stopped */ }
      recordRef.current = null
    }
  }, [])

  // ============================================================
  // 재생 모드: 표준 WaveSurfer
  // ============================================================

  const startPlaybackWaveform = useCallback((url: string) => {
    if (!containerRef.current) return
    if (wsRef.current) { wsRef.current.destroy(); wsRef.current = null }

    const ws = WaveSurfer.create({
      ...commonOptions,
      container: containerRef.current,
      url,
    })

    // 재생 시간 → sessionStore 동기화
    ws.on('timeupdate', (time: number) => {
      if (!seekingRef.current) {
        setCurrentTime(Math.floor(time))
      }
    })

    wsRef.current = ws
  }, [setCurrentTime]) // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================
  // 모드 전환 Effect
  // ============================================================

  useEffect(() => {
    if (isRecording) {
      // 녹음 모드 진입 → 재생 WaveSurfer 제거 후 실시간 파형 시작
      if (wsRef.current && !recordRef.current) {
        wsRef.current.destroy()
        wsRef.current = null
      }
      if (!recordRef.current) {
        startLiveWaveform()
      }
    } else {
      // 녹음 종료 → 실시간 파형 정리
      stopLiveWaveform()
      if (wsRef.current && !audioUrl) {
        // 재생 URL이 없으면 WaveSurfer도 정리
        wsRef.current.destroy()
        wsRef.current = null
      }
    }
  }, [isRecording]) // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================
  // 재생 URL 변경 Effect
  // ============================================================

  useEffect(() => {
    if (!audioUrl) return
    if (isRecording) return   // 녹음 중에는 재생 파형 불필요

    startPlaybackWaveform(audioUrl)

    return () => {
      wsRef.current?.destroy()
      wsRef.current = null
    }
  }, [audioUrl, isRecording, startPlaybackWaveform])

  // ============================================================
  // 일시정지/재개 Effect (RecordPlugin 스크롤 파형)
  // ============================================================

  useEffect(() => {
    if (!recordRef.current) return
    // RecordPlugin은 직접 pause/resume mic 메서드가 없음.
    // 단지 시각적 스크롤 속도가 멈추면 되므로 별도 처리 불필요.
    // 필요 시 recordRef.current.pauseMic() / resumeMic() 호출 가능.
  }, [isPaused])

  // ============================================================
  // 외부 currentTime 변경 → WaveSurfer seek (재생 모드만)
  // ============================================================

  useEffect(() => {
    const ws = wsRef.current
    if (!ws || isRecording || !audioUrl) return

    const duration = ws.getDuration()
    if (duration <= 0) return

    const wsTime  = ws.getCurrentTime()
    const diff    = Math.abs(wsTime - currentTime)

    // 1초 이상 차이날 때만 seek (사용자가 클릭하지 않은 외부 점프)
    if (diff > 1) {
      seekingRef.current = true
      ws.seekTo(Math.min(currentTime / duration, 1))
      // 다음 timeupdate 이벤트 전에 플래그 해제
      setTimeout(() => { seekingRef.current = false }, 200)
    }
  }, [currentTime, isRecording, audioUrl])

  // ============================================================
  // 언마운트 정리
  // ============================================================

  useEffect(() => {
    return () => {
      stopLiveWaveform()
      wsRef.current?.destroy()
      wsRef.current = null
    }
  }, [stopLiveWaveform])

  // ============================================================
  // 렌더
  // ============================================================

  return (
    <div
      style={{
        position:        'relative',
        width:           '100%',
        height,
        backgroundColor: 'var(--bg-tertiary, #1e1e2e)',
        borderRadius:    8,
        overflow:        'hidden',
      }}
    >
      {/* WaveSurfer 마운트 컨테이너 */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* 유휴 상태 자리 표시자 */}
      {!isRecording && !audioUrl && (
        <div
          style={{
            position:       'absolute',
            inset:          0,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            pointerEvents:  'none',
          }}
        >
          <span
            style={{
              fontSize: 12,
              color:    'var(--text-tertiary, #6b7280)',
            }}
          >
            녹음을 시작하면 파형이 표시됩니다
          </span>
        </div>
      )}

      {/* 녹음 중 상태 표시 도트 */}
      {isRecording && !isPaused && (
        <div
          style={{
            position:        'absolute',
            top:             8,
            right:           10,
            width:           8,
            height:          8,
            borderRadius:    '50%',
            backgroundColor: 'var(--accent-red, #ef4444)',
            animation:       'lm-blink 1s ease-in-out infinite',
          }}
        />
      )}

      <style>{`
        @keyframes lm-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.2; }
        }
      `}</style>
    </div>
  )
}
