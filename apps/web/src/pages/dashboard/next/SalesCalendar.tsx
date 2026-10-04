/**
 * SalesCalendar — the headline of the page (founder: "an important thing for
 * me"). A TradeZella-style month grid where each day carries its own result,
 * and clicking a day opens everything that happened on it (DayDetail, inside
 * the settle 0fr→1fr expansion).
 *
 * Honesty rules encoded here (ADR 0290):
 *  - Days are the HOUSE's days. "Today" and "future" come from the gateway's
 *    `today` (the house's clock), not the browser's; the browser date is a
 *    fallback only for a gateway older than ADR 0290.
 *  - With net sales shown (an owner or manager, a register connected), each
 *    cell headlines the day's NET sales — check subtotals before tax and
 *    surcharge, voided left out — and is shaded by them; the delivery mark
 *    stays. Otherwise the cell carries money paid to vendors, labelled so.
 *    The cell layout is fork F2 in ADR 0290, built on its recommendation.
 *  - A quiet day is a quiet blank ('·'), not "$0 of results"; an unknown day
 *    is the em dash; a FUTURE day carries no figure at all.
 *  - A house with no time zone gets em dashes and one line saying so, with
 *    the way to set it (DASH-G2) — never a UTC guess.
 *  - When the endpoint is unreachable the grid keeps its day numbers and the
 *    figures are skeletons/em dashes — never fabricated zeros.
 *
 * Motion: cells arrive staggered on each month's first paint (ent-01
 * lineage: clip wipe + 6px rise on the settle curve, decaying interval).
 * All of it collapses under prefers-reduced-motion via lib/mudavym.animate.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { animate, settle } from '@/lib/mudavym';
import type { ActivityItem, AlertItem } from './useDashboardNextData';
import { useDayOrders, useMonthLedger, type DayLedger } from './useDashboardNextData';
import { DASH, figure, localDateStr, money, monthName } from './format';
import { SERIF } from './fonts';
import DayDetail from './DayDetail';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface SalesCalendarProps {
  restaurantId: string | null;
  alerts: AlertItem[] | undefined;
  activity: ActivityItem[] | undefined;
}

const MONO_FIG = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums' } as const;

/** What a cell says. `salesShown` picks the headline (F2, ADR 0290). */
function cellFigure(day: DayLedger | undefined, salesShown: boolean, zoneUnset: boolean): string {
  if (!day || zoneUnset) return DASH;
  if (salesShown) {
    if (day.checks === 0) return '·';
    return day.net_sales == null ? DASH : money(day.net_sales, 'compact');
  }
  if (day.procurement_spend == null) return DASH;
  return day.procurement_spend > 0 ? money(day.procurement_spend, 'compact') : '·';
}

function cellLabel(dateStr: string, day: DayLedger | undefined, salesShown: boolean, zoneUnset: boolean): string {
  if (!day) return dateStr;
  const parts: string[] = [];
  if (zoneUnset) parts.push('figures unknown, the house time zone is not set');
  else {
    if (salesShown) {
      parts.push(day.checks === 0 ? 'no sales' : `net sales ${money(day.net_sales)}`);
    }
    parts.push(
      day.procurement_spend == null
        ? 'paid to vendors unknown'
        : day.procurement_spend > 0
          ? `paid to vendors ${money(day.procurement_spend)}`
          : 'no deliveries',
    );
  }
  parts.push(`${day.events.length} events`);
  return `${dateStr}: ${parts.join(', ')}`;
}

