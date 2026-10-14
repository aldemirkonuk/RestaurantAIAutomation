/**
 * The trade registers — what came in, what went out, and what is coming.
 *
 * Five of the eleven catalogue entries (`rp-catalogue.tsx` assembles them all).
 * Each declares four things and nothing else: where its figures come from
 * (`path`), the window it speaks about, the drawings that are TRUE of its data
 * (`graphs`, with `graphNote` saying what is not offered and why), and how to
 * turn its payload into the one shape every cutting is drawn from (`view`).
 *
 * Every `basis` array below holds the SERVER's own sentences, verbatim. This
 * page never writes a basis of its own.
 */

import { Link } from 'react-router-dom';
import ReadingList from './ReadingList';
import {
  EM,
  MONO,
  WEEKDAY_SHORT,
  categoryLabel,
  codeOf,
  countOf,
  figure,
  money,
  num,
  pct,
  ratioPct,
  shortDay,
  weekLabel,
  weekStart,
  weekdayIndex,
} from './rp-format';
import { AMOUNTS_WITHHELD, refundChecksSaid, zeroChecksSaid } from './rp-registers-house';
import { analysis, arr, obj, str, type AnalysisSpec, type ViewCtx } from './rp-spec';
import { houseToday } from '@/lib/houseZone';
import type { Cat, Cell } from './rp-view';

/* ───────────────────────────────────────────────────── 1. the reading ──── */

export interface ReadingRow {
  ruleKey: string;
  sentence: string;
  category: string;
  score: number;
  entityLabel: string | null;
}

const reading = analysis<ReadingRow[]>({
  title: 'The reading',
  register: 'insight register',
  answers: 'What the engine has noticed, in its own sentences',
  window: () => 'the stored insight feed, recomputed hourly',
  path: (rid) => `/analytics/insights/${rid}?limit=40`,
  graphs: ['table', 'bars'],
  graphNote:
    'Bars count the sentences in each category — nothing more. There is no line, area or heat map here because a sentence has no magnitude and no date to plot it against.',
  select: (raw) =>
    arr(obj(raw).insights)
      .map((row) => {
        const candidate = str(row.candidate_key ?? row.candidateKey);
        const entity = str(row.entity_key ?? row.entityKey);
        return {
          ruleKey: `insight:${candidate}${entity ? `:${entity}` : ''}`,
          sentence: str(row.sentence),
          category: str(row.category) || 'sales',
          score: num(row.score) ?? 0,
          entityLabel: (row.entity_label ?? row.entityLabel ?? null) as string | null,
        };
      })
      .filter((r) => r.sentence !== '')
      .sort((a, b) => b.score - a.score),
  view: (rows) => {
    if (rows.length === 0)
      return {
        say: 'The engine has produced no insight for this restaurant yet. It computes hourly and on demand — there is nothing to say, rather than nothing to show.',
        figures: [],
        notes: [],
        basis: [],
      };
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return {
      node: <ReadingList rows={rows} />,
      cats: {
        data: Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([c, n]) => ({ label: categoryLabel(c), value: n, full: categoryLabel(c) })),
        xLabel: 'category',
        yLabel: 'sentences',
        unit: 'sentences',
        format: (v) => figure(v),
      },
      figures: [
        { label: 'Sentences read', value: figure(rows.length) },
        { label: 'Categories with something to say', value: figure(counts.size) },
      ],
      notes: [
        'Sentences are printed as the engine wrote them. This page never composes one.',
      ],
      basis: [
        `${countOf(rows.length, 'sentence', 'sentences')} read from the stored insight feed; every number in them was computed by the engine from this restaurant's own rows.`,
      ],
    };
  },
});

/* ────────────────────────────────────────────────────── 2. the till ────── */

export interface TillWindow {
  posConnected: boolean;
  /** null — never 0 — when no POS has ever landed a check. */
  revenue: number | null;
  checkCount: number | null;
  /** Of `checkCount`, the checks with no total, left out of `revenue` (F-1444). 0 from an older gateway. */
  checksWithoutTotal: number;
  /** Of `checkCount`, the checks rung at 0, a comp or a staff meal (F-1534). 0 from an older gateway. */
  checksTakingNoMoney: number;
  /** Of `checkCount`, the refunds sent as checks with a minus total (F-1644). 0 from an older gateway. */
  checksRefunded: number;
  /** The money those refunds gave back, as a positive sum; taken off `revenue`. 0 from an older gateway. */
  refunded: number;
  from: string;
  to: string;
  days: number;
  /** The house's zone the days were filed in (ADR 0296); null from an older gateway or a house with none. */
  timezone: string | null;
  /** True when the house has no time zone: no day can be filed, so nothing is stated. */
  zoneUnset: boolean;
  dailySeries: Array<{ date: string; revenue: number }>;
  /**
   * The house day of the first check the till ever sent (F-1662): from then on
   * the till was connected, so a day after it with no check is a day the house
   * was shut, not a day missing. null from an older gateway.
   */
  coveredFrom: string | null;
}

