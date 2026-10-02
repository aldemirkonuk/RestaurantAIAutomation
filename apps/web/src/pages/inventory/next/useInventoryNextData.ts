/**
 * The /inventory rework's reads (INV-W4; inventory.md §15, "Build rulings").
 *
 * One hook for the page and one for an opened row. Both read through the
 * shared hooks and services; nothing here edits them. What this file adds is
 * the mapping, and the mapping exists to close the traps the legacy page's
 * `useInventoryPage.ts` carries (dossier A, confirmed by dossier E):
 *
 *  - stock `|| 0` and par `|| 10` (useInventoryPage.ts:202-204). A par of 0
 *    became 10 and an unread stock became 0. Here an absent figure stays null
 *    and renders the dash; a 0 stays 0.
 *  - the location filter that never reached the filter (useInventoryPage.ts:77).
 *    `zoneFilter` below is applied.
 *  - search by `toLowerCase().includes`, so "Chateau" missed "Château" and the
 *    Turkish dotted and dotless i never matched. `fold` folds both.
 *  - `$` hard-coded (bits.tsx:9-13). Money goes through `fmtMoney` with the
 *    house's own code, read from GET /settings/currency.
 *  - the 'NV' literal and `leadDays = 6` (RowExpansion.tsx:156, :173). Neither
 *    exists here: an absent vintage is the dash, and no lead time is assumed.
 *  - an unknown wine type coerced to red (wine-library.ts:6-14). The library's
 *    raw `category` is read; absent is "not recorded", drawn in ink, never red.
 *  - a failed lot or zone read rendered as empty. `zones` is null when the row
 *    carried no lot list, and `locations.unavailable` says the zone names
 *    could not be read; both render the dash.
 *
 * Unknown is never zero (ADRs 0020, 0067, 0149): every figure here is
 * `number | null`, and a read that is pending or failed is `null`.
 */
import { useEffect, useMemo } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { useInventory } from '../../../hooks/queries/useInventoryQueries';
import { useWinesByIds } from '../../../hooks/queries/useWineQueries';
import { useProviders } from '../../../hooks/queries/useProviderQueries';
import { useStorageLocations, type StorageLocation } from '../../../hooks/useStorageLocations';
import { apiClient, getErrorMessage } from '../../../services/api/client';
import { failureReason } from './iv-failure';
import { settingsApi } from '../../../services/api/settings';
import { documentsApi, type ProcurementDocument } from '../../../services/api/documents';
import { fetchDeliveriesToName } from '../../../services/api/orders';
import { fetchAuctionLotRecords, type AuctionLotRecord } from '../../../services/api/inventory';
import { getPriceAdvice } from '../../../services/api/pricing';
import type { InventoryItem as ApiItem, Wine as ApiWine } from '../../../services/api/types';
import type { Provider } from '../../../services/api/providers';
import { DELIVERIES_TO_NAME_KEY } from '../../../components/mudavym/DeliveriesToName';
import { fmtMoney } from '../../../lib/mudavym/format';
import { queryKeys } from '../../../lib/query-keys';
import { pendingSpotCountCount, watchSpotCountOutbox } from '../../../lib/spotCountOutbox';
import { num, text } from '../../cellar/next/cellar-format';
import type { MapTone } from '../command/CellarMapView';
import type { InventoryItem as LegacyItem } from '../useInventoryPage';
import { COUNT_DUE_DAYS } from '../command/bits';
import type { AdviceLoad } from '../command/HousePriceCell';

export const EM = '—';

/* ── the row ─────────────────────────────────────────────────────────────── */

/**
 * Where a title stands against its par. `out` is counted apart from `below`
 * (founder, INV-W4 F-2), and `below` is strictly stock < par (ADR 0129).
 * `nopar` is a par of 0: there is nothing to be below. `unknown` is a stock
 * that was not read.
 */
export type Standing = 'out' | 'below' | 'at' | 'above' | 'nopar' | 'unknown';

export interface ZoneQty {
  locationId: string | null;
  qty: number;
}

