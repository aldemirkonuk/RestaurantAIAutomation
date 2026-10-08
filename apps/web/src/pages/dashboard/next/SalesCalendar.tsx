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
 *    cell headlines the day's NET sales — the checks' stated subtotals,
 *    voided left out (before tax and surcharge where the POS adapter sends
 *    it so; ADR 0290 §8) — and is shaded by them; the delivery mark
 *    stays. Otherwise the cell carries money paid to vendors, labelled so.
 *    The cell is the founder's F2, "Sales in the cell (Recommended)".
 *  - Count and say (netsales F1): a day where only some checks carried a
 *    subtotal says "from N of M checks" under its figure; a day whose checks
 *    carried none reads "not recorded", never $0. The month line sums the
 *    days the register counted and says "from N of M days" when that is
 *    short of the days begun (the founder, 2026-10-05).
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

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { animate, settle } from '@/lib/mudavym';
import type { ActivityItem, AlertItem } from './useDashboardNextData';
import {
  NOT_RECORDED,
  fromChecks,
  fromDays,
  useDayOrders,
  useMonthLedger,
  type DayLedger,
  type MonthLedger,
} from './useDashboardNextData';
import { DASH, dateIn, figure, longDay, money, monthName } from './format';
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
  // Omitted reads as false (fail closed): a caller that forgets it draws no
  // money (PR #579 audit note 6). Every production caller passes it.
  seesAmounts?: boolean;
}

const MONO_FIG = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums' } as const;

/*
 * A cell sizes what it holds by its OWN width, never the viewport's (ADR 0290
 * §9). Inside the app shell the rooms rail (232 px) and the open counter
 * (320 px from a 1280 px window) leave a cell 36.9 px wide at 1280 px —
 * narrower than on a phone — so `dashboard-next.css`'s 720 px breakpoint
 * never sees it, and a 12 px "$4.2K" drew as "$4.2". So the cell is a size
 * container; its side padding narrows from 7 px to 3 px with it (a grid
 * item's percentage padding reads its own track), and its figure and words
 * are sized in `cqi`, hundredths of the cell's inner width.
 */
export const CELL_SIDE = 'clamp(3px, calc(25% - 6px), 7px)';
const CELL_BOX = { containerType: 'inline-size', paddingLeft: CELL_SIDE, paddingRight: CELL_SIDE } as const;

/** JetBrains Mono advances 0.6 em a character; the cell sets -0.01 em. */
const MONO_ADVANCE_EM = 0.59;

/**
 * The cell headline's size: 12 px where it fits, else the size at which the
 * month's longest headline exactly fills the cell's inner width. One size for
 * the whole month, so a figure's size never stands in for its magnitude.
 */
export function cellFigureSize(longest: number): string {
  if (longest <= 1) return '12px';
  const cqi = Math.floor((100 / (MONO_ADVANCE_EM * longest)) * 100) / 100;
  return `min(12px, ${cqi}cqi)`;
}

/**
 * The cell's words ("from N of M checks", "not recorded", "N orders"): 9 px
 * where the longest of their words fits, else the size at which "checks"
 * (3.45 em in the text face) fills the cell. They wrap between words, and a
 * word wider than the cell still breaks rather than run off its edge.
 */
export const CELL_WORDS_SIZE = 'min(9px, 28.5cqi)';

/**
 * A size, carried as `--dn-cell-size` and read back as the font size: the
 * custom property keeps the `cqi` value inspectable where a CSS parser does
 * not know the unit (jsdom drops it from `font-size`).
 */
function cellSized(size: string): CSSProperties {
  return { ['--dn-cell-size' as string]: size, fontSize: 'var(--dn-cell-size)' };
}

