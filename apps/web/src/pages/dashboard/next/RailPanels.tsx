/**
 * The rail beside the calendar: the week ahead, what's running low, and the
 * recent-activity tape. Every panel carries the honest empty state the
 * founder asked for — "Nothing on the calendar this week." is his exact
 * liked line — and the em-dash rule for unreachable data.
 */

import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCalendarEvents } from '@/hooks/queries/useCalendarQueries';
import type { CalendarEvent } from '@/services/api/calendar';
import type { InventoryItem } from '@/services/api/types';
import { formatNumber } from '@/lib/utils';
import type { ActivityItem } from './useDashboardNextData';
import { DASH, dateIn, eventKindWords, localDateStr, parseDateStr, timeAgo } from './format';
import { TryAgain } from './TryAgain';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-lg border border-paper-2 bg-paper-0 p-4" aria-label={title}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-inkm-1">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-[12px] italic text-inkm-4">{children}</p>;
}

/* ── This week ──────────────────────────────────────────────────────────── */

export function WeekAhead({
  restaurantId,
  zone = null,
}: {
  restaurantId: string | null;
  zone?: string | null;
}) {
  // DASH-W20: the week starts on the house's today, not the device's.
  const todayStr = dateIn(new Date(), zone);
  const end = parseDateStr(todayStr);
  end.setDate(end.getDate() + 6);
  const query = useCalendarEvents(restaurantId ?? '', {
    startDate: todayStr,
    endDate: localDateStr(end),
  });

  const events: CalendarEvent[] = (query.data ?? [])
    .slice()
    .sort((a, b) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? '')));

  return (
    <Panel
      title="This week"
      action={
        <Link
          to="/calendar"
          className="text-[11px] uppercase tracking-[0.1em] text-inkm-4 underline-offset-2 hover:text-inkm-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
        >
          Calendar
        </Link>
      }
    >
      {query.isLoading && (
        <div className="space-y-2">
          <div className="dn-skel h-8" aria-hidden />
          <div className="dn-skel h-8 w-4/5" aria-hidden />
        </div>
      )}
      {query.isError && (
        <EmptyLine>
          {DASH} The calendar couldn’t be reached just now.
          <TryAgain onRetry={() => query.refetch()} />
        </EmptyLine>
      )}
      {!query.isLoading && !query.isError && events.length === 0 && (
        <EmptyLine>Nothing on the calendar this week.</EmptyLine>
      )}
      {!query.isLoading && events.length > 0 && (
        <ul className="space-y-1.5">
          {events.slice(0, 6).map((ev) => (
            <li key={ev.id} className="flex items-baseline justify-between gap-3 text-[13px]">
              {/* DASH-W31/W32: two lines at most; the kind in words, never a code. */}
              <span className="min-w-0 line-clamp-2 leading-snug text-inkm-1">
                {ev.title}
                {eventKindWords(ev.type) ? <span className="text-inkm-4"> · {eventKindWords(ev.type)}</span> : null}
              </span>
              <span className="shrink-0 text-[11px] text-inkm-4" style={{ fontFamily: MONO }}>
                {parseDateStr(ev.date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                {ev.allDay || !ev.startTime ? '' : ` ${ev.startTime.slice(0, 5)}`}
              </span>
            </li>
          ))}
          {events.length > 6 && (
            <li className="text-[11px] text-inkm-4">and {events.length - 6} more this week</li>
          )}
        </ul>
      )}
    </Panel>
  );
}

/* ── Running low ────────────────────────────────────────────────────────── */

/**
 * The low-stock endpoint returns raw `v_low_stock_items` rows in snake_case
 * (`wine_name`, `stock_live`, `threshold_min`, `vintage`) — verified against
 * the running gateway — while the web `InventoryItem` type promises camelCase.
 * `inventoryApi.getLowStockItems` now normalizes that at the service boundary
 * (`services/api/inventory.ts`, `normalizeInventoryItem`); the raw fallback
 * below is kept so the panel stays correct if a caller ever hands it rows that
 * skipped the service.
 */
interface RawLowStockFields {
  wine_name?: string | null;
  stock_live?: number;
  threshold_min?: number;
  vintage?: number | null;
  /**
   * The unit the row's stock AND its par are written in (ADR 0070), from
   * migration 20270502100000_every_good_can_run_low. The view now holds every
   * good, so a flour's 200 is grams, not bottles. Absent on an older view.
   */
  uom?: string | null;
  /** null: nobody has counted this good (OD-161). Absent on an older view. */
  last_counted_at?: string | null;
}

/** restaurant_inventory_uom_check's vocabulary, in the house's words. */
const UNIT_WORDS: Record<string, [one: string, many: string]> = {
  bottle: ['bottle', 'bottles'],
  case: ['case', 'cases'],
  keg: ['keg', 'kegs'],
  pack: ['pack', 'packs'],
  each: ['unit', 'units'],
  glass: ['glass', 'glasses'],
  shot: ['shot', 'shots'],
  ml: ['ml', 'ml'],
  l: ['l', 'l'],
  mg: ['mg', 'mg'],
  g: ['g', 'g'],
  kg: ['kg', 'kg'],
};

/**
 * The unit word after a figure. An unknown unit is shown as written rather
 * than folded into "bottles"; no unit at all says nothing, as before.
 */
export function unitWord(uom: string | null | undefined, n: number | null): string | null {
  const key = (uom ?? '').trim().toLowerCase();
  if (!key) return null;
  // Own keys only: "constructor" or "toString" is not a unit word.
  if (!Object.prototype.hasOwnProperty.call(UNIT_WORDS, key)) return key;
  const pair = UNIT_WORDS[key];
  return n === 1 ? pair[0] : pair[1];
}

/** The unit a person reads 1,000 or more of a small unit in. */
const UNIT_UP: Record<string, string> = { g: 'kg', ml: 'l', mg: 'g' };

/**
 * One figure as a person reads it, and the unit it is then in. Stock and par
 * are integers in the good's own `uom` (ADR 0070), so a flour's 2500 is grams.
 * Whole g, ml or mg of 1,000 or more read a unit up, every gram kept: 2500 g
 * is "2.5 kg", 1750 g "1.75 kg", 1001 g "1.001 kg", 1500 ml "1.5 l". The same
 * rule as `amountIn` in apps/api-gateway/src/common/goods-words.ts, which
 * Lately and the alert line use, so the rail and the bell say the same stock
 * the same way. Any other unit is left as it is.
 */
export function readAmount(
  n: number,
  uom: string | null | undefined,
): { figure: string; unitKey: string } {
  const key = (uom ?? '').trim().toLowerCase();
  const up = Object.prototype.hasOwnProperty.call(UNIT_UP, key) ? UNIT_UP[key] : null;
  if (up && Math.abs(n) >= 1000) {
    return { figure: (n / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }), unitKey: up };
  }
  return { figure: formatNumber(n), unitKey: key };
}

