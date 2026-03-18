# LectureMate — 프로젝트 컨텍스트

## 프로젝트 개요
서버 없이 브라우저에서 PDF + 실시간 STT(Whisper WASM) + 코드 실행(Monaco+Pyodide) + 수식 변환(KaTeX)을 통합하는 PC 전용 학습 웹앱.

## 기술 스택 (반드시 준수)
- React 18 + TypeScript + Vite
- Zustand (상태관리, Sliced Store 패턴)
- Dexie.js (IndexedDB — 메타데이터)
- OPFS (대용량 바이너리: 오디오, PDF 원본)
- react-pdf (PDF.js 래퍼)
- WaveSurfer.js (오디오 파형)
- Transformers.js + Whisper-base quantized (STT, Web Worker에서만 실행)
- KaTeX (수식 렌더링)
- Fuse.js (퍼지 검색)
- @dnd-kit/core (드래그앤드롭)
- react-hotkeys-hook (단축키)
- @monaco-editor/react (코드 에디터, lazy-load)
- Pyodide (Python WASM, Web Worker에서만 실행)
- Tauri v2 (데스크톱 패키징)

## 아키텍처 규칙
1. **무거운 연산은 반드시 Web Worker에서:** Whisper STT, Pyodide, PDF 텍스트 추출. 메인 스레드에서 절대 돌리지 않는다.
2. **WASM 상호 배타적 로딩:** Whisper(400MB)와 Pyodide(200MB)를 동시에 활성화하지 않는다. ResourceManager의 ActiveMode('recording'|'reviewing'|'coding')로 전환.
3. **데이터 저장 원칙:** WAL intent → 원본 저장 → 파생 데이터 생성 → 커밋. 크래시 시 자동 복구.
4. **오디오 청크:** 5초 + 앞뒤 1초 오버랩. STT 결과에서 오버랩 중복 제거 필수.
5. **자동 저장:** 3초 디바운스. 변경 감지 시 IndexedDB에 자동 커밋.
6. **Undo/Redo:** Immer produceWithPatches로 역방향 패치 기록. 최대 100단계.

## 디렉토리 구조 (이 구조를 따라 파일 생성)
```
src/
├── components/pdf/        # PDFViewerPanel, OverlayCanvas, TextBoxComponent, HighlightLayer, StickerLayer
├── components/sidebar/    # SidebarPanel, STTStream, TagTimeline, BookmarkList
├── components/code/       # CodeTab, MonacoWrapper, ConsoleOutput
├── components/audio/      # RecordingControls, AudioWaveform
├── components/search/     # SearchOverlay, SearchResults
├── components/queue/      # PendingTray, PendingBadge
├── components/toolbar/    # Toolbar, ColorPalette, StickerPalette
├── components/status/     # SaveStatusIndicator, StorageUsageBar, WhisperStatusBadge
├── stores/                # sessionStore, annotationStore, searchStore, jobQueueStore, codeStore, undoRedoStore
├── workers/               # audio.worker, stt.worker, pdf.worker, codeRunner.worker
├── core/                  # ResourceManager, MemoryGuard, CrashRecoveryManager, JobScheduler, PreWarmingManager, AutoSaveManager, OPFSStorage
├── db/                    # schema (Dexie v3), *Repository 파일들
├── hooks/                 # useRecording, useStt, useTagging, useTextBox, useHighlighter, useSearch, useCodeRunner, useUndoRedo, useAutoSave
├── lib/                   # mathParser, mathDictionary, overlapDeduplicator, codeDetector, timeSync, exporters/
└── types/                 # index.ts (공통 타입)
```

## 코딩 스타일
- 함수형 컴포넌트 + hooks만 사용
- 타입은 types/index.ts에 중앙 집중 관리
- Worker 통신은 postMessage + onmessage (Transferable 활용)
- CSS: Tailwind CSS 사용
- 테스트: Vitest + React Testing Library (핵심 로직만)

## 상세 아키텍처
전체 상세 아키텍처는 `docs/architecture-v4.md` 파일을 참조하세요.
