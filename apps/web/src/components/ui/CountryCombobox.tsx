import { useState, useRef, useEffect } from 'react'
import { Globe, ChevronDown, Check } from 'lucide-react'
import { COUNTRY_NAMES as COUNTRIES } from '../../lib/countries'

interface CountryComboboxProps {
  value: string
  onChange: (value: string) => void
  className?: string
  id?: string
}

export function CountryCombobox({ value, onChange, className, id }: CountryComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = query.trim() === ''
    ? COUNTRIES
    : COUNTRIES.filter((c) => c.toLowerCase().includes(query.toLowerCase()))

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

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
      <input
        id={id}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="United States, Turkey, UK…"
        autoComplete="off"
        className="block w-full pl-10 pr-8 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none text-sm"
      />
      <ChevronDown
        className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
      />

      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-56 overflow-y-auto"
        >
          {filtered.map((country) => (
            <button
              key={country}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                setQuery(country)
                onChange(country)
                setOpen(false)
              }}
              className={[
                'w-full px-4 py-2.5 text-left text-sm flex items-center justify-between transition-colors',
                value === country
                  ? 'bg-wine-50 text-wine-700 font-semibold'
                  : 'text-gray-700 hover:bg-gray-50',
              ].join(' ')}
            >
              {country}
              {value === country && <Check className="w-3.5 h-3.5 text-wine-600 flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