const CELL_WORDS: CSSProperties = {
  ...cellSized(CELL_WORDS_SIZE),
  lineHeight: 1.15,
  overflowWrap: 'anywhere',
};
// "recorded" breaks inside the word ("record" / "ed") in every cell measured up
// to 49.4 px wide and reads whole from 59.7 px. The founder kept his words
// over a shorter cell form (ADR 0290 §9).
const NOT_RECORDED_FIG: CSSProperties = {
  ...CELL_WORDS,
  fontFamily: 'inherit',
  fontStyle: 'italic',
  fontWeight: 400,
  color: 'var(--ink-4, #665D50)',
};

/**
 * What a cell says. `salesShown` picks the headline (F2, ADR 0290); a role
 * that sees no money (DASH-W22) gets no figure on a day with deliveries — its
 * count is in the cell's marks.
 */
function cellFigure(
  day: DayLedger | undefined,
  salesShown: boolean,
  zoneUnset: boolean,
  seesAmounts: boolean,
): string {
  if (!day || zoneUnset) return DASH;
  if (salesShown) {
    if (day.checks == null) return DASH;
    if (day.checks === 0) return '·';
    return day.net_sales == null ? NOT_RECORDED : money(day.net_sales, 'compact');
  }
  if (!seesAmounts) {
    if (day.order_count == null) return DASH;
    return day.order_count > 0 ? '' : '·';
  }
  if (day.procurement_spend == null) return DASH;
  return day.procurement_spend > 0 ? money(day.procurement_spend, 'compact') : '·';
}

/** A day's net sales in words, for its label (count and say, netsales F1). */
function salesSaid(day: DayLedger): string {
  if (day.checks == null) return 'net sales unknown';
  if (day.checks === 0) return 'no sales';
  if (day.net_sales == null) return `net sales ${NOT_RECORDED}`;
  const from = fromChecks(day.net_checks, day.checks);
  return `net sales ${money(day.net_sales)}${from ? ` ${from}` : ''}`;
}

/**
 * The month's net sales in words: the figure, then how much of the month it
 * covers. "not recorded" when the counted days' checks carried no subtotal.
 */
function monthSalesSaid(ledger: MonthLedger | null): { figure: string; from: string[] } {
  if (!ledger) return { figure: DASH, from: [] };
  if (
    ledger.monthlyNetSales == null &&
    ledger.monthlyChecks != null &&
    ledger.monthlyChecks > 0 &&
    ledger.monthlyNetChecks === 0
  ) {
    return { figure: NOT_RECORDED, from: [] };
  }
  if (ledger.monthlyNetSales == null) return { figure: DASH, from: [] };
  const from = [
    fromDays(ledger.monthlyDaysCounted, ledger.monthlyDaysBegun),
    fromChecks(ledger.monthlyNetChecks, ledger.monthlyChecks),
  ].filter((x): x is string => x !== null);
  return { figure: money(ledger.monthlyNetSales), from };
}

/**
 * DASH-W35: the square is named in words — the day, then what it holds — and
 * says which day is today. The figures follow ADR 0290: sales when shown,
 * "unknown" for a figure the gateway could not file.
 */
function cellLabel(
  dateStr: string,
  day: DayLedger | undefined,
  o: { salesShown: boolean; zoneUnset: boolean; seesAmounts: boolean; isToday: boolean },
): string {
  const head = `${longDay(dateStr)}${o.isToday ? ', today' : ''}`;
  if (!day) return head;
  const parts: string[] = [];
  if (o.zoneUnset) parts.push('figures unknown, the house time zone is not set');
  else {
    if (o.salesShown) parts.push(salesSaid(day));
    if (o.seesAmounts) {
      parts.push(
        day.procurement_spend == null
          ? 'paid to vendors unknown'
          : day.procurement_spend > 0
            ? `${money(day.procurement_spend)} paid to vendors`
            : 'no deliveries',
      );
    } else {
      parts.push(
        day.order_count == null
          ? 'deliveries unknown'
          : day.order_count > 0
            ? `${day.order_count} ${day.order_count === 1 ? 'delivery' : 'deliveries'}`
            : 'no deliveries',
      );
    }
  }
  parts.push(day.events.length === 0 ? 'nothing on the calendar' : `${day.events.length} on the calendar`);
  return `${head}: ${parts.join(', ')}`;
}