/** True for a calendar quarter, YYYY-Qn, which the till reads like a month (F-1577). */
export function isQuarter(period: string): boolean {
  return /^\d{4}-Q[1-4]$/.test(period);
}

/** "July 2026" for 2026-07, and "Q3 2026 (July to September)" for 2026-Q3, in the reader's language. */
export function monthLabel(month: string): string {
  if (isQuarter(month)) {
    const [year, q] = month.split('-Q');
    const first = (Number(q) - 1) * 3 + 1;
    const name = (m: number) =>
      new Date(Number(year), m - 1, 1, 12).toLocaleDateString(undefined, { month: 'long' });
    return `Q${q} ${year} (${name(first)} to ${name(first + 2)})`;
  }
  const d = new Date(`${month}-01T12:00:00`);
  return Number.isNaN(d.getTime())
    ? month
    : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * This month as YYYY-MM, on the calendar of the Date given. Pass
 * `houseToday(zone)` for the house's month: the gateway refuses a month that
 * has not begun on the house's clock (F-909).
 */
export function thisMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The same month, or quarter, one year before (F-1604): 2026-03 → 2025-03,
 * 2026-Q1 → 2025-Q1. Null for anything else, so nothing is read for it.
 */
export function yearBefore(period: string): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2]|Q[1-4])$/.exec(period);
  return m ? `${Number(m[1]) - 1}-${m[2]}` : null;
}

/** This quarter as YYYY-Qn, on the calendar of the Date given (F-1577). */
export function thisQuarter(now: Date = new Date()): string {
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
}

/** Week columns spanning [from, to] — so a week with no takings is a BLANK
 *  column rather than a week that quietly does not exist. */
function weekColumns(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return [];
  const cols: string[] = [];
  let cursor = weekStart(from);
  const last = weekStart(to);
  for (let guard = 0; guard < 60; guard++) {
    cols.push(cursor);
    if (cursor >= last) break;
    const d = new Date(`${cursor}T00:00:00`);
    d.setDate(d.getDate() + 7);
    cursor = weekStart(`${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`);
  }
  return cols;
}

