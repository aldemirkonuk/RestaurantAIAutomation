/**
 * Conversation filter vocabulary + helpers.
 * Single source of truth for options, badges, URL serialization, and tests.
 */

export const CHANNELS = ['email', 'sms', 'voice', 'whatsapp'] as const
export type Channel = (typeof CHANNELS)[number]

export const DIRECTIONS = ['inbound', 'outbound'] as const
export type Direction = (typeof DIRECTIONS)[number]

/** Canonical sentiment values written by AI agents / provider_sentiment_history. */
export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const
export type Sentiment = (typeof SENTIMENTS)[number]

/** UI bucket when detected_sentiment is null or unrecognized. */
export type SentimentBucket = Sentiment | 'unclassified'

export const DELIVERY_STATUSES = ['pending', 'sent', 'delivered', 'failed'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const

export const MONTHS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
] as const

export interface ConversationFilterState {
  channel: string
  direction: string
  sentiment: string
  status: string
  quarter: string
  year: string
  /** 1–12 as a string; only meaningful together with `year`. */
  month: string
  /** Inclusive local calendar day, `YYYY-MM-DD`. */
  dateFrom: string
  /** Inclusive local calendar day, `YYYY-MM-DD`. */
  dateTo: string
  search: string
  /** Provider UUID — filters list to one distributor. */
  providerId: string
  /** Human-readable procurement order number (not UUID). */
  orderNumber: string
  page: number
}

export const EMPTY_CONVERSATION_FILTERS: ConversationFilterState = {
  channel: '',
  direction: '',
  sentiment: '',
  status: '',
  quarter: '',
  year: '',
  month: '',
  dateFrom: '',
  dateTo: '',
  search: '',
  providerId: '',
  orderNumber: '',
  page: 1,
}

const SENTIMENT_SET = new Set<string>(SENTIMENTS)

/**
 * Normalize raw DB/API sentiment into a controlled bucket.
 * Unknown / empty → unclassified (never render a raw mystery string).
 */
export function normalizeSentiment(
  raw: string | null | undefined,
): SentimentBucket {
  if (raw == null) return 'unclassified'
  const trimmed = String(raw).trim().toLowerCase()
  if (!trimmed) return 'unclassified'
  if (SENTIMENT_SET.has(trimmed)) return trimmed as Sentiment
  return 'unclassified'
}

/** Wine-theme badge classes per sentiment bucket. */
export function sentimentBadgeClass(bucket: SentimentBucket): string {
  switch (bucket) {
    case 'positive':
      return 'bg-emerald-100 text-emerald-700'
    case 'negative':
      return 'bg-red-100 text-red-700'
    case 'neutral':
      return 'bg-gray-100 text-gray-600'
    case 'unclassified':
    default:
      return 'bg-amber-50 text-amber-700'
  }
}

export function sentimentLabel(bucket: SentimentBucket): string {
  switch (bucket) {
    case 'positive':
      return 'Positive'
    case 'negative':
      return 'Negative'
    case 'neutral':
      return 'Neutral'
    case 'unclassified':
      return 'Unclassified'
  }
}

/**
 * Badge for a conversation thread. A thread without an order is not "unassigned" —
 * it is a real negotiation that has not produced a purchase order yet, which is the
 * normal state for an inquiry. Label it truthfully.
 */
export function threadBadgeLabel(
  orderNumber: string | null | undefined,
): string {
  return orderNumber?.trim() || 'No order yet'
}

/** Amber when no order is linked; mono gray for real order numbers. */
export function threadBadgeClass(
  orderNumber: string | null | undefined,
): string {
  return orderNumber?.trim()
    ? 'bg-gray-100 text-gray-700 font-mono'
    : 'bg-amber-50 text-amber-700'
}

/**
 * Direction in DB may be UPPERCASE (legacy) or lowercase — normalize for UI + filters.
 */
export function normalizeDirection(
  raw: string | null | undefined,
): Direction | 'unknown' {
  if (!raw) return 'unknown'
  const d = String(raw).trim().toLowerCase()
  if (d === 'inbound' || d === 'outbound') return d
  return 'unknown'
}

