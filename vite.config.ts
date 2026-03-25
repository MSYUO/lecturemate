import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),

    VitePWA({
      /**
       * autoUpdate: 새 SW가 설치되면 사용자 확인 없이 자동 업데이트.
       * sw.ts의 skipWaiting() + clientsClaim()과 짝을 이룸.
       */
      registerType: 'autoUpdate',

      /**
       * injectManifest: src/sw.ts를 직접 컴파일하고
       * self.__WB_MANIFEST 에 프리캐시 목록을 주입합니다.
       */
      strategies: 'injectManifest',
      srcDir:     'src',
      filename:   'sw.ts',

      /** Web App Manifest */
      manifest: {
        name:             'LectureMate',
        short_name:       'LectureMate',
        description:      'PDF + 실시간 STT + 코드 실행 학습 도구',
        theme_color:      '#1a1a2e',
        background_color: '#1a1a2e',
        display:          'standalone',
        lang:             'ko',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },

      injectManifest: {
        /**
         * 프리캐시 대상: 빌드된 JS/CSS/HTML/폰트/아이콘.
         * WASM, ONNX, .bin 모델 파일은 runtime CacheFirst로 처리하므로 제외.
         */
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores:  ['**/*.wasm', '**/*.onnx', '**/*.bin'],
      },

      /**
       * 개발 서버에서는 SW를 비활성화합니다.
       * SW가 활성화되면 HMR(Hot Module Replacement)과 충돌할 수 있습니다.
       */
      devOptions: {
        enabled: false,
      },
    }),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  worker: {
    format: 'es',
  },

  build: {
    rollupOptions: {
      output: {
        /**
         * 무거운 라이브러리를 별도 청크로 분리해 초기 번들 크기를 줄입니다.
         * 각 청크는 필요 시점에만 동적 로드됩니다.
         *
         * 청크 목적:
         *   vendor-pdf    — PDF 렌더링 (react-pdf + pdfjs-dist, ~1.5 MB)
         *   vendor-monaco — 코드 에디터 (lazy-load, ~2 MB)
         *   vendor-audio  — 오디오 파형 시각화 (~300 KB)
         *   vendor-katex  — 수식 렌더링 (~200 KB)
         *   vendor-dnd    — 드래그앤드롭 (~50 KB)
         */
        manualChunks(id) {
          if (id.includes('react-pdf') || id.includes('pdfjs-dist'))  return 'vendor-pdf'
          if (id.includes('@monaco-editor'))                           return 'vendor-monaco'
          if (id.includes('wavesurfer'))                              return 'vendor-audio'
          if (id.includes('katex'))                                   return 'vendor-katex'
          if (id.includes('@dnd-kit'))                                return 'vendor-dnd'
        },
      },
    },
  },

  optimizeDeps: {
    // react-pdf / pdfjs-dist: new URL(..., import.meta.url) 브라우저 전용 API 사용.
    // Vite pre-bundle(esbuild/Node.js 컨텍스트)에서 깨지므로 반드시 exclude.
    exclude: ['@xenova/transformers', 'react-pdf', 'pdfjs-dist'],
    // warning: CJS 모듈 → react-pdf 의존성. exclude된 패키지 트리 안에서
    // ESM default import로 사용되므로 Vite가 CJS→ESM 변환하도록 명시적 include.
    include: ['warning'],
  },

  server: {
    headers: {
      // COEP 제거: require-corp가 HuggingFace CDN fetch를 차단해 Whisper 모델
      // 다운로드 실패("AI 오류") 원인. 프로덕션은 public/_headers에서 SW 캐시와
      // 함께 적용되므로 dev에서만 제거.
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },

  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },

  test: {
    environment: 'node',
    globals:     true,
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
