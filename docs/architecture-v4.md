# LectureMate — PC 전용 올인원 학습 웹앱 아키텍처 v4 (Final)

---

## 0. 변경 이력

| 버전 | 주요 변경 |
|------|-----------|
| v1 | 초기 기획 (PDF + STT + 태깅) |
| v2 | 4-Layer 아키텍처, Worker 통신, DB 스키마 구체화 |
| v3 | 오프라인 복원력, 작업 큐, 동시 녹음, Monaco 코드 에디터, 메모리 최적화, 수익 모델 |
| **v4** | **OPFS 이원화 스토리지, WASM 프리워밍, 오디오 오버랩 보정, 자동태깅 토글, 더블클릭 텍스트박스, 수식 자동 변환(KaTeX), Pyodide 에러 바운더리, 형광펜·스티커·북마크, Undo/Redo, 자동저장, 내보내기** |

---

## 1. 프로젝트 본질

### 한 줄 요약
서버 없이 브라우저 안에서 PDF 강의자료 + 실시간 STT + 코드 실행 + 수식 변환을 통합하고, 네트워크가 끊겨도 데이터가 절대 유실되지 않는 **"개발자와 이공계 학생을 위한 PC 전용 굿노트"**.

### 핵심 차별화 5대 축

| # | 차별화 | 경쟁 제품의 문제 | LectureMate 해결 |
|---|--------|-----------------|-------------------|
| 1 | **오프라인 무결성** | 다글로 등 클라우드 STT: 네트워크 끊기면 청크 유실 | 100% 로컬. WAL 크래시 복구. 오디오 원본 항상 선저장 |
| 2 | **비용 제로** | 클라우드 STT 분당 과금, 구독제 | Whisper WASM 무료 구동. 일회성 판매 |
| 3 | **3차원 동기화** | 굿노트: 시간↔공간 연결 없음 | 시간(STT) ↔ 공간(PDF좌표) ↔ 텍스트(필기) 완전 동기화 |
| 4 | **코드 실행** | 노트앱에 코드 에디터 없음 | Monaco + Pyodide/JS 샌드박스 내장 |
| 5 | **수식 자동 변환** | 수기 입력 또는 별도 앱 필요 | 자연어 타이핑 → KaTeX 수식 자동 렌더링 |

---

## 2. 기술 스택 (v4 최종)

| 영역 | 선택 | 비용 | 라이선스 | 비고 |
|------|------|------|----------|------|
| 프레임워크 | React 18 + TypeScript + Vite | $0 | MIT | |
| 상태관리 | Zustand (Sliced Store) | $0 | MIT | Immer 미들웨어로 불변성 |
| 로컬 DB (메타) | Dexie.js (IndexedDB) | $0 | Apache 2.0 | 태그, STT, 검색 인덱스 |
| 로컬 DB (바이너리) | **OPFS (Origin Private File System)** | $0 | 웹 표준 | 오디오 Blob, PDF 원본 ★v4 변경 |
| PDF 렌더링 | react-pdf (PDF.js 래퍼) | $0 | Apache 2.0 | |
| 오디오 파형 | WaveSurfer.js | $0 | BSD-3 | |
| STT 엔진 | Transformers.js (Whisper-base, quantized) | $0 | Apache 2.0 | |
| 텍스트 검색 | Fuse.js | $0 | Apache 2.0 | |
| DnD | @dnd-kit/core | $0 | MIT | |
| 단축키 | react-hotkeys-hook | $0 | MIT | |
| 코드 에디터 | Monaco Editor (@monaco-editor/react) | $0 | MIT | |
| Python 실행 | Pyodide (CPython WASM) | $0 | MPL 2.0 | |
| JS 샌드박스 | iframe sandbox | $0 | 웹 표준 | |
| **수식 렌더링** | **KaTeX** | $0 | MIT | ★v4 신규 |
| **수식 파싱** | **커스텀 NLP 파서 + 정규식** | $0 | 자체 | ★v4 신규 |
| **Undo/Redo** | **Immer + 커스텀 히스토리 스택** | $0 | MIT | ★v4 신규 |
| 패키징 | Tauri v2 | $0 | MIT/Apache 2.0 | |

---

## 3. 5-Layer 아키텍처 (v4 확장)

```
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — UI Components (React)                                     │
│  ┌──────────┐┌──────────┐┌────────┐┌────────┐┌─────────┐┌────────┐  │
│  │PDFViewer ││STTSidebar││Toolbar ││Audio   ││Monaco   ││Search  │  │
│  │+Overlay  ││(DnD src) ││+Hotkeys││Player  ││+Console ││Overlay │  │
│  │+TextBox  ││          ││+Toggle ││        ││         ││        │  │
│  │+MathRndr ││          ││        ││        ││         ││        │  │
│  └────┬─────┘└────┬─────┘└───┬────┘└───┬────┘└────┬────┘└───┬────┘  │
├───────┼────────────┼──────────┼─────────┼─────────┼──────────┼──────┤
│  LAYER 2 — State + Sync + History (Zustand + Immer)                  │
│  ┌───────────┐┌───────────┐┌─────────┐┌──────────┐┌───────────────┐  │
│  │SessionStr ││AnnotStr   ││SearchEng││JobQueue  ││UndoRedoStr   │  │
│  │time↔page  ││tags/annot ││Fuse 4src││pending/  ││history stack │  │
│  │↔tag sync  ││highlight  ││         ││active    ││patch-based   │  │
│  │autoTag:on ││textbox    ││         ││retry     ││              │  │
│  └─────┬─────┘│mathExpr   │└────┬────┘└────┬─────┘└──────┬──────┘  │
│         │     │sticker    │     │           │             │          │
│         │     │bookmark   │     │           │             │          │
│         │     └─────┬─────┘     │           │             │          │
├─────────┼───────────┼───────────┼───────────┼─────────────┼─────────┤
│  LAYER 3 — Background Workers (Web Workers + WASM)                   │
│  ┌────────────┐┌───────────────┐┌──────────┐┌──────────┐┌────────┐  │
│  │AudioWorker ││★ STTWorker   ││PDFWorker ││CodeRunner││MathPrs │  │
│  │MediaRecorder││Whisper WASM  ││텍스트추출││Pyodide/  ││수식파싱│  │
│  │→5s+1s ovlp ││chunk→segment ││페이지인덱││iframe JS ││→KaTeX  │  │
│  └─────┬──────┘└──────┬───────┘└────┬─────┘└────┬─────┘└───┬────┘  │
├────────┼──────────────┼─────────────┼───────────┼──────────┼────────┤
│  LAYER 4 — Crash Recovery + Transaction Manager (WAL)                │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ WriteAheadLog: intent → 실행 → commit                           ││
│  │ AutoSave: 5초 debounce → 변경 감지 시 자동 저장                 ││
│  └──────────────────────────────────┬───────────────────────────────┘│
├─────────────────────────────────────┼────────────────────────────────┤
│  LAYER 5 — Persistent Storage (이원화)                               │
│  ┌─ IndexedDB (Dexie.js) ──────────┐ ┌─ OPFS ────────────────────┐  │
│  │ sessions, tags, annotations,    │ │ /audio/{sessionId}/{chunk} │  │
│  │ highlights, sttSegments,        │ │ /pdf/{pdfId}.pdf           │  │
│  │ pdfTextIndex, pendingJobs,      │ │ /export/{filename}         │  │
│  │ codeSnippets, mathExpressions,  │ │                            │  │
│  │ bookmarks, wal, undoHistory     │ │ (대용량 바이너리 전용)      │  │
│  └─────────────────────────────────┘ └────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. 스토리지 이원화: IndexedDB + OPFS (★v4 핵심 변경)

### 4.1 문제

IndexedDB에 모든 데이터를 넣으면:
- 1시간 녹음 = PCM 16kHz mono 기준 약 115MB
- 일주일 수업 5과목 × 2시간 = 약 1.15GB
- PDF 10개 × 평균 20MB = 200MB
- 한 달이면 5GB+ → 브라우저 쿼터(통상 디스크의 50~60%) 초과 위험
- IndexedDB는 대용량 Blob의 순차 읽기/쓰기에 최적화되지 않음

### 4.2 이원화 전략

```typescript
// 데이터 성격에 따라 저장소 분리
const STORAGE_POLICY = {
  // IndexedDB: 작고 자주 쿼리되는 구조화 데이터
  indexedDB: [
    'sessions',       // ~1KB each
    'tags',           // ~200B each
    'annotations',    // ~500B each
    'highlights',     // ~200B each
    'sttSegments',    // ~500B each (텍스트 + 타임스탬프)
    'pdfTextIndex',   // ~5KB/page
    'pendingJobs',    // ~500B each
    'codeSnippets',   // ~2KB each
    'mathExpressions',// ~300B each
    'bookmarks',      // ~200B each
    'wal',            // ~200B each
    'undoHistory',    // ~1KB each (Immer 패치)
  ],
  
  // OPFS: 크고 순차적으로 읽히는 바이너리 데이터
  opfs: [
    'audio/*',        // 5초 청크 PCM Blob (~960KB each)
    'pdf/*',          // PDF 원본 파일 (수 MB~수십 MB)
    'export/*',       // 내보내기 임시 파일
  ],
};
```

### 4.3 OPFS 래퍼 클래스

```typescript
class OPFSStorage {
  private root: FileSystemDirectoryHandle | null = null;
  