const trailingTill = analysis<TillWindow>({
  title: 'Through the till',
  register: 'till register',
  answers: 'What guests actually paid, day by day',
  // The window ends on the house's today (goals.service.ts getPosRevenueWindow),
  // so an unfinished day is one of its days and the line says so (F-1215).
  window: (ctx) => `the last ${ctx.days} days of POS checks, today so far`,
  path: (rid, ctx) => `/analytics/pos-revenue/${rid}?days=${ctx.days}`,
  graphs: ['area', 'line', 'bars', 'heatmap', 'table', 'figure'],
  graphNote:
    'This is the one register with a date on every row, so it is the one that can be a heat map: weekday against week. No scatter — there is only one measure per day, and a scatter needs two.',
  takesWindow: true,
  select: (raw) => {
    const d = obj(raw);
    return {
      posConnected: d.posConnected === true,
      revenue: num(d.revenue),
      checkCount: num(d.checkCount),
      checksWithoutTotal: num(d.checksWithoutTotal) ?? 0,
      checksTakingNoMoney: num(d.checksTakingNoMoney) ?? 0,
      checksRefunded: num(d.checksRefunded) ?? 0,
      refunded: num(d.refunded) ?? 0,
      from: str(d.from),
      to: str(d.to),
      days: num(d.days) ?? 0,
      timezone: str(d.timezone) || null,
      zoneUnset: d.zoneUnset === true,
      dailySeries: arr(d.dailySeries).map((r) => ({
        date: str(r.date),
        revenue: num(r.revenue) ?? 0,
      })),
      coveredFrom: str(d.coveredFrom) || null,
    };
  },
  view: (w) => {
    if (!w.posConnected)
      return {
        say: (
          <>
            No POS check has ever landed for this restaurant, so there is no sales revenue to read.
            That is an absent feed, not a day of {money(0)} — nothing is drawn here.{' '}
            <Link to="/settings?tab=pos" className="rp-link rp-ink rp-focus rp-no-drag">
              Connect a till in Settings
            </Link>
          </>
        ),
        figures: [],
        notes: [],
        basis: [],
      };
    // A house with no time zone has no days to file a check on (ADR 0296), so
    // the till states no figure rather than UTC days dressed as the house's.
    if (w.zoneUnset)
      return {
        say: (
          <>
            This house&rsquo;s time zone isn&rsquo;t set, so no sale can be filed on the house&rsquo;s day
            yet — nothing is drawn here.{' '}
            <Link to="/settings?tab=time-zone" className="rp-link rp-ink rp-focus rp-no-drag">
              Set the time zone in Settings
            </Link>
          </>
        ),
        figures: [],
        notes: [],
        basis: [],
      };
    // F-1444: a check with no total is left out of Taken, so the average
    // divides by the checks that carry one, never by every check. F-1534: nor
    // by a check rung at 0 (a comp, a staff meal), which took no money.
    // F-1644: nor by a refund, which Taken has had taken off; the average
    // is over the paid checks alone, so their refunds are added back.
    const totaled =
      w.checkCount != null
        ? w.checkCount - w.checksWithoutTotal - w.checksTakingNoMoney - w.checksRefunded
        : null;
    const avg =
      w.revenue != null && totaled != null && totaled > 0 ? (w.revenue + w.refunded) / totaled : null;
    const figures = [
      { label: 'Taken', value: money(w.revenue), note: 'No POS revenue recorded' },
      { label: 'Checks', value: figure(w.checkCount) },
      {
        label: 'Average check',
        value: money(avg, 'table'),
        note: 'Needs both revenue and a check count',
      },
    ];
    const basis = [
      w.timezone
        ? `Non-voided pos_checks.total between ${w.from || EM} and ${w.to || EM}, each check filed on the house's day in ${w.timezone} by when it closed, else when it opened.`
        : `Non-voided pos_checks.total between ${w.from || EM} and ${w.to || EM}.`,
      'The series is sparse on purpose: a day with no check is absent, not plotted at zero.',
    ];
    // F-1644 (was F-446): a refund the till sends as a check with a minus
    // total is taken off Taken; one the till keeps apart never reaches
    // Mudavym. The page says both wherever it prints Taken.
    // F-1536: Taken is the checks' totals, which hold tax and tips on most
    // tills, while the dashboard draws net sales; the page says which it is.
    const notes = [
      ...(w.revenue != null ? [TILL_TOTALS_NOT_NET, TILL_REFUNDS_TAKEN_OFF] : []),
      ...(w.checksWithoutTotal > 0 ? [tillUntotaledSaid(w.checksWithoutTotal)] : []),
      ...(w.checksTakingNoMoney > 0 ? [zeroChecksSaid(w.checksTakingNoMoney)] : []),
      ...(w.checksRefunded > 0 ? [refundChecksSaid(w.checksRefunded)] : []),
    ];
    if (w.dailySeries.length === 0)
      return {
        say: 'The till answered, and no check fell inside this window.',
        figures,
        notes,
        basis,
      };

    const cols = weekColumns(w.from, w.to);
    const byDate = new Map(w.dailySeries.map((d) => [d.date, d.revenue]));
    const cells: Cell[] = [];
    for (const [date, revenue] of byDate) {
      cells.push({
        row: WEEKDAY_SHORT[weekdayIndex(date)],
        col: weekLabel(weekStart(date)),
        value: revenue,
        title: shortDay(date),
      });
    }
    return {
      cats: {
        data: w.dailySeries.map((d) => ({
          label: shortDay(d.date),
          value: d.revenue,
          full: shortDay(d.date),
        })),
        xLabel: 'day',
        yLabel: 'taken',
        unit: 'taken',
        format: (v) => money(v, 'compact'),
      },
      matrix: {
        rows: [...WEEKDAY_SHORT],
        cols: cols.map(weekLabel),
        cells,
        xLabel: 'week beginning',
        yLabel: 'weekday',
        unit: 'taken',
        format: (v) => money(v, 'compact'),
      },
      table: {
        cols: [
          { key: 'day', label: 'Day' },
          { key: 'taken', label: 'Taken', numeric: true },
        ],
        rows: w.dailySeries.map((d) => ({
          key: d.date,
          cells: [shortDay(d.date), money(d.revenue, 'table')],
        })),
        more:
          w.dailySeries.length < w.days
            ? `${w.dailySeries.length} of the ${w.days} days in the window rang up a check; the rest are absent rather than zero.`
            : undefined,
      },
      figures,
      notes,
      basis,
    };
  },
});

/**
 * The till over one calendar month when the reader picked one (F-128), or
 * over last week when the weekly bell opened the page (F-1236), otherwise
 * the trailing window above, unchanged — the export desk pins that
 * one against its own catalogue, and it still writes only a trailing window.
 */
const till: AnalysisSpec = {
  ...trailingTill,
  window: (ctx) =>
    ctx.month
      ? `${monthLabel(ctx.month)} of POS checks${ctx.month === (isQuarter(ctx.month) ? thisQuarter : thisMonth)(houseToday(ctx.zone)) ? ', so far' : ''}, by the house’s days`
      : ctx.week
        ? 'last week of POS checks, Monday to Sunday, by the house’s days'
        : trailingTill.window(ctx),
  // F-1236: the weekly bell's week is the house's last full Monday to Sunday,
  // which the gateway works out on the house's clock.
  path: (rid, ctx) =>
    ctx.month
      ? `/analytics/pos-revenue/${rid}?month=${ctx.month}`
      : ctx.week
        ? `/analytics/pos-revenue/${rid}?week=${ctx.week}`
        : trailingTill.path!(rid, ctx),
  // F-1604: a month (or quarter) is set beside the same one a year before.
  view: (data, ctx) => {
    const shown = trailingTill.view(data, ctx);
    const before = ctx.month ? yearBefore(ctx.month) : null;
    if (!before || !ctx.lastYear) return shown;
    const w = data as TillWindow;
    if (!w.posConnected || w.zoneUnset) return shown;
    return { ...shown, figures: [...shown.figures, lastYearFigure(ctx.month!, before, w.revenue, ctx.lastYear, ctx.zone)] };
  },
};

