/**
 * DayDetail — everything that happened on one calendar day: net sales (for an
 * owner or manager, once a register is connected), money paid to vendors, the
 * deliveries themselves, calendar events, alerts and activity. The day is the
 * HOUSE's day (ADR 0290): timestamps are matched to it in the house's zone.
 * Opens under the month grid inside a settle 0fr→1fr expansion (the
 * founder's named favourite; the wrapper lives in SalesCalendar).
 *
 * "Scrub the day" (sig-d lineage): the tape strip is one bar per day of the
 * month; dragging across it moves the selected day under the needle. It is
 * deliberately un-eased — figures snap per day because the samples ARE
 * per-day; easing between them would fabricate data that does not exist.
 */

import { KeyboardEvent, PointerEvent, ReactNode, useRef } from 'react';
import { Link } from 'react-router-dom';
import { formatNumber } from '@/lib/utils';
import { vendorLine } from '@/lib/mudavym/vendor';
import {
  houseDateOf,
  type ActivityItem,
  type AlertItem,
  type DayLedger,
  type DayOrdersState,
  type MonthSales,
} from './useDashboardNextData';
import { DASH, eventTime, figure, localDateStr, longDay, money, timeAgo } from './format';
import { SERIF } from './fonts';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

/* ── the tape ───────────────────────────────────────────────────────────── */

interface TapeProps {
  daily: DayLedger[];
  selected: string;
  /** The figure each bar draws: net sales when shown, else vendor spend. */
  value: (d: DayLedger) => number | null;
  onScrub: (date: string) => void;
}