  async init(): Promise<void> {
    this.root = await navigator.storage.getDirectory();
    // 하위 디렉토리 생성
    await this.root.getDirectoryHandle('audio', { create: true });
    await this.root.getDirectoryHandle('pdf', { create: true });
    await this.root.getDirectoryHandle('export', { create: true });
  }
  
  // 오디오 청크 저장 (스트리밍 쓰기)
  async writeAudioChunk(
    sessionId: string, 
    chunkIndex: number, 
    pcmData: Float32Array
  ): Promise<void> {
    const audioDir = await this.root!.getDirectoryHandle('audio', { create: true });
    const sessionDir = await audioDir.getDirectoryHandle(sessionId, { create: true });
    const file = await sessionDir.getFileHandle(
      `chunk_${String(chunkIndex).padStart(6, '0')}.pcm`, 
      { create: true }
    );
    const writable = await file.createWritable();
    await writable.write(pcmData.buffer);
    await writable.close();
  }
  
  // 오디오 청크 읽기 (특정 시간대)
  async readAudioChunk(sessionId: string, chunkIndex: number): Promise<Float32Array> {
    const audioDir = await this.root!.getDirectoryHandle('audio');
    const sessionDir = await audioDir.getDirectoryHandle(sessionId);
    const file = await sessionDir.getFileHandle(
      `chunk_${String(chunkIndex).padStart(6, '0')}.pcm`
    );
    const blob = await (await file.getFile()).arrayBuffer();
    return new Float32Array(blob);
  }
  
  // PDF 저장
  async writePDF(pdfId: string, arrayBuffer: ArrayBuffer): Promise<void> {
    const pdfDir = await this.root!.getDirectoryHandle('pdf', { create: true });
    const file = await pdfDir.getFileHandle(`${pdfId}.pdf`, { create: true });
    const writable = await file.createWritable();
    await writable.write(arrayBuffer);
    await writable.close();
  }
  
  // 세션 오디오 전체 삭제 (용량 관리)
  async deleteSessionAudio(sessionId: string): Promise<void> {
    const audioDir = await this.root!.getDirectoryHandle('audio');
    await audioDir.removeEntry(sessionId, { recursive: true });
  }
  
  // 사용량 조회
  async getStorageEstimate(): Promise<{ usage: number; quota: number }> {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
  }
}
```

### 4.4 용량 관리 정책

```typescript
class StorageManager {
  private readonly WARNING_THRESHOLD = 0.7;  // 70% 사용 시 경고
  private readonly DANGER_THRESHOLD = 0.85;  // 85% 사용 시 자동 정리 제안
  
  async checkAndWarn(): Promise<void> {
    const { usage, quota } = await this.opfs.getStorageEstimate();
    const ratio = usage / quota;
    
    if (ratio > this.DANGER_THRESHOLD) {
      // UI 알림: "저장 공간이 부족합니다. 오래된 세션의 오디오 원본을 삭제하시겠습니까?"
      // STT 변환이 완료된 세션은 오디오 원본 삭제 가능 (텍스트는 유지)
      this.suggestCleanup();
    } else if (ratio > this.WARNING_THRESHOLD) {
      // 상태 바에 용량 경고 아이콘 표시
      this.showWarningBadge(usage, quota);
    }
  }
  
  // "스마트 정리": STT 완료된 오래된 세션의 오디오만 삭제 (텍스트/태그 보존)
  async smartCleanup(olderThanDays: number = 30): Promise<number> {
    const cutoff = Date.now() - olderThanDays * 86400000;
    const oldSessions = await db.sessions
      .where('createdAt').below(cutoff)
      .toArray();
    
    let freedBytes = 0;
    for (const session of oldSessions) {
      const allJobsComplete = await db.pendingJobs
        .where('sessionId').equals(session.id)
        .filter(j => j.status !== 'complete')
        .count() === 0;
      
      if (allJobsComplete) {
        // 오디오 원본만 삭제, 메타데이터(태그, STT, 필기)는 보존
        const audioSize = await this.opfs.getSessionAudioSize(session.id);
        await this.opfs.deleteSessionAudio(session.id);
        freedBytes += audioSize;
        
        // 세션에 "오디오 삭제됨" 플래그
        await db.sessions.update(session.id, { audioDeleted: true });
      }
    }
    return freedBytes;
  }
}
```

---

## 5. WASM 프리워밍 + 스켈레톤 UX (★v4 신규)

### 5.1 프리워밍 전략

```typescript
class PreWarmingManager {
  private whisperReady = false;
  private pyodideReady = false;
  
  // 앱 시작 직후 호출 — 유휴 시간에 Whisper 모델 선로딩
  async warmUpOnIdle(): Promise<void> {
    // 1단계: UI가 먼저 완전히 렌더링되도록 양보
    await new Promise(resolve => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(resolve, { timeout: 3000 });
      } else {
        setTimeout(resolve, 1000);
      }
    });
    
    // 2단계: STT Worker 생성 + 모델 로딩 시작 (백그라운드)
    this.sttWorker = new Worker(new URL('../workers/stt.worker.ts', import.meta.url));
    this.sttWorker.postMessage({ type: 'INIT_MODEL' });
    
    this.sttWorker.onmessage = (e) => {
      if (e.data.type === 'MODEL_READY') {
        this.whisperReady = true;
        // 상태 바에 "AI 음성 인식 준비 완료 ✓" 표시
        useSessionStore.getState().setWhisperStatus('ready');
      }
      if (e.data.type === 'MODEL_PROGRESS') {
        // 상태 바에 로딩 진행률 표시: "AI 모델 로딩 중... 73%"
        useSessionStore.getState().setWhisperStatus('loading', e.data.progress);
      }
    };
    
    // 3단계: Pyodide는 로드하지 않음 (코드 탭 최초 활성화 시에만)
  }
  
  // 코드 탭 첫 활성화 시 호출
  async warmUpPyodide(): Promise<void> {
    if (this.pyodideReady) return;
    
    this.codeWorker = new Worker(new URL('../workers/codeRunner.worker.ts', import.meta.url));
    this.codeWorker.postMessage({ type: 'INIT_PYODIDE' });
    
    // Pyodide 로딩 중 스켈레톤 UI 표시 (아래 참고)
  }
}
```

### 5.2 스켈레톤 UI 전략

```typescript
// 모드 전환 시 무거운 리소스 로딩 중의 UX 처리

function CodeTab() {
  const { pyodideStatus } = useCodeStore();
  
  if (pyodideStatus === 'loading') {
    return (
      <div className="code-tab-skeleton">
        {/* Monaco Editor 영역: 회색 줄무늬 스켈레톤 */}
        <div className="skeleton-editor">
          <div className="skeleton-line w-80" />
          <div className="skeleton-line w-60" />
          <div className="skeleton-line w-90" />
          <div className="skeleton-line w-40" />
        </div>
        
        {/* 하단 Console 영역: "Python 런타임 준비 중..." 메시지 */}
        <div className="skeleton-console">
          <div className="loading-spinner" />
          <span>Python 실행 환경 준비 중... (최초 1회, 약 3초)</span>
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
        
        {/* Monaco Editor 자체는 이미 로드 시작 (Pyodide보다 가벼움) */}
        <MonacoEditor readOnly placeholder="런타임 로딩 완료 후 코드를 작성할 수 있습니다..." />
      </div>
    );
  }
  
  return <FullCodeEditor />;
}
```

### 5.3 앱 시작 시퀀스 (전체 타임라인)

```
t=0ms     앱 HTML 로드 + React hydration
t=200ms   LAYER 1 UI 완전 렌더링 (PDF 뷰어 셸, 빈 사이드바)
t=300ms   ┌─ CrashRecoveryManager.recover() ← WAL 미완료 intent 재실행
          │  (보통 0~2개, <100ms)
