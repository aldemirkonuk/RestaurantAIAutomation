/**
 * VendorPricesNext formatting — the same honesty rule as every Mudavym page:
 * an unknown renders as an em dash or a sentence, never as a zero, a guess or
 * a hopeful percentage.
 *
 * Fonts are the three house faces (mudavym.css): Fraunces speaks, DM Sans is
 * operated, JetBrains Mono carries figures, dates and provenance.
 */

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * Fraunces, injected once — index.html loads the sans and the mono but not the
 * serif, and index.html is a shared file this page may not touch. The id
 * matches the dashboard's `fonts.ts` and `Sheet.tsx` so the three inject at
 * most one link. Copied deliberately: pages do not import across pages.
 */
const FRAUNCES_LINK_ID = 'mudavym-fraunces';

export function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FRAUNCES_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FRAUNCES_LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

/** A finite number, or null. Guards NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * A money figure in the currency the row states. Nothing here converts: a
 * lira figure prints as lira, and a null prints as the dash. An unknown
 * currency code prints the number with the code beside it rather than
 * throwing or silently dropping to dollars.
 */
export function money(value: number | null | undefined, currency: string | null | undefined): string {
  const v = num(value);
  if (v === null) return EM;
  const code = (currency ?? '').trim().toUpperCase();
  if (!code) return v.toFixed(2);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${v.toFixed(2)} ${code}`;
  }
}

/** "+3.4%" / "-12.0%" / em dash. Never prints a null as flat. */
export function pctChange(fraction: number | null | undefined): string {
  const f = num(fraction);
  if (f === null) return EM;
  const sign = f > 0.0005 ? '+' : f < -0.0005 ? '-' : '';
  return `${sign}${Math.abs(f * 100).toFixed(1)}%`;
}

/** "today" / "yesterday" / "6 days ago" / "3 months ago" / "date unknown". */
export function ageWords(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'date unknown';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'date unknown';
  const days = Math.floor((now.getTime() - then) / 86_400_000);
  if (days < 0) return 'dated in the future';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? 'a month ago' : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? 'a year ago' : `${years} years ago`;
}

/** "5 Sep 2026" — a date as a date; the raw ISO when it will not parse. */
export function dateWords(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return iso;
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "5 Sep 2026, 14:02" — for a decision or a judgement, where the minute matters. */
export function stampWords(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return iso;
  return `${dateWords(iso)}, ${t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * The pack, as the source stated it. The single most common cause of a wrong
 * comparison is a case price read as a bottle price, so the pack is always
 * printed beside the figure — "12 × 750 ml", "1 × 375 ml", "6 × volume not
 * stated".
 */
export function packWords(packSize: number | null | undefined, unitVolumeMl: number | null | undefined): string {
  const pack = num(packSize) ?? 1;
  const ml = num(unitVolumeMl);
  const vol = ml === null ? 'volume not stated' : `${ml} ml`;
  return `${pack} × ${vol}`;
}

/** "750 ml" / "volume not stated". */
export function volumeWords(unitVolumeMl: number | null | undefined): string {
  const ml = num(unitVolumeMl);
  return ml === null ? 'volume not stated' : `${ml} ml`;
}

/** Count words for a heading: "one sighting", "14 sightings", "no sightings". */
export function countWords(n: number | null, singular: string, plural = `${singular}s`): string {
  if (n === null) return `${EM} ${plural}`;
  if (n === 0) return `no ${plural}`;
  if (n === 1) return `one ${singular}`;
  return `${n} ${plural}`;
}

/* ── the sources ──────────────────────────────────────────────────────────── */

export type SourceType =
  | 'invoice'
  | 'quote'
  | 'api_catalog'
  | 'website_scrape'
  | 'chat'
  | 'social'
  | 'manual';

export const SOURCE_TYPES: SourceType[] = [
  'invoice',
  'quote',
  'api_catalog',
  'website_scrape',
  'chat',
  'social',
  'manual',
];

export interface SourceMeta {
  /** The word on the rung. */
  label: string;
  /** ADR 0117's trust tier as the writers stamp it, 1 (best) to 7. */
  tier: number;
  /**
   * WHO WRITES IT, as a `path:line` a reader can check. The legend once listed
   * six channels the system was not watching (page note §12); each entry here
   * names the writer that exists on this tree, so the legend cannot again
   * promise a stream nobody feeds.
   */
  writer: string;
  /** The sentence beside the label. */
  sentence: string;
}

export const SOURCE_META: Record<SourceType, SourceMeta> = {
  invoice: {
    label: 'Invoice',
    tier: 1,
    writer: 'procurement/own-paper-sighting.ts:344 via procurement.service.ts:1449',
    sentence: 'A line on a receipt this house verified, mirrored into the register the moment it was checked.',
  },
  quote: {
    label: 'Quote',
    tier: 2,
    writer: 'procurement/own-paper-sighting.ts (order_confirmed) and vendor-comparison.service.ts recordManualObservation',
    sentence: 'A price the vendor committed to in writing: a confirmed order, or a written quote somebody recorded.',
  },
  api_catalog: {
    label: 'Vendor feed',
    tier: 3,
    writer: 'distributor-feed/catalog-ingest.service.ts:408',
    sentence: 'A line from a price file the vendor handed over, ingested as it was written.',
  },
  website_scrape: {
    label: 'Public page',
    tier: 4,
    writer: 'vendor-intel/vendor-site-sighting.ts:411 (the sweep, gated on VENDOR_SITE_SWEEP_ENABLED)',
    sentence: 'A list price read off the vendor’s own web page. Signed by nobody; never set beside a quote.',
  },
  chat: {
    label: 'Rep message',
    tier: 5,
    writer: 'vendor-comparison.service.ts recordManualObservation (typed by a person)',
    sentence: 'A number a rep sent by message, written down by whoever read it.',
  },
  social: {
    label: 'Social post',
    tier: 6,
    writer: 'vendor-comparison.service.ts recordManualObservation (typed by a person)',
    sentence: 'A public post, often promotional, written down by a person.',
  },
  manual: {
    label: 'Told to us',
    tier: 7,
    writer: 'vendor-comparison.service.ts recordManualObservation (typed by a person)',
    sentence: 'Heard it, wrote it down. The least-provenanced row the register holds, and it says so.',
  },
};

export function isSourceType(v: unknown): v is SourceType {
  return typeof v === 'string' && (SOURCE_TYPES as string[]).includes(v);
}

/** The label for a source the page has words for; the raw value otherwise, never hidden. */
export function sourceLabel(v: string | null | undefined): string {
  if (!v) return 'source not stated';
  return isSourceType(v) ? SOURCE_META[v].label : v;
}

/** The four a person may attest to (ManualObservationDto). */
export const HAND_SOURCES: Array<{ value: 'quote' | 'chat' | 'social' | 'manual'; label: string; hint: string }> = [
  { value: 'quote', label: 'Written quote', hint: 'They committed to it in writing' },
  { value: 'chat', label: 'Message from a rep', hint: 'WhatsApp, SMS or email' },
  { value: 'social', label: 'Social post', hint: 'Public, often promotional' },
  { value: 'manual', label: 'Told to me', hint: 'Heard it, wrote it down' },
];

/* ── the wine's name ──────────────────────────────────────────────────────── */

/**
 * A wine's name without repeating itself. Mirrors `wineDisplayLabel` in the
 * gateway's wine-identity.ts — the browser cannot import server code, and the
 * chip and the heading below it sit two lines apart. Joining all three fields
 * unconditionally reads "Schramsberg Vineyards 2021 Schramsberg Blanc de Noir
 * North Coast 2021", because the library's `name` often already carries the
 * producer and the vintage. Ported from the legacy page, which got it right.
 */
const TRADE_WORDS = new Set([
  'vineyard', 'vineyards', 'winery', 'wineries', 'estate', 'estates', 'cellar',
  'cellars', 'domaine', 'domaines', 'chateau', 'bodega', 'bodegas', 'weingut',
  'tenuta', 'azienda', 'agricola', 'cantina', 'maison', 'champagne', 'wine',
  'wines', 'company', 'co', 'inc', 'ltd', 'llc', 'the', 'family', 'brothers',
  'bros', 'and',
]);

export function wineLabel(w: { name?: string | null; producer?: string | null; vintage?: number | null }): string {
  const norm = (s?: string | null) =>
    (s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const name = (w.name ?? '').trim();
  const producer = (w.producer ?? '').trim();
  const vintage = w.vintage ? String(w.vintage) : '';

  const distinctive = norm(producer).split(' ').filter((x) => x && !TRADE_WORDS.has(x));
  const nameWords = new Set(norm(name).split(' '));
  const nameSaysProducer = distinctive.length > 0 && distinctive.every((x) => nameWords.has(x));

  const parts: string[] = [];
  if (producer && !nameSaysProducer) parts.push(producer);
  if (name) parts.push(name);
  if (vintage && !new RegExp(`\\b${vintage}\\b`).test(name)) parts.push(vintage);
  return parts.join(' ');
}

/* ── the gateway's own words ──────────────────────────────────────────────── */

/**
 * The server's message, not axios's. "Request failed with status code 400"
 * tells the reader nothing they can act on; the API's own sentence is the
 * whole point of having returned a 400. Ported from the legacy page.
 */
export function apiErrorMessage(error: unknown, fallback = 'No reason was given.'): string {
  const body = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  const message = body?.message;
  if (Array.isArray(message)) return message.join('. ');
  if (typeof message === 'string' && message) return message;
  const plain = (error as { message?: string })?.message;
  return plain || fallback;
}

export function apiErrorStatus(error: unknown): number | null {
  const s = (error as { response?: { status?: number } })?.response?.status;
  return typeof s === 'number' ? s : null;
}

/** Retry the network, never the request: a 4xx will say the same thing again. */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  const status = apiErrorStatus(error);
  if (status !== null && status >= 400 && status < 500) return false;
  return failureCount < 1;
}