export interface InvRow {
  id: string;
  wineId: string | null;
  /** The house's own name for the title (alias first, ADR 0124). Null = none on the row. */
  name: string | null;
  /** The library's name, only when it differs from the house's. */
  libraryName: string | null;
  producer: string | null;
  /**
   * What the Type column says (INV-W30): a wine's style, folded so "Rosé" and
   * "rose" are one ("red", "rose"); "wine" for a wine with no style; the
   * drink's kind for anything else ("beer", "spirit", "non_alcoholic");
   * "unclassified" when the library's classifier could not tell. null = no
   * library row to read it from, i.e. not recorded.
   */
  type: string | null;
  /**
   * The library's beverage kind (`master_wine_library.beverage_kind`, one of
   * wine / beer / spirit / sake / cider / cocktail / non_alcoholic / unknown,
   * migration 20260817060000_beverage_kind_classification.sql). Inferred as
   * "wine" from a style when the library row did not carry the column; null
   * when there is nothing to read it from.
   */
  kind: string | null;
  vintage: number | null;
  grape: string | null;
  bottleSizeMl: number | null;
  stock: number | null;
  shadow: number | null;
  par: number | null;
  reorderPoint: number | null;
  /** False when the gateway's analytics join failed for this read. */
  analyticsReadable: boolean;
  velocity: number | null;
  /** Days of cover. Null at zero velocity: a title nobody buys has no runway. */
  runway: number | null;
  daysSinceSale: number | null;
  deadStock: boolean;
  bottle: number | null;
  glass: number | null;
  pourMl: number | null;
  wac: number | null;
  costProvenance: 'invoice' | 'estimated' | null;
  /** stock × WAC; null when either is unknown. */
  value: number | null;
  lastCountedAt: string | null;
  openMl: number | null;
  /** Null when the row carried no lot list at all. */
  zones: ZoneQty[] | null;
  providerId: string | null;
  providerName: string | null;
  standing: Standing;
}

export function standingOf(stock: number | null, par: number | null): Standing {
  if (stock === null) return 'unknown';
  if (stock <= 0) return 'out';
  if (par === null || par <= 0) return 'nopar';
  if (stock < par) return 'below';
  if (stock === par) return 'at';
  return 'above';
}

/** The map's legend in this page's words: the chips say Out / Below par / Reconcile (INV-W19). */
export const MAP_WORDS: Record<MapTone, string> = {
  green: 'At or above par',
  amber: 'Below par',
  rose: 'Out',
  violet: 'Reconcile',
  neutral: 'Not read, or no par set',
};

/** A map tile's tint by the same standing the table and chips use. */
export function mapTone(item: LegacyItem): MapTone {
  if ((item.shadowStock ?? 0) > 0) return 'violet';
  switch (standingOf(item.liveStock ?? null, item.threshold ?? null)) {
    case 'out':
      return 'rose';
    case 'below':
      return 'amber';
    case 'at':
    case 'above':
      return 'green';
    default:
      return 'neutral';
  }
}

type Raw = Record<string, unknown>;

/**
 * INV-W30: the page holds every drink the library holds, not only wine. The
 * kind is read raw, not through `text()`, because `text()` turns the
 * classifier's own "unknown" verdict into null, and "the classifier could not
 * tell" is a different sentence from "nothing was recorded". `category` is the
 * library's `primary_type` (wines.service.ts:188), a wine style.
 */
export function typeOf(category: unknown, beverageKind: unknown): { type: string | null; kind: string | null } {
  const style = text(category);
  const styleKey = style === null ? null : fold(style);
  const k = typeof beverageKind === 'string' && beverageKind.trim() !== '' ? beverageKind.trim().toLowerCase() : null;
  if (k === null || k === 'unknown') {
    if (styleKey !== null) return { type: styleKey, kind: 'wine' };
    return k === null ? { type: null, kind: null } : { type: 'unclassified', kind: 'unknown' };
  }
  if (k === 'wine') return { type: styleKey ?? 'wine', kind: 'wine' };
  return { type: k, kind: k };
}

const TYPE_WORDS: Record<string, string> = {
  rose: 'Rosé',
  non_alcoholic: 'Non-alcoholic',
  unclassified: 'not classified',
};

