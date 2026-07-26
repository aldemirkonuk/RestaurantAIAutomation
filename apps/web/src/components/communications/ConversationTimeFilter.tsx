import { useEffect, useRef, useState } from 'react'
import { CalendarRange, ChevronDown, X } from 'lucide-react'
import { ThemedSelect } from '../ui/ThemedSelect'
import { cn } from '../../lib/utils'
import {
  EMPTY_TIME_FILTER,
  FILTER_OPTIONS,
  TIME_PRESETS,
  hasTimeFilter,
  recentYearOptions,
  resolveTimePreset,
  timeFilterLabel,
  timeFilterMode,
  type TimeFilterFields,
} from '../../lib/conversationFilters'

export interface ConversationTimeFilterProps {
  value: TimeFilterFields
  onChange: (next: TimeFilterFields) => void
  className?: string
}

/**
 * Custom time window control: day range, single month, or quarter.
 * Replaces the quarter-only select — a range is applied per keystroke so the
 * list narrows as soon as either end of the window is set.
 */
export function ConversationTimeFilter({
  value,
  onChange,
  className,
}: ConversationTimeFilterProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const mode = timeFilterMode(value)
  const active = hasTimeFilter(value)
  const yearOptions = recentYearOptions()
  const currentYear = String(new Date().getFullYear())

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

  const setRange = (partial: { dateFrom?: string; dateTo?: string }) =>
    onChange({
      ...EMPTY_TIME_FILTER,
      dateFrom: partial.dateFrom ?? value.dateFrom,
      dateTo: partial.dateTo ?? value.dateTo,
    })

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <button
        type="button"
        aria-label="Filter by time range"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 min-w-[9rem] px-3 py-2 text-sm font-medium rounded-lg border bg-white transition-colors outline-none',
          active
            ? 'border-wine-300 text-wine-700 bg-wine-50/60'
            : 'border-gray-200 text-gray-700 hover:border-gray-300',
          open && 'border-wine-500 ring-2 ring-wine-100',
        )}
      >
        <CalendarRange className="w-4 h-4 shrink-0 opacity-70" />
        <span className="truncate">{timeFilterLabel(value)}</span>
        <ChevronDown
          className={cn(
            'w-4 h-4 ml-auto shrink-0 text-gray-400 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Time range"
          className="absolute left-0 z-40 mt-1 w-[19rem] rounded-xl border border-gray-100 bg-white shadow-lg p-3 space-y-3"
        >
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Custom range
            </p>
            <div className="flex items-center gap-2">
              <label className="flex-1">
                <span className="sr-only">From date</span>
                <input
                  type="date"
                  aria-label="From date"
                  value={value.dateFrom}
                  max={value.dateTo || undefined}
                  onChange={(e) => setRange({ dateFrom: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none"
                />
              </label>
              <span className="text-gray-400 text-sm">→</span>
              <label className="flex-1">
                <span className="sr-only">To date</span>
                <input
                  type="date"
                  aria-label="To date"
                  value={value.dateTo}
                  min={value.dateFrom || undefined}
                  onChange={(e) => setRange({ dateTo: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none"
                />
              </label>
            </div>
          </div>

          <div className="space-y-2 pt-1 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Month
            </p>
            <div className="flex items-center gap-2">
              <ThemedSelect
                aria-label="Filter by month"
                className="flex-1"
                align="left"
                value={mode === 'month' ? value.month : ''}
                options={[...FILTER_OPTIONS.month]}
                onChange={(month) =>
                  onChange(
                    month
                      ? {
                          ...EMPTY_TIME_FILTER,
                          month,
                          year: value.year || currentYear,
                        }
                      : EMPTY_TIME_FILTER,
                  )
                }
              />
              <ThemedSelect
                aria-label="Filter by year"
                className="w-[6rem]"
                align="left"
                value={value.year || currentYear}
                options={yearOptions}
                onChange={(year) =>
                  onChange({
                    ...EMPTY_TIME_FILTER,
                    year,
                    month: mode === 'month' ? value.month : '',
                    quarter: mode === 'quarter' ? value.quarter : '',
                  })
                }
              />
            </div>
          </div>

          <div className="space-y-2 pt-1 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Quarter
            </p>
            <ThemedSelect
              aria-label="Filter by quarter"
              className="w-full"
              align="left"
              value={mode === 'quarter' ? value.quarter : ''}
              options={[...FILTER_OPTIONS.quarter]}
              onChange={(quarter) =>
                onChange(
                  quarter
                    ? {
                        ...EMPTY_TIME_FILTER,
                        quarter,
                        year: value.year || currentYear,
                      }
                    : EMPTY_TIME_FILTER,
                )
              }
            />
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
            {TIME_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => {
                  onChange(resolveTimePreset(preset.value))
                  setOpen(false)
                }}
                className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200 hover:bg-wine-50 hover:text-wine-700 hover:border-wine-100 transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {active && (
            <button
              type="button"
              onClick={() => {
                onChange(EMPTY_TIME_FILTER)
                setOpen(false)
              }}
              className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-wine-600 hover:bg-wine-50 rounded-lg transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Clear time filter
            </button>
          )}
        </div>
      )}
    </div>
  )
}