function DayTape({ daily, selected, value, onScrub }: TapeProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const max = Math.max(1, ...daily.map((d) => value(d) ?? 0));
  const idx = daily.findIndex((d) => d.date === selected);

  const scrubTo = (clientX: number) => {
    const el = ref.current;
    if (!el || daily.length === 0) return;
    const rect = el.getBoundingClientRect();
    const t = Math.min(0.999, Math.max(0, (clientX - rect.left) / rect.width));
    const i = Math.floor(t * daily.length);
    const d = daily[i];
    if (d && d.date !== selected) onScrub(d.date); // direct, un-eased
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    (e.target as Element).closest('.dn-tape')?.setPointerCapture?.(e.pointerId);
    scrubTo(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons > 0) scrubTo(e.clientX);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (idx < 0) return;
    let next = idx;
    if (e.key === 'ArrowLeft') next = Math.max(0, idx - 1);
    else if (e.key === 'ArrowRight') next = Math.min(daily.length - 1, idx + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = daily.length - 1;
    else return;
    e.preventDefault();
    if (next !== idx) onScrub(daily[next].date);
  };

  return (
    <div
      ref={ref}
      className="dn-tape"
      role="slider"
      tabIndex={0}
      aria-label="Scrub across the days of the month"
      aria-valuemin={1}
      aria-valuemax={daily.length}
      aria-valuenow={idx + 1}
      aria-valuetext={longDay(selected)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      {daily.map((d) => {
        const v = value(d);
        // An unknown day draws as a faint stub, never as a measured bar.
        return (
          <div
            key={d.date}
            className="dn-tape-bar"
            data-on={d.date === selected}
            data-unknown={v == null}
            style={{
              height: `${v == null ? 10 : Math.max(10, Math.round((v / max) * 100))}%`,
              opacity: v == null ? 0.35 : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/* ── section scaffolding ────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-inkm-3">{title}</p>
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-[12px] italic text-inkm-3">{children}</p>;
}

function MiniFig({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p
        className="text-[19px] font-medium leading-tight text-inkm-1"
        style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.015em' }}
      >
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-[0.1em] text-inkm-3">{label}</p>
    </div>
  );
}

/* ── the panel ──────────────────────────────────────────────────────────── */

export interface DayDetailProps {
  day: DayLedger | null; // null only while the panel is closing
  daily: DayLedger[];
  /** The house's zone: null = none set; undefined = an older gateway did not say. */
  zone?: string | null;
  sales?: MonthSales;
  dayOrders: DayOrdersState;
  alerts: AlertItem[] | undefined;
  activity: ActivityItem[] | undefined;
  onScrub: (date: string) => void;
  onClose: () => void;
}

export function DayDetail({
  day,
  daily,
  zone,
  sales,
  dayOrders,
  alerts,
  activity,
  onScrub,
  onClose,
}: DayDetailProps) {
  if (!day) return <div className="min-h-[1px]" />;

  const salesShown = sales === 'shown';
  // Timestamps arrive as UTC ISO strings; the calendar's days are the
  // HOUSE's (ADR 0290). Match in the house's zone, or a 23:00 alert lands on
  // the wrong square. With no zone set nothing can be matched to a day; an
  // older gateway that does not say keeps the browser's zone, as before.
  const onThisDay = (iso: string | undefined) => {
    if (!iso || zone === null) return false;
    if (zone) return houseDateOf(iso, zone) === day.date;
    const t = new Date(iso);
    return !Number.isNaN(t.getTime()) && localDateStr(t) === day.date;
  };
  const dayAlerts = (alerts ?? []).filter((a) => onThisDay(a.createdAt));
  const dayActivity = (activity ?? []).filter((a) => onThisDay(a.timestamp));
  const orderCount = day.order_count ?? 0;
  const noZoneLine = 'Filed by the house’s time zone, which isn’t set.';

  return (
    <div className="border-t border-paper-2 px-4 pb-4 pt-3 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[20px] font-medium text-inkm-1" style={{ fontFamily: SERIF }}>
          {longDay(day.date)}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="dn-ink rounded px-2 py-1 text-[11px] uppercase tracking-[0.1em] text-inkm-3 hover:text-inkm-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
        >
          Close
        </button>
      </div>

      <DayTape
        daily={daily}
        selected={day.date}
        value={(d) => (salesShown ? d.net_sales : d.procurement_spend)}
        onScrub={onScrub}
      />

      {/* Figures snap with the tape head — per-day samples, never interpolated.
          Net sales add up each check's stated subtotal, voided left out
          (AW17); it is before tax and surcharge only where the POS adapter
          sends it so (Square maps net_amounts.total_money, Clover writes
          null; pos-adapters.ts). Vendor money is money out, never sales. */}
      <div
        className={`mt-1 grid grid-cols-2 gap-4 ${salesShown ? 'sm:grid-cols-3 lg:grid-cols-6' : 'sm:grid-cols-4'}`}
      >
        {salesShown && <MiniFig label="Net sales" value={money(day.net_sales)} />}
        {salesShown && <MiniFig label="Checks" value={figure(day.checks)} />}
        <MiniFig label="Paid to vendors" value={money(day.procurement_spend)} />
        <MiniFig label="Deliveries" value={figure(day.order_count)} />
        <MiniFig label="Bottles in" value={figure(day.bottles_sold)} />
        <MiniFig label="On the calendar" value={formatNumber(day.events.length)} />
      </div>
      {sales === 'no-register' && (
        <p className="mt-2 text-[12px] italic text-inkm-3" data-testid="dn-no-register">
          No register connected — net sales show once a register sends its first check.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
        <Section title="Deliveries">
          {dayOrders.state === 'loading' && (
            <>
              <div className="dn-skel h-9" aria-hidden />
              <div className="dn-skel h-9 w-4/5" aria-hidden />
            </>
          )}
          {dayOrders.state === 'unknown' && (
            <EmptyLine>
              {DASH} The order ledger couldn’t be reached; the totals above still stand.
            </EmptyLine>
          )}
          {dayOrders.state === 'no-zone' && (
            <EmptyLine>
              {DASH} {noZoneLine}
            </EmptyLine>
          )}
          {dayOrders.state === 'ready' && dayOrders.orders.length === 0 && (
            <EmptyLine>
              {orderCount > 0
                ? `${orderCount} ${orderCount === 1 ? 'delivery' : 'deliveries'} landed this day — the line items couldn’t be listed here.`
                : 'No deliveries landed this day.'}
            </EmptyLine>
          )}
          {dayOrders.state === 'ready' &&
            dayOrders.orders.map((o) => (
              <Link
                key={o.id}
                to={`/orders?highlight=${o.id}`}
                className="dn-row dn-ink flex items-baseline justify-between gap-3 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
              >
                {/*
                  The vendor clause is REAL again. `GET
                  /procurement/orders/history` joins `providers` on
                  `provider_id` since 2026-09-05; before that this line read
                  `o.providerName` — a key the route had never sent — and
                  printed the literal word "vendor" over every delivery. It goes
                  through `vendorLine` so a name that could not be read prints
                  the words rather than a blank. The two money figures are
                  `finalPrice` / `totalCost`, the DTO's own names; the old
                  `unitPrice` / `totalPrice` made `formatMoney(undefined)` and
                  printed "60 × $0 · $0". `money()` is the em dash for an
                  absent figure.
                */}
                <span className="min-w-0 truncate text-[13px] text-inkm-1">
                  {o.wineName ?? 'Unnamed wine'}
                  <span className="text-inkm-3"> · {vendorLine(o)}</span>
                </span>
                <span
                  className="shrink-0 text-[12px] text-inkm-2"
                  style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatNumber(o.quantity)}
                  {o.unitType ? ` ${o.unitType}` : ''} × {money(o.finalPrice)} ·{' '}
                  <span className="text-inkm-1">{money(o.totalCost)}</span>
                </span>
              </Link>
            ))}
          {dayOrders.state === 'ready' &&
            dayOrders.orders.length > 0 &&
            dayOrders.orders.length < orderCount && (
              <EmptyLine>
                Showing {dayOrders.orders.length} of the day’s {orderCount} deliveries.
              </EmptyLine>
            )}
        </Section>

        <Section title="On the calendar">
          {day.events.length === 0 && <EmptyLine>Nothing was on the calendar.</EmptyLine>}
          {day.events.map((ev, i) => (
            <div key={ev.id ?? i} className="dn-row flex items-baseline justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate text-[13px] text-inkm-1">
                {ev.title ?? 'Untitled event'}
                {ev.event_type ? <span className="text-inkm-3"> · {ev.event_type}</span> : null}
              </span>
              <span className="shrink-0 text-[12px] text-inkm-3" style={{ fontFamily: MONO }}>
                {eventTime(ev.event_time) ?? 'all day'}
              </span>
            </div>
          ))}
        </Section>

        <Section title="Alerts raised">
          {dayAlerts.length === 0 && (
            <EmptyLine>{zone === null ? noZoneLine : 'No alerts carry this date.'}</EmptyLine>
          )}
          {dayAlerts.map((a) => (
            <div key={a.id} className="flex items-baseline gap-2 text-[13px]">
              <span
                className={`mt-0.5 inline-block h-[7px] w-[7px] shrink-0 rounded-full ${a.severity === 'critical' ? 'bg-seal' : 'bg-seal-ring'}`}
                aria-hidden
              />
              <span className="min-w-0 text-inkm-2">
                <span className="text-inkm-1">{a.title}.</span> {a.message}
              </span>
            </div>
          ))}
        </Section>

        <Section title="Activity">
          {dayActivity.length === 0 && (
            <EmptyLine>{zone === null ? noZoneLine : 'No recorded activity for this day.'}</EmptyLine>
          )}
          {dayActivity.map((a) => (
            <div key={a.id} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-inkm-2">
                <span className="text-inkm-1">{a.title}</span>
                {a.description ? ` — ${a.description}` : ''}
              </span>
              <span className="shrink-0 text-[11px] text-inkm-3" style={{ fontFamily: MONO }}>
                {timeAgo(a.timestamp)}
              </span>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}

export default DayDetail;