/** The house's word for a `type` key: never the key itself ("non_alcoholic"). */
export function typeLabel(key: string): string {
  return TYPE_WORDS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** The Type filter's value for every wine at once, shown only when the house holds other drinks too. */
export const ALL_WINE = 'kind:wine';

/** One gateway row (already through `normalizeInventoryItem`) and its library wine. */
export function toRow(item: ApiItem, wine?: ApiWine | null): InvRow {
  const r = item as unknown as Raw;
  const w = (wine ?? null) as unknown as Raw | null;
  const stock = num(r.stockLive);
  const par = num(r.thresholdMin);
  const analyticsReadable = r.analyticsReadable !== false;
  const velocity = analyticsReadable ? num(r.velocityPerDay) : null;
  const cover = analyticsReadable ? num(r.daysOfCover) : null;
  const runway =
    cover !== null ? cover : velocity !== null && velocity > 0 && stock !== null ? stock / velocity : null;
  const wac = num(r.wac);
  // `wineName` is the house's alias when it set one; `libraryName` is the
  // library's own name, carried beside it (inventory.service.ts:95-103).
  const name = text(r.wineName) ?? text(w?.displayName) ?? text(w?.name);
  const library = text(r.libraryName) ?? text(w?.name);
  const zones = Array.isArray(r.locations)
    ? (r.locations as Raw[])
        .map((l) => ({ locationId: text(l.locationId), qty: num(l.qty) }))
        .filter((l): l is ZoneQty => l.qty !== null)
    : null;
  const provenance = r.costProvenance === 'invoice' || r.costProvenance === 'estimated' ? r.costProvenance : null;
  return {
    id: String(r.id),
    wineId: text(r.wineId),
    name,
    libraryName: library && library !== name ? library : null,
    producer: text(r.wineProducer) ?? text(w?.producer),
    ...typeOf(w?.category, w?.beverageKind),
    vintage: num(r.wineVintage) ?? num(w?.vintage),
    grape: text(w?.grapeVariety),
    bottleSizeMl: num(r.bottleSizeMl) ?? num(w?.bottleSizeMl),
    stock,
    shadow: num(r.shadowStock),
    par,
    reorderPoint: num(r.reorderPoint),
    analyticsReadable,
    velocity,
    runway,
    daysSinceSale: num(r.daysSinceSale),
    deadStock: r.deadStock === true,
    bottle: num(r.menuPriceBottle),
    glass: num(r.menuPriceGlass),
    pourMl: num(r.pourSizeMl),
    wac,
    costProvenance: provenance,
    value: stock !== null && wac !== null ? stock * wac : null,
    lastCountedAt: text(r.lastCountedAt),
    openMl: num(r.openMl),
    zones,
    providerId: text(r.providerId),
    providerName: text(r.providerName),
    standing: standingOf(stock, par),
  };
}

/** Bottles to bring a title back to par, when both figures are read and it is short. */
export function suggestedToPar(row: InvRow): number | null {
  if (row.stock === null || row.par === null || row.par <= 0) return null;
  const short = row.par - row.stock;
  return short > 0 ? short : null;
}

/* ── the order: "Needs you first" ────────────────────────────────────────── */

/** 0 out, 1 below par, 2 everything else. */
export function severity(row: InvRow): 0 | 1 | 2 {
  if (row.standing === 'out') return 0;
  if (row.standing === 'below') return 1;
  return 2;
}

export const SEVERITY_GROUP = ['Out', 'Below par', 'Everything else, by runway'] as const;

/**
 * Severity first, then runway ascending, then the name. The legacy sort
 * (InventoryCommandPage.tsx:491-495) was runway alone with a null runway last,
 * so a bottle at 0 with no recent sale — whose runway is null — sank to the
 * bottom of the page (dossier E §1).
 */
export function needsYouFirst(a: InvRow, b: InvRow): number {
  const s = severity(a) - severity(b);
  if (s !== 0) return s;
  const ra = a.runway ?? Number.POSITIVE_INFINITY;
  const rb = b.runway ?? Number.POSITIVE_INFINITY;
  if (ra !== rb) return ra < rb ? -1 : 1;
  return (a.name ?? '').localeCompare(b.name ?? '');
}

export type SortId = 'needs' | 'name' | 'value';

export const SORT_LABEL: Record<SortId, string> = { needs: 'Needs you first', name: 'Name', value: 'Value at cost' };

/**
 * How the list is ordered, said truthfully (INV-W23). With no cost on any
 * listed title the value sort has nothing to sort by and falls back to Needs
 * you first (sortRows below); the line says so instead of going quiet.
 */
export function sortWords(sort: SortId, rows: InvRow[]): string {
  if (sort === 'value' && rows.length > 0 && rows.every((r) => r.value === null)) {
    return 'sorted Value at cost, though no title listed has a cost yet, so they stay in Needs you first order';
  }
  return `sorted ${SORT_LABEL[sort]}`;
}

export function sortRows(rows: InvRow[], sort: SortId): InvRow[] {
  const out = [...rows];
  if (sort === 'needs') return out.sort(needsYouFirst);
  if (sort === 'name') return out.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  // Value at cost, largest first; an unknown value sorts after every known one.
  return out.sort((a, b) => {
    const va = a.value ?? Number.NEGATIVE_INFINITY;
    const vb = b.value ?? Number.NEGATIVE_INFINITY;
    return va === vb ? needsYouFirst(a, b) : vb > va ? 1 : -1;
  });
}

/* ── search that ignores accents ─────────────────────────────────────────── */

/**
 * Lower-case, strip combining marks, fold the Turkish dotless ı. `İ` lower-cases
 * to `i` + U+0307, which the mark strip removes, so İstanbul, Istanbul and
 * ıstanbul all fold to "istanbul".
 */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ß/g, 'ss')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');
}

