/**
 * @file components/status/StorageUsageBar.tsx
 * LectureMate — OPFS 스토리지 사용량 표시 바
 *
 * ## 표시
 * - 사용량 텍스트 + 미니 진행 바 + 퍼센트
 *
 * ## 색상 (storageStore.level 기준)
 * - ok     (< 70%)  → 파랑  (--accent-blue)
 * - warn   (70~85%) → 주황  (--accent-amber)
 * - danger (≥ 85%)  → 빨강 + "정리 제안" 버튼 표시
 *
 * ## 갱신
 * - 마운트 시 즉시 + 30초마다 storageManager.checkAndWarn() 호출
 * - 결과는 storageStore에 저장되므로 폴링 로직은 이 컴포넌트에만 있음
 */

import { useEffect, useState } from 'react'
import { useStorageStore }    from '@/stores/storageStore'
import { storageManager }     from '@/core/StorageManager'

// ============================================================
// 헬퍼
// ============================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024)                return `${bytes} B`
  if (bytes < 1_048_576)           return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1_073_741_824)       return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`
}

// ============================================================
// StorageUsageBar
// ============================================================

export function StorageUsageBar() {
  const usage        = useStorageStore((s) => s.usage)
  const quota        = useStorageStore((s) => s.quota)
  const ratio        = useStorageStore((s) => s.ratio)
  const level        = useStorageStore((s) => s.level)
  const isCleaningUp = useStorageStore((s) => s.isCleaningUp)

  const [freedMsg, setFreedMsg] = useState<string | null>(null)

  // 30초마다 storageManager.checkAndWarn() 호출
  useEffect(() => {
    storageManager.checkAndWarn()
    const id = setInterval(() => storageManager.checkAndWarn(), 30_000)
    return () => clearInterval(id)
  }, [])

  // quota가 아직 로드되지 않았으면 아무것도 렌더링하지 않음
  if (quota === 0) return null

  const pct = Math.min(100, Math.round(ratio * 100))

  const color =
    level === 'danger' ? 'var(--accent-red)'   :
    level === 'warn'   ? 'var(--accent-amber)' :
                         'var(--accent-blue)'

  const tip = `스토리지: ${formatBytes(usage)} / ${formatBytes(quota)} (${pct}%)`

  const handleCleanup = async () => {
    setFreedMsg(null)
    const freed = await storageManager.smartCleanup(30)
    if (freed > 0) {
      setFreedMsg(`${formatBytes(freed)} 정리 완료`)
      setTimeout(() => setFreedMsg(null), 4_000)
    }
  }

  return (
    <div className="flex items-center gap-2" title={tip}>
      {/* 사용량 텍스트 */}
      <span
        className="text-xs tabular-nums whitespace-nowrap"
        style={{ color: level !== 'ok' ? color : 'var(--text-muted)' }}
      >
        {freedMsg ?? formatBytes(usage)}
      </span>

      {/* 진행 바 */}
      <div
        className="rounded-full overflow-hidden"
        style={{
          width:           56,
          height:          4,
          backgroundColor: 'var(--bg-tertiary)',
        }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>

      {/* 퍼센트 */}
      <span
        className="text-xs tabular-nums"
        style={{ color, minWidth: 28 }}
      >
        {pct}%
      </span>

      {/* 85% 이상: "정리" 버튼 */}
      {level === 'danger' && (
        <button
          onClick={handleCleanup}
          disabled={isCleaningUp}
          className="text-xs px-2 py-0.5 rounded-md transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
          style={{
            backgroundColor: 'rgba(239,68,68,0.15)',
            color:           'var(--accent-red)',
          }}
          title="STT 완료된 오래된 세션의 오디오 원본 삭제 (태그·필기 보존)"
        >
          {isCleaningUp ? '정리 중…' : '정리'}
        </button>
      )}
    </div>
  )
}