t=500ms   ├─ Dexie.js 초기화 + OPFS 디렉토리 생성
          │
t=800ms   ├─ [유휴 시간 감지] PreWarmingManager.warmUpOnIdle()
          │  └─ STT Worker 생성 + Whisper 모델 로딩 시작 (백그라운드)
          │     상태 바: "AI 모델 로딩 중... 0%"
          │
t=1000ms  ├─ [사용자 인터랙션 가능]
          │  PDF 열기, 이전 세션 불러오기, 필기 등 즉시 가능
          │
t=3000ms  ├─ Whisper 모델 로딩 완료 (캐시 히트 시)
          │  상태 바: "AI 음성 인식 준비 완료 ✓"
          │  녹음 버튼 활성화
          │
t=???     └─ [사용자가 코드 탭 최초 클릭]
              └─ Pyodide 로딩 시작 (스켈레톤 UI 표시)
              └─ ~3초 후 완료
```

---

## 6. 오디오 오버랩 보정 (★v4 신규)

### 6.1 문제

5초 청크로 자르면 문장이 중간에 끊겨 Whisper 인식률이 급락합니다:
```
원본 발화: "이 공식은 중간고사에 무조건 나옵니다"
청크 A (0~5초): "이 공식은 중간고"  ← 끊김
청크 B (5~10초): "사에 무조건 나옵니다"  ← "고사"가 "사"로 시작
```

### 6.2 1초 오버랩 전략

```typescript
// AudioWorker: 5초 청크 + 앞뒤 1초 오버랩
class OverlappingChunker {
  private readonly CHUNK_DURATION = 5;      // 초
  private readonly OVERLAP_DURATION = 1;    // 초
  private readonly SAMPLE_RATE = 16000;
  
  private buffer: Float32Array[] = [];
  private bufferDuration = 0;
  private chunkIndex = 0;
  
  // 새 PCM 데이터 도착 시
  onAudioData(pcmData: Float32Array): Float32Array | null {
    this.buffer.push(pcmData);
    this.bufferDuration += pcmData.length / this.SAMPLE_RATE;
    
    if (this.bufferDuration >= this.CHUNK_DURATION + this.OVERLAP_DURATION) {
      // 현재 청크: [이전 오버랩 1초] + [본체 5초] + [다음 오버랩 1초]
      // = 총 7초 분량을 Whisper에게 전달
      const chunkSamples = (this.CHUNK_DURATION + 2 * this.OVERLAP_DURATION) * this.SAMPLE_RATE;
      const chunk = this.extractChunk(chunkSamples);
      
      // 다음 청크를 위해 마지막 1초(오버랩)를 버퍼에 남겨둠
      this.retainOverlap();
      
      return chunk;
    }
    return null;
  }
}
```

### 6.3 STT Worker: 오버랩 중복 제거

```typescript
// STTWorker 내부: 오버랩 구간의 중복 텍스트 제거

class OverlapDeduplicator {
  private previousEndText: string = '';  // 이전 청크 마지막 ~20자
  
  deduplicate(currentResult: SttSegment[], overlapDuration: number): SttSegment[] {
    if (!this.previousEndText) {
      // 첫 청크: 오버랩 없음
      this.updatePreviousEnd(currentResult);
      return currentResult;
    }
    
    // 현재 결과의 처음 부분에서 이전 청크 끝부분과 겹치는 텍스트 찾기
    const overlapSegments = currentResult.filter(
      seg => seg.startTime < overlapDuration  // 오버랩 구간에 속하는 세그먼트
    );
    
    // 겹치는 세그먼트의 텍스트를 이전 끝과 비교
    const deduped = currentResult.filter(seg => {
      if (seg.startTime >= overlapDuration) return true;  // 오버랩 밖: 유지
      // 오버랩 안: 이전 청크에 이미 있으면 제거
      return !this.isOverlapDuplicate(seg.text);
    });
    
    this.updatePreviousEnd(currentResult);
    return deduped;
  }
  
  private isOverlapDuplicate(text: string): boolean {
    // 레벤슈타인 유사도 기반: 80% 이상 일치하면 중복으로 판단
    const similarity = this.levenshteinSimilarity(
      this.previousEndText.slice(-30),
      text.slice(0, 30)
    );
    return similarity > 0.8;
  }
}
```

### 6.4 이중 패스와의 연계

```
실시간 패스 (녹음 중):
  청크 A [0~6초, 오버랩 포함] → 빠른 추론 (beam=1) → 중복 제거 → UI 표시
  청크 B [4~11초, 오버랩 포함] → 빠른 추론 → 중복 제거 → UI 표시
  ...정확도 약 85%

후처리 패스 (녹음 후):
  전체 오디오 → 느린 추론 (beam=5) → 정확도 약 95%
  → 실시간 결과를 교체 (타임스탬프 범위 매칭)
  → 태그 연결 자동 유지
```

---

## 7. 자동 태깅 토글 시스템 (★v4 신규)

### 7.1 개념

녹음 중 마우스로 태깅하는 기능을 켜고 끌 수 있습니다:
- **ON (태깅 모드):** 마우스 클릭/드래그가 태그 생성으로 작동
- **OFF (일반 모드):** 마우스가 일반 PDF 탐색(스크롤, 텍스트 선택)으로 작동

### 7.2 구현

```typescript
// SessionStore에 추가
interface SessionStore {
  // ... 기존 필드 ...
  
  // 자동 태깅 토글
  isTaggingMode: boolean;
  toggleTaggingMode: () => void;
  
  // 현재 태깅 도구
  activeToolType: 'pointer' | 'highlighter' | 'textbox' | 'tagger';
  setActiveTool: (tool: ToolType) => void;
}

// 단축키 매핑
const HOTKEY_MAP = {
  // 도구 전환
  'v': 'pointer',        // 기본 포인터 (PDF 탐색)
  'h': 'highlighter',    // 형광펜
  't': 'textbox',        // 텍스트 상자
  
  // 태깅 토글
  'Tab': 'toggleTaggingMode',  // 태깅 모드 ON/OFF
  
  // 태그 생성 (태깅 모드 ON일 때만)
  'alt+click':    'pointTag',       // 점 태그
  'drag':         'areaTag',        // 영역 태그
  'ctrl+space':   'pageTag',        // 페이지 태그
  
  // 녹음 제어
  'ctrl+r':       'toggleRecording', // 녹음 시작/정지
  'ctrl+shift+r': 'pauseRecording',  // 녹음 일시정지
  
  // 필기
  'ctrl+z':       'undo',
  'ctrl+shift+z': 'redo',
  'ctrl+f':       'search',
  'ctrl+s':       'forceSave',       // 수동 저장 (자동 저장과 별개)
  'escape':       'deselect',        // 선택 해제 / 모드 해제
};
```

### 7.3 태깅 모드 UI 표시

```
┌─────────────────────────────────────────────┐
│  [V] [H] [T]  ║  🏷️ 태깅모드: ON [Tab]   │  ← Toolbar
│  포인터 형광 텍스트  ║  녹음 중 ●02:34        │
└─────────────────────────────────────────────┘

태깅 모드 ON:
  - PDF 위 커서가 십자(+) 모양으로 변경
  - Toolbar에 "태깅모드: ON" 초록색 뱃지
  - Alt+클릭 → 점 태그 (핀 아이콘 표시)
  - 마우스 드래그 → 영역 태그 (파란 점선 박스)
  - PDF 스크롤은 스크롤바 또는 Page Up/Down으로만

태깅 모드 OFF:
  - 커서 정상 (화살표)
  - 마우스 클릭 → PDF 텍스트 선택
  - 마우스 드래그 → PDF 스크롤/선택
  - Ctrl+Space → 페이지 태그는 여전히 작동 (키보드이므로)
