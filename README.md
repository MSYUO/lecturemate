# LectureMate

서버 없이 브라우저에서 동작하는 PC 전용 학습 웹앱.
**PDF 뷰어 + 실시간 STT(Whisper WASM) + 코드 실행(Monaco + Pyodide) + 수식 변환(KaTeX)** 통합 환경.

## 주요 기능

- PDF 업로드 및 페이지별 뷰어
- 실시간 음성 인식(Whisper-base quantized, 완전 오프라인)
- 형광펜 · 어노테이션 · 텍스트 박스 · 스티커 오버레이
- Python 코드 에디터 및 WASM 실행 환경(Pyodide)
- KaTeX 수식 렌더링 및 LaTeX 변환
- Markdown / HTML / PDF 내보내기
- PWA — 오프라인 지원 및 홈 화면 설치

## 기술 스택

| 영역 | 기술 |
|---|---|
| UI | React 18 + TypeScript + Vite + Tailwind CSS |
| 상태 관리 | Zustand (Sliced Store) |
| 데이터 저장 | Dexie.js (IndexedDB) + OPFS (바이너리) |
| PDF | react-pdf (PDF.js) + pdf-lib (내보내기) |
| STT | Transformers.js + Whisper-base (Web Worker) |
| 수식 | KaTeX |
| 코드 실행 | Monaco Editor + Pyodide (Web Worker) |
| 오디오 | WaveSurfer.js |
| 검색 | Fuse.js |
| DnD | @dnd-kit/core |
| 배포 | Cloudflare Pages + PWA (Workbox) |

## 개발 환경 실행

```bash
npm install
npm run dev        # http://localhost:5173
```

## 빌드 및 배포

```bash
npm run build                                          # dist/ 생성
wrangler pages deploy dist --project-name lecturemate  # Cloudflare Pages 배포
```

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
git checkout -b feat/my-feature   # 기능 브랜치 생성
# ... 작업 ...
git push origin feat/my-feature
# GitHub에서 dev 브랜치로 PR 생성
```

### 커밋 메시지 규칙

```
feat: 새 기능 추가
fix:  버그 수정
refactor: 리팩토링 (기능 변경 없음)
docs: 문서 수정
chore: 빌드·설정 변경
```
