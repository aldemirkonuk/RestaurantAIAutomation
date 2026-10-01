/**
 * SalesCalendar — the headline of the page (founder: "an important thing for
 * me"). A TradeZella-style month grid where each day carries its own result,
 * and clicking a day opens everything that happened on it (DayDetail, inside
 * the settle 0fr→1fr expansion).
 *
 * Honesty rules encoded here:
 *  - The per-day figure is procurement SPEND — money paid to vendors — from
 *    the frozen `calendar-revenue` endpoint. The header says so; nothing on
 *    this surface is labelled "sales" or "revenue".
 *  - A past day with no deliveries is a quiet blank, not "$0 of results";
 *    a FUTURE day carries no figure at all (its result does not exist yet).
 *  - When the endpoint is unreachable the grid keeps its day numbers and the
 *    figures are skeletons/em dashes — never fabricated zeros.
 *
 * Motion: cells arrive staggered on each month's first paint (ent-01
 * lineage: clip wipe + 6px rise on the settle curve, decaying interval).
 * All of it collapses under prefers-reduced-motion via lib/mudavym.animate.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { animate, settle } from '@/lib/mudavym';
import { formatMoney, formatNumber } from '@/lib/utils';
import type { ActivityItem, AlertItem } from './useDashboardNextData';
import { useDayOrders, useMonthLedger, type DayLedger } from './useDashboardNextData';
import { DASH, dateIn, longDay, monthName } from './format';
import { SERIF } from './fonts';
import DayDetail from './DayDetail';
import { TryAgain } from './TryAgain';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const MONTH_PARAM = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_PARAM = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * DASH-W29 (P7; ADR 0160, "the URL holds it"): the month on show and the day
 * opened live in the address — `?month=YYYY-MM` (absent for the house's
 * current month) and `?day=YYYY-MM-DD` — so a reload, a shared link or a
 * phone coming back to the tab lands on the same day. A day names its own
 * month; anything malformed is ignored rather than guessed at.
 *
 * DASH-W36: not exported — a component file that also exports a plain
 * function cannot be Fast Refreshed, so every save reloaded the page.
 */
function readCalendarParams(params: URLSearchParams): {
  month: { year: number; month: number } | null;
  day: string | null;
} {
  const d = params.get('day');
  const day = d && DAY_PARAM.test(d) ? d : null;
  if (day) return { month: { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) }, day };
  const m = MONTH_PARAM.exec(params.get('month') ?? '');
  return { month: m ? { year: Number(m[1]), month: Number(m[2]) } : null, day: null };
}

export interface SalesCalendarProps {
  restaurantId: string | null;
  alerts: AlertItem[] | undefined;
  activity: ActivityItem[] | undefined;
  /** DASH-W20: the house's IANA zone; null until the stats answer. */
  zone?: string | null;
  /**
   * DASH-W22 (founder, 2026-10-01, "A: hide amounts for staff"): false for a
   * role that sees counts, not money. The squares then carry deliveries and
   * their shade measures deliveries; no dollar figure is drawn.
   */
  seesAmounts?: boolean;
}

