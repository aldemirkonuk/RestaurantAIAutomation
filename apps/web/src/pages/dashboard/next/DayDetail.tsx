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
  NOT_RECORDED,
  fromChecks,
  houseDateOf,
  type ActivityItem,
  type AlertItem,
  type DayLedger,
  type DayOrdersState,
  type MonthSales,
} from './useDashboardNextData';
import { DASH, dateIn, eventKindWords, eventTime, figure, longDay, money, timeAgo } from './format';
import { SERIF } from './fonts';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

/* ── the tape ───────────────────────────────────────────────────────────── */

interface TapeProps {
  daily: DayLedger[];
  selected: string;
  /**
   * The figure each bar draws: net sales when shown, else vendor spend — or
   * deliveries for a role that sees no money (DASH-W22).
   */
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
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-inkm-4">{title}</p>
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-[12px] italic text-inkm-4">{children}</p>;
}

function MiniFig({ label, value, note }: { label: string; value: string; note?: string | null }) {
  // "not recorded" is words, not a figure: the text face, smaller, muted.
  const words = value === NOT_RECORDED;
  return (
    <div>
      <p
        className={
          words
            ? 'text-[14px] italic leading-tight text-inkm-4'
            : 'text-[19px] font-medium leading-tight text-inkm-1'
        }
        style={words ? undefined : { fontFamily: MONO, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.015em' }}
      >
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-[0.1em] text-inkm-4">{label}</p>
      {note && <p className="text-[11px] text-inkm-4">{note}</p>}
    </div>
  );
}

/**
 * The day's net sales, counted and said (netsales F1, "Count and say"): the
 * subtotals the checks carried, "not recorded" when checks came and none
 * carried one, the dash when the day is not known.
 */
function netSalesValue(day: DayLedger): string {
  if (day.checks != null && day.checks > 0 && day.net_sales == null) return NOT_RECORDED;
  return money(day.net_sales);
}

/*
 * The panel's grids are sized by the PANEL, never the viewport (ADR 0290 §9).
 * Inside the app shell the panel is about 282 px wide at a 1280 px window (the
 * rooms rail and the open counter take 552 px), so the viewport's
 * `lg:grid-cols-6` gave each figure 34 px and "$39,302.5" ran into its
 * neighbours. A track never narrows below what its content needs; the `- 1px`
 * keeps sub-pixel rounding from dropping a column.
 */

/**
 * The figure row: a track is never narrower than 8rem (an eleven-character
 * figure at 19 px), and a row holds at most half the figures, so six read
 * 3 + 3 or 2 + 2 + 2 and four read 2 + 2 — never a lone figure on a row.
 */
export function figureColumns(count: number): string {
  const most = Math.max(1, Math.ceil(count / 2));
  return `repeat(auto-fill, minmax(max(8rem, calc((100% - ${most - 1}rem) / ${most} - 1px)), 1fr))`;
}

/** The four lists below: side by side only where each gets 16rem. */
export const SECTION_COLUMNS = 'repeat(auto-fill, minmax(max(16rem, calc((100% - 1.25rem) / 2 - 1px)), 1fr))';

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
  /** DASH-W22: false for a role that sees counts, not money (staff). */
  seesAmounts?: boolean;
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
  seesAmounts = true,
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
    return !Number.isNaN(t.getTime()) && dateIn(t, zone) === day.date;
  };
  const dayAlerts = (alerts ?? []).filter((a) => onThisDay(a.createdAt));
  const dayActivity = (activity ?? []).filter((a) => onThisDay(a.timestamp));
  // DASH-W13 (founder, 2026-10-01): a future day opens only when something is
  // on the calendar, and it shows only that — its money, deliveries, alerts
  // and activity do not exist yet.
  const isFuture = day.date > dateIn(new Date(), zone);

  const calendarSection = (
    <Section title="On the calendar">
      {day.events.length === 0 && <EmptyLine>Nothing was on the calendar.</EmptyLine>}
      {day.events.map((ev, i) => (
        <div key={ev.id ?? i} className="dn-row flex items-baseline justify-between gap-3 px-3 py-2">
          {/* DASH-W30/W32: wraps instead of cutting; the kind in words, never a code. */}
          <span className="min-w-0 break-words leading-snug text-[13px] text-inkm-1">
            {ev.title ?? 'Untitled event'}
            {eventKindWords(ev.event_type) ? <span className="text-inkm-4"> · {eventKindWords(ev.event_type)}</span> : null}
          </span>
          <span className="shrink-0 text-[12px] text-inkm-4" style={{ fontFamily: MONO }}>
            {eventTime(ev.event_time) ?? 'all day'}
          </span>
        </div>
      ))}
    </Section>
  );

  if (isFuture) {
    return (
      <div className="border-t border-paper-2 px-4 pb-4 pt-3 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[20px] font-medium text-inkm-1" style={{ fontFamily: SERIF }}>
            {longDay(day.date)}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="dn-ink rounded px-2 py-1 text-[11px] uppercase tracking-[0.1em] text-inkm-4 hover:text-inkm-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
          >
            Close
          </button>
        </div>
        <div className="mt-3">{calendarSection}</div>
      </div>
    );
  }

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
          className="dn-ink rounded px-2 py-1 text-[11px] uppercase tracking-[0.1em] text-inkm-4 hover:text-inkm-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
        >
          Close
        </button>
      </div>

      <DayTape
        daily={daily}
        selected={day.date}
        // DASH-W22: a role that sees no money measures deliveries, not spend.
        value={(d) => (salesShown ? d.net_sales : seesAmounts ? d.procurement_spend : d.order_count)}
        onScrub={onScrub}
      />

      {/* Figures snap with the tape head — per-day samples, never interpolated.
          Net sales add up the subtotals the checks carried, voided left out
          (AW17), and say "from N of M checks" when some carried none
          (netsales F1); it is before tax and surcharge only where the POS
          adapter sends it so (Square maps net_amounts.total_money, Clover writes
          null; pos-adapters.ts). Vendor money is money out, never sales. */}
      <div
        className="mt-1 grid gap-4"
        data-testid="dn-day-figures"
        // Without money (DASH-W22) three figures remain; they lay out as four
        // do, at most two across.
        style={{ gridTemplateColumns: figureColumns(salesShown ? 6 : 4) }}
      >
        {salesShown && (
          <MiniFig label="Net sales" value={netSalesValue(day)} note={fromChecks(day.net_checks, day.checks)} />
        )}
        {salesShown && <MiniFig label="Checks" value={figure(day.checks)} />}
        {seesAmounts && <MiniFig label="Paid to vendors" value={money(day.procurement_spend)} />}
        <MiniFig label="Deliveries" value={figure(day.order_count)} />
        <MiniFig label="Bottles in" value={figure(day.bottles_sold)} />
        <MiniFig label="On the calendar" value={formatNumber(day.events.length)} />
      </div>
      {sales === 'no-register' && (
        <p className="mt-2 text-[12px] italic text-inkm-4" data-testid="dn-no-register">
          No register connected — net sales show once a register sends its first check.
        </p>
      )}

      {/*
        DASH-W30 (P7): two columns only when the card itself has room. A
        viewport breakpoint split it at 1024 too, where the calendar card is
        a narrow column and each half was ~110px.
      */}
      <div className="mt-4 grid gap-5" data-testid="dn-day-sections" style={{ gridTemplateColumns: SECTION_COLUMNS }}>
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
                to={`/orders?order=${o.id}`}
                className="dn-row dn-ink flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
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
                {/*
                  DASH-W30 (P7): the name and vendor wrap instead of losing the
                  vendor; in a narrow column the figures drop to their own line
                  rather than squeezing the name to a letter a line.
                */}
                <span className="min-w-0 break-words leading-snug text-[13px] text-inkm-1">
                  {o.wineName ?? 'Unnamed item'}
                  <span className="text-inkm-4"> · {vendorLine(o)}</span>
                </span>
                <span
                  className="ml-auto shrink-0 text-[12px] text-inkm-2"
                  style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatNumber(o.quantity)}
                  {o.unitType ? ` ${o.unitType}` : ''}
                  {seesAmounts && (
                    <>
                      {' '}× {money(o.finalPrice)} ·{' '}
                      <span className="text-inkm-1">{money(o.totalCost)}</span>
                    </>
                  )}
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

        {calendarSection}

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
              {/* DASH-W31 (P7): two lines, then an ellipsis — not one line cut mid-word. */}
              <span className="min-w-0 line-clamp-2 leading-snug text-inkm-2">
                <span className="text-inkm-1">{a.title}</span>
                {a.description ? ` — ${a.description}` : ''}
              </span>
              <span className="shrink-0 text-[11px] text-inkm-4" style={{ fontFamily: MONO }}>
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
