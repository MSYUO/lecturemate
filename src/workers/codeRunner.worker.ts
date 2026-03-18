/**
 * @file workers/codeRunner.worker.ts
 * LectureMate — 코드 실행 Web Worker (Section 5.2 / Section 10)
 *
 * ## 메시지 프로토콜
 * IN  { type: 'init' }
 *       → Pyodide 로딩 + 기본 패키지(numpy, pandas, matplotlib, scipy, sympy) 로드
 *       → OUT { type: 'progress'; percent }  (로딩 진행률)
 *       → OUT { type: 'ready' }              (완료)
 *
 * IN  { type: 'run'; snippetId; language; source }
 *       → Python: handleImportError → micropip on-demand → runPythonAsync
 *       → OUT { type: 'output'; snippetId; text }  (stdout 스트림)
 *       → OUT { type: 'stderr'; snippetId; text }  (stderr 스트림)
 *       → OUT { type: 'result'; snippetId; executionTime; status }  (완료)
 *
 * IN  { type: 'interrupt' }
 *       → Pyodide 실행 인터럽트 (SharedArrayBuffer 지원 환경)
 *
 * ## 패키지 처리 전략 (Section 10.1~10.2)
 * - PRELOADED  : init 시 사전 로딩 완료. 추가 처리 없음.
 * - AVAILABLE  : 최초 import 시 micropip으로 온디맨드 설치.
 *                "설치 중..." 메시지 출력 후 설치 완료 시 실행.
 * - UNSUPPORTED: 실행 전 친절한 한국어 에러 메시지 후 중단.
 * - 그 외      : Pyodide loadPackagesFromImports 위임. 실패 시 Python 자연 에러.
 */

import type { CodeRunnerInMessage, CodeRunnerOutMessage } from '@/types'

// ============================================================
// Pyodide 인스턴스 (초기화 후 재사용)
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pyodide: any = null

function post(msg: CodeRunnerOutMessage): void {
  self.postMessage(msg)
}

// ============================================================
// 패키지 목록 (Section 10.1)
// ============================================================

const PRELOADED_PACKAGES = ['numpy', 'pandas', 'matplotlib', 'scipy', 'sympy']

/**
 * Python import 이름 → Pyodide/pip 패키지 이름 매핑.
 * import 감지 시 이 이름으로 micropip.install을 호출합니다.
 */
const AVAILABLE_MAP: Record<string, string> = {
  sklearn:      'scikit-learn',
  networkx:     'networkx',
  PIL:          'pillow',
  bs4:          'beautifulsoup4',
  regex:        'regex',
  yaml:         'pyyaml',
  jsonschema:   'jsonschema',
  cryptography: 'cryptography',
}

/**
 * 이 Worker 세션에서 이미 설치된 AVAILABLE 패키지.
 * 재실행 시 "설치 중..." 메시지가 반복되지 않도록 추적합니다.
 */
const installedAvailable = new Set<string>()

// ============================================================
// 비지원 패키지 매핑 (Section 10.2)
// ============================================================

