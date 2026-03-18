/**
 * @file lib/mathParser.ts
 * LectureMate — 한국어 자연어 → LaTeX → KaTeX 렌더링 파이프라인
 *
 * ## 파이프라인
 *   입력 텍스트
 *     └→ isMathExpression()   점수 기반 수식 감지 (임계값 3)
 *           └→ naturalLanguageToLatex()  다단계 변환
 *                 ├─ Pass 1: 구조 패턴 (분수, 합산기호, 적분, 극한, 루트, 벡터, 편미분 …)
 *                 ├─ Pass 2: 지수 패턴 (제곱, 세제곱, n제곱)
 *                 ├─ Pass 3: 단순 토큰 치환 (그리스 문자, 연산자 …)
 *                 └─ Pass 4: 정리 (x^2 → x^{2})
 *                       └→ renderMath()   KaTeX HTML 생성
 *
 * ## 변환 예시
 *   "시그마 i=1 에서 n"  → \sum_{i=1}^{n}
 *   "3 분의 1"           → \frac{1}{3}
 *   "인테그랄 0에서 1"   → \int_{0}^{1}
 *   "리밋 x → 0"         → \lim_{x \to 0}
 *   "루트 x"             → \sqrt{x}
 *   "x 벡터"             → \vec{x}
 *   "편미분 f 편미분 x"  → \frac{\partial f}{\partial x}
 *   "알파 제곱"          → \alpha^{2}
 */

import katex from 'katex'
import { KOREAN_MATH_MAP, STRUCTURAL_KEYS } from '@/lib/mathDictionary'

// ============================================================
// 수식 감지
// ============================================================

/**
 * 점수 기반 수식 감지 휴리스틱.
 *
 * 채점 방식:
 *   - 한국어 수학 용어(KOREAN_MATH_MAP 키) 발견: +3점
 *   - 수학 기호 정규식 매칭: +2점
 *
 * 임계값 3 이상이면 수식으로 판단합니다.
 *
 * @example
 *   isMathExpression("알파 + 베타")  → true  (알파: +3, 베타: +3)
 *   isMathExpression("x + y = z")   → true  (기호: +2, 패턴: +2)
 *   isMathExpression("오늘 날씨 좋다") → false (0점)
 */
export function isMathExpression(text: string): boolean {
  // 수학 기호/패턴 정규식 — 매칭 시 각 +2점
  const regexIndicators: RegExp[] = [
    /[=+\-×÷≠≥≤≈∝∞∈⊂∪∩]/,         // 수학 기호 문자
    /\^/,                              // 지수 표기
    /제곱|세제곱/,                     // 한국어 지수
    /분의/,                            // 한국어 분수
    /^[a-zA-Z]\s*[+\-*/=]\s*[a-zA-Z0-9]/, // 변수 식 (x + y, a = b)
    /\d+\s*[+\-*/=]\s*\d+/,           // 숫자 연산 (1 + 2, 3 = 3)
    /[∫∑∏∂∇]/,                        // 특수 수학 기호
  ]

  let score = 0

  // 한국어 수학 용어 포함 여부 (+3점)
  for (const term of Object.keys(KOREAN_MATH_MAP)) {
    if (text.includes(term)) {
      score += 3
      if (score >= 3) return true   // 조기 종료
    }
  }

  // 수학 기호 패턴 (+2점)
  for (const rx of regexIndicators) {
    if (rx.test(text)) {
      score += 2
      if (score >= 3) return true
    }
  }

  return score >= 3
}

// ============================================================
// 자연어 → LaTeX 변환
// ============================================================

/**
 * 단일 토큰을 KOREAN_MATH_MAP에서 변환합니다.
 * 사전에 없으면 원본 그대로 반환합니다.
 */
function convertToken(token: string): string {
  const trimmed = token.trim()
  const mapped  = KOREAN_MATH_MAP[trimmed]
  // 구조 마커(__FRAC__ 등)는 그대로 반환하지 않고 원본 유지
  if (mapped !== undefined && !mapped.startsWith('__')) return mapped
  return trimmed
}

/**
 * 한국어 자연어 수식 표현을 LaTeX 문자열로 변환합니다.
 *
 * 처리 순서 (순서 중요):
 *   Pass 1 — 구조 패턴 (다중 토큰 패턴, 먼저 소비)
 *   Pass 2 — 지수 패턴 (제곱류, 토큰 치환 전에 처리)
 *   Pass 3 — 단순 토큰 치환 (그리스 문자, 연산자)
 *   Pass 4 — 정리 (x^2 → x^{2})
 */
