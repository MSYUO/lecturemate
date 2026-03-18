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
      // react-pdf 10이 내부에 pdfjs-dist 5.4.x를 별도로 번들합니다.
      // 루트의 pdfjs-dist(5.5.x)와 버전이 달라 workerSrc ↔ 라이브러리 간
      // 프로토콜 불일치가 발생하므로, 모든 pdfjs-dist 참조를
      // react-pdf 내부 버전으로 단일화합니다.
      'pdfjs-dist': path.resolve(
        __dirname,
        './node_modules/react-pdf/node_modules/pdfjs-dist',
      ),
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
    exclude: ['@xenova/transformers'],
  },

  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  test: {
    environment: 'node',
    globals:     true,
    alias: {
      '@': path.resolve(__dirname, './src'),
      'pdfjs-dist': path.resolve(
        __dirname,
        './node_modules/react-pdf/node_modules/pdfjs-dist',
      ),
    },
  },
})