export function matchesSearch(row: InvRow, query: string, zoneName: (id: string | null) => string | null): boolean {
  const q = fold(query.trim());
  if (q === '') return true;
  const hay = [
    row.name,
    row.libraryName,
    row.producer,
    row.grape,
    row.type === null ? null : typeLabel(row.type),
    row.kind === 'wine' ? 'wine' : null,
    row.vintage === null ? null : String(row.vintage),
    ...(row.zones ?? []).map((z) => zoneName(z.locationId)),
  ]
    .filter((s): s is string => typeof s === 'string')
    .map(fold)
    .join(' ');
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/* ── chips ───────────────────────────────────────────────────────────────── */

export type ChipId = 'all' | 'out' | 'below' | 'reconcile' | 'count' | 'dead' | 'price';

export const CHIPS: { id: ChipId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'out', label: 'Out' },
  { id: 'below', label: 'Below par' },
  { id: 'reconcile', label: 'Reconcile' },
  { id: 'count', label: 'Count due' },
  { id: 'dead', label: 'Dead stock' },
  { id: 'price', label: 'Price signals' },
];

export function countDue(row: InvRow, now = Date.now()): boolean {
  if (row.lastCountedAt === null) return true;
  const t = Date.parse(row.lastCountedAt);
  if (!Number.isFinite(t)) return true;
  return (now - t) / 86_400_000 > COUNT_DUE_DAYS;
}

/**
 * Whether a row belongs under a chip. `price` matches nothing: a price signal
 * needs a market figure and none is read (`retail_price_avg` is not selected,
 * database.service.ts:42-53), so its count is the dash, never 0.
 */
export function chipMatch(row: InvRow, chip: ChipId, now = Date.now()): boolean {
  switch (chip) {
    case 'all':
      return true;
    case 'out':
      return row.standing === 'out';
    case 'below':
      return row.standing === 'below';
    case 'reconcile':
      return row.shadow !== null && row.shadow > 0;
    case 'count':
      return countDue(row, now);
    case 'dead':
      return row.deadStock;
    case 'price':
      return false;
  }
}

/* ── zone and type filters ───────────────────────────────────────────────── */

/** `''` = every zone; `'none'` = rows with no bottle in any zone. */
export function inZone(row: InvRow, zone: string): boolean {
  if (zone === '') return true;
  if (row.zones === null) return false;
  if (zone === 'none') return !row.zones.some((z) => z.locationId !== null && z.qty > 0);
  return row.zones.some((z) => z.locationId === zone && z.qty > 0);
}

/** `''` = every type; `'none'` = type not recorded. */
export function ofType(row: InvRow, type: string): boolean {
  if (type === '') return true;
  if (type === 'none') return row.type === null;
  if (type === ALL_WINE) return row.kind === 'wine';
  return row.type === type;
}

/* ── money ───────────────────────────────────────────────────────────────── */

export type HouseCurrency =
  | { state: 'reading'; code: null }
  | { state: 'recorded'; code: string }
  | { state: 'not_recorded'; code: null }
  | { state: 'unreadable'; code: null };

/**
 * A money figure for a cell. The house's code when it is recorded; the dash
 * while the currency is still being read; a bare number when the house has no
 * currency or it could not be read — the header says which, once, rather than
 * every cell repeating "(currency not recorded)". Never `$`.
 */
/**
 * A selling pace a manager can tell apart. The view stores sold_30d / 30,
 * rounded to three places (inventory_analytics), so one bottle in a month is
 * 0.033 a day. One decimal drew that as "0.0", the same as a title that never
 * sold. Below 0.1 a day, show two places; a true zero is "0".
 */
export function fmtPace(v: number): string {
  if (v === 0) return '0';
  return v < 0.1 ? v.toFixed(2) : v.toFixed(1);
}

/** Bottles sold in the last 30 days, recovered from the stored pace (sold_30d / 30). */
export function sold30(v: number): number {
  return Math.round(v * 30);
}