/**
 * "Same month last year" beside a month the till is set to (F-1604). A month
 * the till never sent a check for is said as that, not as 0 taken: the house
 * may not have been on Mudavym then. The change is given only for a period
 * that has ended, since a month so far set against a whole one is not a
 * change. F-1646: nor is a month the till covered only partly, before its
 * first check: it says N of M days on record and gives no change. F-1662: the
 * till covers a period from its first check (`coveredFrom`, or the period's
 * first check from an older gateway) to the period's end, so a day the house
 * was shut inside that time does not withhold the change.
 */
export function lastYearFigure(
  period: string,
  before: string,
  taken: number | null,
  last: NonNullable<ViewCtx['lastYear']>,
  zone: string | null = null,
): { label: string; value: string; note?: string } {
  const label = `${isQuarter(period) ? 'Same quarter' : 'Same month'} last year, ${monthLabel(before)}`;
  if (last === 'reading') return { label, value: EM, note: 'Being read' };
  if (last === 'unread') return { label, value: EM, note: `${monthLabel(before)} could not be read` };
  if (!last.posConnected || last.zoneUnset || last.revenue == null || !last.checkCount)
    return {
      label,
      value: EM,
      note: `No check from your till reached Mudavym for ${monthLabel(before)}, so there is nothing to set beside it`,
    };
  // The read is the till's own window (TillWindow): the days in that period,
  // its last day, and the day the till first sent a check.
  const { dailySeries, days, to, coveredFrom } = last as Partial<
    Pick<TillWindow, 'dailySeries' | 'days' | 'to' | 'coveredFrom'>
  >;
  const first = coveredFrom || dailySeries?.[0]?.date;
  const onRecord = first && to && days != null ? Math.min(days, daysThrough(first, to)) : null;
  if (onRecord != null && days != null && onRecord < days)
    return {
      label,
      value: money(last.revenue),
      note: `${onRecord} of ${days} days on record in ${monthLabel(before)}, so no change is worked out against a whole ${isQuarter(period) ? 'quarter' : 'month'}`,
    };
  const running = period === (isQuarter(period) ? thisQuarter : thisMonth)(houseToday(zone));
  const change =
    !running && taken != null && last.revenue > 0 ? ` (${pct((taken - last.revenue) / last.revenue)} this year)` : '';
  return { label, value: `${money(last.revenue)}${change}` };
}

/** Days from one YYYY-MM-DD to another, both counted; 0 when `last` is before `first`. */
function daysThrough(first: string, last: string): number {
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.max(0, Math.round((at(last) - at(first)) / 86_400_000) + 1);
}

/**
 * F-1536: said beside every till figure. Taken sums the checks' totals, which
 * on most tills hold tax and the tip, and the dashboard draws net sales.
 *
 * Word for word the gateway's `TILL_TOTALS_NOT_NET`
 * (`reports/exports/report-export-cuttings.ts`); change one and the other with it.
 */
export const TILL_TOTALS_NOT_NET =
  "Taken is the check totals as your till sends them. On most tills that includes tax and tips, so it reads higher than the dashboard's net sales, which are before tax and tips.";

/**
 * Said beside every till figure (F-1644): which refunds Taken has had taken
 * off, and which it cannot have.
 *
 * Word for word the gateway's `TILL_REFUNDS_TAKEN_OFF`
 * (`reports/exports/report-export-cuttings.ts`), so the screen and the file a
 * house hands on say the same thing. Web cannot import the gateway; change
 * one and the other with it.
 */
export const TILL_REFUNDS_TAKEN_OFF =
  "Refunds your till sends as a check with a minus total are taken off Taken. A refund your till keeps only in its own refund report does not reach Mudavym, so check that report before you hand this on as net takings.";

/**
 * F-1444: word for word the gateway's `tillUntotaledSaid`
 * (`reports/exports/report-export-cuttings.ts`), so the screen and the file
 * say the same thing.
 */
export function tillUntotaledSaid(n: number): string {
  return `${n} ${n === 1 ? 'check has' : 'checks have'} no total from the till, so ${n === 1 ? 'it is' : 'they are'} left out of Taken and of the Average check rather than counted as nothing paid.`;
}

/* ───────────────────────────────────────────────────── 3. spend pacing ── */

