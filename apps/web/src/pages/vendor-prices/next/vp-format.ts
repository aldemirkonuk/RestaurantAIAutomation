/**
 * VendorPricesNext formatting — the same honesty rule as every Mudavym page:
 * an unknown renders as an em dash or a sentence, never as a zero, a guess or
 * a hopeful percentage.
 *
 * Pure and framework-free so every branch can be asserted without a browser.
 * Fonts are the three house faces (styles/mudavym.css): Fraunces speaks, DM
 * Sans is operated, JetBrains Mono carries figures, dates and provenance.
 */

export const EM = '—'

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif'
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif'
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'

/** A finite number, or null. Guards NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/**
 * A money figure in the currency the row states. Nothing here converts: a
 * lira figure prints as lira, and a null prints as the dash. An unknown
 * currency code prints the number with the code beside it rather than
 * throwing or silently dropping to dollars — the register holds real ISO
 * codes only (gateway `common/iso-4217.ts#isIso4217`), but a row written
 * before that rule existed still has to render.
 */
export function money(value: number | null | undefined, currency: string | null | undefined): string {
  const v = num(value)
  if (v === null) return EM
  const code = (currency ?? '').trim().toUpperCase()
  if (!code) return v.toFixed(2)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(v)
  } catch {
    return `${v.toFixed(2)} ${code}`
  }
}

/** "+3.4%" / "-12.0%" / em dash. Never prints a null as flat. */
export function pctChange(fraction: number | null | undefined): string {
  const f = num(fraction)
  if (f === null) return EM
  const sign = f > 0.0005 ? '+' : f < -0.0005 ? '-' : ''
  return `${sign}${Math.abs(f * 100).toFixed(1)}%`
}

/**
 * Fork 5(a) (ADR 0160 §112, direction A's recommended set): a trend needs a
 * minimum sample before it prints a number, and the count is printed either
 * way. `vendor-price-consensus.ts#priceTrend` carries no such floor (a
 * page-wide rule, not an engine one — other pure-engine callers do not owe
 * this page's minimum), so it is enforced here, on the count the engine
 * already returns.
 */
export const MIN_TREND_SAMPLE = 5

/** "+3.4% (7 sightings)" once there is enough sample; "not enough — 2 of 5"
 * below the floor; the em dash when there is nothing to compare at all. */
export function trendWords(pct: number | null, sampleCount: number): string {
  if (sampleCount < MIN_TREND_SAMPLE) return `not enough — ${sampleCount} of ${MIN_TREND_SAMPLE}`
  if (pct === null) return EM
  return pctChange(pct)
}

/**
 * The consensus confidence as a sentence with its own formula, never a bare
 * percent (ADR 0113: a person decides on evidence, not a number with no
 * working). Mirrors `vendorPriceConsensus`'s actual weights — 60% weighted
 * evidence mass, 40% source-kind diversity, clamped to 5–95% — using the
 * source-kind count the response already carries (`sourceBreakdown`); the
 * two raw terms themselves are not returned by the engine, so the sentence
 * names the shape of the formula rather than inventing numbers for its parts.
 */
export function confidenceSentence(confidence: number, sourceBreakdown: Record<string, number>): string {
  const kinds = Object.keys(sourceBreakdown).length
  const pct = Math.round(confidence * 100)
  return `${pct}% — 60% from how much trust- and recency-weighted evidence survived, 40% from how many kinds of source agree (${kinds} kind${kinds === 1 ? '' : 's'} of source here), clamped to 5–95%.`
}

/**
 * The card's own line: a percent with a plain-English reading, never the
 * formula's parameters (ADR 0160 §112 review, "the register drawn at the
 * standard of a financial instrument… with the machinery behind it
 * unexposed"). `confidenceSentence` — the full working — moves behind "How
 * this was calculated" instead of sitting on the card unconditionally.
 */
export function confidenceHeadline(confidence: number): string {
  const pct = Math.round(confidence * 100)
  const word = pct >= 80 ? 'strong' : pct >= 55 ? 'moderate' : pct >= 30 ? 'weak' : 'very weak'
  return `${pct}% — ${word}`
}

/**
 * `IdentityCandidate.method` in plain words. The raw enum value
 * ("normalised_key") used to be interpolated straight into the sighting
 * sheet's sentence — exactly the kind of machinery ADR 0160 §112 says stays
 * behind the page, not printed as if a person typed it (review finding).
 */
export function candidateMethodLabel(method: string): string {
  if (method === 'exact_key_ambiguous') return 'an exact name match with more than one candidate'
  if (method === 'normalised_key') return 'a normalised name match'
  if (method === 'person') return "a person's suggestion"
  return method
}

/** "today" / "yesterday" / "6 days ago" / "3 months ago" / "date unknown". */
export function ageWords(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'date unknown'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'date unknown'
  const days = Math.floor((now.getTime() - then) / 86_400_000)
  if (days < 0) return 'dated in the future'
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? 'a month ago' : `${months} months ago`
  const years = Math.floor(days / 365)
  return years === 1 ? 'a year ago' : `${years} years ago`
}

