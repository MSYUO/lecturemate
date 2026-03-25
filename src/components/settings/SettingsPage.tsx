/**
 * @file components/settings/SettingsPage.tsx
 * LectureMate — 설정 화면 (토스뱅크 스타일)
 *
 * ## 섹션
 * 1. 일반      — 기본 저장 폴더 지정
 * 2. 시험 가중치 — ON/OFF + 족보 메모 입력 (추후 AI 프롬프트 연동)
 * 3. 저장 공간  — OPFS 사용량 바 + "정리하기"
 * 4. 정보      — 앱 버전, 단축키 목록
 */

import { useState, useEffect } from 'react'
import { useRouterStore }        from '@/stores/routerStore'
import { useSessionStore }       from '@/stores/sessionStore'
import { useFolderStore }        from '@/stores/folderStore'
import { useStorageStore }       from '@/stores/storageStore'
import { useTranslationStore }   from '@/stores/translationStore'
import { storageManager }        from '@/core/StorageManager'
import { LANG_LABELS }           from '@/lib/translator'

// ============================================================
// 헬퍼
// ============================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024)          return `${bytes} B`
  if (bytes < 1_048_576)     return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`
}

// ============================================================
// 하위 컴포넌트 — Section / Row
// ============================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <p className="text-xs font-bold uppercase tracking-wider mb-3 px-1" style={{ color: '#8B95A1' }}>
        {title}
      </p>
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#FFFFFF', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', border: '1px solid #F2F4F8' }}>
        {children}
      </div>
    </section>
  )
}

function Row({
  label, sublabel, children, last,
}: {
  label: string; sublabel?: string; children: React.ReactNode; last?: boolean
}) {
  return (
    <div
      className="flex items-center justify-between px-5 py-4"
      style={{ borderBottom: last ? 'none' : '1px solid #F9FAFB' }}
    >
      <div>
        <p className="text-sm font-medium" style={{ color: '#191F28' }}>{label}</p>
        {sublabel && <p className="text-xs mt-0.5" style={{ color: '#8B95A1' }}>{sublabel}</p>}
      </div>
      <div className="ml-4 flex items-center">
        {children}
      </div>
    </div>
  )
}

// ============================================================
// 미니 토글 스위치
// ============================================================

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="relative flex items-center shrink-0"
      style={{
        width:           44,
        height:          24,
        borderRadius:    12,
        backgroundColor: value ? '#3182F6' : '#D1D5DB',
        transition:      'background-color 200ms',
      }}
    >
      <span
        style={{
          position:        'absolute',
          width:           18,
          height:          18,
          borderRadius:    9,
          backgroundColor: '#FFFFFF',
          left:            value ? 22 : 3,
          transition:      'left 200ms',
          boxShadow:       '0 1px 4px rgba(0,0,0,0.18)',
        }}
      />
    </button>
  )
}

// ============================================================
// 단축키 목록
// ============================================================

const SHORTCUTS: [string, string][] = [
  ['V', '포인터 도구'],
  ['H', '형광펜 도구'],
  ['T', '텍스트 상자'],
  ['S', '스티커 도구'],
  ['Tab', '태깅 모드 토글'],
  ['Ctrl+Space', '페이지 전체 태그'],
  ['Ctrl+Z', '실행 취소'],
  ['Ctrl+Shift+Z', '다시 실행'],
  ['Ctrl+F', '검색 열기'],
  ['Ctrl+B', '북마크 토글'],
  ['Ctrl+R', '녹음 시작/정지'],
  ['Ctrl+Shift+R', '녹음 일시정지'],
  ['Escape', '선택 해제'],
]

// ============================================================
// SettingsPage
// ============================================================

export function SettingsPage() {
  const goBack                = useRouterStore((s) => s.goBack)
  const defaultSaveFolderId   = useSessionStore((s) => s.defaultSaveFolderId)
  const setDefaultSaveFolderId = useSessionStore((s) => s.setDefaultSaveFolderId)

  const { folders, isLoaded, loadFolders } = useFolderStore()

  const usage        = useStorageStore((s) => s.usage)
  const quota        = useStorageStore((s) => s.quota)
  const ratio        = useStorageStore((s) => s.ratio)
  const level        = useStorageStore((s) => s.level)
  const isCleaningUp = useStorageStore((s) => s.isCleaningUp)

  const defaultTargetLang    = useTranslationStore((s) => s.defaultTargetLang)
  const defaultDisplayMode   = useTranslationStore((s) => s.defaultDisplayMode)
  const autoDetectSource     = useTranslationStore((s) => s.autoDetectSource)
  const setDefaultTargetLang = useTranslationStore((s) => s.setDefaultTargetLang)
  const setDefaultDisplayMode = useTranslationStore((s) => s.setDefaultDisplayMode)
  const setAutoDetectSource  = useTranslationStore((s) => s.setAutoDetectSource)

  const [examEnabled, setExamEnabled]   = useState(false)
  const [examNotes, setExamNotes]       = useState('')
  const [freedMsg, setFreedMsg]         = useState<string | null>(null)
  const [showFolderPicker, setShowFolderPicker] = useState(false)

  useEffect(() => {
    if (!isLoaded) void loadFolders()
    storageManager.checkAndWarn()
  }, [isLoaded, loadFolders])

  const pct = Math.min(100, Math.round(ratio * 100))
  const storageColor =
    level === 'danger' ? '#F03E3E' :
    level === 'warn'   ? '#F0B429' :
                         '#3182F6'

  const defaultFolderName = folders.find((f) => f.id === defaultSaveFolderId)?.name ?? '없음 (매번 선택)'

  const handleCleanup = async () => {
    setFreedMsg(null)
    const freed = await storageManager.smartCleanup(30)
    if (freed > 0) {
      setFreedMsg(`${formatBytes(freed)} 정리 완료`)
      setTimeout(() => setFreedMsg(null), 4_000)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#F9FAFB' }}>

      {/* ── 헤더 ──────────────────────────────────────────── */}
      <header
        className="flex items-center gap-3 px-6 shrink-0"
        style={{
          height:          64,
          backgroundColor: '#FFFFFF',
          borderBottom:    '1px solid #F2F4F8',
          boxShadow:       '0 1px 0 #F2F4F8',
        }}
      >
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all hover:bg-[#F2F4F8] active:scale-95"
          style={{ color: '#3182F6' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          뒤로
        </button>
        <h1 className="text-base font-bold" style={{ color: '#191F28' }}>설정</h1>
      </header>

      {/* ── 본문 ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-8 max-w-xl mx-auto w-full">

        {/* 1. 일반 */}
        <Section title="일반">
          <Row label="기본 저장 폴더" sublabel="PDF·녹음 저장 시 기본으로 사용" last>
            <div className="relative">
              <button
                onClick={() => setShowFolderPicker((v) => !v)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-all hover:bg-[#F2F4F8] active:scale-95"
                style={{ color: '#3182F6' }}
              >
                {defaultFolderName}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {showFolderPicker && (
                <div
                  className="absolute right-0 top-10 z-30 rounded-2xl overflow-hidden py-1"
                  style={{ backgroundColor: '#FFFFFF', border: '1px solid #F2F4F8', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', minWidth: 180 }}
                >
                  {[{ id: null, name: '없음 (매번 선택)' }, ...folders].map((f) => (
                    <button
                      key={f.id ?? 'none'}
                      onClick={() => { setDefaultSaveFolderId(f.id); setShowFolderPicker(false) }}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm text-left transition-colors"
                      style={{ color: '#191F28', backgroundColor: 'transparent' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#F9FAFB' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                    >
                      {f.name}
                      {f.id === defaultSaveFolderId && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3182F6" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Row>
        </Section>

        {/* 2. 시험 가중치 */}
        <Section title="시험 가중치">
          <Row label="시험 가중치 사용" sublabel="스티커 중요도·AI 요약에 반영됩니다">
            <Toggle value={examEnabled} onChange={setExamEnabled} />
          </Row>
          {examEnabled && (
            <div className="px-5 pb-4">
              <p className="text-xs font-medium mb-2" style={{ color: '#8B95A1' }}>족보 메모 (기출 주제를 자유롭게 입력)</p>
              <textarea
                value={examNotes}
                onChange={(e) => setExamNotes(e.target.value)}
                placeholder="예: 2장 선형변환, 3장 행렬식 자주 출제..."
                rows={4}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
                style={{
                  backgroundColor: '#F9FAFB',
                  border:          '1.5px solid #F2F4F8',
                  color:           '#191F28',
                }}
                onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#3182F6' }}
                onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#F2F4F8' }}
              />
            </div>
          )}
        </Section>

        {/* 3. 저장 공간 */}
        {quota > 0 && (
          <Section title="저장 공간">
            <div className="px-5 py-4">
              {/* 사용량 텍스트 */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium" style={{ color: '#191F28' }}>
                  {freedMsg ?? `${formatBytes(usage)} 사용 중`}
                </p>
                <p className="text-sm font-semibold tabular-nums" style={{ color: storageColor }}>
                  {pct}%
                </p>
              </div>
              {/* 진행 바 */}
              <div className="rounded-full overflow-hidden mb-4" style={{ height: 8, backgroundColor: '#F2F4F8' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: storageColor }}
                />
              </div>
              <p className="text-xs mb-4" style={{ color: '#8B95A1' }}>
                총 {formatBytes(quota)} 중 {formatBytes(quota - usage)} 남음
              </p>
              <button
                onClick={() => void handleCleanup()}
                disabled={isCleaningUp}
                className="px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
                style={{
                  backgroundColor: level === 'danger' ? 'rgba(240,62,62,0.10)' : '#F2F4F8',
                  color:           level === 'danger' ? '#F03E3E' : '#4E5968',
                }}
              >
                {isCleaningUp ? '정리 중…' : '정리하기'}
              </button>
            </div>
          </Section>
        )}

        {/* 4. 번역 */}
        <Section title="번역">
          {/* 기본 표시 모드 */}
          <Row label="기본 표시 모드" sublabel="번역 결과를 PDF 위에 덮거나 패널에 표시">
            <div
              className="flex"
              style={{ backgroundColor: '#F2F4F8', borderRadius: 10, padding: 2, gap: 2 }}
            >
              {(['overlay', 'panel'] as const).map((mode) => {
                const active = defaultDisplayMode === mode
                return (
                  <button
                    key={mode}
                    onClick={() => setDefaultDisplayMode(mode)}
                    style={{
                      padding:         '4px 12px',
                      borderRadius:    8,
                      fontSize:        12,
                      fontWeight:      active ? 600 : 400,
                      backgroundColor: active ? '#3182F6' : 'transparent',
                      color:           active ? '#FFFFFF' : '#8B95A1',
                      border:          'none',
                      cursor:          'pointer',
                      transition:      'all 150ms',
                    }}
                  >
                    {mode === 'overlay' ? '오버레이' : '패널'}
                  </button>
                )
              })}
            </div>
          </Row>
          {/* 기본 번역 언어 */}
          <Row label="기본 번역 언어" sublabel="새 번역 시 기본으로 선택되는 언어">
            <select
              value={defaultTargetLang}
              onChange={(e) => setDefaultTargetLang(e.target.value)}
              style={{
                padding:         '5px 10px',
                borderRadius:    10,
                border:          '1px solid #E5E7EB',
                fontSize:        13,
                backgroundColor: '#F9FAFB',
                color:           '#191F28',
                cursor:          'pointer',
              }}
            >
              {Object.entries(LANG_LABELS)
                .filter(([code]) => code !== 'auto')
                .map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
            </select>
          </Row>
          {/* 원본 언어 자동 감지 */}
          <Row label="원본 언어 자동 감지" sublabel="LibreTranslate /detect 엔드포인트 사용" last>
            <Toggle value={autoDetectSource} onChange={setAutoDetectSource} />
          </Row>
        </Section>

        {/* 5. 정보 */}
        <Section title="정보">
          <Row label="버전" last={false}>
            <span className="text-sm" style={{ color: '#8B95A1' }}>1.0.0</span>
          </Row>
          <div className="px-5 py-4">
            <p className="text-xs font-medium mb-3" style={{ color: '#8B95A1' }}>단축키</p>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {SHORTCUTS.map(([key, desc]) => (
                <div key={key} className="flex items-center gap-2">
                  <span
                    className="text-xs px-2 py-0.5 rounded-lg font-mono shrink-0"
                    style={{ backgroundColor: '#F2F4F8', color: '#4E5968' }}
                  >
                    {key}
                  </span>
                  <span className="text-xs truncate" style={{ color: '#8B95A1' }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

      </div>
    </div>
  )
}