export function cellMoney(v: number | null, currency: HouseCurrency): string {
  if (v === null || !Number.isFinite(v)) return EM;
  if (currency.state === 'reading') return EM;
  if (currency.state === 'recorded') return fmtMoney(v, currency.code);
  return v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

/* ── the read sentence ───────────────────────────────────────────────────── */

/**
 * A count of bottles or titles, grouped the way money on this page is
 * (1,240), so the two read alike (INV-W33). Exports and input boxes keep
 * the bare number.
 */
export function fmtCount(n: number): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 1 });
}

function plural(n: number, one: string, many: string): string {
  return `${fmtCount(n)} ${n === 1 ? one : many}`;
}

/** Bottles at 1.5 days of cover or less that are not already out. */
export function dryTomorrow(row: InvRow): boolean {
  return row.standing !== 'out' && row.runway !== null && row.runway < 1.5;
}

/**
 * The one read sentence at the top (no KPI tiles). Every number in it is a
 * count of what was read; what was not read is named, never folded into a 0.
 */
export function readSentence(rows: InvRow[], currency: HouseCurrency, zonesReadable: boolean): string {
  const n = rows.length;
  const read = rows.filter((r) => r.stock !== null);
  const bottles = read.reduce((sum, r) => sum + Math.max(0, r.stock ?? 0), 0);
  const zoneIds = new Set<string>();
  for (const r of rows) for (const z of r.zones ?? []) if (z.locationId !== null && z.qty > 0) zoneIds.add(z.locationId);
  const parts: string[] = [];

  let first =
    read.length === 0
      ? `${plural(n, 'title', 'titles')}; no title's stock could be read, so the bottle count is unknown`
      : read.length < n
        ? `${plural(n, 'title', 'titles')}, ${plural(bottles, 'bottle', 'bottles')} on the ${fmtCount(read.length)} whose stock was read (${fmtCount(n - read.length)} could not be read)`
        : `${plural(n, 'title', 'titles')}, ${plural(bottles, 'bottle', 'bottles')}`;
  if (zonesReadable && zoneIds.size > 0) first += ` across ${plural(zoneIds.size, 'zone', 'zones')}`;
  parts.push(`${first}.`);

  const out = rows.filter((r) => r.standing === 'out').length;
  const below = rows.filter((r) => r.standing === 'below').length;
  const dry = rows.filter(dryTomorrow).length;
  const lead = read.length < n ? 'Of the titles read, nothing' : 'Nothing';
  if (read.length === 0) {
    // No stock was read, so nothing can be said to be out or fine.
  } else if (out === 0 && below === 0) {
    parts.push(dry === 0 ? `${lead} is out or below par.` : `${lead} is out or below par, but ${dry === 1 ? 'one runs' : `${fmtCount(dry)} run`} dry tomorrow.`);
  } else {
    let s =
      out === 0
        ? `None is out; ${fmtCount(below)} ${below === 1 ? 'is' : 'are'} below par`
        : `${fmtCount(out)} ${out === 1 ? 'is' : 'are'} out${below > 0 ? `, and ${fmtCount(below)} more ${below === 1 ? 'is' : 'are'} below par` : ''}`;
    if (dry > 0) s += `; ${dry === 1 ? 'one runs' : `${fmtCount(dry)} run`} dry tomorrow`;
    parts.push(`${s}.`);
  }

  const priced = rows.filter((r) => r.value !== null);
  if (priced.length === 0) {
    parts.push('No title has a cost on the books yet, so the value at cost reads —, not 0.');
  } else {
    const total = priced.reduce((sum, r) => sum + (r.value ?? 0), 0);
    const missing = n - priced.length;
    parts.push(
      `At cost the cellar holds ${cellMoney(total, currency)}, with ${fmtCount(priced.length)} of ${fmtCount(n)} titles priced${
        missing > 0 ? `; the ${fmtCount(missing)} without a cost show —, never 0` : ''
      }.`,
    );
  }
  // No market figure is read at all (`retail_price_avg` is not selected), so
  // this is said as the page's limit, never as the house having none (INV-W28).
  parts.push('This page does not read a market price yet, so the market reads unknown, not zero.');
  if (currency.state === 'not_recorded') parts.push('The house has no currency recorded, so money shows as bare numbers.');
  if (currency.state === 'unreadable') parts.push('The house’s currency could not be read, so money shows as bare numbers.');
  return parts.join(' ');
}

