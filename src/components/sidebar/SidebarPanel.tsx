/**
 * @file components/sidebar/SidebarPanel.tsx
 * LectureMate — 우측 사이드바 패널
 *
 * ## 탭 구조
 * - [STT]   실시간 변환 텍스트 (Phase 2에서 활성화)
 * - [코드]  Monaco 코드 에디터 + Pyodide (Section 5)
 * - [북마크] BookmarkList 컴포넌트 연결
 *
 * ## 하단
 * AudioWaveform 플레이스홀더 (Phase 2에서 WaveSurfer 연결)
 */

import { useState, useCallback, useEffect } from 'react'
import { BookmarkList } from './BookmarkList'
import { STTStream } from './STTStream'
import { AudioWaveform } from '@/components/audio/AudioWaveform'
import { CodeTab } from '@/components/code/CodeTab'
import { resourceManager } from '@/core/ResourceManager'

// ============================================================
// 탭 정의
// ============================================================

type TabId = 'stt' | 'code' | 'bookmark'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'stt',      label: 'STT',   icon: '🎙' },
  { id: 'code',     label: '코드',  icon: '⌨'  },
  { id: 'bookmark', label: '북마크', icon: '🔖' },
]

// ============================================================
// SidebarPanel
// ============================================================

export function SidebarPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('stt')

  // 탭 전환 시 ResourceManager 모드 전환 + Pyodide 온디맨드 로딩
  const handleTabClick = useCallback((id: TabId) => {
    setActiveTab(id)
    if (id === 'code') {
      resourceManager.switchMode('coding')
    } else {
      resourceManager.switchMode('reviewing')
    }
  }, [])

  // PDF 뷰어에서 "코드로 복사" 클릭 시 코드 탭으로 자동 전환
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<TabId>).detail
      if (tab === 'code') {
        setActiveTab('code')
        resourceManager.switchMode('coding')
      }
    }
    window.addEventListener('lm:switch-tab', handler)
    return () => window.removeEventListener('lm:switch-tab', handler)
  }, [])

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
              onClick={() => handleTabClick(id)}
              className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-all relative"
              style={{
                color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
                backgroundColor: 'transparent',
                border: 'none',
              }}
            >
              <span style={{ fontSize: 13 }}>{icon}</span>
              {label}
              {/* 활성 탭 하단 인디케이터 */}
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
      {/* CodeTab은 내부적으로 flex-col h-full 레이아웃이므로 overflow-hidden 필요 */}
      <div className={activeTab === 'code' ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 overflow-y-auto min-h-0'}>

        {/* STT 탭 */}
        {activeTab === 'stt' && <STTStream />}

        {/* 코드 탭 */}
        {activeTab === 'code' && <CodeTab />}

        {/* 북마크 탭 */}
        {activeTab === 'bookmark' && <BookmarkList />}
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