const UNSUPPORTED_MAP: Record<string, string | null> = {
  tensorflow: '💡 TensorFlow는 GPU가 필요해 브라우저에서 실행할 수 없습니다.\n   대안: NumPy + SciPy로 기초 ML 실습은 가능합니다.',
  tf:         '💡 TensorFlow는 GPU가 필요해 브라우저에서 실행할 수 없습니다.',
  torch:      '💡 PyTorch는 GPU/네이티브 바이너리가 필요해 브라우저에서 실행할 수 없습니다.',
  torchvision:'💡 torchvision은 PyTorch에 의존하므로 브라우저에서 지원되지 않습니다.',
  cv2:        '💡 OpenCV는 네이티브 라이브러리여서 브라우저에서 실행 불가합니다.\n   대안: Pillow(PIL)로 기본 이미지 처리는 가능합니다.',
  requests:   '💡 네트워크 요청은 브라우저 보안 정책으로 불가합니다.\n   대안: JavaScript 탭에서 fetch API를 사용해보세요.',
  urllib3:    '💡 네트워크 요청은 브라우저 보안 정책으로 불가합니다.',
  httpx:      '💡 네트워크 요청은 브라우저 보안 정책으로 불가합니다.',
  aiohttp:    '💡 네트워크 요청은 브라우저 보안 정책으로 불가합니다.',
  flask:      '💡 Flask는 서버 프레임워크로 브라우저에서 실행할 수 없습니다.',
  django:     '💡 Django는 서버 프레임워크로 브라우저에서 실행할 수 없습니다.',
  fastapi:    '💡 FastAPI는 서버 프레임워크로 브라우저에서 실행할 수 없습니다.',
  psycopg2:   '💡 데이터베이스 드라이버는 브라우저 환경에서 지원되지 않습니다.',
  pymongo:    '💡 데이터베이스 드라이버는 브라우저 환경에서 지원되지 않습니다.',
  redis:      '💡 데이터베이스 드라이버는 브라우저 환경에서 지원되지 않습니다.',
  subprocess: '💡 subprocess는 브라우저 보안 정책으로 허용되지 않습니다.\n   대안: 코드 내 로직으로 직접 구현하세요.',
  os:         null,  // os 모듈 자체는 허용 (os.path 등), os.system만 문제
  socket:     '💡 소켓 통신은 브라우저 환경에서 지원되지 않습니다.',
}

/**
 * import 이름에서 비지원/사용 가능 여부를 판단해 에러 메시지를 반환합니다.
 * null 반환 = 문제 없음.
 */
function handleImportError(moduleName: string): string | null {
  if (moduleName in UNSUPPORTED_MAP) return UNSUPPORTED_MAP[moduleName]
  return null  // 알 수 없는 모듈: Python 자연 ImportError로 처리
}

// ============================================================
// 임포트 이름 추출 헬퍼
// ============================================================

function extractImportNames(source: string): string[] {
  const names: string[] = []
  // import foo, from foo import bar, from foo.bar import baz
  const re = /^\s*(?:import|from)\s+([\w.]+)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    names.push(m[1].split('.')[0])
  }
  return [...new Set(names)]
}

// ============================================================
// Pyodide 초기화 + 기본 패키지 로딩
// ============================================================

async function initPyodide(): Promise<void> {
  post({ type: 'progress', percent: 0 })

  try {
    // CDN ESM 동적 import — TypeScript 정적 분석 + Vite 번들링 모두 우회
    const pyodideUrl = 'https://cdn.jsdelivr.net/pyodide/v0.26.0/full/pyodide.mjs'
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-explicit-any
    const { loadPyodide } = await (Function('u', 'return import(u)')(pyodideUrl)) as any

    post({ type: 'progress', percent: 10 })

    pyodide = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.0/full/',
    })

    post({ type: 'progress', percent: 40 })

    // 기본 패키지 사전 로딩 (대학 코딩 수업 90% 커버)
    await pyodide.loadPackage(PRELOADED_PACKAGES)
    // PRELOADED를 설치 완료 목록으로 등록 (AVAILABLE과 중복 방지)
    PRELOADED_PACKAGES.forEach((p) => installedAvailable.add(p))

    post({ type: 'progress', percent: 90 })

    // micropip 사전 로딩 (온디맨드 패키지 설치에 필요)
    await pyodide.loadPackage('micropip')

    // stdlib 확인
    await pyodide.runPythonAsync('import sys, io, statistics, micropip')

    post({ type: 'progress', percent: 100 })
    post({ type: 'ready' })

  } catch (err) {
    console.error('[codeRunner.worker] Pyodide 초기화 실패:', err)
    post({ type: 'error', snippetId: '', message: `Pyodide 초기화 실패: ${String(err)}` })
  }
}

// ============================================================
// Python 실행
// ============================================================