```

---

## 8. 더블클릭 텍스트 상자 + 수식 자동 변환 (★v4 핵심 신규)

### 8.1 더블클릭 → 텍스트 상자 생성

```typescript
// PDFOverlay 컴포넌트: 더블클릭 이벤트 핸들러
function handleDoubleClick(e: React.MouseEvent) {
  const { pageNumber, x, y } = getPageCoordinates(e);
  
  // 1. 해당 위치에 텍스트 상자 생성
  const textbox: TextBoxAnnotation = {
    id: crypto.randomUUID(),
    sessionId: currentSessionId,
    pdfId: currentPdfId,
    type: 'textbox',
    pageNumber,
    coordinates: { x, y, width: 250, height: 40 },  // 기본 크기
    content: '',
    isMathMode: false,
    createdAt: Date.now(),
  };
  
  annotationStore.addTextBox(textbox);
  
  // 2. 자동 포커스 → 즉시 타이핑 가능
  requestAnimationFrame(() => {
    document.getElementById(`textbox-${textbox.id}`)?.focus();
  });
}
```

### 8.2 텍스트 상자 컴포넌트

```typescript
function TextBoxComponent({ textbox }: { textbox: TextBoxAnnotation }) {
  const [content, setContent] = useState(textbox.content);
  const [renderedMath, setRenderedMath] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(true);
  
  // 포커스 아웃 시: 수식 감지 + 변환
  const handleBlur = async () => {
    setIsEditing(false);
    
    // 수식 패턴 감지
    const mathResult = await detectAndConvertMath(content);
    if (mathResult) {
      setRenderedMath(mathResult.katexHtml);
      annotationStore.updateTextBox(textbox.id, { 
        content, 
        mathLatex: mathResult.latex,
        isMathMode: true 
      });
    } else {
      annotationStore.updateTextBox(textbox.id, { content });
    }
    
    // 자동 저장 트리거
    autoSaveManager.markDirty();
  };
  
  // 클릭 시: 다시 편집 모드
  const handleClick = () => setIsEditing(true);
  
  return (
    <div 
      className="textbox-annotation"
      style={{
        position: 'absolute',
        left: textbox.coordinates.x,
        top: textbox.coordinates.y,
        minWidth: textbox.coordinates.width,
      }}
    >
      {isEditing ? (
        <textarea
          id={`textbox-${textbox.id}`}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleTextBoxKeyDown}
          autoFocus
          className="textbox-input"
          placeholder="텍스트 입력... (수식: 시그마, 알파 등)"
        />
      ) : (
        <div className="textbox-display" onClick={handleClick}>
          {renderedMath ? (
            <div 
              className="math-rendered"
              dangerouslySetInnerHTML={{ __html: renderedMath }}
            />
          ) : (
            <span>{content}</span>
          )}
        </div>
      )}
      
      {/* 리사이즈 핸들 */}
      <div className="resize-handle" onMouseDown={handleResize} />
      
      {/* 삭제 버튼 (호버 시 표시) */}
      <button className="delete-btn" onClick={() => annotationStore.deleteTextBox(textbox.id)}>
        ×
      </button>
    </div>
  );
}
```

### 8.3 수식 자동 변환 엔진 (★ 핵심 기능)

#### 자연어 → LaTeX → KaTeX 렌더링 파이프라인

```
사용자 입력                    LaTeX 변환                     KaTeX 렌더링
─────────────────────────────────────────────────────────────────────────
"시그마 i=1 에서 n"     →     \sum_{i=1}^{n}          →     Σ(위에n, 아래i=1)
"알파 + 베타 - 1"       →     \alpha + \beta - 1      →     α + β - 1
"x 제곱 + 2x + 1"      →     x^{2} + 2x + 1         →     x² + 2x + 1
"루트 x^2 + y^2"        →     \sqrt{x^{2} + y^{2}}   →     √(x²+y²)
"x 분의 1"              →     \frac{1}{x}             →     1/x (분수)
"인테그랄 0에서 1"       →     \int_{0}^{1}            →     ∫₀¹
"리밋 x → 0"            →     \lim_{x \to 0}          →     lim(x→0)
"A 역행렬"              →     A^{-1}                  →     A⁻¹
"x 벡터"                →     \vec{x}                 →     x⃗
"f 프라임 x"            →     f'(x)                   →     f'(x)
"편미분 f 편미분 x"     →     \frac{\partial f}{\partial x}  →  ∂f/∂x
```

#### 파서 구현

```typescript
// lib/mathParser.ts

// 1단계: 한국어 수학 용어 → LaTeX 토큰 매핑
const KOREAN_MATH_MAP: Record<string, string> = {
  // 그리스 문자
  '알파': '\\alpha', '베타': '\\beta', '감마': '\\gamma', '델타': '\\delta',
  '엡실론': '\\epsilon', '제타': '\\zeta', '에타': '\\eta', '세타': '\\theta',
  '이오타': '\\iota', '카파': '\\kappa', '람다': '\\lambda', '뮤': '\\mu',
  '뉴': '\\nu', '크사이': '\\xi', '파이': '\\pi', '로': '\\rho',
  '시그마': '\\sigma', '타우': '\\tau', '입실론': '\\upsilon', '피': '\\phi',
  '카이': '\\chi', '프사이': '\\psi', '오메가': '\\omega',
  // 대문자
  '대문자시그마': '\\Sigma', '대문자파이': '\\Pi', '대문자오메가': '\\Omega',
  '대문자델타': '\\Delta', '대문자감마': '\\Gamma',
  
  // 연산자
  '더하기': '+', '빼기': '-', '곱하기': '\\times', '나누기': '\\div',
  '플러스': '+', '마이너스': '-',
  '같다': '=', '같지않다': '\\neq',
  '크다': '>', '작다': '<', '크거나같다': '\\geq', '작거나같다': '\\leq',
  '약': '\\approx', '비례': '\\propto',
  '무한': '\\infty', '무한대': '\\infty',
  
  // 함수/기호
  '루트': '\\sqrt', '제곱근': '\\sqrt',
  '절대값': '\\left|', // 후처리 필요
  '로그': '\\log', '자연로그': '\\ln',
  '사인': '\\sin', '코사인': '\\cos', '탄젠트': '\\tan',
  '인테그랄': '\\int', '적분': '\\int',
  '리밋': '\\lim', '극한': '\\lim',
  '서메이션': '\\sum', '합': '\\sum',
  '프로덕트': '\\prod', '곱': '\\prod',
  '편미분': '\\partial',
  '미분': 'd',
  '역행렬': '^{-1}',
  '전치': '^{T}',
  '벡터': '\\vec',
  '프라임': "'",
  '더블프라임': "''",
  
  // 구조
  '분의': 'FRAC_MARKER',  // 특수 처리
  '제곱': '^{2}',
  '세제곱': '^{3}',
  'n제곱': '^{n}',
  '에서': '_RANGE_START',  // 특수 처리: "i=1 에서 n" → _{i=1}^{n}
};

// 2단계: 수식 감지 휴리스틱
function isMathExpression(text: string): boolean {
  const mathIndicators = [
    // 한국어 수학 용어 포함
    ...Object.keys(KOREAN_MATH_MAP),
    // 수학 기호 패턴
    /[=+\-×÷≠≥≤≈∝]/,
    /\^/,
    // "x의 y제곱" 패턴
    /제곱|세제곱|n제곱/,
    // "a 분의 b" 패턴
    /분의/,
    // 변수 + 연산자 패턴: "x + y", "a - b"
    /^[a-zA-Z]\s*[\+\-\*\/\=]\s*[a-zA-Z0-9]/,
  ];
  
  let score = 0;
  for (const indicator of mathIndicators) {
    if (indicator instanceof RegExp) {
      if (indicator.test(text)) score += 2;
    } else {
      if (text.includes(indicator)) score += 3;
    }
  }
  
  // 일반 한국어 문장과 구분하기 위해 임계값 설정
  // 점수가 낮으면 수식이 아닌 일반 텍스트로 판단
  return score >= 3;
}

