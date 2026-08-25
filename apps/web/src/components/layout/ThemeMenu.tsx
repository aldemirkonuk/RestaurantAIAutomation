import { useEffect, useRef, useState } from 'react'
import { Sun, Moon, Monitor, Check } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { cn } from '../../lib/utils'

/**
 * ThemeMenu — 3-way theme picker in the header (NEW-026).
 *
 * Light / Dark / System as a dropdown menu (vs. the old binary toggle). The
 * trigger shows the currently-resolved theme's icon; the menu marks the chosen
 * mode (which may be "System"). Click-outside + Escape close it.
 */

const OPTIONS = [
  { value: 'light' as const, label: 'Light', icon: Sun },
  { value: 'dark' as const, label: 'Dark', icon: Moon },
  { value: 'system' as const, label: 'System', icon: Monitor },
]

export function ThemeMenu({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const TriggerIcon = resolvedTheme === 'dark' ? Moon : Sun

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-xl bg-gray-100 p-2 text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        aria-label="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Theme: ${theme === 'system' ? `System (${resolvedTheme})` : theme}`}
      >
        <TriggerIcon className="w-5 h-5" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-xl z-50 dark:border-gray-700 dark:bg-gray-800"
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = theme === value
            return (
              <button
                key={value}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">{label}</span>
                {active && <Check className="w-4 h-4 text-wine-600" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