async function runPython(snippetId: string, source: string): Promise<void> {
  if (!pyodide) {
    post({ type: 'stderr', snippetId, text: 'Pyodide가 준비되지 않았습니다.' })
    post({ type: 'result', snippetId, executionTime: 0, status: 'error' })
    return
  }

  const startTime = performance.now()
  let hasError = false

  // ── 1단계: import 분석 ─────────────────────────────────
  const importNames = extractImportNames(source)

  // 1a. 비지원 패키지 사전 감지
  for (const mod of importNames) {
    const errMsg = handleImportError(mod)
    if (errMsg) {
      post({ type: 'stderr', snippetId, text: errMsg })
      hasError = true
    }
  }

  if (hasError) {
    const executionTime = Math.round(performance.now() - startTime)
    post({ type: 'result', snippetId, executionTime, status: 'error' })
    return
  }

  // ── 2단계: AVAILABLE 패키지 온디맨드 설치 ────────────
  const toInstall = importNames.filter(
    (mod) => AVAILABLE_MAP[mod] && !installedAvailable.has(AVAILABLE_MAP[mod]),
  )

  if (toInstall.length > 0) {
    for (const mod of toInstall) {
      const pkgName = AVAILABLE_MAP[mod]
      post({ type: 'output', snippetId, text: `📦 '${pkgName}' 설치 중... (최초 1회, 잠시 기다려주세요)` })
      try {
        await pyodide.runPythonAsync(`
import micropip
await micropip.install('${pkgName}')
        `)
        installedAvailable.add(pkgName)
        post({ type: 'output', snippetId, text: `✅ '${pkgName}' 설치 완료` })
      } catch (installErr) {
        post({ type: 'stderr', snippetId, text: `⚠️ '${pkgName}' 설치 실패: ${String(installErr)}` })
        hasError = true
      }
    }

    if (hasError) {
      const executionTime = Math.round(performance.now() - startTime)
      post({ type: 'result', snippetId, executionTime, status: 'error' })
      return
    }
  }

  // ── 3단계: Pyodide 자동 패키지 로딩 (나머지 알려진 패키지) ──
  try {
    await pyodide.loadPackagesFromImports(source)
  } catch {
    // 알 수 없는 패키지는 Python 단계에서 자연스러운 ImportError 발생
  }

  // ── 4단계: stdout/stderr 리다이렉트 설정 ─────────────
  pyodide.setStdout({
    batched: (text: string) => post({ type: 'output', snippetId, text }),
  })
  pyodide.setStderr({
    batched: (text: string) => post({ type: 'stderr', snippetId, text }),
  })

  // ── 5단계: 코드 실행 ──────────────────────────────────
  try {
    const result = await pyodide.runPythonAsync(source)
    if (result !== undefined && result !== null) {
      const repr = String(result)
      if (repr !== 'None') post({ type: 'output', snippetId, text: repr })
    }
  } catch (err: unknown) {
    hasError = true
    const msg = err instanceof Error ? err.message : String(err)
    // ModuleNotFoundError 특별 처리
    if (msg.includes('ModuleNotFoundError') || msg.includes('No module named')) {
      const match = msg.match(/No module named ['"]?([\w.]+)/)
      if (match) {
        const mod = match[1].split('.')[0]
        const friendly = UNSUPPORTED_MAP[mod]
        post({ type: 'stderr', snippetId, text: friendly
          ?? `⚠️ '${mod}' 모듈을 찾을 수 없습니다.\n   지원 라이브러리: numpy, pandas, matplotlib, scipy, sympy 등`
        })
      } else {
        post({ type: 'stderr', snippetId, text: msg })
      }
    } else {
      post({ type: 'stderr', snippetId, text: msg })
    }
  }

  const executionTime = Math.round(performance.now() - startTime)
  post({ type: 'result', snippetId, executionTime, status: hasError ? 'error' : 'ok' })
}

// ============================================================
// 메시지 핸들러
// ============================================================

self.onmessage = async (e: MessageEvent<CodeRunnerInMessage>): Promise<void> => {
  const msg = e.data

  if (msg.type === 'init') {
    await initPyodide()
    return
  }

  if (msg.type === 'run') {
    await runPython(msg.snippetId, msg.source)
    return
  }

  if (msg.type === 'interrupt') {
    if (pyodide?.interruptBuffer) {
      pyodide.interruptBuffer[0] = 2  // SIGINT
    }
  }
}