export function SalesCalendar({ restaurantId, alerts, activity }: SalesCalendarProps) {
  const now = new Date();
  const browserToday = localDateStr(now);
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const { month } = useMonthLedger(restaurantId, cursor.year, cursor.month);
  const ledger = month.state === 'ready' ? month.ledger : null;
  const dayOrders = useDayOrders(restaurantId, selected, ledger?.timezone);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // The house's today, once the gateway has said it: a string, null (no zone),
  // or undefined (not said yet / an older gateway). Kept across months.
  const [houseToday, setHouseToday] = useState<string | null | undefined>(undefined);
  const landed = useRef(false);
  useEffect(() => {
    if (!ledger || ledger.today === undefined) return;
    setHouseToday(ledger.today);
    // Open on the house's month, once, unless the reader has already moved.
    if (!landed.current && ledger.today) {
      const [y, m] = ledger.today.split('-').map(Number);
      if (y !== cursor.year || m !== cursor.month) setCursor({ year: y, month: m });
    }
    landed.current = true;
  }, [ledger, cursor.year, cursor.month]);

  // Which days are past is the house's call; with no zone the browser date
  // only greys out the future (every figure is a dash anyway). The today mark
  // is drawn only when the house has a today.
  const futureFrom = houseToday ?? browserToday;
  const todayMark = houseToday === undefined ? browserToday : houseToday;
  const monthKey = `${cursor.year}-${cursor.month}`;
  const [todayY, todayM] = futureFrom.split('-').map(Number);
  const isCurrentMonth = cursor.year === todayY && cursor.month === todayM;

  const daily: DayLedger[] = useMemo(() => ledger?.daily ?? [], [ledger]);
  const salesShown = ledger?.sales === 'shown';
  const zoneUnset = ledger?.zoneUnset === true;
  const headline = (d: DayLedger | undefined): number | null =>
    d ? (salesShown ? d.net_sales : d.procurement_spend) : null;
  const maxHead = useMemo(
    () => Math.max(1, ...daily.map((d) => (salesShown ? d.net_sales : d.procurement_spend) ?? 0)),
    [daily, salesShown],
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
    landed.current = true;
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
      aria-label={salesShown ? 'Sales calendar — net sales per day' : 'Month calendar — paid to vendors per day'}
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
                onClick={() => { landed.current = true; setSelected(null); setCursor({ year: todayY, month: todayM }); }}
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
        <p className="text-[12px] text-inkm-3" data-testid="dn-month-totals">
          {salesShown && (
            <>
              net sales{' '}
              <span className="text-inkm-1" style={MONO_FIG}>
                {money(ledger?.monthlyNetSales)}
              </span>
              {' · '}
            </>
          )}
          paid to vendors{' '}
          <span className="text-inkm-1" style={MONO_FIG}>
            {money(ledger?.monthlySpend)}
          </span>
          {' · '}
          <span className="text-inkm-1" style={MONO_FIG}>
            {figure(ledger?.monthlyBottles)}
          </span>{' '}
          bottles in
        </p>
      </div>

      {zoneUnset && (
        <p className="px-4 pt-2 text-[12px] italic text-inkm-3 sm:px-5" data-testid="dn-zone-unset">
          {DASH} This house’s time zone isn’t set, so no day’s figures can be filed yet.{' '}
          <Link
            to="/settings?tab=time-zone"
            className="not-italic text-inkm-1 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
          >
            Set the time zone
          </Link>
        </p>
      )}

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
          const isFuture = dateStr > futureFrom;
          const isToday = todayMark !== null && dateStr === todayMark;
          const head = zoneUnset ? null : headline(day);
          const heat = head != null && head > 0 ? 0.06 + 0.3 * (head / maxHead) : 0;
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
              aria-label={cellLabel(dateStr, day, salesShown, zoneUnset)}
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
                {day && day.order_count != null && day.order_count > 0 && (
                  <span className="text-[9px] text-inkm-3" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {day.order_count} {day.order_count === 1 ? 'order' : 'orders'}
                  </span>
                )}
              </span>
              {month.state === 'loading' && !isFuture ? (
                <span className="dn-skel h-3 w-8" aria-hidden />
              ) : (
                <span className="dn-cell-fig">
                  {isFuture ? '' : cellFigure(day, salesShown, zoneUnset)}
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
            zone={ledger?.timezone}
            sales={ledger?.sales}
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