export interface PacingRegister {
  /** Staff are sent the pace and the order count, never the spend (F-203). */
  amountsWithheld?: boolean;
  basis?: { outflow?: string; days?: string; notCounted?: string };
  spendLast30d: number | null;
  spendPrev30d: number | null;
  paceDeltaPct: number | null;
  projectedNext4Weeks: number[] | null;
  committedOpenOrders: number | null;
  /**
   * The codes the paid-out and committed figures are in, when the gateway
   * names one; a currency not the house's prints with its own sign (F-1145).
   */
  spendCurrency?: string | null;
  committedCurrency?: string | null;
  openOrderCount: number | null;
  /**
   * Why the buying figures are blank: the deliveries were paid in two
   * currencies, with no exchange rate to add them by (F-1042).
   */
  spendNote?: string | null;
  /** The same, for the open orders behind Committed (F-1042). */
  committedNote?: string | null;
  /**
   * Orders in neither figure (approved, in negotiation, partly received), at
   * their order value — null from a gateway that does not send it (F-130).
   */
  notCounted: {
    approved: number;
    partlyReceived: number;
    other: number;
    /** Null when they were ordered in two currencies (F-1042). */
    orderValue: number | null;
    /** The code `orderValue` is in (F-1145). */
    orderValueCurrency?: string | null;
    /** Why `orderValue` is null (F-1042). */
    orderValueNote?: string | null;
    /** Of those, orders with no price, left out of `orderValue` (F-1010). */
    unpriced: number;
  } | null;
  /** Delivered orders in the 180 days with no price, left out of the sums (F-701). */
  spendUnpricedCount?: number;
  /** Open orders with no price, left out of `committedOpenOrders` (F-701). */
  committedUnpricedCount?: number;
}

/**
 * The orders neither figure counts, said in words beside them, so "committed"
 * and "paid out" are not read as the whole book (F-130). Null when there are
 * none, or the gateway did not say.
 */
