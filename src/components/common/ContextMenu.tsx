/**
 * @file components/common/ContextMenu.tsx
 * LectureMate — 범용 컨텍스트 메뉴 (토스뱅크 스타일)
 *
 * Props:
 *   items    메뉴 항목 배열 { label, onClick, danger? }
 *   x, y     화면 좌표
 *   onClose  외부 클릭·ESC 시 닫기
 *   children 커스텀 슬롯 (색상 팔레트 등)
 */

import { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  x: number
  y: number
  onClose: () => void
  children?: React.ReactNode
}

export function ContextMenu({ items, x, y, onClose, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown',   onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown',   onKey)
    }
  }, [onClose])

  // 화면 밖으로 삐져나오지 않도록 위치 조정
  const style: React.CSSProperties = {
    position:        'fixed',
    left:            x,
    top:             y,
    zIndex:          50,
    backgroundColor: '#FFFFFF',
    border:          '1px solid #F2F4F8',
    boxShadow:       '0 8px 32px rgba(0,0,0,0.12)',
    borderRadius:    16,
    minWidth:        164,
    overflow:        'hidden',
    paddingTop:      4,
    paddingBottom:   4,
  }

  return (
    <div ref={ref} style={style}>
      {items.map((item, idx) => (
        <button
          key={idx}
          onClick={() => { item.onClick(); onClose() }}
          className="w-full flex items-center px-4 py-2.5 text-sm text-left transition-colors"
          style={{ color: item.danger ? '#F03E3E' : '#191F28', backgroundColor: 'transparent' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#F5F6F8' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
        >
          {item.label}
        </button>
      ))}
      {children && (
        <>
          <div style={{ height: 1, backgroundColor: '#F2F4F8', margin: '4px 0' }} />
          {children}
        </>
      )}
    </div>
  )
}
