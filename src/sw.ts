/**
 * @file src/sw.ts
 * LectureMate — Service Worker (Section 7.2)
 *
 * ## 캐싱 전략
 *
 * ### 앱 셸 (precache)
 * vite-plugin-pwa가 빌드 시 `self.__WB_MANIFEST`에 JS/CSS/HTML 해시 목록을
 * 주입합니다. `precacheAndRoute()`가 이를 받아 캐시하고, 오프라인에서
 * index.html 등을 제공합니다.
 *
 * ### Whisper 모델 파일 (runtime · CacheFirst)
 * HuggingFace CDN(huggingface.co, cdn-lfs.huggingface.co)의 응답을
 * 'whisper-model-cache-v1' 캐시에 저장합니다.
 * 앱 버전이 올라가도 이 캐시는 유지됩니다 (purgeOnQuotaError: false).
 *
 * ## 업데이트 흐름
 * `skipWaiting()` + `clientsClaim()` → 새 SW가 설치되는 즉시 모든 탭을 제어.
 * `registerType: 'autoUpdate'`와 짝을 이루어 사용자 개입 없이 업데이트됩니다.
 */

/// <reference lib="webworker" />
import { clientsClaim, skipWaiting } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import type { PrecacheEntry } from 'workbox-precaching'

// ============================================================
// 전역 타입 확장
// ============================================================

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | PrecacheEntry)[]
}

// ============================================================
// 즉시 활성화
// ============================================================

/** 새 SW가 installed 되는 즉시 waiting 단계를 건너뜁니다. */
skipWaiting()

/** 새 SW가 활성화되는 순간 열려 있는 모든 클라이언트를 즉시 제어합니다. */
clientsClaim()

// ============================================================
// 앱 셸 프리캐시
// ============================================================

/**
 * 이전 버전의 precache 항목을 정리합니다.
 * 앱 업데이트 시 구버전 JS/CSS 캐시가 삭제됩니다.
 * 모델 캐시(별도 cacheName)는 영향받지 않습니다.
 */
cleanupOutdatedCaches()

/**
 * 빌드 결과물(JS, CSS, HTML, 아이콘, 폰트)을 프리캐시합니다.
 * `self.__WB_MANIFEST`는 vite-plugin-pwa가 빌드 시 주입하는
 * `[{ url, revision }]` 목록입니다.
 */
precacheAndRoute(self.__WB_MANIFEST)

// ============================================================
// Whisper 모델 파일 — CacheFirst (영구 캐시)
// ============================================================

/**
 * HuggingFace CDN에서 받아오는 모델 파일을 CacheFirst로 캐시합니다.
 *
 * 대상 호스트:
 * - huggingface.co             (메인 CDN)
 * - cdn-lfs.huggingface.co     (LFS 저장소)
 * - cdn-lfs-us-1.huggingface.co
 *
 * CacheFirst 선택 이유:
 * - ONNX 모델(~100 MB)은 버전이 고정됨 → 네트워크 재조회 불필요
 * - 오프라인 시에도 모델이 즉시 제공되어야 함
 *
 * 별도 cacheName('whisper-model-cache-v1')을 사용해
 * `cleanupOutdatedCaches()`의 precache 정리 대상에서 제외됩니다.
 */
registerRoute(
  ({ url }) =>
    url.hostname === 'huggingface.co' ||
    url.hostname.endsWith('.huggingface.co'),
  new CacheFirst({
    cacheName: 'whisper-model-cache-v1',
    plugins: [
      /**
       * HuggingFace CDN은 CORS 헤더를 제공하므로 status:200 가능.
       * opaque 응답(status:0)도 포함해 CORS 없는 서브도메인에 대비합니다.
       */
      new CacheableResponsePlugin({ statuses: [0, 200] }),

      new ExpirationPlugin({
        /** 모델 파일 수 상한 (base + large 등 여러 모델 대비) */
        maxEntries: 200,
        /** 1년 — 재다운로드 최소화 */
        maxAgeSeconds: 365 * 24 * 60 * 60,
        /**
         * 저장 공간 부족 시에도 모델 캐시를 유지합니다.
         * 400 MB 재다운로드를 방지하는 것이 스토리지 절약보다 중요합니다.
         */
        purgeOnQuotaError: false,
      }),
    ],
  }),
)
