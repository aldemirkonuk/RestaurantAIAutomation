import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { 
  CompanyClass, 
  CompanyClassConfig, 
  COMPANY_CLASS_CONFIG,
  getClassConfig,
  isValidClass,
} from '../../types/companyClass'

// ==================== Types ====================

export type EntityKind = 'provider' | 'wine_type' | 'label' | 'event' | 'order'

export interface EntityOption {
  /** Unique identifier */
  id: string
  /** Display label */
  label: string
  /** Entity kind for grouping */
  kind: EntityKind
  /** Display badge text */
  badge?: string
  /** Subtitle/secondary text */
  subtitle?: string
  /** Company class for AI context */
  companyClass?: CompanyClass
  /** Additional metadata */
  metadata?: Record<string, any>
}

interface EntityAutocompleteProps {
  /** Current input value */
  value: string
  /** Available options to search */
  options: EntityOption[]
  /** Input placeholder */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Message when no matches */
  emptyMessage?: string
  /** Show company class badges */
  showClassBadges?: boolean
  /** Filter by specific kinds */
  filterByKinds?: EntityKind[]
  /** Filter by specific company classes */
  filterByClasses?: CompanyClass[]
  /** Embedded mode - removes border and padding for use inside chip containers */
  embedded?: boolean
  /** Callback when value changes */
  onChange: (value: string) => void
  /** Callback when option is selected */
  onSelect: (option: EntityOption) => void
}

// ==================== Helper Functions ====================

/**
 * Get color classes for a company class
 */
function getClassColors(companyClass?: CompanyClass): { bg: string; text: string } {
  if (!companyClass || !isValidClass(companyClass)) {
    return { bg: 'bg-gray-100', text: 'text-gray-700' }
  }
  const config = getClassConfig(companyClass)
  return { bg: config.bgColor, text: config.textColor }
}

/**
 * Get kind-based colors when no company class is specified
 */
function getKindColors(kind: EntityKind): { bg: string; text: string } {
  const kindColors: Record<EntityKind, { bg: string; text: string }> = {
    provider: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
    wine_type: { bg: 'bg-rose-100', text: 'text-rose-700' },
    label: { bg: 'bg-blue-100', text: 'text-blue-700' },
    event: { bg: 'bg-purple-100', text: 'text-purple-700' },
    order: { bg: 'bg-amber-100', text: 'text-amber-700' },
  }
  return kindColors[kind]
}

// ==================== Component ====================

