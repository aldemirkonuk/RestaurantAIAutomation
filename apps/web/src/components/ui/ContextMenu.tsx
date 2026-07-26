import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

const MENU_WIDTH = 208 // w-52
const MENU_EST_HEIGHT = 280

export interface ContextMenuItem {
  id: string
  label: string
  icon?: LucideIcon
  danger?: boolean
  disabled?: boolean
  dividerBefore?: boolean
  onClick: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
  className?: string
  /** Estimated height for viewport clamping (default 280). */
  estimatedHeight?: number
  children?: ReactNode
}

/**
 * Fixed-position context menu matching Orders / Providers chrome.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
  className,
  estimatedHeight = MENU_EST_HEIGHT,
  children,
}: ContextMenuProps) {
  const top = Math.min(y, typeof window !== 'undefined' ? window.innerHeight - estimatedHeight : y)
  const left = Math.min(x, typeof window !== 'undefined' ? window.innerWidth - MENU_WIDTH - 8 : x)

  return (
    <div
      role="menu"
      className={cn(
        'fixed z-[60] w-52 bg-white border border-gray-200 rounded-xl shadow-xl p-1',
        className,
      )}
      style={{ top, left }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      {items.map((item) => (
        <div key={item.id}>
          {item.dividerBefore && <div className="my-1 border-t border-gray-100" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              onClose()
            }}
            className={cn(
              'flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm rounded-lg',
              'hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent',
              item.danger ? 'text-red-600' : 'text-gray-700',
            )}
          >
            {item.icon && (
              <item.icon
                className={cn('w-4 h-4 shrink-0', item.danger ? 'text-red-500' : 'text-gray-400')}
              />
            )}
            {item.label}
          </button>
        </div>
      ))}
    </div>
  )
}