export function naturalLanguageToLatex(input: string): string {
  let latex = input

  // ── Pass 1: 구조 패턴 ────────────────────────────────────

  // 편미분 f 편미분 x → \frac{\partial f}{\partial x}
  // (다른 규칙보다 먼저 처리 — '편미분' 토큰이 중복 소비되지 않도록)
  latex = latex.replace(
    /편미분\s+(\S+)\s+편미분\s+(\S+)/g,
    (_, f, x) => `\\frac{\\partial ${convertToken(f)}}{\\partial ${convertToken(x)}}`,
  )

  // 시그마/합계 i=1 에서 n → \sum_{i=1}^{n}
  latex = latex.replace(
    /(시그마|서메이션|합계)\s+(\S+=\S+)\s+에서\s+(\S+)/g,
    (_, _op, lower, upper) => `\\sum_{${lower}}^{${convertToken(upper)}}`,
  )

  // 프로덕트 i=1 에서 n → \prod_{i=1}^{n}
  latex = latex.replace(
    /(프로덕트)\s+(\S+=\S+)\s+에서\s+(\S+)/g,
    (_, _op, lower, upper) => `\\prod_{${lower}}^{${convertToken(upper)}}`,
  )

  // 인테그랄/적분 a에서 b 또는 a 에서 b → \int_{a}^{b}
  latex = latex.replace(
    /(인테그랄|적분)\s+(\S+?)\s*에서\s+(\S+)/g,
    (_, _op, lower, upper) =>
      `\\int_{${convertToken(lower)}}^{${convertToken(upper)}}`,
  )

  // 리밋/극한 x → 0 또는 x->0 → \lim_{x \to 0}
  latex = latex.replace(
    /(리밋|극한)\s+(\S+)\s*[→\->]+\s*(\S+)/g,
    (_, _op, variable, target) =>
      `\\lim_{${variable} \\to ${convertToken(target)}}`,
  )

  // a 분의 b → \frac{b}{a}  (한국어: 분모가 먼저 나옴)
  latex = latex.replace(
    /(\S+)\s+분의\s+(\S+)/g,
    (_, denom, numer) =>
      `\\frac{${convertToken(numer)}}{${convertToken(denom)}}`,
  )

  // 루트/제곱근 expr → \sqrt{expr}  (단일 토큰만 캡처)
  latex = latex.replace(
    /(루트|제곱근)\s+(\S+)/g,
    (_, _op, expr) => `\\sqrt{${convertToken(expr)}}`,
  )

  // x 벡터 → \vec{x}
  latex = latex.replace(
    /(\S+)\s+벡터/g,
    (_, v) => `\\vec{${v}}`,
  )

  // f 프라임 → f'   /   f 더블프라임 → f''
  latex = latex.replace(
    /(\S+)\s+더블프라임/g,
    (_, f) => `${f}''`,
  )
  latex = latex.replace(
    /(\S+)\s+프라임/g,
    (_, f) => `${f}'`,
  )

  // A 역행렬 → A^{-1}
  latex = latex.replace(
    /(\S+)\s+역행렬/g,
    (_, m) => `${m}^{-1}`,
  )

  // A 전치 → A^{T}
  latex = latex.replace(
    /(\S+)\s+전치/g,
    (_, m) => `${m}^{T}`,
  )

  // ── Pass 2: 지수 패턴 (토큰 치환 전에 처리) ────────────────
  // 순서 중요: 세제곱·n제곱을 제곱보다 먼저 처리해야 "세제곱"이 "제곱"으로 부분 치환되지 않음

  // x 세제곱 → x^{3}
  latex = latex.replace(/(\S+)\s+세제곱/g, '$1^{3}')
  // x n제곱 → x^{n}
  latex = latex.replace(/(\S+)\s+n제곱/g,  '$1^{n}')
  // x 제곱 → x^{2}
  latex = latex.replace(/(\S+)\s+제곱/g,   '$1^{2}')

  // ── Pass 3: 단순 토큰 치환 (그리스 문자, 연산자 등) ─────────
  // 긴 키를 먼저 처리해야 부분 일치 오류를 방지합니다.
  // 예: "무한대"를 "무한" 보다 먼저 치환해야 "\infty대" 방지

  const sortedEntries = Object.entries(KOREAN_MATH_MAP)
    .filter(([k, v]) => !STRUCTURAL_KEYS.has(k) && !v.startsWith('__'))
    .sort(([a], [b]) => b.length - a.length)   // 긴 키 우선

  for (const [korean, latexToken] of sortedEntries) {
    latex = latex.replaceAll(korean, latexToken)
  }

  // ── Pass 4: 정리 ────────────────────────────────────────────

  // 괄호 없는 지수 표기 정규화: x^2 → x^{2}  (이미 중괄호 있는 것은 패스)
  latex = latex.replace(/(\S)\^(\d+)(?!\})/g, '$1^{$2}')

  return latex
}

// ============================================================
// KaTeX 렌더링
// ============================================================

/**
 * LaTeX 문자열을 KaTeX HTML로 렌더링합니다.
 * 변환 실패 시 에러 메시지를 감싼 `<span>`을 반환합니다.
 *
 * @param latex — KaTeX 문법 LaTeX 문자열
 * @returns HTML 문자열 (dangerouslySetInnerHTML에 사용 가능)
 */
export function renderMath(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode:  false,   // 인라인 모드 (텍스트 상자 내)
      output:       'html',
    })
  } catch {
    return `<span class="math-error" title="수식 변환 실패">${latex}</span>`
  }
}

// ============================================================
// 통합 함수
// ============================================================

export interface MathConvertResult {
  /** 변환된 LaTeX 문자열 */
  latex:     string
  /** KaTeX 렌더링 HTML (dangerouslySetInnerHTML 용) */
  katexHtml: string
}

/**
 * 텍스트를 감지 → 변환 → 렌더링하는 통합 함수.
 *
 * 수식이 아닌 것으로 판단되면 `null`을 반환합니다.
 * TextBoxComponent의 onBlur 핸들러에서 호출합니다.
 *
 * @example
 *   const result = await detectAndConvertMath("시그마 i=1 에서 n")
 *   // result.latex    → "\\sum_{i=1}^{n}"
 *   // result.katexHtml → "<span class='katex'>...</span>"
 */
export async function detectAndConvertMath(
  text: string,
): Promise<MathConvertResult | null> {
  if (!isMathExpression(text)) return null

  const latex    = naturalLanguageToLatex(text)
  const katexHtml = renderMath(latex)

  return { latex, katexHtml }
}