export function EntityAutocomplete({
  value,
  options,
  placeholder = 'Search entities...',
  disabled = false,
  emptyMessage = 'No matches found',
  showClassBadges = true,
  filterByKinds,
  filterByClasses,
  embedded = false,
  onChange,
  onSelect,
}: EntityAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Filter and search options
  const filteredOptions = useMemo(() => {
    let filtered = options

    // Filter by kinds if specified
    if (filterByKinds && filterByKinds.length > 0) {
      filtered = filtered.filter(opt => filterByKinds.includes(opt.kind))
    }

    // Filter by company classes if specified
    if (filterByClasses && filterByClasses.length > 0) {
      filtered = filtered.filter(opt => 
        opt.companyClass && filterByClasses.includes(opt.companyClass)
      )
    }

    // Search filter
    const query = value.trim().toLowerCase()
    if (query) {
      filtered = filtered.filter(option => {
        const label = option.label.toLowerCase()
        const badge = option.badge?.toLowerCase() || ''
        const subtitle = option.subtitle?.toLowerCase() || ''
        const classLabel = option.companyClass 
          ? COMPANY_CLASS_CONFIG[option.companyClass]?.label.toLowerCase() || ''
          : ''
        return (
          label.includes(query) || 
          badge.includes(query) || 
          subtitle.includes(query) ||
          classLabel.includes(query)
        )
      })
    }

    return filtered.slice(0, 8)
  }, [options, value, filterByKinds, filterByClasses])

  // Group options by kind for better organization
  const groupedOptions = useMemo(() => {
    const groups: Record<EntityKind, EntityOption[]> = {
      provider: [],
      wine_type: [],
      label: [],
      event: [],
      order: [],
    }

    filteredOptions.forEach(opt => {
      groups[opt.kind].push(opt)
    })

    return groups
  }, [filteredOptions])

  const handleSelect = (option: EntityOption) => {
    onSelect(option)
    setIsOpen(false)
  }

  const handleClear = () => {
    onChange('')
  }

  // Render option with company class badge (Gmail/n8n style)
  const renderOption = (option: EntityOption) => {
    const colors = option.companyClass 
      ? getClassColors(option.companyClass)
      : getKindColors(option.kind)

    const classConfig = option.companyClass 
      ? COMPANY_CLASS_CONFIG[option.companyClass]
      : null

    // Icon for entity type
    const entityIcon = option.kind === 'provider' ? '🚚' 
      : option.kind === 'wine_type' ? '🍷' 
      : option.kind === 'label' ? '🏷️'
      : option.kind === 'event' ? '📅'
      : option.kind === 'order' ? '📦'
      : '📄'

    return (
      <button
        key={option.id}
        type="button"
        onClick={() => handleSelect(option)}
        className="w-full px-3 py-2.5 text-left hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0 group"
      >
        <div className="flex items-center gap-3">
          {/* Entity icon */}
          <span className="text-base flex-shrink-0">{entityIcon}</span>
          
          {/* Main content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-900 truncate">
                {option.label}
              </p>
            </div>
            {option.subtitle && (
              <p className="text-xs text-gray-500 truncate mt-0.5">
                {option.subtitle}
              </p>
            )}
          </div>
          
          {/* Company Class ID badge (n8n credential style) */}
          {showClassBadges && option.companyClass && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className={cn(
                'text-[10px] px-2 py-1 rounded font-mono font-medium border',
                colors.bg,
                colors.text,
                'border-current/20'
              )}>
                {option.companyClass}
              </span>
            </div>
          )}
          
          {/* Badge (if no company class) */}
          {option.badge && !option.companyClass && (
            <span className={cn(
              'flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium',
              colors.bg,
              colors.text
            )}>
              {option.badge}
            </span>
          )}
        </div>
      </button>
    )
  }

  // Render grouped options
  const renderGroupedOptions = () => {
    const kindLabels: Record<EntityKind, string> = {
      provider: 'Providers',
      wine_type: 'Wine Types',
      label: 'Labels',
      event: 'Events',
      order: 'Orders',
    }

    const hasGroups = Object.values(groupedOptions).some(group => group.length > 0)
    const hasMultipleGroups = Object.values(groupedOptions).filter(g => g.length > 0).length > 1

    if (!hasGroups) {
      return (
        <div className="px-4 py-3 text-sm text-gray-500">{emptyMessage}</div>
      )
    }

    // If only one group or few results, render flat list
    if (!hasMultipleGroups || filteredOptions.length <= 4) {
      return filteredOptions.map(renderOption)
    }

    // Render with group headers
    return Object.entries(groupedOptions).map(([kind, opts]) => {
      if (opts.length === 0) return null

      return (
        <div key={kind}>
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {kindLabels[kind as EntityKind]}
            </p>
          </div>
          {opts.map(renderOption)}
        </div>
      )
    })
  }

  return (
    <div className="relative">
      <div className="relative">
        {!embedded && (
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 150)}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            embedded 
              ? 'w-full py-1 bg-transparent border-none outline-none focus:ring-0 text-sm'
              : 'w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent',
            disabled && 'bg-gray-100 text-gray-500 cursor-not-allowed'
          )}
          style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
        />
        {value && !disabled && !embedded && (
          <button
            onClick={handleClear}
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>

      {isOpen && !disabled && (
        <div className={cn(
          "absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto",
          embedded ? "mt-1 w-[280px] left-0" : "mt-2 w-full"
        )}>
          {renderGroupedOptions()}
        </div>
      )}
    </div>
  )
}

// ==================== Exports ====================

export type { EntityAutocompleteProps }
