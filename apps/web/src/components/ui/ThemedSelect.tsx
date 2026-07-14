import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface ThemedSelectOption {
  value: string
  label: string
}

interface ThemedSelectProps {
  value: string
  options: ThemedSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  align?: 'left' | 'right'
}

/**
 * Fully theme-styled dropdown (button + panel) — replaces the native <select>
 * so the closed control AND the open option list match the wine/gray design
 * system used across the app.
 */
export function ThemedSelect({
  value,
  options,
  onChange,
  disabled,
  className,
  align = 'right',
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = options.find((o) => o.value === value)

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center justify-between gap-2 w-full min-w-[8rem] px-3 py-2 text-sm font-medium rounded-lg border bg-white text-gray-700 transition-colors outline-none',
          disabled
            ? 'opacity-50 cursor-not-allowed border-gray-200'
            : 'border-gray-200 hover:border-gray-300 cursor-pointer',
          open && !disabled && 'border-wine-500 ring-2 ring-wine-100',
        )}
      >
        <span className="truncate">{selected?.label ?? 'Select'}</span>
        <ChevronDown
          className={cn(
            'w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && !disabled && (
        <div
          className={cn(
            'absolute z-30 mt-1 min-w-full w-max max-w-[16rem] rounded-lg border border-gray-100 bg-white shadow-lg py-1',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={cn(
                'flex items-center justify-between gap-3 w-full text-left px-3 py-2 text-sm transition-colors',
                o.value === value
                  ? 'text-wine-700 bg-wine-50 font-medium'
                  : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              <span className="truncate">{o.label}</span>
              {o.value === value && (
                <Check className="w-4 h-4 text-wine-600 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