// 3단계: 자연어 → LaTeX 변환
function naturalLanguageToLatex(input: string): string {
  let latex = input;
  
  // 규칙 기반 변환 (순서 중요)
  
  // "a 분의 b" → \frac{b}{a}  (한국어: 분모가 먼저 옴)
  latex = latex.replace(
    /(\S+)\s*분의\s*(\S+)/g, 
    (_, denom, numer) => `\\frac{${convertToken(numer)}}{${convertToken(denom)}}`
  );
  
  // "시그마 i=1 에서 n" → \sum_{i=1}^{n}
  latex = latex.replace(
    /(시그마|서메이션|합)\s*(\S+=\S+)\s*에서\s*(\S+)/g,
    (_, _op, lower, upper) => `\\sum_{${lower}}^{${upper}}`
  );
  
  // "인테그랄 a에서 b" → \int_{a}^{b}
  latex = latex.replace(
    /(인테그랄|적분)\s*(\S+)에서\s*(\S+)/g,
    (_, _op, lower, upper) => `\\int_{${convertToken(lower)}}^{${convertToken(upper)}}`
  );
  
  // "리밋 x → a" → \lim_{x \to a}
  latex = latex.replace(
    /(리밋|극한)\s*(\S+)\s*[→->]\s*(\S+)/g,
    (_, _op, variable, target) => `\\lim_{${variable} \\to ${convertToken(target)}}`
  );
  
  // "루트 expr" → \sqrt{expr}
  latex = latex.replace(
    /(루트|제곱근)\s+(.+?)(?=\s*[\+\-\=]|$)/g,
    (_, _op, expr) => `\\sqrt{${convertToken(expr)}}`
  );
  
  // "x 벡터" → \vec{x}
  latex = latex.replace(
    /(\S+)\s*벡터/g,
    (_, v) => `\\vec{${v}}`
  );
  
  // "f 프라임" → f'
  latex = latex.replace(
    /(\S+)\s*프라임/g,
    (_, f) => `${f}'`
  );
  
  // "편미분 f 편미분 x" → \frac{\partial f}{\partial x}
  latex = latex.replace(
    /편미분\s*(\S+)\s*편미분\s*(\S+)/g,
    (_, f, x) => `\\frac{\\partial ${f}}{\\partial ${x}}`
  );
  
  // 단순 토큰 치환 (그리스 문자, 연산자 등)
  for (const [korean, latexToken] of Object.entries(KOREAN_MATH_MAP)) {
    if (!['분의', '에서'].includes(korean)) {  // 이미 처리된 특수 토큰 제외
      latex = latex.replaceAll(korean, latexToken);
    }
  }
  
  // "x 제곱" → x^{2}, "x^3" → x^{3}
  latex = latex.replace(/(\S)\s*제곱/g, '$1^{2}');
  latex = latex.replace(/(\S)\s*세제곱/g, '$1^{3}');
  latex = latex.replace(/(\S)\^(\d+)/g, '$1^{$2}');
  
  return latex;
}

// 4단계: KaTeX 렌더링
function renderMath(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: false,  // 인라인 모드 (텍스트 상자 내)
      output: 'html',
    });
  } catch (e) {
    // 변환 실패 시 원본 텍스트 반환
    return `<span class="math-error" title="수식 변환 실패">${latex}</span>`;
  }
}

// 통합 함수: 텍스트 → 감지 → 변환 → 렌더링
async function detectAndConvertMath(text: string): Promise<{
  latex: string;
  katexHtml: string;
} | null> {
  if (!isMathExpression(text)) return null;
  
  const latex = naturalLanguageToLatex(text);
  const katexHtml = renderMath(latex);
  
  return { latex, katexHtml };
}
```

### 8.4 수식 변환 UX 흐름

```
[사용자] PDF 위 더블클릭
    │
    └→ 텍스트 상자 생성 (편집 모드, 커서 깜빡임)
        │
        ├→ [타이핑] "시그마 i=1 에서 n 알파 제곱"
        │
        └→ [포커스 아웃] (클릭 다른 곳 / Tab / Enter)
            │
            ├→ 수식 감지: score=15 ≥ 3 → 수식으로 판정
            │
            ├→ LaTeX 변환: \sum_{i=1}^{n} \alpha^{2}
            │
            ├→ KaTeX 렌더링: 아름다운 수식으로 표시
            │   ┌─────────────────────────────┐
            │   │  n                          │
            │   │  Σ  α²                      │
            │   │ i=1                         │
            │   └─────────────────────────────┘
            │
            └→ [클릭하면] 다시 편집 모드로 (원본 텍스트 표시)
                "시그마 i=1 에서 n 알파 제곱"

※ 수식이 아닌 일반 텍스트("오늘 중간고사 범위 확인"):
    → 감지 score=0 < 3 → 수식 변환 안 함 → 일반 텍스트로 표시
```

### 8.5 수식 모드 강제 토글

```typescript
// 사용자가 수식 자동 감지를 원하지 않을 때, 또는 강제로 수식 모드를 켤 때

// 방법 1: 접두어 사용
// "$" 로 시작하면 강제 수식 모드
// "$ 2x + 3 = 7" → 무조건 수식으로 변환

// 방법 2: 단축키
// Ctrl+M → 현재 텍스트 상자를 수식 모드로 토글
// 텍스트 상자 우상단에 [Σ] 아이콘 표시 (수식 모드 활성화 표시)

// 방법 3: 직접 LaTeX 입력
// "$$" 로 감싸면 LaTeX로 직접 해석
// "$$ \int_0^1 e^{-x} dx $$" → 바로 KaTeX 렌더링
```

---

## 9. 추가 편의 기능 (★v4 신규)

### 9.1 형광펜 (Highlighter)

```typescript
interface Highlight {
  id: string;
  sessionId: string;
  pdfId: string;
  pageNumber: number;
  color: HighlightColor;
  rects: BoundingBox[];      // PDF 텍스트 위치 (여러 줄 가능)
  linkedTagId?: string;       // 태그와 연결 시
  note?: string;              // 형광펜에 메모 추가
  createdAt: number;
}

type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';

// 단축키: H → 형광펜 모드 활성화
// 마우스 드래그로 텍스트 위 영역 지정 → 해당 영역에 반투명 색상 오버레이
// 색상 변경: H 누른 상태에서 1~5 숫자키 (1=노랑, 2=초록, 3=파랑, 4=분홍, 5=주황)
// 형광펜 위 우클릭 → 메모 추가 팝업
```

### 9.2 스티커 / 라벨

```typescript
interface Sticker {
  id: string;
  sessionId: string;
  pdfId: string;
  pageNumber: number;
  type: StickerType;
  coordinates: { x: number; y: number };
  label?: string;            // 사용자 정의 텍스트
  createdAt: number;
}

type StickerType = 
  | 'important'    // ⭐ 중요
  | 'question'     // ❓ 질문
  | 'review'       // 🔄 복습 필요
  | 'exam'         // 📝 시험 출제
  | 'understand'   // ✅ 이해 완료
  | 'difficult'    // 🔴 어려움
  | 'custom';      // 사용자 정의

// 단축키: S → 스티커 팔레트 표시
// 클릭으로 PDF 위에 스티커 배치
// 스티커별 필터링 가능 (예: "시험 출제" 스티커만 모아보기)
```

### 9.3 페이지 북마크

```typescript
interface Bookmark {
  id: string;
  sessionId: string;
  pdfId: string;
  pageNumber: number;
  title: string;              // "Chapter 3: 확률분포"
  color?: string;
  createdAt: number;
}

// 단축키: Ctrl+B → 현재 페이지 북마크
// 사이드바에 북마크 목록 표시 (빠른 페이지 이동)
// PDF 좌측에 색깔 탭으로 시각화
```

### 9.4 Undo / Redo 시스템

```typescript
// Immer 패치 기반 Undo/Redo

import { enablePatches, produceWithPatches, applyPatches, Patch } from 'immer';
enablePatches();

interface UndoRedoStore {
  past: Patch[][];        // Undo 스택 (역방향 패치)
  future: Patch[][];      // Redo 스택 (정방향 패치)
  maxHistory: number;     // 최대 100단계
  
  // Undoable 액션 래퍼
  doAction: <T>(recipe: (draft: T) => void) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

// 사용 예시: 텍스트 상자 이동
annotationStore.doAction((draft) => {
  const textbox = draft.textboxes.find(t => t.id === id);
  if (textbox) {
    textbox.coordinates.x = newX;
    textbox.coordinates.y = newY;
  }
});
// → Ctrl+Z로 이전 위치로 되돌리기 가능

// Undo 가능한 액션들:
// - 텍스트 상자 생성/삭제/이동/수정
// - 태그 생성/삭제
// - 형광펜 생성/삭제
// - 스티커 배치/제거
// - 드래그앤드롭 (STT → PDF)

// Undo 불가능한 액션들 (비가역):
// - 녹음 시작/정지
// - STT 변환 결과
// - 세션 삭제
```

### 9.5 자동 저장 (AutoSave)

```typescript
class AutoSaveManager {
  private isDirty = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 3000;  // 3초 디바운스
  
  // 어떤 변경이든 발생하면 호출
  markDirty(): void {
    this.isDirty = true;
    
    // UI: 상태 바에 "저장 중..." 표시
    useSessionStore.getState().setSaveStatus('pending');
    
    // 디바운스: 3초간 추가 변경 없으면 저장 실행
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.save(), this.DEBOUNCE_MS);
  }
  