/**
 * "200 / min 500 g", "2.5 / min 5 kg", and, when the two figures read in
 * different units, "800 g / min 2 kg": the stock carries its own unit only
 * when it is not the minimum's. A missing figure is a dash and keeps the
 * other's unit; a row with no unit says none, as before.
 */
export function stockAgainstMin(
  stock: number | null,
  min: number | null,
  uom: string | null | undefined,
): { stock: string; stockUnit: string | null; min: string; unit: string | null } {
  const s = stock == null ? null : readAmount(stock, uom);
  const m = min == null ? null : readAmount(min, uom);
  const minKey = m?.unitKey ?? s?.unitKey ?? (uom ?? '').trim().toLowerCase();
  const stockOwnUnit = s != null && m != null && s.unitKey !== m.unitKey;
  return {
    stock: s?.figure ?? DASH,
    stockUnit: stockOwnUnit ? unitWord(s.unitKey, stock) : null,
    min: m?.figure ?? DASH,
    unit: unitWord(minKey, min),
  };
}

function lowStockView(it: InventoryItem) {
  const raw = it as InventoryItem & RawLowStockFields;
  const min = it.thresholdMin ?? raw.threshold_min ?? null;
  return {
    id: it.id,
    name: it.wineName ?? raw.wine_name ?? null,
    vintage: it.wineVintage ?? raw.vintage ?? null,
    stock: it.stockLive ?? raw.stock_live ?? null,
    min,
    uom: raw.uom ?? null,
    // OD-161: null = never counted (absent is not null).
    notCounted: raw.last_counted_at === null,
  };
}

type LowStockLine = ReturnType<typeof lowStockView>;

/**
 * How far a good has run down, as a share of its own minimum. It carries no
 * unit, so a flour 300 g short and a wine 12 bottles short compare fairly; a
 * raw shortfall would let six gram goods push an empty wine off the list.
 * Unknown when the stock or a positive minimum is missing.
 */
function shareLeft(it: LowStockLine): number | null {
  if (it.stock == null || it.min == null || it.min <= 0) return null;
  return it.stock / it.min;
}

