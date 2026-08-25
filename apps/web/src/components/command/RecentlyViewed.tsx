/**
 * RecentlyViewed — the ⌘⇧O "jump back" switcher (NEW-034). Lists the last
 * routes you visited; ↑/↓ + Enter to jump, Esc to close.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, CornerDownLeft } from 'lucide-react'
import { getRecentlyViewed } from './recents-store'

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function RecentlyViewed({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [active, setActive] = useState(0)
  // Skip the current page (index 0 is where you already are).
  const entries = useMemo(() => (open ? getRecentlyViewed().slice(1) : []), [open])

  useEffect(() => {
    if (open) setActive(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => (entries.length ? (a + 1) % entries.length : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (entries.length ? (a - 1 + entries.length) % entries.length : 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const entry = entries[active]
        if (entry) {
          onClose()
          navigate(entry.path)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, entries, active, navigate, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[16vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Recently viewed"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="absolute inset-0 bg-gray-900/40" aria-hidden />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <Clock className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-900">Recently viewed</span>
        </div>
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            No recent pages yet — they collect as you navigate.
          </div>
        ) : (
          <div role="listbox" className="py-2 max-h-[50vh] overflow-y-auto">
            {entries.map((entry, idx) => (
              <button
                key={entry.path}
                role="option"
                aria-selected={idx === active}
                onMouseMove={() => setActive(idx)}
                onClick={() => {
                  onClose()
                  navigate(entry.path)
                }}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left ${
                  idx === active ? 'bg-wine-50' : ''
                }`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-gray-900 truncate">
                    {entry.label}
                  </span>
                  <span className="block text-xs text-gray-400 truncate">
                    {entry.path} · {ago(entry.ts)}
                  </span>
                </span>
                {idx === active && (
                  <CornerDownLeft className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