/** The latest spot count across the book, for the crumb; null = nothing counted yet. */
export function latestCount(rows: InvRow[]): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    const ms = r.lastCountedAt ? Date.parse(r.lastCountedAt) : NaN;
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = r.lastCountedAt;
    }
  }
  return best;
}

/* ── the page's read ─────────────────────────────────────────────────────── */

export interface Waiting {
  /** Null while pending or after a failed read. */
  n: number | null;
  failed: boolean;
  /** True when the read hit its window, so `n` is a floor. */
  capped?: boolean;
}

const RECEIPT_QUEUE_LIMIT = 100;

export function useInventoryNextData() {
  const { activeRestaurantId, activeRole, user, availableRestaurants, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const rid = activeRestaurantId ?? null;
  const role = (activeRole ?? (user as { role?: string } | null)?.role ?? null) as string | null;
  /** Owners and managers, as `canEditPrice` reads it (InventoryCommandPage.tsx:196-198). */
  const canManage = role === 'owner' || role === 'manager';

  const list = useInventory();
  const items = list.data ?? null;

  const wineIds = useMemo(
    () => [...new Set((items ?? []).map((i) => i.wineId).filter((id): id is string => !!id))],
    [items],
  );
  const wines = useWinesByIds(wineIds);
  const winesById = useMemo(() => {
    const m = new Map<string, ApiWine>();
    for (const w of (wines.data ?? []) as ApiWine[]) m.set(w.id, w);
    return m;
  }, [wines.data]);

  const rows = useMemo<InvRow[] | null>(
    () => (items === null ? null : items.map((i) => toRow(i, i.wineId ? winesById.get(i.wineId) : null))),
    [items, winesById],
  );

  const currencyQ = useQuery({
    queryKey: ['settings', 'currency'],
    queryFn: () => settingsApi.houseCurrency(),
    staleTime: 5 * 60_000,
  });
  const currency: HouseCurrency = currencyQ.isPending
    ? { state: 'reading', code: null }
    : currencyQ.isError || !currencyQ.data?.readable
      ? { state: 'unreadable', code: null }
      : currencyQ.data.code
        ? { state: 'recorded', code: currencyQ.data.code }
        : { state: 'not_recorded', code: null };

  const storage = useStorageLocations();
  const providersQ = useProviders(rid ?? '');

  // Per-wine advice toward the house's target margin (ADR 0193), the shape
  // `HousePriceCell` reads — the same read and the same failure words as
  // InventoryCommandPage.tsx:202-235.
  const adviceQ = useQuery({
    queryKey: ['pricing-advice', rid],
    queryFn: getPriceAdvice,
    staleTime: 30_000,
    retry: 1,
    enabled: rid !== null && canManage,
  });
  const advice: AdviceLoad = useMemo(() => {
    if (adviceQ.isError)
      // The table shows this as the hover on "advice unavailable" (INV-W31).
      return { status: 'error', message: `the price advice could not be read — ${failureReason(adviceQ.error)}` };
    if (!adviceQ.data) return { status: 'loading' };
    if (!Array.isArray(adviceQ.data.wines) || !adviceQ.data.target)
      return { status: 'error', message: 'the price advice came back in a shape this page cannot read' };
    return {
      status: 'ready',
      byId: new Map(adviceQ.data.wines.map((w) => [w.inventoryId, w])),
      targetSet: adviceQ.data.target.set,
      locksReadable: adviceQ.data.locks?.readable !== false,
      locksReason: adviceQ.data.locks?.reason ?? null,
    };
  }, [adviceQ.isError, adviceQ.error, adviceQ.data]);

  // The quiet line's three counts. The first two share their keys and fetchers
  // with /receipts (useReceiptsNextData.ts:114-120) and the DeliveriesToName
  // card, so the page and the card can never disagree about one read.
  const invoicesQ = useQuery<ProcurementDocument[]>({
    queryKey: ['receipts-next', 'queue', rid],
    queryFn: () => documentsApi.list({ status: 'needs_review', limit: RECEIPT_QUEUE_LIMIT }),
    enabled: rid !== null,
    staleTime: 30_000,
  });
  const deliveriesQ = useQuery({
    queryKey: DELIVERIES_TO_NAME_KEY,
    queryFn: fetchDeliveriesToName,
    staleTime: 60_000,
    enabled: rid !== null,
  });
  const outboxQ = useQuery({
    queryKey: ['inventory-next', 'spot-count-outbox', rid],
    queryFn: pendingSpotCountCount,
    staleTime: 15_000,
  });

  // Counts queued offline go out when the connection returns or the tab comes
  // back, as the legacy page has it (InventoryCommandPage.tsx imports the same
  // watcher). A count that lands re-reads the stock and the outbox.
  useEffect(
    () =>
      watchSpotCountOutbox(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
        void queryClient.invalidateQueries({ queryKey: ['inventory-next', 'spot-count-outbox'] });
      }),
    [queryClient],
  );

  const waiting = {
    invoices: {
      n: invoicesQ.data ? invoicesQ.data.length : null,
      failed: invoicesQ.isError,
      capped: (invoicesQ.data?.length ?? 0) >= RECEIPT_QUEUE_LIMIT,
    } as Waiting,
    deliveries: {
      n: deliveriesQ.data ? deliveriesQ.data.deliveries.length : null,
      failed: deliveriesQ.isError,
    } as Waiting,
    outbox: { n: typeof outboxQ.data === 'number' ? outboxQ.data : null, failed: outboxQ.isError } as Waiting,
  };

  // INV-W28: every side read that did not answer, in the page's words, so the
  // footer never says "every figure was read" over one that failed, and one
  // control reads them all again. The zones key is useStorageLocations.ts:75,131.
  const unread: string[] = [];
  // INV-W29: the selling-pace join rides on the stock read; when it fails the
  // gateway sends analyticsReadable: false and deadStock: false on every row
  // (inventory.service.ts:163,265), so "Dead stock 0" would read a failure as health.
  const paceUnread = (rows ?? []).some((r) => !r.analyticsReadable);
  if (paceUnread) unread.push('the selling pace, so pace, runway and dead stock show —');
  if (wines.isError) unread.push('the wine library, so type shows —, the type filter is off, and grapes are left out of details and search');
  if (storage.locationsUnavailable) unread.push('the storage locations, so zones show — and the zone filter is off');
  if (currency.state === 'unreadable') unread.push('the house’s currency');
  if (advice.status === 'error') unread.push('the price advice');
  if (invoicesQ.isError) unread.push('the invoices waiting for a match');
  if (deliveriesQ.isError) unread.push('the delivered lines waiting for their item');
  // A read still in flight is not an answer either: until the library answers,
  // a blank type is unknown, not "not recorded", and the footer may not say
  // every figure was read. A query with nothing to ask (no wine ids) never runs.
  const libraryAnswered = wineIds.length === 0 || wines.isSuccess;
  const pending: string[] = [];
  if (wineIds.length > 0 && wines.isPending) pending.push('the wine library');
  if (storage.locationsLoading) pending.push('the storage locations');
  if (currency.state === 'reading') pending.push('the house’s currency');
  // The advice is only asked for owners and managers (enabled above); for anyone
  // else it never runs, so it is not "still reading".
  if (canManage && advice.status === 'loading') pending.push('the price advice');
  if (invoicesQ.isPending) pending.push('the invoices waiting for a match');
  if (deliveriesQ.isPending) pending.push('the delivered lines waiting for their item');
  const rereadUnread = () => {
    if (paceUnread) void list.refetch();
    if (wines.isError) void wines.refetch();
    if (storage.locationsUnavailable) void queryClient.invalidateQueries({ queryKey: ['storageLocations', rid] });
    if (currency.state === 'unreadable') void currencyQ.refetch();
    if (advice.status === 'error') void adviceQ.refetch();
    if (invoicesQ.isError) void invoicesQ.refetch();
    if (deliveriesQ.isError) void deliveriesQ.refetch();
  };

  // No house is not an empty house: with no active restaurant the stock is
  // never asked for, so the page says which building is missing instead of
  // waiting on a read that will not start.
  const state: 'reading' | 'nohouse' | 'failed' | 'ready' =
    authLoading ? 'reading' : rid === null ? 'nohouse' : rows !== null ? 'ready' : list.isError ? 'failed' : 'reading';

  return {
    state,
    error: list.isError ? getErrorMessage(list.error) : null,
    /** A re-read failed after an earlier one answered: the rows shown are the earlier read's. */
    stale: list.isError && rows !== null,
    refetch: () => void list.refetch(),
    rid,
    canManage,
    branches: availableRestaurants,
    rows,
    rawItems: items ?? [],
    /** The library read failed: type, grape and the library name are unread, not absent. */
    libraryUnread: wines.isError,
    /** The library has answered (or there was nothing to ask it): only then is a blank type "not recorded". */
    libraryAnswered,
    /** The selling-pace join failed for this read: pace, runway and dead stock are unread, not zero (INV-W29). */
    paceUnread,
    currency,
    locations: {
      list: storage.locations as StorageLocation[],
      loading: storage.locationsLoading,
      unavailable: storage.locationsUnavailable,
      setLocations: storage.setLocations,
    },
    providers: {
      list: (providersQ.data ?? null) as Provider[] | null,
      // Shown inside a sentence, so in the house's words (INV-W31).
      error: providersQ.isError ? failureReason(providersQ.error) : null,
    },
    advice,
    refetchAdvice: () => void adviceQ.refetch(),
    waiting,
    /** Side reads that did not answer, each with what it leaves unread (INV-W28). */
    unread,
    rereadUnread,
    /** Side reads that have not answered yet, neither data nor failure (INV-W28). */
    pending,
  };
}