export function channelLabel(channel: string): string {
  const map: Record<string, string> = {
    email: 'Email',
    sms: 'SMS',
    voice: 'Voice',
    whatsapp: 'WhatsApp',
  }
  return map[channel] ?? channel
}

export function directionLabel(direction: string): string {
  if (direction === 'inbound') return 'Inbound'
  if (direction === 'outbound') return 'Outbound'
  return 'All directions'
}

// ── Time filtering ────────────────────────────────────────────────
//
// Three mutually exclusive modes share one control: an explicit day range
// (dateFrom/dateTo), a single month (year + month), or a quarter (year +
// quarter). Selecting one mode clears the others so the API never receives
// two overlapping windows for `created_at`.

export type TimeFilterMode = 'all' | 'range' | 'month' | 'quarter'

export type TimeFilterFields = Pick<
  ConversationFilterState,
  'dateFrom' | 'dateTo' | 'month' | 'quarter' | 'year'
>

export const EMPTY_TIME_FILTER: TimeFilterFields = {
  dateFrom: '',
  dateTo: '',
  month: '',
  quarter: '',
  year: '',
}

/** Local `YYYY-MM-DD` — never UTC, so "today" matches the user's calendar. */
export function toCalendarDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function timeFilterMode(f: TimeFilterFields): TimeFilterMode {
  if (f.dateFrom || f.dateTo) return 'range'
  if (f.year && f.month) return 'month'
  if (f.quarter) return 'quarter'
  return 'all'
}

export function hasTimeFilter(f: TimeFilterFields): boolean {
  return timeFilterMode(f) !== 'all'
}

export const TIME_PRESETS = [
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'thisYear', label: 'This year' },
] as const

export type TimePreset = (typeof TIME_PRESETS)[number]['value']

/** Expand a preset into concrete filter fields, relative to `now`. */
export function resolveTimePreset(
  preset: TimePreset,
  now: Date = new Date(),
): TimeFilterFields {
  const range = (from: Date, to: Date): TimeFilterFields => ({
    ...EMPTY_TIME_FILTER,
    dateFrom: toCalendarDay(from),
    dateTo: toCalendarDay(to),
  })

  switch (preset) {
    case 'last7':
    case 'last30':
    case 'last90': {
      const days = preset === 'last7' ? 7 : preset === 'last30' ? 30 : 90
      const from = new Date(now)
      // Inclusive window: "last 7 days" spans today plus the 6 days before it.
      from.setDate(from.getDate() - (days - 1))
      return range(from, now)
    }
    case 'thisMonth':
      return {
        ...EMPTY_TIME_FILTER,
        year: String(now.getFullYear()),
        month: String(now.getMonth() + 1),
      }
    case 'lastMonth': {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      return {
        ...EMPTY_TIME_FILTER,
        year: String(prev.getFullYear()),
        month: String(prev.getMonth() + 1),
      }
    }
    case 'thisYear':
      return range(
        new Date(now.getFullYear(), 0, 1),
        new Date(now.getFullYear(), 11, 31),
      )
  }
}

export function monthLabel(month: string): string {
  return MONTHS.find((m) => m.value === String(parseInt(month, 10)))?.label ?? month
}

/** Label for the time control trigger and its removable chip. */
export function timeFilterLabel(f: TimeFilterFields): string {
  switch (timeFilterMode(f)) {
    case 'range':
      if (f.dateFrom && f.dateTo) {
        return f.dateFrom === f.dateTo
          ? f.dateFrom
          : `${f.dateFrom} → ${f.dateTo}`
      }
      return f.dateFrom ? `From ${f.dateFrom}` : `Until ${f.dateTo}`
    case 'month':
      return `${monthLabel(f.month)} ${f.year}`
    case 'quarter':
      return f.year ? `${f.quarter} ${f.year}` : f.quarter
    case 'all':
      return 'All time'
  }
}