/** "5 Sep 2026" — a date as a date; the raw ISO when it will not parse. */
export function dateWords(iso: string | null | undefined): string {
  if (!iso) return EM
  const t = new Date(iso)
  if (!Number.isFinite(t.getTime())) return iso
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The pack, as the source stated it. The single most common cause of a wrong
 * comparison is a case price read as a bottle price, so the pack is always
 * printed beside the figure — "12 × 750 ml", "1 × 375 ml", "6 × volume not
 * stated".
 */
export function packWords(packSize: number | null | undefined, unitVolumeMl: number | null | undefined): string {
  const pack = num(packSize) ?? 1
  const ml = num(unitVolumeMl)
  const vol = ml === null ? 'volume not stated' : `${ml} ml`
  return `${pack} × ${vol}`
}

/** Count words for a heading: "one sighting", "14 sightings", "no sightings". */
export function countWords(n: number | null, singular: string, plural = `${singular}s`): string {
  if (n === null) return `${EM} ${plural}`
  if (n === 0) return `no ${plural}`
  if (n === 1) return `one ${singular}`
  return `${n} ${plural}`
}

/* ── the sources ──────────────────────────────────────────────────────────── */

export type SourceType =
  | 'invoice'
  | 'quote'
  | 'api_catalog'
  | 'website_scrape'
  | 'chat'
  | 'social'
  | 'manual'

export const SOURCE_TYPES: SourceType[] = [
  'invoice',
  'quote',
  'api_catalog',
  'website_scrape',
  'chat',
  'social',
  'manual',
]

export interface SourceMeta {
  /** The word on the rung. */
  label: string
  /** ADR 0117's trust tier as the writers stamp it, 1 (best) to 7. */
  tier: number
  /** The sentence beside the label. */
  sentence: string
}

export const SOURCE_META: Record<SourceType, SourceMeta> = {
  invoice: {
    label: 'Invoice',
    tier: 1,
    sentence:
      'A line on a receipt this house verified, mirrored into the register the moment it was checked.',
  },
  quote: {
    label: 'Quote',
    tier: 2,
    sentence:
      'A price the vendor committed to in writing: a confirmed order, or a written quote somebody recorded.',
  },
  api_catalog: {
    label: 'Vendor feed',
    tier: 3,
    sentence: 'A line from a price file the vendor handed over, ingested as it was written.',
  },
  website_scrape: {
    label: 'Public page',
    tier: 4,
    sentence: 'A list price read off the vendor’s own web page. Signed by nobody; never set beside a quote.',
  },
  chat: {
    label: 'Rep message',
    tier: 5,
    sentence: 'A number a rep sent by message, written down by whoever read it.',
  },
  social: {
    label: 'Social post',
    tier: 6,
    sentence: 'A public post, often promotional, written down by a person.',
  },
  manual: {
    label: 'Told to us',
    tier: 7,
    sentence: 'Heard it, wrote it down. The least-provenanced row the register holds, and it says so.',
  },
}

export function isSourceType(v: unknown): v is SourceType {
  return typeof v === 'string' && (SOURCE_TYPES as string[]).includes(v)
}

/** The label for a source the page has words for; the raw value otherwise, never hidden. */
export function sourceLabel(v: string | null | undefined): string {
  if (!v) return 'source not stated'
  return isSourceType(v) ? SOURCE_META[v].label : v
}

/** The four a person may attest to (ManualObservationDto). */
export const HAND_SOURCES: Array<{ value: 'quote' | 'chat' | 'social' | 'manual'; label: string; hint: string }> = [
  { value: 'quote', label: 'Written quote', hint: 'They committed to it in writing' },
  { value: 'chat', label: 'Message from a rep', hint: 'WhatsApp, SMS or email' },
  { value: 'social', label: 'Social post', hint: 'Public, often promotional' },
  { value: 'manual', label: 'Told to me', hint: 'Heard it, wrote it down' },
]

/* ── currencies ───────────────────────────────────────────────────────────── */

/**
 * A short list for the record-a-price picker. The register accepts any real
 * ISO 4217 code (the gateway is the source of truth, `common/iso-4217.ts`);
 * this is only the client's shortlist plus a free-text fallback so a house
 * trading in a currency not listed here is never blocked.
 */
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'TRY'] as const

/* ── the wine's name ──────────────────────────────────────────────────────── */

/**
 * A wine's name without repeating itself. Mirrors `wineDisplayLabel` in the
 * gateway's `wine-identity.ts` and the legacy page's own copy
 * (`VendorPriceCompare.tsx`) — the browser cannot import server code, so this
 * is a third copy of the same rule, kept in lockstep by citation rather than
 * import.
 */
const TRADE_WORDS = new Set([
  'vineyard', 'vineyards', 'winery', 'wineries', 'estate', 'estates', 'cellar',
  'cellars', 'domaine', 'domaines', 'chateau', 'bodega', 'bodegas', 'weingut',
  'tenuta', 'azienda', 'agricola', 'cantina', 'maison', 'champagne', 'wine',
  'wines', 'company', 'co', 'inc', 'ltd', 'llc', 'the', 'family', 'brothers',
  'bros', 'and',
])

export function wineLabel(w: { name?: string | null; producer?: string | null; vintage?: number | null }): string {
  const norm = (s?: string | null) =>
    (s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const name = (w.name ?? '').trim()
  const producer = (w.producer ?? '').trim()
  const vintage = w.vintage ? String(w.vintage) : ''

  const distinctive = norm(producer).split(' ').filter((x) => x && !TRADE_WORDS.has(x))
  const nameWords = new Set(norm(name).split(' '))
  const nameSaysProducer = distinctive.length > 0 && distinctive.every((x) => nameWords.has(x))

  const parts: string[] = []
  if (producer && !nameSaysProducer) parts.push(producer)
  if (name) parts.push(name)
  if (vintage && !new RegExp(`\\b${vintage}\\b`).test(name)) parts.push(vintage)
  return parts.join(' ')
}