export function notCountedNote(n: PacingRegister['notCounted']): string | null {
  if (!n) return null;
  const parts = [
    n.approved > 0 ? countOf(n.approved, 'approved order', 'approved orders') : null,
    n.partlyReceived > 0
      ? countOf(n.partlyReceived, 'partly received order', 'partly received orders')
      : null,
    n.other > 0 ? countOf(n.other, 'order still being negotiated', 'orders still being negotiated') : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const unpriced =
    n.unpriced > 0
      ? ` ${figure(n.unpriced)} of them ${n.unpriced === 1 ? 'carries' : 'carry'} no price, so that order value leaves ${n.unpriced === 1 ? 'it' : 'them'} out.`
      : '';
  const value =
    n.orderValue === null
      ? `.${n.orderValueNote ? ` ${n.orderValueNote}` : ''}`
      : `, ${money(n.orderValue, 'full', n.orderValueCurrency)} at order value.`;
  return `Not in either figure: ${list}${value}${unpriced} They count once the vendor confirms them or they close.`;
}

/**
 * F-701: an order with no price is left out of the spend sums, not counted as
 * $0, and the cutting says how many — beside the figure it shortens. Shared by
 * "Spend pacing" and "Against ourselves", which read the same cashflow lens.
 */
export function unpricedNotes(spend?: number, committed?: number): string[] {
  const out: string[] = [];
  if (spend && spend > 0)
    out.push(
      `${figure(spend)} delivered ${spend === 1 ? 'order carries' : 'orders carry'} no price in these 180 days, so the 30-day buying figures leave ${spend === 1 ? 'it' : 'them'} out and may be short by what ${spend === 1 ? 'it' : 'they'} cost.`,
    );
  if (committed && committed > 0)
    out.push(
      `${figure(committed)} open ${committed === 1 ? 'order carries' : 'orders carry'} no price, so Committed, not yet delivered leaves ${committed === 1 ? 'it' : 'them'} out.`,
    );
  return out;
}

const pacing = analysis<PacingRegister>({
  title: 'Spend pacing',
  register: 'cashflow register',
  answers: 'Whether buying is running hot or cold against the 30 days before',
  window: () => '180 days of purchasing, compared in two 30-day windows, the last one ending today so far',
  path: (rid) => `/analytics/cashflow/${rid}`,
  graphs: ['bars', 'table', 'figure'],
  graphNote:
    'Two windows are two bars; a line through two points would draw a trend that has not been measured. The four-week projection is printed rather than plotted — a weekly figure and a 30-day total do not share an axis.',
  select: (raw) => {
    const d = obj(raw);
    return {
      amountsWithheld: d.amountsWithheld === true,
      basis: d.basis as PacingRegister['basis'],
      spendLast30d: num(d.spendLast30d),
      spendPrev30d: num(d.spendPrev30d),
      paceDeltaPct: num(d.paceDeltaPct),
      projectedNext4Weeks: Array.isArray(d.projectedNext4Weeks)
        ? (d.projectedNext4Weeks as number[])
        : null,
      committedOpenOrders: num(d.committedOpenOrders),
      spendCurrency: codeOf(d.spendCurrency),
      committedCurrency: codeOf(d.committedCurrency),
      openOrderCount: num(d.openOrderCount),
      notCounted: (() => {
        const n = obj(d.notCounted);
        const a = num(n.approved);
        const p = num(n.partlyReceived);
        const o = num(n.other);
        const v = num(n.orderValue);
        const vNote = typeof n.orderValueNote === 'string' ? n.orderValueNote : null;
        // A null value is read only with its reason (F-1042); without one the
        // gateway did not say, as before.
        return a === null || p === null || o === null || (v === null && !vNote)
          ? null
          : {
              approved: a,
              partlyReceived: p,
              other: o,
              orderValue: v,
              orderValueCurrency: codeOf(n.orderValueCurrency),
              orderValueNote: vNote,
              unpriced: num(n.unpriced) ?? 0,
            };
      })(),
      spendUnpricedCount: num(d.spendUnpricedCount) ?? undefined,
      committedUnpricedCount: num(d.committedUnpricedCount) ?? undefined,
      spendNote: typeof d.spendNote === 'string' ? d.spendNote : null,
      committedNote: typeof d.committedNote === 'string' ? d.committedNote : null,
    };
  },
  view: (c) => {
    const figures = [
      { label: 'Pace', value: pct(c.paceDeltaPct), note: 'Needs two comparable 30-day windows' },
      { label: 'Committed, not yet delivered', value: money(c.committedOpenOrders, 'full', c.committedCurrency) },
      { label: 'Open orders', value: figure(c.openOrderCount) },
    ];
    const projection = c.projectedNext4Weeks;
    const notes = [
      projection && projection.length > 0 ? (
        <>
          Projected, next four weeks:{' '}
          <span style={{ fontFamily: MONO }}>
            {projection.map((v) => money(v, 'compact', c.spendCurrency)).join(' · ')}
          </span>{' '}
          — a Holt projection, not a measurement.
        </>
      ) : (
        <>
          Too few weeks of purchasing to project — {EM} rather than a line drawn through two points.
        </>
      ),
      ...(notCountedNote(c.notCounted) ? [notCountedNote(c.notCounted)] : []),
      ...unpricedNotes(c.spendUnpricedCount, c.committedUnpricedCount),
      ...(c.committedNote ? [c.committedNote] : []),
    ];
    const basis = [
      c.basis?.outflow ? `Outflow: ${c.basis.outflow}.` : null,
      c.basis?.days ? `Days: ${c.basis.days}.` : null,
    ];
    if (c.amountsWithheld)
      return {
        say: `${AMOUNTS_WITHHELD} The pace and the open orders below still say whether buying runs hot or cold.`,
        figures: figures.filter((x) => x.label !== 'Committed, not yet delivered'),
        notes: [],
        basis,
      };
    // Two currencies have no one figure (F-1042): blank windows, and why —
    // never the "no delivered order" sentence below.
    if (c.spendNote) return { say: c.spendNote, figures, notes, basis };
    // Two invisible bars are not a chart. When both windows are empty the
    // sentence is the honest rendering — and it names WHICH windows.
    if ((c.spendLast30d ?? 0) === 0 && (c.spendPrev30d ?? 0) === 0)
      return {
        // An unpriced delivery may sit in a window (F-701): then it is the
        // price that is missing, not the order.
        say: `No delivered purchase order${c.spendUnpricedCount ? ' with a price' : ''} falls in either 30-day window, so there is no pace to draw — two bars at zero would say the same thing less clearly.`,
        figures,
        notes,
        basis,
      };
    return {
      cats: {
        data: [
          { label: 'Prev 30', value: c.spendPrev30d, full: 'The 30 days before last' },
          { label: 'Last 30', value: c.spendLast30d, full: 'The last 30 days' },
        ],
        xLabel: 'window',
        yLabel: 'paid out',
        unit: 'paid out',
        format: (v) => money(v, 'compact', c.spendCurrency),
      },
      table: {
        cols: [
          { key: 'w', label: 'Window' },
          { key: 'v', label: 'Paid out', numeric: true },
        ],
        rows: [
          { key: 'prev', cells: ['The 30 days before last', money(c.spendPrev30d, 'table', c.spendCurrency)] },
          { key: 'last', cells: ['The last 30 days', money(c.spendLast30d, 'table', c.spendCurrency)] },
        ],
      },
      figures,
      notes,
      basis,
    };
  },
});

/* ───────────────────────────────────────────────── 4. the week's shape ── */

export interface WeekRegister {
  weekdayProfile: Array<{ day: string; mean: number; stdev: number; n: number }>;
  bestDay: string | null;
  worstDay: string | null;
  /** Since 2026-09-03: true when an extreme is shared and both are withheld. */
  tie: boolean | null;
  trendPerDayPct: number | null;
  /** F-185: true when the house has no zone, so no bottle is filed on a weekday. */
  zoneUnset: boolean;
  basis?: { weekday?: string; extremes?: string };
}

const week = analysis<WeekRegister>({
  title: 'The week’s shape',
  register: 'seasonality register',
  answers: 'Which nights carry the week',
  window: () => 'the last 90 days of the consumption log',
  path: (rid) => `/analytics/seasonality/${rid}`,
  graphs: ['bars', 'line', 'area', 'table'],
  graphNote:
    'No heat map: seasonality returns one dimension — a mean per weekday — and a heat map needs two. No scatter, and no reference line: the endpoint publishes no median or threshold for this register, and a rule we invented is not the engine’s.',
  select: (raw) => {
    const d = obj(raw);
    return {
      weekdayProfile: arr(d.weekdayProfile).map((p) => ({
        day: str(p.day),
        mean: num(p.mean) ?? 0,
        stdev: num(p.stdev) ?? 0,
        n: num(p.n) ?? 0,
      })),
      bestDay: (d.bestDay ?? null) as string | null,
      worstDay: (d.worstDay ?? null) as string | null,
      tie: typeof d.tie === 'boolean' ? d.tie : null,
      trendPerDayPct: num(d.trendPerDayPct),
      zoneUnset: d.zoneUnset === true,
      basis: d.basis as WeekRegister['basis'],
    };
  },
  view: (w) => {
    // The gateway files each bottle on the house's day (F-185). With no zone
    // it files none, and an empty week is not "no consumption recorded".
    if (w.zoneUnset)
      return {
        say: (
          <>
            This house&rsquo;s time zone isn&rsquo;t set, so no bottle can be filed on a weekday yet —
            nothing is drawn here.{' '}
            <Link to="/settings?tab=time-zone" className="rp-link rp-ink rp-focus rp-no-drag">
              Set the time zone in Settings
            </Link>
          </>
        ),
        figures: [],
        notes: [],
        basis: [],
      };
    const basis = [
      w.basis?.weekday ??
        'Mean units per weekday over the last 90 days of wine_consumption_log; a weekday with no observation is left blank rather than drawn at zero.',
      w.basis?.extremes,
    ];
    if (w.weekdayProfile.length === 0)
      return {
        say: 'No consumption is recorded in the last 90 days, so the week has no shape yet.',
        figures: [],
        notes: [],
        basis,
      };
    const data: Cat[] = w.weekdayProfile.map((d) => ({
      label: d.day.slice(0, 3),
      value: d.n > 0 ? Number(d.mean.toFixed(2)) : null,
      full: `${d.day} · ${countOf(d.n, 'observation', 'observations')}`,
    }));
    // A tie is not a ranking. The server now withholds both days and sets
    // `tie` (before 2026-09-03 it broke the tie by weekday order and reported
    // Sunday as busiest AND quietest); an older gateway sends neither field,
    // so the equality check stays as the fallback.
    const ranked = w.tie === false || (w.tie === null && !!w.bestDay && w.bestDay !== w.worstDay);
    const figures = [
      {
        label: 'Busiest day',
        value: ranked && w.bestDay ? w.bestDay : EM,
        note: 'More than one weekday shares the highest mean',
      },
      {
        label: 'Quietest day',
        value: ranked && w.worstDay ? w.worstDay : EM,
        note: 'More than one weekday shares the lowest mean',
      },
      { label: '28-day trend, per day', value: pct(w.trendPerDayPct) },
    ];
    const notes = ranked
      ? []
      : [
          'Busiest and quietest read — because more than one weekday shares the extreme, and naming one of them would be an arbitrary tie-break rather than a finding.',
        ];
    if (data.every((b) => (b.value ?? 0) === 0))
      return {
        say: 'Every weekday reads zero over the last 90 days — the consumption log recorded no movement, so the week has no shape to draw yet.',
        figures,
        notes,
        basis,
      };
    return {
      cats: {
        data,
        xLabel: 'weekday',
        yLabel: 'bottles/day',
        unit: 'bottles/day',
        format: (v) => figure(v),
      },
      table: {
        cols: [
          { key: 'd', label: 'Weekday' },
          { key: 'm', label: 'Mean/day', numeric: true },
          { key: 's', label: 'Spread', numeric: true },
          { key: 'n', label: 'Days seen', numeric: true },
        ],
        rows: w.weekdayProfile.map((d) => ({
          key: d.day,
          cells: [d.day, figure(d.mean), figure(d.stdev), figure(d.n)],
        })),
      },
      figures,
      notes,
      basis,
    };
  },
});

/* ───────────────────────────────────────────────────── 5. what's coming ── */

export interface AheadRegister {
  model: string | null;
  /** Since 2026-09-03: false when nothing was projected. */
  modelFitted: boolean | null;
  horizon: number;
  history: { dates: string[]; values: number[] };
  forecast: Array<{ date: string; value: number }>;
  totalForecastDemand: number | null;
  accuracy: { mape: number | null; scoredPoints: number; basis: string } | null;
  basis?: { demand?: string; model?: string; total?: string };
}

/**
 * The largest backtest error (MAPE, in percent) at which a projection is
 * still drawn. Above 50% the usual reading is "inaccurate": the model misses
 * by more than half of what was taken out (coordinator's call, F-134).
 */
export const MAX_SHOWN_MAPE = 50;

/** Why a projection is withheld, in the owner's words; null when it is shown. */
export function forecastWithheld(accuracy: AheadRegister['accuracy']): string | null {
  if (!accuracy || accuracy.mape == null)
    return 'Nothing is projected: the model could not be scored against this cellar’s own history, so there is no way to say how far to trust it.';
  if (accuracy.mape > MAX_SHOWN_MAPE)
    return `Nothing is projected: tried on this cellar’s own history, the model missed by ${ratioPct(accuracy.mape / 100, 0)} on average — more than half — so its figure would mislead more than help.`;
  return null;
}

const ahead = analysis<AheadRegister>({
  title: 'What’s coming',
  register: 'forecast register',
  answers: 'What the model expects the next fortnight to take out of the cellar',
  window: () => 'up to 120 days of history, from the first sale through yesterday; 14 days ahead',
  path: (rid) => `/analytics/forecast/${rid}?horizon=14`,
  graphs: ['line', 'area', 'bars', 'table', 'figure'],
  graphNote:
    'The projection is always the dashed half, whichever drawing you pick — a forecast that looks like a measurement is a lie told with a stroke width. No heat map: the history is one series, not a grid.',
  select: (raw) => {
    const d = obj(raw);
    const h = obj(d.history);
    return {
      model: typeof d.model === 'string' ? d.model : null,
      modelFitted: typeof d.modelFitted === 'boolean' ? d.modelFitted : null,
      horizon: num(d.horizon) ?? 14,
      history: {
        dates: Array.isArray(h.dates) ? (h.dates as string[]) : [],
        values: Array.isArray(h.values) ? (h.values as number[]) : [],
      },
      forecast: arr(d.forecast).map((f) => ({ date: str(f.date), value: num(f.value) ?? 0 })),
      totalForecastDemand: num(d.totalForecastDemand),
      accuracy: (d.accuracy ?? null) as AheadRegister['accuracy'],
      basis: d.basis as AheadRegister['basis'],
    };
  },
  view: (a) => {
    const basis = [
      a.basis?.demand,
      a.basis?.model,
      a.basis?.total,
      a.accuracy?.basis,
      a.accuracy ? `Scored on ${figure(a.accuracy.scoredPoints)} out-of-sample points.` : null,
    ];
    // Since 2026-09-03 the endpoint publishes no projection at all when the
    // history holds no observation, so this branch is now the server's own
    // verdict rather than this page inferring one from an empty array.
    if (a.forecast.length === 0 || a.modelFitted === false)
      return {
        say: 'Nothing is projected: no model fitted this history, so no line is drawn and no total is claimed.',
        figures: [
          { label: `Next ${a.horizon} days`, value: EM, note: 'No model fitted this history' },
          { label: 'Model', value: EM, note: 'No model fitted this history' },
        ],
        notes: [],
        basis,
      };
    // A projection is shown only beside a score that says it can be trusted
    // (F-134). With no backtest error, or one above MAX_SHOWN_MAPE, the
    // figure is withheld and the reason printed: 6,318.9 bottles at a 100%
    // error is not an expectation, it is noise with a decimal point.
    const withheld = forecastWithheld(a.accuracy);
    if (withheld)
      return {
        say: withheld,
        figures: [
          { label: `Next ${a.horizon} days`, value: EM, note: 'Withheld: not accurate enough to show' },
          {
            label: 'Backtest error (MAPE)',
            value: a.accuracy?.mape == null ? EM : ratioPct(a.accuracy.mape / 100, 1),
            note: 'Not scoreable on this history',
          },
          { label: 'Model', value: a.model || EM, note: 'No model fitted this history' },
        ],
        notes: [],
        basis,
      };
    const tail = 28;
    const values = a.history.values.slice(-tail);
    const hist: Cat[] = a.history.dates.slice(-tail).map((d, i) => ({
      label: shortDay(d),
      value: values[i] ?? null,
      projected: null,
      full: shortDay(d),
    }));
    const seam = hist.length > 0 ? hist[hist.length - 1] : null;
    // The seam carries both series so the dashed run starts where the measured
    // one ends, instead of floating a gap between them.
    if (seam) seam.projected = seam.value;
    const fut: Cat[] = a.forecast.map((f) => ({
      label: shortDay(f.date),
      value: null,
      projected: f.value,
      full: shortDay(f.date),
    }));
    return {
      cats: {
        data: [...hist, ...fut],
        xLabel: 'day',
        yLabel: 'bottles',
        unit: 'bottles',
        format: (v) => figure(v),
        projectedLabel: 'projected',
        refs: seam ? [{ x: seam.label, label: 'projected from here' }] : undefined,
      },
      table: {
        cols: [
          { key: 'd', label: 'Day' },
          { key: 'v', label: 'Projected', numeric: true },
        ],
        rows: a.forecast.map((f) => ({ key: f.date, cells: [shortDay(f.date), figure(f.value)] })),
        more: 'Every row below is the model’s expectation. None of it is trade that happened.',
      },
      figures: [
        { label: `Next ${a.horizon} days`, value: figure(a.totalForecastDemand) },
        {
          label: 'Backtest error (MAPE)',
          value: a.accuracy?.mape == null ? EM : ratioPct(a.accuracy.mape / 100, 1),
          note: 'Not scoreable on this history',
        },
        { label: 'Model', value: a.model || EM, note: 'No model fitted this history' },
      ],
      notes: ['The dashed run is projected. It is the model’s expectation, not trade that happened.'],
      basis,
    };
  },
});

export { reading, till, pacing, week, ahead };
