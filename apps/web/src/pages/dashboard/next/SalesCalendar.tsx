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

import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, settle } from '@/lib/mudavym';
import { formatMoney, formatNumber } from '@/lib/utils';
import type { ActivityItem, AlertItem } from './useDashboardNextData';
import { useDayOrders, useMonthLedger, type DayLedger } from './useDashboardNextData';
import { DASH, localDateStr, monthName } from './format';
import { SERIF } from './fonts';
import DayDetail from './DayDetail';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface SalesCalendarProps {
  restaurantId: string | null;
  alerts: AlertItem[] | undefined;
  activity: ActivityItem[] | undefined;
}

export function SalesCalendar({ restaurantId, alerts, activity }: SalesCalendarProps) {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const { month } = useMonthLedger(restaurantId, cursor.year, cursor.month);
  const dayOrders = useDayOrders(restaurantId, selected);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const todayStr = localDateStr(now);
  const monthKey = `${cursor.year}-${cursor.month}`;
  const isCurrentMonth = cursor.year === now.getFullYear() && cursor.month === now.getMonth() + 1;

  const daily: DayLedger[] = month.state === 'ready' ? month.ledger.daily : [];
  const maxSpend = useMemo(
    () => Math.max(1, ...daily.map((d) => d.procurement_spend)),
    [daily],
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
    setSelected(null);
    setCursor((c) => {
      const d = new Date(c.year, c.month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  };

  const pick = (date: string) => setSelected((cur) => (cur === date ? null : date));

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
            <span className="text-inkm-3">{cursor.year}</span>
          </h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => nav(-1)} aria-label="Previous month"
              className="dn-ink rounded px-2 py-0.5 text-inkm-3 hover:bg-paper-1 hover:text-inkm-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal">
              ‹
            </button>
            {!isCurrentMonth && (
              <button type="button"
                onClick={() => { setSelected(null); setCursor({ year: now.getFullYear(), month: now.getMonth() + 1 }); }}
                className="dn-ink rounded px-2 py-0.5 text-[11px] uppercase tracking-[0.1em] text-inkm-3 hover:bg-paper-1 hover:text-inkm-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal">
                Today
              </button>
            )}
            <button type="button" onClick={() => nav(1)} aria-label="Next month"
              className="dn-ink rounded px-2 py-0.5 text-inkm-3 hover:bg-paper-1 hover:text-inkm-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal">
              ›
            </button>
          </div>
        </div>
        <p className="text-[12px] text-inkm-3">
          paid to vendors{' '}
          <span
            className="text-inkm-1"
            style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums' }}
          >
            {month.state === 'ready' ? formatMoney(month.ledger.monthlySpend, 'full') : DASH}
          </span>
          {' · '}
          <span
            className="text-inkm-1"
            style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums' }}
          >
            {month.state === 'ready' ? formatNumber(month.ledger.monthlyBottles) : DASH}
          </span>{' '}
          bottles in
        </p>
      </div>

      {/* weekday header */}
      <div className="dn-cal-grid px-4 pt-3 sm:px-5" aria-hidden>
        {WEEKDAYS.map((w) => (
          <p key={w} className="pb-1 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-inkm-3">
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
          const heat = day && spend > 0 ? 0.06 + 0.3 * (spend / maxSpend) : 0;
          return (
            <button
              key={dateStr}
              type="button"
              className="dn-cell dn-ink"
              data-selected={selected === dateStr}
              data-today={isToday}
              data-future={isFuture}
              disabled={isFuture}
              onClick={() => pick(dateStr)}
              aria-label={
                day
                  ? `${dateStr}: ${spend > 0 ? formatMoney(spend, 'full') : 'no deliveries'}, ${day.events.length} events`
                  : dateStr
              }
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
                  <span className="text-[9px] text-inkm-3" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {day.order_count} {day.order_count === 1 ? 'order' : 'orders'}
                  </span>
                )}
              </span>
              {month.state === 'loading' && !isFuture ? (
                <span className="dn-skel h-3 w-8" aria-hidden />
              ) : (
                <span className="dn-cell-fig">
                  {isFuture ? '' : day ? (spend > 0 ? formatMoney(spend, 'compact') : '·') : DASH}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {month.state === 'unknown' && (
        <p className="px-4 pb-4 text-[12px] italic text-inkm-3 sm:px-5">
          {DASH} This month’s ledger couldn’t be reached. The days keep their places; figures will
          land when the connection returns.
        </p>
      )}

      {/* settle 0fr→1fr — the founder's favourite — around the day panel */}
      <div className="dn-expand" data-open={!!selectedDay}>
        <div>
          <DayDetail
            day={selectedDay}
            daily={daily}
            dayOrders={dayOrders}
            alerts={alerts}
            activity={activity}
            onScrub={(d) => setSelected(d)}
            onClose={() => setSelected(null)}
          />
        </div>
      </div>
    </section>
  );
}

export default SalesCalendar;