  private async save(): Promise<void> {
    if (!this.isDirty) return;
    
    try {
      // WAL intent 기록
      const walId = await crashRecovery.writeIntent('autosave', {
        timestamp: Date.now()
      });
      
      // Zustand 상태 → IndexedDB 동기화
      const state = useAnnotationStore.getState();
      await db.transaction('rw', 
        db.tags, db.annotations, db.highlights, db.textboxes, db.stickers, db.bookmarks,
        async () => {
          // 변경된 엔티티만 upsert (전체 덮어쓰기 방지)
          await db.tags.bulkPut(state.dirtyTags);
          await db.annotations.bulkPut(state.dirtyAnnotations);
          // ... 기타 엔티티
        }
      );
      
      await crashRecovery.commit(walId);
      this.isDirty = false;
      
      // UI: "저장 완료 ✓"
      useSessionStore.getState().setSaveStatus('saved');
    } catch (error) {
      // UI: "저장 실패 ✗ — 재시도 중..."
      useSessionStore.getState().setSaveStatus('error');
      setTimeout(() => this.save(), 5000);  // 5초 후 재시도
    }
  }
}
```

### 9.6 내보내기 (Export)

```typescript
type ExportFormat = 'pdf_annotated' | 'markdown' | 'html' | 'json';

async function exportSession(sessionId: string, format: ExportFormat): Promise<Blob> {
  const session = await db.sessions.get(sessionId);
  const tags = await db.tags.where('sessionId').equals(sessionId).toArray();
  const annotations = await db.annotations.where('sessionId').equals(sessionId).toArray();
  const sttSegments = await db.sttSegments.where('sessionId').equals(sessionId).toArray();
  const codeSnippets = await db.codeSnippets.where('sessionId').equals(sessionId).toArray();
  
  switch (format) {
    case 'markdown':
      return exportAsMarkdown(session, tags, annotations, sttSegments, codeSnippets);
      
    case 'json':
      // 전체 데이터 구조 내보내기 (백업/이식용)
      return new Blob([JSON.stringify({
        session, tags, annotations, sttSegments, codeSnippets,
        exportedAt: new Date().toISOString(),
        version: 'v4',
      }, null, 2)], { type: 'application/json' });
      
    case 'html':
      // KaTeX 수식 포함 HTML (인쇄용)
      return exportAsHtml(session, tags, annotations, sttSegments);
      
    case 'pdf_annotated':
      // pdf-lib으로 원본 PDF에 필기/형광펜 합성
      return exportAsAnnotatedPdf(session, annotations);
  }
}

// 단축키: Ctrl+E → 내보내기 다이얼로그
```

---

## 10. Pyodide 에러 바운더리 (★v4 보완)

### 10.1 지원 패키지 명시

```typescript
// 사전 로딩되는 Pyodide 패키지 (대학 코딩 수업 90% 커버)
const PRELOADED_PACKAGES = [
  'numpy',       // 수치 계산
  'pandas',      // 데이터 분석
  'matplotlib',  // 시각화
  'scipy',       // 과학 계산
  'sympy',       // 기호 수학
  'statistics',  // 통계
];

// 추가 로드 가능 패키지 (사용자 요청 시 동적 설치)
const AVAILABLE_PACKAGES = [
  'scikit-learn', 'networkx', 'pillow', 'beautifulsoup4',
  'regex', 'pyyaml', 'jsonschema', 'cryptography',
];

// 절대 사용 불가 패키지 (브라우저 제약)
const UNSUPPORTED_PACKAGES = [
  'tensorflow', 'torch', 'cv2',       // GPU/네이티브 바이너리 필요
  'requests', 'urllib3', 'httpx',      // 네트워크 I/O 불가
  'flask', 'django', 'fastapi',       // 서버 프레임워크
  'psycopg2', 'pymongo', 'redis',     // DB 드라이버
  'subprocess', 'os.system',          // 시스템 콜 불가
];
```

### 10.2 친절한 에러 메시지

```typescript
// CodeRunner Worker: import 실패 시 사용자 친화적 에러

function handleImportError(moduleName: string): string {
  if (UNSUPPORTED_PACKAGES.includes(moduleName)) {
    const alternatives: Record<string, string> = {
      'requests': '💡 네트워크 요청은 브라우저 환경에서 불가합니다.\n   fetch API 예제를 JavaScript 탭에서 실행해보세요.',
      'tensorflow': '💡 TensorFlow는 GPU가 필요해 브라우저에서 실행할 수 없습니다.\n   NumPy + SciPy로 기초 ML 실습은 가능합니다.',
      'cv2': '💡 OpenCV는 네이티브 라이브러리여서 브라우저에서 실행 불가합니다.\n   Pillow(PIL)로 기본 이미지 처리는 가능합니다.',
    };
    
    return alternatives[moduleName] || 
      `⚠️ '${moduleName}'은(는) 브라우저 로컬 환경에서 지원되지 않습니다.\n` +
      `   지원 라이브러리: numpy, pandas, matplotlib, scipy, sympy 등\n` +
      `   전체 목록은 [설정 > 코드 실행 환경]에서 확인하세요.`;
  }
  
  if (AVAILABLE_PACKAGES.includes(moduleName)) {
    return `📦 '${moduleName}'을(를) 설치 중입니다... (최초 1회)`;
  }
  
  return `❌ ModuleNotFoundError: '${moduleName}'\n` +
    `   pip install이 필요한 패키지이거나 오타일 수 있습니다.`;
}
```

### 10.3 코드 실행 안전장치

```typescript
// 무한루프 방지 + 메모리 폭탄 방지

const CODE_EXECUTION_LIMITS = {
  timeoutMs: 10000,        // 10초 타임아웃
  maxOutputLines: 1000,    // stdout 최대 1000줄
  maxOutputBytes: 1048576, // stdout 최대 1MB
  maxMemoryMB: 100,        // Pyodide 추가 메모리 100MB 제한
};

// Worker에서 타임아웃 감지 → terminate → 새 Worker 생성
class CodeExecutionGuard {
  async execute(code: string, language: string): Promise<CodeRunResponse> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.worker.terminate();
        this.worker = this.createNewWorker();
        resolve({
          stdout: '',
          stderr: '⏱️ 실행 시간 초과 (10초). 무한 루프가 있는지 확인해주세요.',
          executionTime: CODE_EXECUTION_LIMITS.timeoutMs,
          status: 'timeout',
        });
      }, CODE_EXECUTION_LIMITS.timeoutMs);
      
      this.worker.onmessage = (e) => {
        clearTimeout(timer);
        resolve(e.data);
      };
      
      this.worker.postMessage({ type: 'RUN_CODE', code, language });
    });
  }
}
```

---

## 11. 업데이트된 DB 스키마 (v4)

```typescript
class LectureMateDB extends Dexie {
  sessions!: Table<Session>;
  tags!: Table<Tag>;
  annotations!: Table<Annotation>;
  highlights!: Table<Highlight>;
  textboxes!: Table<TextBoxAnnotation>;   // ★v4: 독립 테이블
  stickers!: Table<Sticker>;             // ★v4 신규
  bookmarks!: Table<Bookmark>;           // ★v4 신규
  sttSegments!: Table<SttSegment>;
  pdfTextIndex!: Table<PdfPageText>;
  pendingJobs!: Table<Job>;
  codeSnippets!: Table<CodeSnippet>;
  mathExpressions!: Table<MathExpression>; // ★v4 신규
  wal!: Table<WALEntry>;
  undoHistory!: Table<UndoPatch>;         // ★v4 신규

  constructor() {
    super('LectureMateDB');
    this.version(3).stores({
      sessions:        '++id, pdfId, createdAt',
      tags:            '++id, sessionId, pdfId, pageNumber, type, timestampStart',
      annotations:     '++id, sessionId, pdfId, pageNumber, linkedTagId',
      highlights:      '++id, sessionId, pdfId, pageNumber, color',
      textboxes:       '++id, sessionId, pdfId, pageNumber, isMathMode',
      stickers:        '++id, sessionId, pdfId, pageNumber, type',
      bookmarks:       '++id, sessionId, pdfId, pageNumber',
      sttSegments:     '++id, sessionId, startTime, endTime, *words',
      pdfTextIndex:    '++id, pdfId, pageNumber',
      pendingJobs:     '++id, sessionId, type, status, createdAt',
      codeSnippets:    '++id, sessionId, pdfId, pageNumber, language',
      mathExpressions: '++id, textboxId, latex',
      wal:             '++id, operation, status, createdAt',
      undoHistory:     '++id, sessionId, createdAt',
    });
  }
}