export type InventoryNextData = ReturnType<typeof useInventoryNextData>;

/* ── one opened row ──────────────────────────────────────────────────────── */

/** One purchase line of the ledger (inventory-ledger.service.ts:712-740). */
export interface PurchaseLine {
  id: string;
  at: string | null;
  qty: number | null;
  /** The gateway maps a 0 unit cost to undefined (`unit_cost || undefined`), so 0 never arrives. */
  unitCost: number | null;
  orderId: string | null;
}

export interface PaperRead {
  /** Null while the order's documents are read; [] once read with none. */
  docs: ProcurementDocument[] | null;
  failed: string | null;
}

const PAPERWORK_LINES = 3;

/**
 * The opened row's own reads, made on the gesture rather than on the page:
 * the last purchases from the ledger (GET /inventory-ledger/transactions with
 * transactionType=purchase), each one's paper (GET /procurement/documents
 * ?orderId=), and the auction lots that carried the title in.
 */
export function useRowDetail(inventoryId: string) {
  const { activeRestaurantId } = useAuth();
  const purchasesQ = useQuery({
    queryKey: ['inventory-next', 'purchases', activeRestaurantId, inventoryId],
    queryFn: async () => {
      // No `limit` param: the gateway's query DTO has no number transform, so
      // any limit arrives as a string and is refused with a 400. The route
      // answers newest first (50 by default); the page keeps the first three.
      const r = await apiClient.get('/inventory-ledger/transactions', {
        params: { inventoryId, transactionType: 'purchase' },
      });
      const body = r.data as { transactions?: Raw[]; total?: unknown };
      if (!Array.isArray(body?.transactions)) throw new Error('the ledger answered in a shape this page cannot read');
      return {
        lines: body.transactions.slice(0, PAPERWORK_LINES).map(
          (t): PurchaseLine => ({
            id: String(t.id),
            at: text(t.transactionDate) ?? text(t.createdAt),
            qty: num(t.quantityChange),
            unitCost: num(t.unitCost),
            orderId: text(t.orderId),
          }),
        ),
        total: num(body.total),
      };
    },
    enabled: Boolean(activeRestaurantId) && inventoryId !== '',
    staleTime: 30_000,
  });

  const orderIds = useMemo(
    () => [...new Set((purchasesQ.data?.lines ?? []).map((l) => l.orderId).filter((id): id is string => !!id))],
    [purchasesQ.data],
  );
  const docQs = useQueries({
    queries: orderIds.map((orderId) => ({
      queryKey: ['inventory-next', 'order-docs', activeRestaurantId, orderId],
      queryFn: () => documentsApi.forOrder(orderId),
      staleTime: 60_000,
    })),
  });
  const paper = new Map<string, PaperRead>();
  orderIds.forEach((orderId, i) => {
    const q = docQs[i];
    paper.set(orderId, {
      docs: q?.data ?? null,
      failed: q?.isError ? getErrorMessage(q.error) : null,
    });
  });

  const lotsQ = useQuery<AuctionLotRecord[]>({
    queryKey: ['inventory-next', 'auction-lots', activeRestaurantId, inventoryId],
    queryFn: () => fetchAuctionLotRecords(inventoryId),
    enabled: Boolean(activeRestaurantId) && inventoryId !== '',
    staleTime: 60_000,
  });

  return {
    purchases: purchasesQ.data?.lines ?? null,
    purchasesTotal: purchasesQ.data?.total ?? null,
    purchasesError: purchasesQ.isError ? getErrorMessage(purchasesQ.error) : null,
    rereadPurchases: () => void purchasesQ.refetch(),
    paper,
    lots: lotsQ.data ?? null,
    lotsError: lotsQ.isError ? getErrorMessage(lotsQ.error) : null,
    rereadLots: () => void lotsQ.refetch(),
  };
}