export function SalesCalendar({ restaurantId, alerts, activity, zone = null, seesAmounts: mayShow = false }: SalesCalendarProps) {
  const now = new Date();
  // DASH-W20: the clock's today is the house's (the stats' zone) — it picks the
  // month the address leaves out. ADR 0290: once the month answers, its own
  // `today` (null when the house has no zone) decides past, future and the mark.
  const clockToday = dateIn(now, zone);
  // The house's today as a month last said it: a string, null (no zone), or
  // undefined (not said yet / an older gateway). Kept across months, so the
  // grid opens on the house's month even when the browser's has turned.
  const [saidToday, setSaidToday] = useState<string | null | undefined>(undefined);
  const openOn = saidToday ?? clockToday;
  const [todayYear, todayMonth] = openOn.split('-').map(Number);
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
  const ledger = month.state === 'ready' ? month.ledger : null;
  useEffect(() => {
    if (ledger && ledger.today !== undefined) setSaidToday(ledger.today);
  }, [ledger]);
  const houseToday = ledger && ledger.today !== undefined ? ledger.today : saidToday;
  const todayStr = houseToday ?? clockToday;
  // A future day has no deliveries to list; don't ask the ledger for them
  // (DASH-W13). Deliveries are matched in the zone the month is filed in.
  const dayOrders = useDayOrders(restaurantId, selected && selected <= todayStr ? selected : null, ledger?.timezone);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const monthKey = `${cursor.year}-${cursor.month}`;
  const [todayY, todayM] = todayStr.split('-').map(Number);
  const isCurrentMonth = cursor.year === todayY && cursor.month === todayM;

  const daily: DayLedger[] = useMemo(() => ledger?.daily ?? [], [ledger]);
  // A month the gateway sent without its money reads as counts even if the
  // caller's role was expected to see it: a withheld figure is never a $0.
  const seesAmounts = mayShow && ledger?.amounts !== 'withheld';
  // G5: a role the page has not read yet sees no sales either — the gateway
  // gates sales and amounts on the same roles (owner, manager).
  const salesShown = seesAmounts && ledger?.sales === 'shown';
  const zoneUnset = ledger?.zoneUnset === true;
  const monthSales = monthSalesSaid(ledger);
  const headline = (d: DayLedger | undefined): number | null =>
    d ? (salesShown ? d.net_sales : seesAmounts ? d.procurement_spend : d.order_count) : null;
  const maxHead = useMemo(
    () =>
      Math.max(
        1,
        ...daily.map((d) => (salesShown ? d.net_sales : seesAmounts ? d.procurement_spend : d.order_count) ?? 0),
      ),
    [daily, salesShown, seesAmounts],
  );
  // The month's longest headline sets the one figure size every cell uses.
  const figSize = useMemo(
    () =>
      cellFigureSize(
        Math.max(
          0,
          ...daily.map((d) => {
            const f = cellFigure(d, salesShown, zoneUnset, seesAmounts);
            return f === NOT_RECORDED ? 0 : f.length;
          }),
        ),
      ),
    [daily, salesShown, zoneUnset, seesAmounts],
  );

  // Monday-first leading blanks.
  const firstWeekday = (new Date(cursor.year, cursor.month - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.year, cursor.month, 0).getDate();

  // The panel opens on the days the grid lets you press, and no others. A
  // `?day=` link to a future day with nothing on the calendar (hand-edited or
  // stale) used to open a panel for a square the grid disables (W13/W29; PR
  // #579 audit note 1); it now reads as closed, like the grid.
  const selectedDay = useMemo(() => {
    const d = selected ? daily.find((x) => x.date === selected) ?? null : null;
    if (!d) return null;
    return d.date > todayStr && d.events.length === 0 ? null : d;
  }, [selected, daily, todayStr]);

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
      aria-label={salesShown ? 'Sales calendar — net sales per day' : seesAmounts ? 'Month calendar — paid to vendors per day' : 'Month calendar — deliveries per day'}
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
        <p className="text-[12px] text-inkm-4" data-testid="dn-month-totals">
          {salesShown && (
            <>
              net sales{' '}
              <span className="text-inkm-1" style={monthSales.figure === NOT_RECORDED ? undefined : MONO_FIG}>
                {monthSales.figure}
              </span>
              {monthSales.from.map((f) => (
                <span key={f} data-testid="dn-month-from">
                  {' · '}
                  {f}
                </span>
              ))}
              {' · '}
            </>
          )}
          {seesAmounts && (
            <>
              paid to vendors{' '}
              <span className="text-inkm-1" style={MONO_FIG}>
                {money(ledger?.monthlySpend)}
              </span>
              {' · '}
            </>
          )}
          <span className="text-inkm-1" style={MONO_FIG}>
            {figure(ledger?.monthlyBottles)}
          </span>{' '}
          {month.state === 'ready' && month.ledger.monthlyBottles === 1 ? 'bottle' : 'bottles'} in
        </p>
      </div>

      {zoneUnset && (
        <p className="px-4 pt-2 text-[12px] italic text-inkm-4 sm:px-5" data-testid="dn-zone-unset">
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
          // No today mark when the house has no zone (ADR 0290).
          const isToday = houseToday !== null && dateStr === todayStr;
          const head = zoneUnset ? null : headline(day);
          const heat = head != null && head > 0 ? 0.06 + 0.3 * (head / maxHead) : 0;
          const fig = cellFigure(day, salesShown, zoneUnset, seesAmounts);
          // Count and say: a figure short of its day's checks says so here.
          const from = salesShown && !zoneUnset && day ? fromChecks(day.net_checks, day.checks) : null;
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
              aria-label={cellLabel(dateStr, day, { salesShown, zoneUnset, seesAmounts, isToday })}
              // color-mix keeps the heat on the seal TOKEN, so both grounds
              // (İznik on paper, lifted teal on charcoal) resolve correctly;
              // browsers without color-mix quietly keep the paper-1 ground.
              style={
                heat > 0
                  ? { ...CELL_BOX, backgroundColor: `color-mix(in srgb, var(--seal) ${Math.round(heat * 100)}%, transparent)` }
                  : CELL_BOX
              }
            >
              <span className="dn-cell-num">{dayNum}</span>
              <span className="dn-cell-marks" style={{ flexWrap: 'wrap' }}>
                {day && day.events.length > 0 && <span className="dn-dot" aria-hidden />}
                {day && day.order_count != null && day.order_count > 0 && (
                  <span className="dn-cell-orders text-inkm-4" style={{ ...CELL_WORDS, fontVariantNumeric: 'tabular-nums' }}>
                    {day.order_count} {day.order_count === 1 ? 'order' : 'orders'}
                  </span>
                )}
              </span>
              {month.state === 'loading' && !isFuture ? (
                <span className="dn-skel h-3 w-8" aria-hidden />
              ) : (
                <span
                  className="dn-cell-fig"
                  // "not recorded" is words, not a figure: the text face, the
                  // cell's word size, free to wrap inside a narrow cell.
                  style={!isFuture && fig === NOT_RECORDED ? NOT_RECORDED_FIG : cellSized(figSize)}
                >
                  {isFuture ? '' : fig}
                </span>
              )}
              {!isFuture && month.state !== 'loading' && from && (
                <span className="dn-cell-from text-inkm-4" style={CELL_WORDS} aria-hidden>
                  {from}
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
            zone={ledger?.timezone}
            sales={seesAmounts ? ledger?.sales : undefined}
            today={todayStr}
            dayOrders={dayOrders}
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
