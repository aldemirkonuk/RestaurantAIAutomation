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
import { DASH, localDateStr, parseDateStr, timeAgo } from './format';

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
  return <p className="text-[12px] italic text-inkm-3">{children}</p>;
}

/* ── This week ──────────────────────────────────────────────────────────── */

export function WeekAhead({ restaurantId }: { restaurantId: string | null }) {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 6);
  const query = useCalendarEvents(restaurantId ?? '', {
    startDate: localDateStr(today),
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
          className="text-[11px] uppercase tracking-[0.1em] text-inkm-3 underline-offset-2 hover:text-inkm-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
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
        <EmptyLine>{DASH} The calendar couldn’t be reached just now.</EmptyLine>
      )}
      {!query.isLoading && !query.isError && events.length === 0 && (
        <EmptyLine>Nothing on the calendar this week.</EmptyLine>
      )}
      {!query.isLoading && events.length > 0 && (
        <ul className="space-y-1.5">
          {events.slice(0, 6).map((ev) => (
            <li key={ev.id} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-inkm-1">
                {ev.title}
                <span className="text-inkm-3"> · {ev.type}</span>
              </span>
              <span className="shrink-0 text-[11px] text-inkm-3" style={{ fontFamily: MONO }}>
                {parseDateStr(ev.date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                {ev.allDay || !ev.startTime ? '' : ` ${ev.startTime.slice(0, 5)}`}
              </span>
            </li>
          ))}
          {events.length > 6 && (
            <li className="text-[11px] text-inkm-3">and {events.length - 6} more this week</li>
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
 * Normalize both so the panel never shows "Unnamed wine" for a named one.
 */
interface RawLowStockFields {
  wine_name?: string | null;
  stock_live?: number;
  threshold_min?: number;
  vintage?: number | null;
}

function lowStockView(it: InventoryItem) {
  const raw = it as InventoryItem & RawLowStockFields;
  return {
    id: it.id,
    name: it.wineName ?? raw.wine_name ?? null,
    vintage: it.wineVintage ?? raw.vintage ?? null,
    stock: it.stockLive ?? raw.stock_live ?? null,
    min: it.thresholdMin ?? raw.threshold_min ?? null,
  };
}

export function LowStockPanel({ items }: { items: InventoryItem[] | null | undefined }) {
  const sorted = (items ?? [])
    .map(lowStockView)
    .sort((a, b) => (a.stock ?? 0) - (a.min ?? 0) - ((b.stock ?? 0) - (b.min ?? 0)));

  return (
    <Panel
      title="Running low"
      action={
        <Link
          to="/inventory"
          className="text-[11px] uppercase tracking-[0.1em] text-inkm-3 underline-offset-2 hover:text-inkm-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
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
        <EmptyLine>{DASH} Stock levels couldn’t be reached just now.</EmptyLine>
      )}
      {items != null && items.length === 0 && (
        <EmptyLine>Nothing is running low. The cellar holds.</EmptyLine>
      )}
      {items != null && sorted.length > 0 && (
        <ul className="space-y-1.5">
          {sorted.slice(0, 6).map((it) => (
            <li key={it.id} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-inkm-1">
                {it.name ?? 'Unnamed wine'}
                {it.vintage ? <span className="text-inkm-3"> {it.vintage}</span> : null}
              </span>
              <span
                className="shrink-0 text-[12px]"
                style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}
              >
                <span className={it.stock === 0 ? 'text-seal font-semibold' : 'text-inkm-1'}>
                  {it.stock == null ? DASH : formatNumber(it.stock)}
                </span>
                <span className="text-inkm-3"> / min {it.min == null ? DASH : formatNumber(it.min)}</span>
              </span>
            </li>
          ))}
          {sorted.length > 6 && (
            <li className="text-[11px] text-inkm-3">and {sorted.length - 6} more below minimum</li>
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
              <span className="min-w-0 truncate text-inkm-2">
                <span className="text-inkm-1">{a.title}</span>
                {a.description ? ` — ${a.description}` : ''}
              </span>
              <span className="shrink-0 text-[11px] text-inkm-3" style={{ fontFamily: MONO }}>
                {timeAgo(a.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
