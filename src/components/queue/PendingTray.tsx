/**
 * @file components/queue/PendingTray.tsx
 * LectureMate — PendingBadge + PendingDropdown 조합
 *
 * TopBar 우측에 마운트. 미완료 작업이 없으면 아무것도 렌더링하지 않음.
 */

import { useState, useCallback } from 'react'
import { PendingBadge } from './PendingBadge'
import { PendingDropdown } from './PendingDropdown'

export function PendingTray() {
  const [isOpen, setIsOpen] = useState(false)

  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  const close  = useCallback(() => setIsOpen(false),      [])

  return (
    <div className="relative">
      <PendingBadge onClick={toggle} isOpen={isOpen} />
      {isOpen && <PendingDropdown onClose={close} />}
    </div>
  )
}
