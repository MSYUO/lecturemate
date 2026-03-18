/**
 * @file lib/codeDetector.ts
 * LectureMate — 코드 블록 감지 휴리스틱 (Section 10.3)
 *
 * PDF 뷰어에서 텍스트를 선택했을 때 코드 블록인지 판별하고
 * 프로그래밍 언어를 자동 감지합니다.
 */

import type { EditorLanguage } from '@/stores/codeStore'

// ============================================================
// 패턴 상수
// ============================================================

/** 코드 키워드 (Python + JS/TS 공통) */
const CODE_KEYWORDS_RE =
  /\b(def|class|function|import|export|from|for|while|if|else|elif|return|const|let|var|async|await|try|except|catch|finally|print|null|undefined|True|False|None|self|this)\b/

/** Python 특화 패턴 */
const PY_RE =
  /\b(def |elif |lambda |self\.|from .+ import |print\(|raise |with |__init__|__main__)\b/

/** TypeScript 특화 패턴 */
const TS_RE =
  /\b(interface |type \w+ =|: string\b|: number\b|: boolean\b|: void\b|: any\b|: unknown\b|Readonly<|Promise<)\b/

// ============================================================
// isCodeBlock
// ============================================================

/**
 * 텍스트가 코드 블록인지 휴리스틱으로 판별합니다.
 *
 * 판별 신호:
 * - 고정폭 폰트 힌트 (fontInfo.isMonospace)
 * - 들여쓰기 비율 (2+ 공백/탭으로 시작하는 줄 비율)
 * - 코드 키워드 밀도
 * - 특수문자 밀도 (=, (, ), {, }, [, ], ;, :, <, >)
 * - Python / TypeScript 특화 패턴 직접 매칭
 *
 * @param text     선택된 텍스트
 * @param fontInfo 선택 영역 폰트 정보 (고정폭 여부 힌트)
 */
export function isCodeBlock(
  text: string,
  fontInfo?: { isMonospace?: boolean },
): boolean {
  if (!text || text.trim().length < 10) return false

  // 고정폭 폰트 힌트 — 강한 신호
  if (fontInfo?.isMonospace) return true

  const lines         = text.split('\n')
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0)
  if (nonEmptyLines.length < 1) return false

  // 단일 단어만 있으면 코드 아님
  if (nonEmptyLines.length === 1 && !/\s/.test(nonEmptyLines[0].trim())) return false

  // 들여쓰기 비율
  const indentedCount = nonEmptyLines.filter((l) => /^[ \t]{2,}/.test(l)).length
  const indentRatio   = indentedCount / nonEmptyLines.length

  // 키워드 존재 여부
  const hasKeywords = CODE_KEYWORDS_RE.test(text)

  // 특수문자 밀도
  const specials     = (text.match(/[=(){}\[\];:<>+\-*/&|!]/g) ?? []).length
  const specialRatio = specials / Math.max(text.length, 1)

  // Python / TypeScript 직접 패턴 — 하나라도 매칭되면 코드로 판단
  if (PY_RE.test(text) || TS_RE.test(text)) return true

  // 복합 규칙
  if (indentRatio > 0.3 && hasKeywords)           return true
  if (hasKeywords && specialRatio > 0.05)          return true
  if (indentRatio > 0.5 && specialRatio > 0.03)   return true

  return false
}

// ============================================================
// detectLanguage
// ============================================================

/**
 * 코드 텍스트에서 프로그래밍 언어를 자동 감지합니다.
 *
 * 우선순위: Python → TypeScript → JavaScript (기본값)
 */
export function detectLanguage(code: string): EditorLanguage {
  const pyHits = [
    /\bdef\s+\w+\s*\(/.test(code),
    /\bclass\s+\w+.*:/.test(code),
    /\belif\b/.test(code),
    /\blambda\b/.test(code),
    /\bself\b/.test(code),
    /\bprint\s*\(/.test(code),
    /\bfrom\s+[\w.]+\s+import\b/.test(code),
    /\bimport\s+\w+\s*$/.test(code),
  ].filter(Boolean).length

  const tsHits = [
    /\binterface\s+\w+/.test(code),
    /\btype\s+\w+\s*=/.test(code),
    /:\s*(string|number|boolean|void|any|unknown|never)\b/.test(code),
    /<[A-Z]\w*>/.test(code),
    /\bReadonly\b/.test(code),
    /\bexport\s+(type|interface)\b/.test(code),
  ].filter(Boolean).length

  if (pyHits >= 2 || (pyHits >= 1 && tsHits === 0)) return 'python'
  if (tsHits >= 1) return 'typescript'
  return 'javascript'
}