export function SalesCalendar({ restaurantId, alerts, activity, zone = null, seesAmounts: mayShow = true }: SalesCalendarProps) {
  const now = new Date();
  // DASH-W20: today is the house's, the clock the ledger is bucketed in.
  const todayStr = dateIn(now, zone);
  const [todayYear, todayMonth] = todayStr.split('-').map(Number);
  const [params, setParams] = useSearchParams();
  const fromUrl = readCalendarParams(params);
  // With no month in the address the grid follows the house's today, so a
  // zone that lands a beat after the first paint still opens the right month.
  const cursor = fromUrl.month ?? { year: todayYear, month: todayMonth };
  const selected = fromUrl.day;
  // Replace, not push: paging months or opening days does not stack history.
  const show = (month: { year: number; month: number } | null, day: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (day || !month || (month.year === todayYear && month.month === todayMonth)) next.delete('month');
        else next.set('month', `${month.year}-${String(month.month).padStart(2, '0')}`);
        if (day) next.set('day', day);
        else next.delete('day');
        return next;
      },
      { replace: true },
    );
  const { month, refetch: refetchMonth } = useMonthLedger(restaurantId, cursor.year, cursor.month);
  // A future day has no deliveries to list; don't ask the ledger for them.
  const dayOrders = useDayOrders(restaurantId, selected && selected <= todayStr ? selected : null, zone);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const monthKey = `${cursor.year}-${cursor.month}`;
  const isCurrentMonth = cursor.year === todayYear && cursor.month === todayMonth;

  const daily: DayLedger[] = month.state === 'ready' ? month.ledger.daily : [];
  // A month the gateway sent without its money reads as counts even if the
  // caller's role was expected to see it: a withheld figure is never a $0.
  const seesAmounts = mayShow && !(month.state === 'ready' && month.ledger.amounts === 'withheld');
  const measure = (d: DayLedger) => (seesAmounts ? d.procurement_spend : d.order_count);
  const maxSpend = useMemo(
    () => Math.max(1, ...daily.map((d) => (seesAmounts ? d.procurement_spend : d.order_count))),
    [daily, seesAmounts],
  );

  // Monday-first leading blanks.
  const firstWeekday = (new Date(cursor.year, cursor.month - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.year, cursor.month, 0).getDate();

  const selectedDay = selected ? daily.find((d) => d.date === selected) ?? null : null;

  /* Staggered arrival — once per month load, on the real cells. */
  useEffect(() => {
    if (month.state !== 'ready' || !gridRef.current) return;
    const cells = gridRef.current.querySelectorAll<HTMLElement>('.dn-cell:not([data-blank="true"])');
    let delay = 0;
    let gap = 16;
    cells.forEach((cell) => {
      animate(
        cell,
        [
          { opacity: 0, transform: 'translateY(6px)', clipPath: 'inset(0 100% 0 0)' },
          { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' },
        ],
        { easing: settle.easing, ms: 420 },
        { delay },
      );
      delay += gap;
      gap *= 0.94; // decaying interval — deliberate head, tail keeps up
    });
  }, [month.state, monthKey]);

  const nav = (delta: number) => {
    const d = new Date(cursor.year, cursor.month - 1 + delta, 1);
    show({ year: d.getFullYear(), month: d.getMonth() + 1 }, null);
  };

  const pick = (date: string) => show(cursor, selected === date ? null : date);

  return (
    <section
      className="rounded-lg border border-paper-2 bg-paper-0"
      aria-label="Sales calendar — one result per day"
    >
      {/* header */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 sm:px-5">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[22px] font-medium text-inkm-1" style={{ fontFamily: SERIF }}>
            {monthName(cursor.month)}{' '}
            <span className="text-inkm-4">{cursor.year}</span>
          </h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => nav(-1)} aria-label="Previous month"
              className="dn-ink rounded px-2 py-0.5 text-inkm-4 hover:bg-paper-1 hover:text-inkm-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal">
              ‹
            </button>
            {!isCurrentMonth && (
              <button type="button"
                onClick={() => show(null, null)}
                className="dn-ink rounded px-2 py-0.5 text-[11px] uppercase tracking-[0.1em] text-inkm-4 hover:bg-paper-1 hover:text-inkm-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal">
                Today
              </button>
            )}
            <button type="button" onClick={() => nav(1)} aria-label="Next month"
              className="dn-ink rounded px-2 py-0.5 text-inkm-4 hover:bg-paper-1 hover:text-inkm-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal">
              ›
            </button>
          </div>
        </div>
        <p className="text-[12px] text-inkm-4">
          {seesAmounts && (
            <>
              paid to vendors{' '}
              <span
                className="text-inkm-1"
                style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums' }}
              >
                {month.state === 'ready' ? formatMoney(month.ledger.monthlySpend, 'full') : DASH}
              </span>
              {' · '}
            </>
          )}
          <span
            className="text-inkm-1"
            style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums' }}
          >
            {month.state === 'ready' ? formatNumber(month.ledger.monthlyBottles) : DASH}
          </span>{' '}
          {month.state === 'ready' && month.ledger.monthlyBottles === 1 ? 'bottle' : 'bottles'} in
        </p>
      </div>

      {/* weekday header */}
      <div className="dn-cal-grid px-4 pt-3 sm:px-5" aria-hidden>
        {WEEKDAYS.map((w) => (
          <p key={w} className="pb-1 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-inkm-4">
            {w}
          </p>
        ))}
      </div>

      {/* the grid */}
      <div ref={gridRef} className="dn-cal-grid px-4 pb-4 sm:px-5">
        {Array.from({ length: firstWeekday }, (_, i) => (
          <div key={`b${i}`} className="dn-cell" data-blank="true" aria-hidden />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const dayNum = i + 1;
          const dateStr = `${cursor.year}-${String(cursor.month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
          const day = daily.find((d) => d.date === dateStr);
          const isFuture = dateStr > todayStr;
          const isToday = dateStr === todayStr;
          const spend = day?.procurement_spend ?? 0;
          const weight = day ? measure(day) : 0;
          const heat = day && weight > 0 ? 0.06 + 0.3 * (weight / maxSpend) : 0;
          return (
            <button
              key={dateStr}
              type="button"
              className="dn-cell dn-ink"
              data-date={dateStr}
              data-selected={selected === dateStr}
              data-today={isToday}
              data-past={dateStr < todayStr}
              data-future={isFuture}
              disabled={isFuture && !(day && day.events.length > 0)}
              onClick={() => pick(dateStr)}
              // DASH-W35: the square is named in words — the day, then what it
              // holds — and says which day is open and which is today.
              aria-pressed={selected === dateStr}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${longDay(dateStr)}${isToday ? ', today' : ''}${
                day
                  ? `: ${
                      seesAmounts
                        ? spend > 0
                          ? `${formatMoney(spend, 'full')} paid to vendors`
                          : 'no deliveries'
                        : day.order_count > 0
                          ? `${day.order_count} ${day.order_count === 1 ? 'delivery' : 'deliveries'}`
                          : 'no deliveries'
                    }, ${
                      day.events.length === 0
                        ? 'nothing on the calendar'
                        : `${day.events.length} on the calendar`
                    }`
                  : ''
              }`}
              // color-mix keeps the heat on the seal TOKEN, so both grounds
              // (İznik on paper, lifted teal on charcoal) resolve correctly;
              // browsers without color-mix quietly keep the paper-1 ground.
              style={
                heat > 0
                  ? { backgroundColor: `color-mix(in srgb, var(--seal) ${Math.round(heat * 100)}%, transparent)` }
                  : undefined
              }
            >
              <span className="dn-cell-num">{dayNum}</span>
              <span className="dn-cell-marks">
                {day && day.events.length > 0 && <span className="dn-dot" aria-hidden />}
                {day && day.order_count > 0 && (
                  <span className="text-[9px] text-inkm-4" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {day.order_count} {day.order_count === 1 ? 'order' : 'orders'}
                  </span>
                )}
              </span>
              {month.state === 'loading' && !isFuture ? (
                <span className="dn-skel h-3 w-8" aria-hidden />
              ) : (
                <span className="dn-cell-fig">
                  {isFuture
                    ? ''
                    : day
                      ? seesAmounts
                        ? spend > 0
                          ? formatMoney(spend, 'compact')
                          : '·'
                        : day.order_count > 0
                          ? ''
                          : '·'
                      : DASH}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {month.state === 'unknown' && (
        <p className="px-4 pb-4 text-[12px] italic text-inkm-4 sm:px-5">
          {DASH} This month’s ledger couldn’t be reached. The days keep their places.
          <TryAgain onRetry={refetchMonth} />
        </p>
      )}

      {/* settle 0fr→1fr — the founder's favourite — around the day panel */}
      <div className="dn-expand" data-open={!!selectedDay}>
        <div>
          <DayDetail
            day={selectedDay}
            daily={daily}
            dayOrders={dayOrders}
            zone={zone}
            seesAmounts={seesAmounts}
            alerts={alerts}
            activity={activity}
            onScrub={(d) => show(cursor, d)}
            onClose={() => {
              const closing = selected;
              show(cursor, null);
              // DASH-W34: hand focus back to the square that opened the panel,
              // so a keyboard isn't sent back to the top of the page.
              if (closing) gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${closing}"]`)?.focus();
            }}
          />
        </div>
      </div>
    </section>
  );
}

export default SalesCalendar;
