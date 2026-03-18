/**
 * @file components/code/SupportedPackagesInfo.tsx
 * LectureMate — 코드 에디터 지원 라이브러리 접이식 패널 (Section 10.1)
 *
 * Python 탭에서 에디터 하단에 표시됩니다.
 * 클릭하면 펼쳐져 사전 로딩 / 온디맨드 / 비지원 패키지 목록을 보여줍니다.
 */

import { useState } from 'react'

// ============================================================
// 패키지 데이터
// ============================================================

const PRELOADED = [
  { name: 'numpy',      desc: '수치 계산 · 배열' },
  { name: 'pandas',     desc: '데이터 분석' },
  { name: 'matplotlib', desc: '시각화' },
  { name: 'scipy',      desc: '과학 계산' },
  { name: 'sympy',      desc: '기호 수학' },
  { name: 'statistics', desc: '통계 (stdlib)' },
]

const ON_DEMAND = [
  { name: 'scikit-learn', importAs: 'sklearn',   desc: '머신러닝' },
  { name: 'networkx',     importAs: 'networkx',  desc: '그래프 이론' },
  { name: 'pillow',       importAs: 'PIL',        desc: '이미지 처리' },
  { name: 'beautifulsoup4', importAs: 'bs4',      desc: 'HTML 파싱' },
  { name: 'regex',        importAs: 'regex',      desc: '정규표현식 확장' },
  { name: 'pyyaml',       importAs: 'yaml',       desc: 'YAML 파싱' },
  { name: 'jsonschema',   importAs: 'jsonschema', desc: 'JSON 검증' },
]

const UNSUPPORTED_EXAMPLES = [
  'tensorflow', 'torch', 'cv2', 'requests', 'flask', 'django', 'subprocess',
]

// ============================================================
// 작은 배지 컴포넌트
// ============================================================

function PackageBadge({
  name,
  color,
  note,
}: {
  name: string
  color: string
  note?: string
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
      style={{ backgroundColor: color, color: 'var(--text-primary)', fontFamily: 'monospace' }}
      title={note}
    >
      {name}
    </span>
  )
}

// ============================================================
// SupportedPackagesInfo
// ============================================================

export function SupportedPackagesInfo() {
  const [open, setOpen] = useState(false)

  return (
    <div
      className="shrink-0 mx-2 mb-1 overflow-hidden rounded-lg"
      style={{ border: '1px solid var(--border-subtle)' }}
    >
      {/* ── 접이식 헤더 ─────────────────────────────────── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          color:           'var(--text-muted)',
          border:          'none',
          cursor:          'pointer',
        }}
      >
        <span className="flex items-center gap-1.5">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          지원 라이브러리
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          style={{
            transform:  open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 180ms ease',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* ── 콘텐츠 ──────────────────────────────────────── */}
      {open && (
        <div
          className="px-3 py-3 flex flex-col gap-3"
          style={{ backgroundColor: 'var(--bg-primary)' }}
        >
          {/* 사전 로딩 */}
          <section>
            <p
              className="text-xs font-medium mb-1.5"
              style={{ color: 'var(--text-muted)' }}
            >
              ✅ 사전 로딩됨 (즉시 사용 가능)
            </p>
            <div className="flex flex-wrap gap-1">
              {PRELOADED.map(({ name, desc }) => (
                <PackageBadge
                  key={name}
                  name={name}
                  color="rgba(34,197,94,0.12)"
                  note={desc}
                />
              ))}
            </div>
          </section>

          {/* 온디맨드 */}
          <section>
            <p
              className="text-xs font-medium mb-1.5"
              style={{ color: 'var(--text-muted)' }}
            >
              📦 요청 시 설치 (최초 import 시 자동 설치)
            </p>
            <div className="flex flex-wrap gap-1">
              {ON_DEMAND.map(({ name, importAs, desc }) => (
                <PackageBadge
                  key={name}
                  name={importAs}
                  color="rgba(59,130,246,0.1)"
                  note={`import ${importAs}  (${name}) — ${desc}`}
                />
              ))}
            </div>
            <p
              className="text-xs mt-1.5"
              style={{ color: 'var(--text-disabled)' }}
            >
              배지 위에 마우스를 올리면 패키지 이름과 설명을 확인할 수 있습니다.
            </p>
          </section>

          {/* 비지원 */}
          <section>
            <p
              className="text-xs font-medium mb-1.5"
              style={{ color: '#f97316' }}
            >
              ⚠️ 지원되지 않음 (GPU·네트워크·서버 프레임워크)
            </p>
            <div className="flex flex-wrap gap-1">
              {UNSUPPORTED_EXAMPLES.map((name) => (
                <PackageBadge
                  key={name}
                  name={name}
                  color="rgba(239,68,68,0.08)"
                  note="이 환경에서 지원되지 않습니다"
                />
              ))}
            </div>
            <p
              className="text-xs mt-1.5 leading-relaxed"
              style={{ color: 'var(--text-disabled)' }}
            >
              GPU가 필요한 라이브러리(tensorflow, torch, cv2)와 네트워크 I/O(requests, urllib3),
              서버 프레임워크(flask, django, subprocess)는 브라우저 환경에서 실행할 수 없습니다.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
