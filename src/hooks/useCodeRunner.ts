/**
 * @file hooks/useCodeRunner.ts
 * LectureMate — 코드 실행 훅 (Section 5.2 / Section 10.3)
 *
 * ## 실행 분기
 * - Python  → PreWarmingManager의 CodeRunner Worker (Pyodide)
 * - JS / TS → jsSandbox.ts (iframe sandbox)
 *
 * ## 안전장치 (CODE_EXECUTION_LIMITS)
 * - 타임아웃: 10초 → Worker terminate → 새 Worker 생성
 * - stdout 최대 1000줄 / 1MB (Worker 스트림 레벨에서 카운팅)
 */

import { useCallback, useRef } from 'react'
import { preWarming } from '@/core/PreWarmingManager'
import { useCodeStore } from '@/stores/codeStore'
import type { EditorLanguage } from '@/stores/codeStore'
import type { CodeRunnerInMessage, CodeRunnerOutMessage } from '@/types'
import { runInJsSandbox } from '@/lib/jsSandbox'

// ============================================================
// 실행 한도 (Section 10.3)
// ============================================================

const TIMEOUT_MS = 10_000
const MAX_LINES  = 1_000
const MAX_BYTES  = 1_048_576  // 1MB

// ============================================================
// useCodeRunner
// ============================================================

export function useCodeRunner() {
  const clearOutput  = useCodeStore((s) => s.clearOutput)
  const appendStdout = useCodeStore((s) => s.appendStdout)
  const appendStderr = useCodeStore((s) => s.appendStderr)
  const setRunStatus = useCodeStore((s) => s.setRunStatus)

  // 실행 중인 타이머 참조 (언마운트 시 정리)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 현재 실행 핸들러 참조 (중단 시 제거)
  const handlerRef = useRef<((e: MessageEvent<CodeRunnerOutMessage>) => void) | null>(null)

  // ── Python 실행 ──────────────────────────────────────────
  const runPython = useCallback((source: string, snippetId: string) => {
    const worker = preWarming.getCodeWorker()
    if (!worker) {
      appendStderr('코드 실행 환경이 준비되지 않았습니다. 코드 탭을 다시 클릭해보세요.')
      setRunStatus('error', 0)
      return
    }

    let stdoutCount = 0
    let stdoutBytes = 0
    let limitReached = false

    // 10초 타임아웃
    timeoutRef.current = setTimeout(() => {
      if (handlerRef.current) {
        worker.removeEventListener('message', handlerRef.current)
        handlerRef.current = null
      }
      // Worker 강제 종료 + 새 Worker 재생성
      preWarming.resetCodeWorker()
      appendStderr('⏱️ 실행 시간 초과 (10초). 무한 루프가 있는지 확인해주세요.')
      setRunStatus('timeout', TIMEOUT_MS)
      // 새 Worker 비동기 초기화 (스켈레톤 재표시)
      preWarming.warmUpPyodide().catch(console.error)
    }, TIMEOUT_MS)

    const handler = (e: MessageEvent<CodeRunnerOutMessage>) => {
      const msg = e.data
      if (msg.type === 'progress' || msg.type === 'ready') return
      if (msg.snippetId !== snippetId) return

      if (msg.type === 'output') {
        if (limitReached) return
        stdoutCount++
        stdoutBytes += msg.text.length
        if (stdoutCount > MAX_LINES || stdoutBytes > MAX_BYTES) {
          limitReached = true
          appendStdout(`⚠️ 출력 한도 초과 (최대 ${MAX_LINES}줄 / 1MB)`)
          return
        }
        appendStdout(msg.text)

      } else if (msg.type === 'stderr') {
        appendStderr(msg.text)

      } else if (msg.type === 'error') {
        // init 실패 메시지 (snippetId = '') - 여기선 도달하지 않지만 방어 처리
        appendStderr(msg.message)

      } else if (msg.type === 'result') {
        clearTimeout(timeoutRef.current!)
        timeoutRef.current = null
        worker.removeEventListener('message', handler)
        handlerRef.current = null
        setRunStatus(msg.status, msg.executionTime)
      }
    }

    handlerRef.current = handler
    worker.addEventListener('message', handler)
    worker.postMessage({
      type: 'run', snippetId, language: 'python', source,
    } satisfies CodeRunnerInMessage)

  }, [appendStdout, appendStderr, setRunStatus])

  // ── 통합 run (언어에 따라 분기) ──────────────────────────
  const run = useCallback(async (source: string, lang: EditorLanguage) => {
    if (!source.trim()) return

    clearOutput()
    setRunStatus('running')

    const snippetId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    if (lang === 'python') {
      runPython(source, snippetId)
    } else {
      // JS / TypeScript: iframe sandbox (메인 스레드, Worker 불필요)
      try {
        const result = await runInJsSandbox(source, TIMEOUT_MS)
        result.stdout.forEach((line) => appendStdout(line))
        result.stderr.forEach((line) => appendStderr(line))
        setRunStatus(result.status, result.executionTime)
      } catch (err) {
        appendStderr(err instanceof Error ? err.message : String(err))
        setRunStatus('error', 0)
      }
    }
  }, [clearOutput, setRunStatus, runPython, appendStdout, appendStderr])

  // ── 중단 ─────────────────────────────────────────────────
  const interrupt = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (handlerRef.current) {
      const worker = preWarming.getCodeWorker()
      if (worker) {
        worker.removeEventListener('message', handlerRef.current)
        worker.postMessage({ type: 'interrupt' } satisfies CodeRunnerInMessage)
      }
      handlerRef.current = null
    }
    setRunStatus('idle')
  }, [setRunStatus])

  return { run, interrupt }
}
