/**
 * @file components/sidebar/SidebarPanel.tsx
 * LectureMate — 우측 사이드바 패널
 *
 * ## 탭 구조
 * - [STT]   실시간 변환 텍스트
 * - [북마크] BookmarkList 컴포넌트
 *
 * ## 하단
 * AudioWaveform 플레이스홀더
 */

import { useState } from 'react'
import { BookmarkList } from './BookmarkList'
import { STTStream } from './STTStream'
import { TranslationPanel } from './TranslationPanel'
import { AudioWaveform } from '@/components/audio/AudioWaveform'

// ============================================================
// 탭 정의
// ============================================================

type TabId = 'stt' | 'bookmark' | 'translation'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'stt',         label: 'STT',   icon: '🎙' },
  { id: 'bookmark',    label: '북마크', icon: '🔖' },
  { id: 'translation', label: '번역',   icon: '🌐' },
]

// ============================================================
// SidebarPanel
// ============================================================

export function SidebarPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('stt')

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: 'var(--bg-secondary)' }}
    >
      {/* ── 탭 헤더 ───────────────────────────────────────── */}
      <div
        className="flex shrink-0"
        style={{
          borderBottom:    '1px solid var(--border-default)',
          backgroundColor: 'var(--bg-primary)',
        }}
      >
        {TABS.map(({ id, label, icon }) => {
          const isActive = activeTab === id
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-all relative"
              style={{
                color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
                backgroundColor: 'transparent',
                border: 'none',
              }}
            >
              <span style={{ fontSize: 13 }}>{icon}</span>
              {label}
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 right-0"
                  style={{
                    height:          2,
                    backgroundColor: 'var(--accent-blue)',
                    borderRadius:    '2px 2px 0 0',
                  }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* ── 탭 콘텐츠 ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === 'stt'         && <STTStream />}
        {activeTab === 'bookmark'    && <BookmarkList />}
        {activeTab === 'translation' && <TranslationPanel />}
      </div>

      {/* ── 하단: 오디오 파형 ──────────────────────────────── */}
      <div
        className="shrink-0 px-3 py-2"
        style={{
          borderTop:       '1px solid var(--border-default)',
          backgroundColor: 'var(--bg-primary)',
        }}
      >
        <AudioWaveform height={56} />
      </div>
    </div>
  )
}