// 신규 엔티티
interface TextBoxAnnotation {
  id: string;
  sessionId: string;
  pdfId: string;
  pageNumber: number;
  coordinates: { x: number; y: number; width: number; height: number };
  content: string;          // 원본 입력 텍스트
  mathLatex?: string;       // 변환된 LaTeX
  isMathMode: boolean;
  linkedTagId?: string;
  createdAt: number;
  updatedAt: number;
}

interface MathExpression {
  id: string;
  textboxId: string;
  originalText: string;     // "시그마 i=1 에서 n"
  latex: string;            // "\sum_{i=1}^{n}"
  isManualLatex: boolean;   // $$ 직접 입력 여부
  createdAt: number;
}
```

---

## 12. 4차원 통합 검색 (v4 확장)

v3의 3차원(STT + 필기 + PDF원문)에서 **코드 스니펫**이 추가되어 4차원 검색이 됩니다.

```typescript
interface SearchResult {
  source: 'stt' | 'annotation' | 'pdfText' | 'code' | 'math';
  text: string;
  pageNumber: number;
  coordinates?: Point;
  timestampStart?: number;
  score: number;
  
  // 소스별 추가 정보
  codeLanguage?: string;     // code 소스일 때
  mathLatex?: string;        // math 소스일 때
  stickerType?: StickerType; // 스티커 필터링용
}

// Fuse.js 인스턴스 5개 → 통합 정렬
const searchSources = [
  { name: 'stt',        collection: sttSegments,   keys: ['text'] },
  { name: 'annotation', collection: annotations,   keys: ['content'] },
  { name: 'pdfText',    collection: pdfTextIndex,  keys: ['text'] },
  { name: 'code',       collection: codeSnippets,  keys: ['code', 'output'] },
  { name: 'math',       collection: mathExpressions, keys: ['originalText', 'latex'] },
];
```

---

## 13. 업데이트된 컴포넌트 트리 (v4)

```
<App>
├── <ServiceWorkerRegistrar />
├── <PreWarmingManager />              // ★v4: 유휴 시간 Whisper 프리워밍
├── <ResourceManager />
├── <MemoryGuard />
├── <CrashRecoveryBoot />
├── <AutoSaveManager />                // ★v4: 3초 디바운스 자동 저장
│
├── <TopBar>
│   ├── <FileOpenButton />
│   ├── <SessionSelector />
│   ├── <RecordingControls />
│   ├── <PendingTray />
│   ├── <SaveStatusIndicator />        // ★v4: "저장 완료 ✓" / "저장 중..."
│   ├── <StorageUsageBar />            // ★v4: OPFS 용량 표시
│   └── <WhisperStatusBadge />         // ★v4: "AI 준비 완료 ✓" / "로딩 73%"
│
├── <MainLayout>
│   ├── <PDFViewerPanel>
│   │   ├── <PDFCanvas />
│   │   ├── <OverlayCanvas />
│   │   │   ├── <TagPins />            // 점 태그 핀 아이콘
│   │   │   ├── <AreaBoxes />          // 영역 태그 점선 박스
│   │   │   └── <HighlightLayer />     // ★v4: 형광펜 오버레이
│   │   ├── <AnnotationLayer />
│   │   │   ├── <TextBoxComponent />   // ★v4: 더블클릭 생성, 수식 변환
│   │   │   └── <StickerLayer />       // ★v4: 스티커/라벨
│   │   ├── <BookmarkTabs />           // ★v4: PDF 좌측 색깔 탭
│   │   └── <DragDropTarget />
│   │
│   └── <SidebarPanel>
│       ├── <SidebarTabs>
│       │   ├── <STTTab>
│       │   │   ├── <STTStream />
│       │   │   └── <TagTimeline />
│       │   ├── <CodeTab>
│       │   │   ├── <MonacoWrapper />  // lazy-loaded
│       │   │   ├── <RunButton />
│       │   │   ├── <ConsoleOutput />
│       │   │   ├── <SnippetHistory />
│       │   │   └── <SupportedPackagesInfo />  // ★v4: 지원 패키지 안내
│       │   └── <BookmarkTab />        // ★v4: 북마크 목록
│       └── <AudioWaveform />
│
├── <SearchOverlay />                  // ★v4: 4차원 + 스티커 필터
├── <ExportDialog />                   // ★v4: 내보내기 다이얼로그
│
├── <Toolbar>
│   ├── [V 포인터] [H 형광펜] [T 텍스트] [S 스티커]
│   ├── [🏷️ 태깅모드 ON/OFF]          // ★v4: Tab 토글
│   ├── [색상 팔레트]                  // ★v4: 형광펜 색상
│   └── [현재 모드 + 단축키 힌트]
│
└── <HotkeyManager />
```

---

## 14. 전체 단축키 맵 (v4)

```
┌─────────────────────────────────────────────────────────────────┐
│  도구 전환                                                       │
│  V           포인터 (기본)                                       │
│  H           형광펜 (+ 숫자 1~5로 색상 변경)                    │
│  T           텍스트 상자 도구                                    │
│  S           스티커 팔레트                                       │
│                                                                  │
│  태깅                                                            │
│  Tab         태깅 모드 ON/OFF 토글                               │
│  Alt+클릭    점 태그 (태깅 모드 ON일 때)                        │
│  드래그      영역 태그 (태깅 모드 ON일 때)                      │
│  Ctrl+Space  현재 페이지 전체 태그                               │
│                                                                  │
│  텍스트/수식                                                     │
│  더블클릭    텍스트 상자 생성 + 편집 모드                       │
│  Ctrl+M      수식 모드 강제 토글                                 │
│  Enter       텍스트 상자 확인 (수식 변환 트리거)                │
│  Escape      편집 취소 / 선택 해제                               │
│                                                                  │
│  녹음                                                            │
│  Ctrl+R      녹음 시작/정지                                      │
│  Ctrl+Shift+R  녹음 일시정지                                     │
│                                                                  │
│  일반                                                            │
│  Ctrl+Z      실행 취소 (Undo)                                    │
│  Ctrl+Shift+Z  다시 실행 (Redo)                                  │
│  Ctrl+F      4차원 통합 검색                                     │
│  Ctrl+B      현재 페이지 북마크                                  │
│  Ctrl+S      수동 저장 (자동 저장과 별개)                       │
│  Ctrl+E      내보내기 다이얼로그                                 │
│                                                                  │
│  코드 (코드 탭 활성 시)                                         │
│  Ctrl+Enter  코드 실행                                           │
│  Ctrl+L      콘솔 클리어                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 15. 업데이트된 디렉토리 구조 (v4)

