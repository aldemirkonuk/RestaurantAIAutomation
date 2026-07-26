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

export interface ConversationFilterState {
  channel: string
  direction: string
  sentiment: string
  status: string
  quarter: string
  year: string
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
  search: '',
  providerId: '',
  orderNumber: '',
  page: 1,
}

/** UI bucket when order_id is null. */
export type OrderBucket = 'unassigned' | string

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
 * Normalize order linkage into a stable group key.
 * Missing order_id → unassigned (mirrors sentiment Unclassified).
 */
export function normalizeOrderKey(
  orderId: string | null | undefined,
): OrderBucket {
  if (orderId == null || !String(orderId).trim()) return 'unassigned'
  return String(orderId).trim()
}

export function isUnassignedOrder(key: OrderBucket): boolean {
  return key === 'unassigned'
}

export function orderBucketLabel(
  orderNumber: string | null | undefined,
  key: OrderBucket,
): string {
  if (isUnassignedOrder(key)) return 'Unassigned'
  const num = orderNumber?.trim()
  return num || 'Order'
}

/** Amber for Unassigned; mono gray for real order numbers. */
export function orderBucketBadgeClass(key: OrderBucket): string {
  if (isUnassignedOrder(key)) return 'bg-amber-50 text-amber-700'
  return 'bg-gray-100 text-gray-700 font-mono'
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

/** True when any dimension (except page) differs from empty defaults. */
export function hasActiveConversationFilters(f: ConversationFilterState): boolean {
  return Boolean(
    f.channel ||
      f.direction ||
      f.sentiment ||
      f.status ||
      f.quarter ||
      f.search ||
      f.providerId ||
      f.orderNumber,
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
    { value: '', label: 'All time' },
    ...QUARTERS.map((q) => ({ value: q, label: q })),
  ],
} as const
