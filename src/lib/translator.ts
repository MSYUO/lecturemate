/**
 * @file lib/translator.ts
 * LectureMate — LibreTranslate 번역 엔진 연동
 *
 * 공개 LibreTranslate 엔드포인트를 순서대로 시도하고 실패 시 다음으로 fallback합니다.
 * 긴 텍스트는 500자 단위로 분할하여 요청하고 결과를 합칩니다.
 */

// ============================================================
// 엔드포인트 목록 (순서대로 fallback)
// ============================================================

const ENDPOINTS = [
  'https://libretranslate.com',
  'https://translate.argosopentech.com',
  'https://translate.terraprint.co',
]

const CHUNK_SIZE = 500

// ============================================================
// 내부 헬퍼
// ============================================================

async function fetchTranslate(
  endpoint: string,
  text: string,
  source: string,
  target: string,
): Promise<string> {
  const res = await fetch(`${endpoint}/translate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ q: text, source, target, format: 'text' }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json() as { translatedText: string }
  return json.translatedText
}

// ============================================================
// 공개 API
// ============================================================

/**
 * 텍스트 언어를 자동 감지합니다.
 * 모든 엔드포인트 실패 시 'auto'를 반환합니다.
 */
export async function detectLang(text: string): Promise<string> {
  const sample = text.slice(0, 200)
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}/detect`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ q: sample }),
      })
      if (!res.ok) continue
      const json = await res.json() as Array<{ language: string; confidence: number }>
      if (json.length > 0) return json[0].language
    } catch {
      // 다음 엔드포인트 시도
    }
  }
  return 'auto'
}

/**
 * 텍스트를 번역합니다.
 * 500자 단위로 분할하여 요청하고 합칩니다.
 * 모든 엔드포인트 실패 시 Error("번역 서버에 연결할 수 없습니다") throw.
 */
export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> {
  // 500자 단위 청크 분할
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE))
  }
  if (chunks.length === 0) return ''

  const results: string[] = []

  for (const chunk of chunks) {
    let success = false
    for (const endpoint of ENDPOINTS) {
      try {
        const result = await fetchTranslate(endpoint, chunk, sourceLang, targetLang)
        results.push(result)
        success = true
        break
      } catch {
        // 다음 엔드포인트 시도
      }
    }
    if (!success) {
      throw new Error('번역 서버에 연결할 수 없습니다')
    }
  }

  return results.join(' ')
}

// ============================================================
// 언어 메타데이터
// ============================================================

export const LANG_LABELS: Record<string, string> = {
  ko:   '한국어',
  en:   'English',
  fr:   'Français',
  de:   'Deutsch',
  ru:   'Русский',
  ja:   '日本語',
  zh:   '中文',
  es:   'Español',
  auto: '자동',
}