/** Counted goods first; out of stock first, then the smallest share left, then by name. */
function byHowLow(a: LowStockLine, b: LowStockLine): number {
  // Uncounted goods are not running low; they go last.
  if (a.notCounted !== b.notCounted) return a.notCounted ? 1 : -1;
  const outA = a.stock === 0 ? 0 : 1;
  const outB = b.stock === 0 ? 0 : 1;
  if (outA !== outB) return outA - outB;
  const ra = shareLeft(a);
  const rb = shareLeft(b);
  if (ra !== rb) {
    if (ra == null) return 1;
    if (rb == null) return -1;
    return ra - rb;
  }
  if (a.name == null || b.name == null) return a.name == null ? (b.name == null ? 0 : 1) : -1;
  return a.name.localeCompare(b.name);
}

export function LowStockPanel({
  items,
  onRetry,
}: {
  items: InventoryItem[] | null | undefined;
  /** DASH-W19: reads the list again after a failed read. */
  onRetry?: () => unknown;
}) {
  const sorted = (items ?? []).map(lowStockView).sort(byHowLow);

  return (
    <Panel
      title="Running low"
      action={
        <Link
          to="/inventory"
          className="text-[11px] uppercase tracking-[0.1em] text-inkm-4 underline-offset-2 hover:text-inkm-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
        >
          Inventory
        </Link>
      }
    >
      {items === undefined && (
        <div className="space-y-2">
          <div className="dn-skel h-6" aria-hidden />
          <div className="dn-skel h-6 w-4/5" aria-hidden />
        </div>
      )}
      {items === null && (
        <EmptyLine>
          {DASH} Stock levels couldn’t be reached just now.
          {onRetry && <TryAgain onRetry={onRetry} />}
        </EmptyLine>
      )}
      {items != null && items.length === 0 && (
        <EmptyLine>Nothing is running low.</EmptyLine>
      )}
      {items != null && sorted.length > 0 && (
        <ul className="space-y-1.5">
          {sorted.slice(0, 6).map((it) => {
            const read = stockAgainstMin(it.stock, it.min, it.uom);
            return (
            <li key={it.id} className="flex items-baseline justify-between gap-3 text-[13px]">
              {it.name ? (
                <Link
                  to={`/inventory?wine=${encodeURIComponent(it.name)}`}
                  className="min-w-0 line-clamp-2 leading-snug text-inkm-1 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
                >
                  {it.name}
                  {it.vintage ? <span className="text-inkm-4"> {it.vintage}</span> : null}
                </Link>
              ) : (
                <span className="min-w-0 line-clamp-2 leading-snug text-inkm-1">
                  Unnamed item
                  {it.vintage ? <span className="text-inkm-4"> {it.vintage}</span> : null}
                </span>
              )}
              {it.notCounted ? (
                <span className="shrink-0 text-[12px] text-inkm-4">not counted yet</span>
              ) : (
              <span
                className="shrink-0 text-[12px]"
                style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}
              >
                <span className={it.stock === 0 ? 'text-seal font-semibold' : 'text-inkm-1'}>
                  {read.stock}
                </span>
                {read.stockUnit ? <span className="text-inkm-4">{` ${read.stockUnit}`}</span> : null}
                <span className="text-inkm-4">
                  {' '}/ min {read.min}
                  {read.unit ? ` ${read.unit}` : null}
                </span>
              </span>
              )}
            </li>
            );
          })}
          {sorted.length > 6 && (
            <li className="text-[11px] text-inkm-4">and {sorted.length - 6} more below minimum</li>
          )}
        </ul>
      )}
    </Panel>
  );
}

/* ── Activity tape ──────────────────────────────────────────────────────── */

export function ActivityPanel({ items }: { items: ActivityItem[] | undefined }) {
  return (
    <Panel title="Lately">
      {items === undefined && (
        <div className="space-y-2">
          <div className="dn-skel h-6" aria-hidden />
          <div className="dn-skel h-6 w-3/4" aria-hidden />
        </div>
      )}
      {items != null && items.length === 0 && (
        <EmptyLine>Quiet. Activity lands here as the day moves.</EmptyLine>
      )}
      {items != null && items.length > 0 && (
        <ul className="space-y-1.5">
          {items.slice(0, 8).map((a) => (
            <li key={a.id} className="flex items-baseline justify-between gap-3 text-[13px]">
              {a.entityType === 'procurement_order' && a.entityId ? (
                <Link
                  to={`/orders?order=${a.entityId}`}
                  className="min-w-0 line-clamp-2 leading-snug text-inkm-2 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
                >
                  <span className="text-inkm-1">{a.title}</span>
                  {a.description ? ` — ${a.description}` : ''}
                </Link>
              ) : (
                <span className="min-w-0 line-clamp-2 leading-snug text-inkm-2">
                  <span className="text-inkm-1">{a.title}</span>
                  {a.description ? ` — ${a.description}` : ''}
                </span>
              )}
              <span className="shrink-0 text-[11px] text-inkm-4" style={{ fontFamily: MONO }}>
                {timeAgo(a.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
