import { useState, useRef, useEffect, useId } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface ThemedSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface ThemedSelectProps {
  value: string
  options: ThemedSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  align?: 'left' | 'right'
  /** Accessible name — required when several selects sit in one filter bar. */
  'aria-label'?: string
  label?: string
}

/**
 * Fully theme-styled dropdown (button + panel) — replaces the native <select>
 * so the closed control AND the open option list match the wine/gray design
 * system used across the app (not iOS / system chrome).
 */
export function ThemedSelect({
  value,
  options,
  onChange,
  disabled,
  className,
  align = 'right',
  'aria-label': ariaLabel,
  label,
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open) return
    const idx = options.findIndex((o) => o.value === value)
    setActiveIndex(idx >= 0 ? idx : 0)
  }, [open, options, value])

  const selected = options.find((o) => o.value === value)
  const accessibleName = ariaLabel || label || 'Select'

  const moveActive = (delta: number) => {
    if (!options.length) return
    let next = activeIndex
    for (let i = 0; i < options.length; i++) {
      next = (next + delta + options.length) % options.length
      if (!options[next]?.disabled) break
    }
    setActiveIndex(next)
  }

  const commit = (opt: ThemedSelectOption) => {
    if (opt.disabled) return
    onChange(opt.value)
    setOpen(false)
  }

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault()
        if (!open) {
          setOpen(true)
        } else {
          moveActive(e.key === 'ArrowDown' ? 1 : -1)
        }
        break
      case 'Home':
        if (open) {
          e.preventDefault()
          setActiveIndex(0)
        }
        break
      case 'End':
        if (open) {
          e.preventDefault()
          setActiveIndex(options.length - 1)
        }
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (!open) setOpen(true)
        else if (activeIndex >= 0 && options[activeIndex]) commit(options[activeIndex])
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          setOpen(false)
        }
        break
    }
  }

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      {label ? (
        <span className="sr-only" id={`${listId}-label`}>
          {label}
        </span>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        aria-label={accessibleName}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={label ? `${listId}-label` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
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
          id={listId}
          role="listbox"
          aria-label={accessibleName}
          className={cn(
            'absolute z-30 mt-1 min-w-full w-max max-w-[16rem] rounded-lg border border-gray-100 bg-white shadow-lg py-1',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {options.map((o, i) => (
            <button
              key={o.value === '' ? '__all__' : o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              disabled={o.disabled}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => commit(o)}
              className={cn(
                'flex items-center justify-between gap-3 w-full text-left px-3 py-2 text-sm transition-colors',
                o.disabled && 'opacity-40 cursor-not-allowed',
                o.value === value
                  ? 'text-wine-700 bg-wine-50 font-medium'
                  : i === activeIndex
                    ? 'bg-gray-50 text-gray-800'
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