/**
 * Convert a calendar-day range into API timestamps. `dateTo` is widened to the
 * end of its day so a single-day range still includes that day's messages.
 */
export function toApiDateRange(f: TimeFilterFields): {
  dateFrom?: string
  dateTo?: string
} {
  return {
    dateFrom: f.dateFrom ? `${f.dateFrom}T00:00:00.000Z` : undefined,
    dateTo: f.dateTo ? `${f.dateTo}T23:59:59.999Z` : undefined,
  }
}

/** True when any dimension (except page) differs from empty defaults. */
export function hasActiveConversationFilters(f: ConversationFilterState): boolean {
  return Boolean(
    f.channel ||
      f.direction ||
      f.sentiment ||
      f.status ||
      f.search ||
      f.providerId ||
      f.orderNumber ||
      hasTimeFilter(f),
  )
}

/** Serialize non-default filters for URL / API query. */
export function filtersToSearchParams(
  f: ConversationFilterState,
): URLSearchParams {
  const p = new URLSearchParams()
  if (f.channel) p.set('channel', f.channel)
  if (f.direction) p.set('direction', f.direction)
  if (f.sentiment) p.set('sentiment', f.sentiment)
  if (f.status) p.set('status', f.status)
  if (f.quarter) p.set('quarter', f.quarter)
  if (f.year) p.set('year', f.year)
  if (f.month) p.set('month', f.month)
  if (f.dateFrom) p.set('dateFrom', f.dateFrom)
  if (f.dateTo) p.set('dateTo', f.dateTo)
  if (f.search) p.set('q', f.search)
  if (f.providerId) p.set('providerId', f.providerId)
  if (f.orderNumber) p.set('orderNumber', f.orderNumber)
  if (f.page > 1) p.set('page', String(f.page))
  return p
}

export function searchParamsToFilters(
  params: URLSearchParams,
): ConversationFilterState {
  const pageRaw = params.get('page')
  const page = pageRaw ? Math.max(1, parseInt(pageRaw, 10) || 1) : 1
  return {
    channel: params.get('channel') ?? '',
    direction: params.get('direction') ?? '',
    sentiment: params.get('sentiment') ?? '',
    status: params.get('status') ?? '',
    quarter: params.get('quarter') ?? '',
    year: params.get('year') ?? '',
    month: params.get('month') ?? '',
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
    search: params.get('q') ?? '',
    providerId: params.get('providerId') ?? '',
    orderNumber: params.get('orderNumber') ?? '',
    page,
  }
}

/** Options for ThemedSelect rows (empty value = All …). */
export const FILTER_OPTIONS = {
  channel: [
    { value: '', label: 'All channels' },
    ...CHANNELS.map((c) => ({ value: c, label: channelLabel(c) })),
  ],
  direction: [
    { value: '', label: 'All directions' },
    ...DIRECTIONS.map((d) => ({ value: d, label: directionLabel(d) })),
  ],
  sentiment: [
    { value: '', label: 'All sentiments' },
    ...SENTIMENTS.map((s) => ({ value: s, label: sentimentLabel(s) })),
    { value: 'unclassified', label: sentimentLabel('unclassified') },
  ],
  status: [
    { value: '', label: 'All statuses' },
    ...DELIVERY_STATUSES.map((s) => ({
      value: s,
      label: s.charAt(0).toUpperCase() + s.slice(1),
    })),
  ],
  quarter: [
    { value: '', label: 'Any quarter' },
    ...QUARTERS.map((q) => ({ value: q, label: q })),
  ],
  month: [
    { value: '', label: 'Any month' },
    ...MONTHS.map((m) => ({ value: m.value, label: m.label })),
  ],
} as const

/** Descending year options for the month/quarter pickers. */
export function recentYearOptions(
  count = 5,
  now: Date = new Date(),
): { value: string; label: string }[] {
  const current = now.getFullYear()
  return Array.from({ length: count }, (_, i) => {
    const year = String(current - i)
    return { value: year, label: year }
  })
}
