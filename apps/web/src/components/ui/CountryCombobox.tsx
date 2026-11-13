import { useState, useRef, useEffect, useId, type KeyboardEvent } from 'react'
import { Globe, ChevronDown, Check } from 'lucide-react'
import { COUNTRY_NAMES as COUNTRIES } from '../../lib/countries'

interface CountryComboboxProps {
  value: string
  onChange: (value: string) => void
  className?: string
  /** The input's id, for a caller's `<label htmlFor>`. */
  id?: string
  /**
   * The input's name when no `<label htmlFor>` points at it. Defaults to
   * "Country" when no `id` is given: with no id, no label can be tied to the box.
   */
  ariaLabel?: string
  /**
   * Draw the list in the flow, under the box, instead of floating over what
   * follows. For a box inside a scrolling panel (a Sheet or a dialog body): the
   * panel clips a floating list at its own bottom edge, and Add a location
   * showed about two countries (walk r23). In the flow the list takes its room,
   * the panel grows or scrolls, and the list is scrolled into view as it opens.
   */
  inline?: boolean
}

/**
 * The country box: a text box with a list of countries under it, as an ARIA
 * combobox (walk r21 D6: it had no role, so a screen reader heard a bare text
 * box and never the list). Arrow keys move through the list, Enter picks,
 * Escape closes; the list says which country is chosen.
 */
export function CountryCombobox({ value, onChange, className, id, ariaLabel, inline = false }: CountryComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const [active, setActive] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  const filtered = query.trim() === ''
    ? COUNTRIES
    : COUNTRIES.filter((c) => c.toLowerCase().includes(query.toLowerCase()))
  const shown = open && filtered.length > 0
  const optionId = (i: number) => `${listId}-opt-${i}`

  // Keep query in sync when parent sets value (e.g. from Places autocomplete)
  useEffect(() => {
    setQuery(value)
  }, [value])

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  // In the flow, the list opens below the panel's fold as often as not; bring
  // the whole list into view once, as it opens.
  useEffect(() => {
    if (inline && shown) listRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [inline, shown])

  // The active option stays in view as the arrow keys move it.
  useEffect(() => {
    if (!shown || active < 0) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [active, shown])

  const pick = (country: string) => {
    setQuery(country)
    onChange(country)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        setActive(filtered.length > 0 ? 0 : -1)
      } else {
        setActive((i) => Math.min(i + 1, filtered.length - 1))
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open) setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      // Enter picks the highlighted country and goes no further; with nothing
      // highlighted it is the form's Enter, as before.
      if (shown && active >= 0 && active < filtered.length) {
        e.preventDefault()
        e.stopPropagation()
        pick(filtered[active])
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
        setActive(-1)
      }
    } else if (e.key === 'Tab') {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      {/* The box and its two marks have their own frame, so the marks stay
          centred on the box when an in-flow list makes the outer frame taller. */}
      <div className="relative">
        <Globe aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-label={ariaLabel ?? (id ? undefined : 'Country')}
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={listId}
          aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            onChange(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="United States, Turkey, UK…"
          autoComplete="off"
          className="block w-full pl-10 pr-8 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none text-sm"
        />
        <ChevronDown
          aria-hidden="true"
          className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </div>

      {shown && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Countries"
          className={
            inline
              ? 'mt-1 bg-white border border-gray-200 rounded-xl max-h-56 overflow-y-auto'
              : 'absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-56 overflow-y-auto'
          }
        >
          {filtered.map((country, i) => (
            <li
              key={country}
              id={optionId(i)}
              data-index={i}
              role="option"
              aria-selected={value === country}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(country)
              }}
              onMouseEnter={() => setActive(i)}
              className={[
                'w-full px-4 py-2.5 text-left text-sm flex items-center justify-between transition-colors cursor-pointer',
                value === country
                  ? 'bg-wine-50 text-wine-700 font-semibold'
                  : i === active
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-700 hover:bg-gray-50',
              ].join(' ')}
            >
              {country}
              {value === country && <Check aria-hidden="true" className="w-3.5 h-3.5 text-wine-600 flex-shrink-0" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
