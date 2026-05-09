import { useState, useRef, useEffect } from 'react'
import { ChefHat, ChevronDown, X } from 'lucide-react'

const CUISINE_GROUPS: { label: string; emoji: string; options: string[] }[] = [
  {
    label: 'American', emoji: '🥩',
    options: ['New American', 'Contemporary American', 'Traditional American', 'Steakhouse', 'Seafood', 'Barbecue', 'Cajun & Creole'],
  },
  {
    label: 'European', emoji: '🍷',
    options: ['French', 'Italian', 'Spanish', 'Mediterranean', 'Greek', 'German', 'British', 'Modern European', 'Brasserie'],
  },
  {
    label: 'Latin American', emoji: '🌮',
    options: ['Mexican', 'Latin', 'Brazilian', 'Peruvian', 'Caribbean'],
  },
  {
    label: 'Asian', emoji: '🥢',
    options: ['Japanese', 'Sushi', 'Chinese', 'Thai', 'Indian', 'Vietnamese', 'Korean', 'Asian Fusion'],
  },
  {
    label: 'Middle East & Africa', emoji: '🌍',
    options: ['Middle Eastern', 'Turkish', 'Moroccan', 'Israeli'],
  },
  {
    label: 'Dining Style', emoji: '🍽️',
    options: ['Farm-to-Table', 'Gastropub', 'Tapas / Small Plates', 'Pizza', 'Vegetarian / Vegan', 'Café & Bakery', 'Brunch'],
  },
  {
    label: 'Drinks & Nightlife', emoji: '🍸',
    options: ['Wine Bar', 'Cocktail Bar', 'Lounge', 'Hotel Restaurant'],
  },
  {
    label: 'Other', emoji: '✨',
    options: ['Other'],
  },
]

interface CuisinePickerProps {
  value: string
  onChange: (value: string) => void
}

export function CuisinePicker({ value, onChange }: CuisinePickerProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

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
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={[
          'w-full flex items-center gap-3 px-3 py-3 border rounded-lg bg-white/80 text-left transition-all',
          open
            ? 'border-wine-500 ring-2 ring-wine-500/10'
            : 'border-gray-300 hover:border-wine-400',
        ].join(' ')}
      >
        <ChefHat className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className={`flex-1 text-sm ${value ? 'text-gray-900' : 'text-gray-400'}`}>
          {value || 'Select cuisine type'}
        </span>
        {value ? (
          <span
            role="button"
            onMouseDown={(e) => { e.stopPropagation(); onChange('') }}
            className="p-0.5 text-gray-400 hover:text-gray-600 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </span>
        ) : (
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden">
          <div className="max-h-72 overflow-y-auto p-4 space-y-4">
            {CUISINE_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-[0.66rem] uppercase tracking-[0.08em] text-gray-400 font-bold mb-2 flex items-center gap-1.5">
                  <span>{group.emoji}</span>
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {group.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        onChange(option)
                        setOpen(false)
                      }}
                      className={[
                        'px-3 py-1.5 rounded-full text-[0.8rem] font-medium border transition-all',
                        value === option
                          ? 'bg-wine-600 text-white border-wine-600 shadow-sm shadow-wine-200'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-wine-400 hover:text-wine-600 hover:bg-wine-50',
                      ].join(' ')}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