```
src/
├── main.tsx
├── App.tsx
├── sw.ts                              // Service Worker
│
├── components/
│   ├── pdf/
│   │   ├── PDFViewerPanel.tsx
│   │   ├── PDFCanvas.tsx
│   │   ├── OverlayCanvas.tsx
│   │   ├── AnnotationLayer.tsx
│   │   ├── TextBoxComponent.tsx       // ★v4: 더블클릭 생성 + 수식 렌더링
│   │   ├── HighlightLayer.tsx         // ★v4
│   │   ├── StickerLayer.tsx           // ★v4
│   │   └── BookmarkTabs.tsx           // ★v4
│   ├── sidebar/
│   │   ├── SidebarPanel.tsx
│   │   ├── SidebarTabs.tsx
│   │   ├── STTStream.tsx
│   │   ├── TagTimeline.tsx
│   │   └── BookmarkList.tsx           // ★v4
│   ├── code/
│   │   ├── CodeTab.tsx
│   │   ├── MonacoWrapper.tsx
│   │   ├── ConsoleOutput.tsx
│   │   ├── RunButton.tsx
│   │   ├── SnippetHistory.tsx
│   │   ├── CodeSkeletonUI.tsx         // ★v4: 로딩 중 스켈레톤
│   │   └── SupportedPackagesInfo.tsx  // ★v4: 지원 패키지 안내
│   ├── audio/
│   │   ├── RecordingControls.tsx
│   │   └── AudioWaveform.tsx
│   ├── search/
│   │   ├── SearchOverlay.tsx
│   │   └── SearchResults.tsx
│   ├── queue/
│   │   ├── PendingTray.tsx
│   │   ├── PendingBadge.tsx
│   │   └── PendingDropdown.tsx
│   ├── toolbar/
│   │   ├── Toolbar.tsx
│   │   ├── ColorPalette.tsx           // ★v4: 형광펜 색상
│   │   └── StickerPalette.tsx         // ★v4
│   ├── status/                        // ★v4 신규
│   │   ├── SaveStatusIndicator.tsx
│   │   ├── StorageUsageBar.tsx
│   │   └── WhisperStatusBadge.tsx
│   └── export/                        // ★v4 신규
│       └── ExportDialog.tsx
│
├── stores/
│   ├── sessionStore.ts
│   ├── annotationStore.ts             // 태그+텍스트박스+형광펜+스티커+북마크 통합
│   ├── searchStore.ts
│   ├── jobQueueStore.ts
│   ├── codeStore.ts
│   └── undoRedoStore.ts               // ★v4 신규
│
├── workers/
│   ├── audio.worker.ts                // ★v4: 오버랩 청킹 포함
│   ├── stt.worker.ts                  // ★v4: 오버랩 중복 제거 포함
│   ├── pdf.worker.ts
│   └── codeRunner.worker.ts
│
├── core/
│   ├── ResourceManager.ts
│   ├── MemoryGuard.ts
│   ├── CrashRecoveryManager.ts
│   ├── JobScheduler.ts
│   ├── PreWarmingManager.ts           // ★v4 신규
│   ├── AutoSaveManager.ts             // ★v4 신규
│   ├── StorageManager.ts              // ★v4 신규: OPFS + 용량 관리
│   └── OPFSStorage.ts                 // ★v4 신규: OPFS 래퍼
│
├── db/
│   ├── schema.ts                      // ★v4: version(3) + 신규 테이블
│   ├── tagRepository.ts
│   ├── annotationRepository.ts
│   ├── sttRepository.ts
│   ├── jobRepository.ts
│   ├── codeSnippetRepository.ts
│   ├── textboxRepository.ts           // ★v4 신규
│   ├── mathRepository.ts              // ★v4 신규
│   └── bookmarkRepository.ts          // ★v4 신규
│
├── hooks/
│   ├── useRecording.ts
│   ├── useStt.ts
│   ├── useTagging.ts
│   ├── useDragDrop.ts
│   ├── useSearch.ts
│   ├── useCodeRunner.ts
│   ├── useResourceMode.ts
│   ├── useTextBox.ts                  // ★v4 신규: 더블클릭 + 수식
│   ├── useHighlighter.ts             // ★v4 신규
│   ├── useUndoRedo.ts                // ★v4 신규
│   └── useAutoSave.ts                // ★v4 신규
│
├── lib/
│   ├── timeSync.ts
│   ├── pdfTextExtractor.ts
│   ├── codeDetector.ts
│   ├── mathParser.ts                  // ★v4 신규: 자연어→LaTeX 파서
│   ├── mathDictionary.ts              // ★v4 신규: 한국어 수학 용어 사전
│   ├── overlapDeduplicator.ts         // ★v4 신규: STT 오버랩 중복 제거
│   └── exporters/                     // ★v4 신규
│       ├── markdownExporter.ts
│       ├── htmlExporter.ts
│       └── pdfExporter.ts
│
└── types/
    └── index.ts
```

---

## 16. 성능 벤치마크 목표 (v4 업데이트)

| 지표 | 목표 | v3 대비 변경 |
|------|------|-------------|
| 앱 초기 로딩 | < 2초 (모델 캐시 후) | UI 선렌더링 + 프리워밍 분리 |
| Whisper 모델 로드 | < 5초 (유휴 시간 프리워밍) | 사용자 체감 0초 (백그라운드) |
| STT 실시간 지연 | < 8초 (5s+1s 오버랩 청크 + 3s 추론) | 오버랩으로 정확도 ↑ |
| STT 실시간 정확도 | > 85% (한국어) | 오버랩 중복 제거 적용 |
| STT 후처리 정확도 | > 95% (한국어) | beam=5 전체 패스 |
| PDF 페이지 전환 | < 200ms | |
| 더블클릭 → 텍스트 상자 | < 100ms | ★v4 신규 |
| 수식 변환 (파싱+렌더링) | < 50ms | ★v4 신규 |
| 태그 생성 반응 | < 50ms | |
| 검색 응답 | < 100ms (1만 항목) | 4차원 확장 |
| Pyodide 초기화 | < 3초 (캐시 후) | 스켈레톤 UI 표시 |
| Python 코드 실행 | < 1초 (단순), < 10초 (타임아웃) | |
| 메모리 사용량 | < 1.5GB (어느 모드든) | |
| OPFS 쓰기 (오디오 청크) | < 50ms/chunk | ★v4: IndexedDB→OPFS 이동 |
| 자동 저장 | 3초 디바운스 | ★v4 신규 |
| 크래시 후 복구 | < 2초 | |
| Undo/Redo | < 10ms | ★v4 신규 |

---

## 17. 개발 로드맵 (v4 최종)

### Phase 1 — PDF 뷰어 + 필기 기반 (2주)
- [ ] Vite + React + TS + PWA + Dexie v3 스키마
- [ ] OPFS 초기화 + StorageManager
- [ ] react-pdf + 페이지 가상화
- [ ] OverlayCanvas + 더블클릭 텍스트 상자
- [ ] AnnotationLayer + 형광펜 + 스티커
- [ ] 단축키 바인딩 (전체 맵)
- [ ] Undo/Redo (Immer 패치)
- [ ] AutoSave (3초 디바운스)
- [ ] 북마크

### Phase 2 — 녹음 + 태깅 + 크래시 복구 (2~3주)
- [ ] AudioWorker + **1초 오버랩 청킹**
- [ ] WaveSurfer.js 파형
- [ ] SessionStore 동기화 삼각형
- [ ] 3단계 태깅 (point/area/page) + **태깅 모드 토글(Tab)**
- [ ] CrashRecoveryManager (WAL)
- [ ] 오디오 OPFS 즉시 저장 정책

### Phase 3 — STT + JobQueue (2~3주) ★ 난이도 최고
- [ ] **PreWarmingManager** (유휴 시간 모델 로딩)
- [ ] STTWorker: Whisper + **오버랩 중복 제거**
- [ ] JobQueueStore + 임시보관함(PendingTray) UI
- [ ] 동시 녹음 + 변환 병렬 처리
- [ ] STT 이중 패스 (실시간 → 후처리 교체)
- [ ] STT 드래그앤드롭 → PDF

### Phase 4 — 수식 변환 + 통합 검색 (1~2주)
- [ ] **mathParser: 한국어 자연어 → LaTeX**
- [ ] **KaTeX 렌더링 통합**
- [ ] 수식 모드 강제 토글 (Ctrl+M, $$ 접두어)
- [ ] Fuse.js 4차원 검색 (STT + 필기 + PDF + 코드)
- [ ] SearchOverlay + 결과 네비게이션

### Phase 5 — Monaco 코드 에디터 (2주)
- [ ] Monaco lazy-load + **스켈레톤 UI**
- [ ] CodeRunnerWorker (Pyodide) + **에러 바운더리**
- [ ] JS 샌드박스 (iframe)
- [ ] PDF 코드 감지 + 드래그앤드롭
- [ ] **지원 패키지 안내 UI**
- [ ] 코드 실행 안전장치 (타임아웃, 메모리 제한)

### Phase 6 — 최적화 + 패키징 + 내보내기 (1~2주)
- [ ] ResourceManager (모드별 상호 배타적 로딩)
- [ ] MemoryGuard (자동 방어)
- [ ] **OPFS 용량 관리** (스마트 정리)
- [ ] **내보내기** (Markdown, HTML, JSON, Annotated PDF)
- [ ] 성능 벤치마크 전체 통과 확인
- [ ] Tauri v2 데스크톱 빌드
- [ ] Service Worker 오프라인 캐싱 검증

---

## 18. 확장 가능성 (미래)

- **LLM RAG:** 태그 범위 컨텍스트 → 할루시네이션 제로 요약
- **WebGPU Whisper:** STT 속도 5~10x
- **협업 (Yjs/CRDT):** 멀티 유저 태깅
- **플러그인 시스템:** 커스텀 언어 런타임 (Rust/Go WASM)
- **모바일 동반 앱:** 녹음만 모바일 → PC에서 태깅/변환
- **LaTeX 자동완성:** 수식 입력 중 실시간 미리보기 + 자동완성 드롭다운
- **AI 수식 OCR:** PDF 내 수식 이미지 → LaTeX 자동 추출 (Mathpix 대체)
- **다국어 수학 파서 확장:** 영어("sigma from i=1 to n") + 일본어 지원
