import { Search, X } from 'lucide-react'
import { ThemedSelect } from '../ui/ThemedSelect'
import { ConversationTimeFilter } from './ConversationTimeFilter'
import { cn } from '../../lib/utils'
import {
  EMPTY_CONVERSATION_FILTERS,
  EMPTY_TIME_FILTER,
  FILTER_OPTIONS,
  hasActiveConversationFilters,
  hasTimeFilter,
  timeFilterLabel,
  type ConversationFilterState,
  channelLabel,
  directionLabel,
  sentimentLabel,
} from '../../lib/conversationFilters'

export interface ConversationFilterBarProps {
  filters: ConversationFilterState
  onChange: (next: ConversationFilterState) => void
  /** Optional counts from stats.bySentiment — zero-count options stay selectable but annotated. */
  sentimentCounts?: Record<string, number>
  /** Distributor options: `{ value: providerId, label: name }`. Empty value = All. */
  providerOptions?: { value: string; label: string }[]
  /** Optional counts from stats.byProvider keyed by provider UUID. */
  providerCounts?: Record<string, number>
  /** When true, hide distributor select (parent locked / scoped provider). */
  hideProviderFilter?: boolean
  className?: string
}

function patch(
  filters: ConversationFilterState,
  partial: Partial<ConversationFilterState>,
): ConversationFilterState {
  return { ...filters, ...partial, page: 1 }
}

/**
 * Theme-based conversation filter bar (ThemedSelect — not native iOS selects).
 * Dimensions AND together; chips remove one dimension at a time.
 */
export function ConversationFilterBar({
  filters,
  onChange,
  sentimentCounts,
  providerOptions,
  providerCounts,
  hideProviderFilter = false,
  className,
}: ConversationFilterBarProps) {
  const sentimentOptions = FILTER_OPTIONS.sentiment.map((o) => {
    if (!o.value || !sentimentCounts) return { ...o }
    const count = sentimentCounts[o.value] ?? 0
    return {
      value: o.value,
      label: count > 0 ? `${o.label} (${count})` : `${o.label} (0)`,
    }
  })

  const distributorOptions = [
    { value: '', label: 'All distributors' },
    ...(providerOptions ?? []).map((o) => {
      if (!providerCounts) return o
      const count = providerCounts[o.value] ?? 0
      return {
        value: o.value,
        label: count > 0 ? `${o.label} (${count})` : `${o.label} (0)`,
      }
    }),
  ]

  const providerLabel =
    providerOptions?.find((o) => o.value === filters.providerId)?.label ??
    filters.providerId

  const chips: { key: string; label: string; remove: () => void }[] = []
  const simpleChip = (key: keyof ConversationFilterState, label: string) => ({
    key,
    label,
    remove: () => onChange(patch(filters, { [key]: '' })),
  })

  if (filters.providerId && !hideProviderFilter) {
    chips.push(simpleChip('providerId', providerLabel))
  }
  if (filters.orderNumber) {
    chips.push(simpleChip('orderNumber', `Order ${filters.orderNumber}`))
  }
  if (filters.channel) {
    chips.push(simpleChip('channel', channelLabel(filters.channel)))
  }
  if (filters.direction) {
    chips.push(simpleChip('direction', directionLabel(filters.direction)))
  }
  if (filters.sentiment) {
    chips.push(
      simpleChip(
        'sentiment',
        sentimentLabel(
          filters.sentiment === 'unclassified'
            ? 'unclassified'
            : (filters.sentiment as 'positive' | 'neutral' | 'negative'),
        ),
      ),
    )
  }
  if (filters.status) {
    chips.push(
      simpleChip(
        'status',
        filters.status.charAt(0).toUpperCase() + filters.status.slice(1),
      ),
    )
  }
  if (hasTimeFilter(filters)) {
    chips.push({
      key: 'time',
      label: timeFilterLabel(filters),
      remove: () => onChange(patch(filters, EMPTY_TIME_FILTER)),
    })
  }
  if (filters.search) {
    chips.push(simpleChip('search', `“${filters.search}”`))
  }

  const clearAll = () =>
    onChange({
      ...EMPTY_CONVERSATION_FILTERS,
      providerId: hideProviderFilter ? filters.providerId : '',
    })

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2 p-2.5 bg-gray-50 rounded-xl border border-gray-100">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => onChange(patch(filters, { search: e.target.value }))}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none"
          />
        </div>

        {!hideProviderFilter && providerOptions && (
          <ThemedSelect
            aria-label="Filter by distributor"
            value={filters.providerId}
            options={distributorOptions}
            onChange={(providerId) => onChange(patch(filters, { providerId }))}
            align="left"
          />
        )}

        <input
          type="search"
          value={filters.orderNumber}
          onChange={(e) =>
            onChange(patch(filters, { orderNumber: e.target.value }))
          }
          placeholder="Order #"
          aria-label="Filter by order number"
          className="w-[120px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white font-mono focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none"
        />

        <ThemedSelect
          aria-label="Filter by channel"
          value={filters.channel}
          options={[...FILTER_OPTIONS.channel]}
          onChange={(channel) => onChange(patch(filters, { channel }))}
          align="left"
        />
        <ThemedSelect
          aria-label="Filter by direction"
          value={filters.direction}
          options={[...FILTER_OPTIONS.direction]}
          onChange={(direction) => onChange(patch(filters, { direction }))}
          align="left"
        />
        <ThemedSelect
          aria-label="Filter by sentiment"
          value={filters.sentiment}
          options={sentimentOptions}
          onChange={(sentiment) => onChange(patch(filters, { sentiment }))}
          align="left"
        />
        <ThemedSelect
          aria-label="Filter by delivery status"
          value={filters.status}
          options={[...FILTER_OPTIONS.status]}
          onChange={(status) => onChange(patch(filters, { status }))}
          align="left"
        />
        <ConversationTimeFilter
          value={filters}
          onChange={(time) => onChange(patch(filters, time))}
        />

        {(() => {
          const active = hideProviderFilter
            ? Boolean(
                filters.channel ||
                  filters.direction ||
                  filters.sentiment ||
                  filters.status ||
                  filters.search ||
                  filters.orderNumber ||
                  hasTimeFilter(filters),
              )
            : hasActiveConversationFilters(filters)
          return (
            active && (
              <button
                type="button"
                onClick={clearAll}
                className="px-3 py-2 text-sm text-wine-600 hover:bg-wine-50 rounded-lg transition-colors flex items-center gap-1"
              >
                <X className="w-4 h-4" />
                Clear
              </button>
            )
          )
        })()}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-0.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.remove}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-wine-50 text-wine-700 border border-wine-100 hover:bg-wine-100 transition-colors"
            >
              {chip.label}
              <X className="w-3 h-3 opacity-70" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
