# LectureMate

> 서버 없이, 인터넷 없이 — 브라우저 하나로 완성하는 스마트 강의 노트

**PDF 뷰어 + 로컬 AI 음성 인식 + 코드 실행 + 수식 변환**을 하나의 탭에서.

### 핵심 차별화

| | |
|---|---|
| **완전 오프라인** | Whisper AI가 브라우저 안에서 직접 실행 — 음성 데이터가 서버로 나가지 않음 |
| **데이터 유실 제로** | WAL(Write-Ahead Log) 크래시 복구 + 3초 자동 저장 |
| **WASM 통합 환경** | 같은 탭에서 Python 코드를 실행하고 수식을 LaTeX으로 변환 |

---

## 주요 기능

- **PDF 뷰어 + 오버레이 필기** — 형광펜(5색), 어노테이션, 텍스트 박스, 스티커를 PDF 위에 직접 오버레이
- **실시간 음성 인식** — Whisper-base quantized(~100 MB) 완전 로컬 실행, 오프라인 지원
- **3단계 태깅** — 점·영역·페이지 단위 타임스탬프 태그로 강의 구간 즉시 복귀
- **수식 자동 변환** — 한국어 수식어 → LaTeX 변환 → KaTeX 렌더링
- **Monaco 코드 에디터 + Python/JS 실행** — Pyodide(Python WASM) 내장, 결과를 노트에 포함
- **4차원 통합 검색** — STT 텍스트·어노테이션·수식·코드를 Fuse.js 퍼지 검색으로 한번에
- **북마크 + 드래그 앤 드롭** — STT 세그먼트를 PDF 페이지로 드래그해 연결
- **4가지 내보내기** — Markdown · HTML(KaTeX 렌더링) · PDF(pdf-lib 합성) · 노트 전용
- **PWA** — 홈 화면 설치, Workbox 오프라인 캐시, 앱 자동 업데이트

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| UI | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| 상태 관리 | Zustand 5 (Sliced Store 패턴) |
| 데이터 저장 | Dexie.js v4 (IndexedDB) + OPFS (오디오·PDF 바이너리) |
| PDF | react-pdf 10 (PDF.js) + pdf-lib (주석 합성 내보내기) |
| AI 음성 인식 | @xenova/transformers + Whisper-base (Web Worker) |
| 수식 | KaTeX 0.16 |
| 코드 실행 | @monaco-editor/react + Pyodide (Web Worker) |
| 오디오 시각화 | WaveSurfer.js 7 |
| 퍼지 검색 | Fuse.js 7 |
| 드래그 앤 드롭 | @dnd-kit/core 6 |
| 단축키 | react-hotkeys-hook 5 |
| PWA / SW | vite-plugin-pwa + Workbox 7 |
| 배포 | Cloudflare Pages |

---

## 시작하기

```bash
git clone https://github.com/MSYUO/lecturemate.git
cd lecturemate
npm install
npm run dev      # http://localhost:5173
```

> **요구사항:** Node.js 20+, Chrome/Edge 권장 (SharedArrayBuffer 필요)

---

## 빌드 & 배포

```bash
npm run build     # TypeScript 검사 + Vite 빌드 → dist/
npm run preview   # 로컬 프로덕션 빌드 미리보기
npm run lint      # 타입 에러 검사 (tsc --noEmit)
npm run test      # 단위 테스트 (Vitest)
```

### Cloudflare Pages

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Pages** → **Create project**
2. GitHub 저장소 연결: `lecturemate`
3. Build settings:

   | 항목 | 값 |
   |---|---|
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

4. `main` 브랜치 푸시 시 자동 배포

> `public/_headers` — COOP / COEP / X-Content-Type-Options (SharedArrayBuffer 필수)
> `public/_redirects` — SPA 라우팅 (`/* /index.html 200`)

---

## 단축키

| 단축키 | 기능 |
|---|---|
| `Ctrl + K` | 통합 검색 열기/닫기 |
| `Ctrl + E` | 내보내기 다이얼로그 |
| `Ctrl + Z` | 실행 취소 (최대 100단계) |
| `Ctrl + Shift + Z` | 다시 실행 |
| `Space` | 오디오 재생/일시정지 |
| `←` / `→` | 오디오 5초 뒤로/앞으로 |
| `[` / `]` | 이전/다음 PDF 페이지 |
| `H` | 형광펜 도구 |
| `A` | 어노테이션 도구 |
| `T` | 텍스트 박스 도구 |
| `S` | 스티커 도구 |
| `Escape` | 현재 도구 해제 / 오버레이 닫기 |
| `Ctrl + S` | 수동 저장 (자동 저장은 3초 디바운스) |

---

## Contributing

### 브랜치 전략

| 브랜치 | 용도 |
|---|---|
| `main` | 안정 배포 버전 — 직접 커밋 금지 |
| `dev` | 통합 개발 브랜치 |
| `feat/*` | 새 기능 (예: `feat/ai-summary`) |
| `fix/*` | 버그 수정 (예: `fix/stt-overlap`) |

### 작업 흐름

```bash
git checkout dev
git checkout -b feat/my-feature
# ... 작업 ...
git push origin feat/my-feature
# GitHub에서 dev 브랜치 대상으로 PR 생성
```

### 커밋 메시지 규칙

```
feat:     새 기능 추가
fix:      버그 수정
refactor: 리팩토링 (기능 변경 없음)
docs:     문서 수정
chore:    빌드·설정 변경
test:     테스트 추가·수정
```

---

## 라이선스

[MIT](LICENSE) © 2025
