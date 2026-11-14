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

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ReadingList from './ReadingList';
import {
  EM,
  MONO,
  WEEKDAY_SHORT,
  categoryLabel,
  UNFILED,
  countOf,
  figure,
  moneyIn,
  num,
  pct,
  shortDay,
  weekLabel,
  weekStart,
  weekdayIndex,
} from './rp-format';
import { analysis, arr, obj, str } from './rp-spec';
import type { Cat, Cell, Measure } from './rp-view';

/* ───────────────────────────────────────────────────── 1. the reading ──── */

export interface ReadingRow {
  ruleKey: string;
  sentence: string;
  category: string;
  score: number;
  entityLabel: string | null;
  /** When the engine wrote it (`analytics_insights.computed_at`); null from a live compute. */
  computedAt: string | null;
}

/**
 * When the oldest of `rows` was computed, in words: "today at 6:00 AM",
 * "yesterday at 6:00 AM", "on Nov 11 at 6:00 AM". Null when no row carries a
 * time (a live compute, written as the page asked).
 *
 * The reading said "recomputed hourly"; the scheduler's default is once a day
 * at 06:00 on the server's clock, so the page opened on a sentence up to a day
 * older than the live registers under it, with no date (r36 reports gap 4).
 */
export function readingAge(rows: ReadonlyArray<Pick<ReadingRow, 'computedAt'>>, now = new Date()): string | null {
  const times = rows
    .map((r) => (r.computedAt ? Date.parse(r.computedAt) : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return null;
  const at = new Date(Math.min(...times));
  const clock = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayOf(now) - dayOf(at)) / 86400000);
  if (days <= 0) return `today at ${clock}`;
  if (days === 1) return `yesterday at ${clock}`;
  return `on ${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${clock}`;
}

/**
 * The sentences, and how many the gateway withheld for the reader's role (ADR
 * 0348: staff are never shown the till, a spend, a margin or a named server's
 * ranking). `withheldForRole` rides on the list so every reader of the rows
 * (Ask the book, the sentence list) keeps reading an array.
 */
export type ReadingRows = ReadingRow[] & { withheldForRole?: number };

/** The sentence a reader is told about the ones written for owners and managers. */
export function withheldSentences(n: number): string {
  return `${countOf(n, 'sentence is', 'sentences are')} about money, the till or a named person, and ${n === 1 ? 'is' : 'are'} written for owners and managers.`;
}

const reading = analysis<ReadingRows>({
  title: 'The reading',
  register: 'insight register',
  answers: 'What the engine has noticed, in its own sentences',
  window: () => 'the stored insight feed, computed once a day unless the house set another cadence',
  path: (rid) => `/analytics/insights/${rid}?limit=40`,
  graphs: ['table', 'bars'],
  graphNote:
    'Bars count the sentences in each category — nothing more. There is no line, area or heat map here because a sentence has no magnitude and no date to plot it against.',
  select: (raw) => {
    const withheld = num(obj(raw).withheldForRole);
    const rows: ReadingRows = arr(obj(raw).insights)
      .map((row) => {
        const candidate = str(row.candidate_key ?? row.candidateKey);
        const entity = str(row.entity_key ?? row.entityKey);
        return {
          ruleKey: `insight:${candidate}${entity ? `:${entity}` : ''}`,
          sentence: str(row.sentence),
          // A sentence with no category is not filed under Sales (r28 gap 20).
          category: str(row.category) || UNFILED,
          score: num(row.score) ?? 0,
          entityLabel: (row.entity_label ?? row.entityLabel ?? null) as string | null,
          computedAt: str(row.computed_at ?? row.computedAt) || null,
        };
      })
      .filter((r) => r.sentence !== '')
      .sort((a, b) => b.score - a.score);
    if (withheld !== null && withheld > 0) rows.withheldForRole = withheld;
    return rows;
  },
  view: (rows) => {
    const withheld = rows.withheldForRole ?? 0;
    if (rows.length === 0)
      return {
        say:
          withheld > 0
            ? `Nothing here is written for your role. ${withheldSentences(withheld)}`
            : 'The engine has produced no insight for this restaurant yet. It computes once a day, and again whenever this page finds nothing stored — there is nothing to say, rather than nothing to show.',
        figures: [],
        notes: [],
        basis: [],
      };
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    const age = readingAge(rows);
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
        { label: 'Computed', value: age ?? 'as this page asked' },
      ],
      notes: [
        'Sentences are printed as the engine wrote them. This page never composes one.',
        ...(withheld > 0 ? [withheldSentences(withheld)] : []),
        ...(age
          ? [
              `The oldest sentence here was computed ${age}. The registers below are read live, so a figure in a sentence can be older than the same figure below.`,
            ]
          : []),
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
  from: string;
  to: string;
  days: number;
  /** The house's zone the days were filed in (ADR 0296); null from an older gateway or a house with none. */
  timezone: string | null;
  /** True when the house has no time zone: no day can be filed, so nothing is stated. */
  zoneUnset: boolean;
  /**
   * Sparse; a `null` revenue is a day the server could not state. `checks` is
   * that day's count of checks; `null` from a gateway that does not send it,
   * and then the till offers no bars and a line.
   */
  dailySeries: Array<{ date: string; revenue: number | null; checks: number | null }>;
  /** True when the gateway withheld the till from this reader (ADR 0298 decision 9). */
  salesWithheld: boolean;
}

/**
 * The day's checks and average check, beside the day's takings, for bars and
 * a line (founder /goal 2026-11-07: "bar graph and their combinations"). Only
 * when every day the gateway sent carries its count: a count missing on some
 * days would draw those days as having none. `null` otherwise, and the
 * drawing says it cannot be drawn that way.
 */
export function tillMeasures(
  w: TillWindow,
  shown: string[],
  money: ReturnType<typeof moneyIn>,
): Measure[] | undefined {
  if (w.dailySeries.length === 0 || w.dailySeries.some((d) => d.checks == null)) return undefined;
  const taken = new Map(w.dailySeries.map((d) => [d.date, d.revenue]));
  const checks = new Map(w.dailySeries.map((d) => [d.date, d.checks as number]));
  return [
    {
      key: 'checks',
      label: 'Checks',
      unit: 'checks',
      format: (v) => figure(v),
      values: shown.map((date) => checks.get(date) ?? null),
    },
    {
      key: 'avg',
      label: 'Average check',
      unit: 'a check',
      format: (v) => money(v, 'compact'),
      values: shown.map((date) => {
        const r = taken.get(date);
        const c = checks.get(date);
        return r != null && c != null && c > 0 ? r / c : null;
      }),
    },
  ];
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

/** Every YYYY-MM-DD from `from` to `to`, both inclusive; [] when either is unusable. */
export function daysBetween(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return [];
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00`);
  for (let guard = 0; guard < 400; guard++) {
    const day = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
    out.push(day);
    if (day >= to) break;
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const till = analysis<TillWindow>({
  title: 'Through the till',
  register: 'till register',
  answers: 'What guests actually paid, day by day',
  window: (ctx) => `the last ${ctx.days} days of POS checks`,
  path: (rid, ctx) => `/analytics/pos-revenue/${rid}?days=${ctx.days}`,
  // The till's takings are a sales figure (ADR 0298 decision 9, ADR 0348):
  // staff keep the page, and this register is held back for them, never asked.
  readers: ['owner', 'manager'],
  graphs: ['area', 'line', 'bars', 'combo', 'heatmap', 'table', 'figure'],
  graphNote:
    'This is the one register with a date on every row, so it is the one that can be a heat map: weekday against week. Bars and a line put each day’s takings beside its checks or its average check, each on its own axis. No scatter — a day’s checks and its takings move together by construction, so a scatter would only draw that.',
  takesWindow: true,
  select: (raw) => {
    const d = obj(raw);
    return {
      posConnected: d.posConnected === true,
      revenue: num(d.revenue),
      checkCount: num(d.checkCount),
      from: str(d.from),
      to: str(d.to),
      days: num(d.days) ?? 0,
      timezone: str(d.timezone) || null,
      zoneUnset: d.zoneUnset === true,
      salesWithheld: d.salesWithheld === true,
      // A day the server sent with no figure stays unknown (null), never 0.
      dailySeries: arr(d.dailySeries).map((r) => ({
        date: str(r.date),
        revenue: num(r.revenue),
        checks: num(r.checks),
      })),
    };
  },
  view: (w, ctx) => {
    // A role the page took for a manager, which the gateway reads as staff
    // (a demotion mid-session): the answer carries no figure, and saying "no
    // till" here would be a claim about the house, not about the reader.
    if (w.salesWithheld)
      return {
        say: 'The till register is written for owners and managers. Nothing below is claimed.',
        figures: [],
        notes: [],
        basis: [],
      };
    const money = moneyIn(ctx.currency);

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
        say: zoneUnsetSay('no sale can be filed on the house’s day yet'),
        figures: [],
        notes: [],
        basis: [],
      };
    const avg =
      w.revenue != null && w.checkCount != null && w.checkCount > 0
        ? w.revenue / w.checkCount
        : null;
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
    if (w.dailySeries.length === 0)
      return {
        say: 'The till answered, and no check fell inside this window.',
        figures,
        notes: [],
        basis,
      };

    const cols = weekColumns(w.from, w.to);
    const byDate = new Map(w.dailySeries.map((d) => [d.date, d.revenue]));
    const cells: Cell[] = [];
    for (const [date, revenue] of byDate) {
      if (revenue == null) continue;
      cells.push({
        row: WEEKDAY_SHORT[weekdayIndex(date)],
        col: weekLabel(weekStart(date)),
        value: revenue,
        title: shortDay(date),
      });
    }
    // Every house day of the window gets its slot, so a day with no check is
    // a gap in the line or an empty bar slot, not a day the axis skips and
    // the line quietly bridges.
    const span = daysBetween(w.from, w.to);
    const counted = w.dailySeries.every((d) => d.checks != null);
    const shown = span.length > 0 ? span : w.dailySeries.map((d) => d.date);
    return {
      cats: {
        data: shown.map((date) => ({
          label: shortDay(date),
          value: byDate.get(date) ?? null,
          full: byDate.has(date) ? shortDay(date) : `${shortDay(date)} · no check`,
        })),
        xLabel: 'day',
        yLabel: 'taken',
        unit: 'taken',
        format: (v) => money(v, 'compact'),
        measureLabel: 'Taken',
        measures: tillMeasures(w, shown, money),
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
          ...(counted ? [{ key: 'checks', label: 'Checks', numeric: true }] : []),
        ],
        rows: w.dailySeries.map((d) => ({
          key: d.date,
          cells: [
            shortDay(d.date),
            money(d.revenue, 'table'),
            ...(counted ? [figure(d.checks)] : []),
          ],
        })),
        more:
          w.dailySeries.length < w.days
            ? `${w.dailySeries.length} of the ${w.days} days in the window rang up a check; the rest are absent rather than zero.`
            : undefined,
      },
      figures,
      notes: [],
      basis,
    };
  },
});

/**
 * A house with no time zone has no day to file anything on (ADR 0296): the
 * register states no figure and says so, with the way to set it.
 */
export function zoneUnsetSay(what: string): ReactNode {
  return (
    <>
      This house&rsquo;s time zone isn&rsquo;t set, so {what} — nothing is drawn here.{' '}
      <Link to="/settings?tab=time-zone" className="rp-link rp-ink rp-focus rp-no-drag">
        Set the time zone in Settings
      </Link>
    </>
  );
}

/* ───────────────────────────────────────────────────── 3. spend pacing ── */

export interface PacingRegister {
  basis?: { outflow?: string };
  /** True when the house has no time zone: spend is withheld, commitments are not. */
  zoneUnset: boolean;
  spendLast30d: number | null;
  spendPrev30d: number | null;
  paceDeltaPct: number | null;
  projectedNext4Weeks: number[] | null;
  committedOpenOrders: number | null;
  openOrderCount: number | null;
  /**
   * Why a figure is withheld: an order in its window carries no recorded cost
   * (the purchases goal's own sentence). Null where it was summed whole.
   */
  unread?: {
    spendLast30d: string | null;
    spendPrev30d: string | null;
    projectedNext4Weeks: string | null;
    committedOpenOrders: string | null;
  };
}

const unreadOf = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

const pacing = analysis<PacingRegister>({
  title: 'Spend pacing',
  register: 'cashflow register',
  answers: 'Whether buying is running hot or cold against the month before',
  window: () => '180 days of purchasing, compared in two 30-day windows',
  path: (rid) => `/analytics/cashflow/${rid}`,
  // What the house paid its vendors is money and suppliers (ADR 0348): staff
  // keep the page, and this register is held back for them, never asked.
  readers: ['owner', 'manager'],
  graphs: ['bars', 'table', 'figure'],
  graphNote:
    'Two windows are two bars; a line through two points would draw a trend that has not been measured. The four-week projection is printed rather than plotted — a weekly figure and a 30-day total do not share an axis.',
  select: (raw) => {
    const d = obj(raw);
    return {
      basis: d.basis as PacingRegister['basis'],
      zoneUnset: d.zoneUnset === true,
      spendLast30d: num(d.spendLast30d),
      spendPrev30d: num(d.spendPrev30d),
      paceDeltaPct: num(d.paceDeltaPct),
      projectedNext4Weeks: Array.isArray(d.projectedNext4Weeks)
        ? (d.projectedNext4Weeks as number[])
        : null,
      committedOpenOrders: num(d.committedOpenOrders),
      openOrderCount: num(d.openOrderCount),
      unread: {
        spendLast30d: unreadOf(obj(d.unread).spendLast30d),
        spendPrev30d: unreadOf(obj(d.unread).spendPrev30d),
        projectedNext4Weeks: unreadOf(obj(d.unread).projectedNext4Weeks),
        committedOpenOrders: unreadOf(obj(d.unread).committedOpenOrders),
      },
    };
  },
  view: (c, ctx) => {
    const money = moneyIn(ctx.currency);
    const figures = [
      { label: 'Pace', value: pct(c.paceDeltaPct), note: 'Needs two comparable 30-day windows' },
      {
        label: 'Committed, not yet delivered',
        value: money(c.committedOpenOrders),
        note: c.unread?.committedOpenOrders ?? undefined,
      },
      { label: 'Open orders', value: figure(c.openOrderCount) },
    ];
    const projection = c.projectedNext4Weeks;
    const notes = [
      projection && projection.length > 0 ? (
        <>
          Projected, next four weeks:{' '}
          <span style={{ fontFamily: MONO }}>
            {projection.map((v) => money(v, 'compact')).join(' · ')}
          </span>{' '}
          — a Holt projection, not a measurement.
        </>
      ) : c.unread?.projectedNext4Weeks ? (
        <>No projection: {c.unread?.projectedNext4Weeks}</>
      ) : (
        <>
          Too few weeks of purchasing to project — {EM} rather than a line drawn through two points.
        </>
      ),
    ];
    // The cost train (#1016) withholds a window holding an uncosted order
    // and says so in `unread`; #843's "adds nothing to spend" note is gone.
    const basis = [c.basis?.outflow ? `Outflow: ${c.basis.outflow}.` : null];
    if (c.zoneUnset)
      return {
        say: zoneUnsetSay('no delivery can be filed on the house’s day yet; what is committed is still stated'),
        figures: figures.slice(1),
        notes: [],
        basis: [],
      };
    // A window withheld over an order with no recorded cost is not drawn: a
    // bar beside a missing one would read as a pace, and the purchases goal
    // refuses the same window. The sentence says which window and why.
    const withheld = c.unread?.spendLast30d ?? c.unread?.spendPrev30d;
    if (withheld)
      return {
        say: withheld,
        figures: [
          { label: 'Last 30 days', value: money(c.spendLast30d), note: c.unread?.spendLast30d ?? undefined },
          { label: 'The 30 before', value: money(c.spendPrev30d), note: c.unread?.spendPrev30d ?? undefined },
          ...figures,
        ],
        notes,
        basis,
      };
    // Two invisible bars are not a chart. The orders are read whole (ADR
    // 0292), so two zeros are a quiet stretch, never a read that came back
    // empty; the sentence is the honest rendering and names WHICH windows.
    if (c.spendLast30d === 0 && c.spendPrev30d === 0)
      return {
        say: 'No delivered purchase order falls in either 30-day window, so there is no pace to draw — two bars at zero would say the same thing less clearly.',
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
        format: (v) => money(v, 'compact'),
      },
      table: {
        cols: [
          { key: 'w', label: 'Window' },
          { key: 'v', label: 'Paid out', numeric: true },
        ],
        rows: [
          { key: 'prev', cells: ['The 30 days before last', money(c.spendPrev30d, 'table')] },
          { key: 'last', cells: ['The last 30 days', money(c.spendLast30d, 'table')] },
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
  weekdayProfile: Array<{ day: string; mean: number; stdev: number | null; n: number }>;
  bestDay: string | null;
  worstDay: string | null;
  /** Since 2026-09-03: true when an extreme is shared and both are withheld. */
  tie: boolean | null;
  trendPerDayPct: number | null;
  /** True when the house has no time zone: no weekday can be named. */
  zoneUnset: boolean;
  basis?: { weekday?: string; extremes?: string };
}

const week = analysis<WeekRegister>({
  title: 'The week’s shape',
  register: 'seasonality register',
  answers: 'Which nights carry the week',
  window: () => 'the last 90 days of the consumption log',
  path: (rid) => `/analytics/seasonality/${rid}`,
  graphs: ['bars', 'combo', 'line', 'area', 'table'],
  graphNote:
    'Bars and a line puts the mean beside its spread or the days seen. No heat map: seasonality returns one dimension — a mean per weekday — and a heat map needs two. No scatter, and no reference line: the endpoint publishes no median or threshold for this register, and a rule we invented is not the engine’s.',
  select: (raw) => {
    const d = obj(raw);
    return {
      weekdayProfile: arr(d.weekdayProfile).map((p) => ({
        day: str(p.day),
        mean: num(p.mean) ?? 0,
        // Null stays null: one observation has no sample spread (not zero).
        stdev: num(p.stdev),
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
    const basis = [
      w.basis?.weekday ??
        'Mean units per weekday over the last 90 days of wine_consumption_log; a weekday with no observation is left blank rather than drawn at zero.',
      w.basis?.extremes,
    ];
    if (w.zoneUnset)
      return {
        say: zoneUnsetSay('no pour can be filed on the house’s weekday yet'),
        figures: [],
        notes: [],
        basis: [],
      };
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
    // A tie is not a ranking. The server withholds only the extreme that is
    // shared and sets `tie` when either is (`separableExtremes`), so a day it
    // still names is a finding and is shown. Before 2026-09-03 it broke the
    // tie by weekday order and reported Sunday as busiest AND quietest; an
    // older gateway sends no `tie`, so the equality check stays the fallback.
    const sent = w.tie !== null || (!!w.bestDay && w.bestDay !== w.worstDay);
    const best = sent ? w.bestDay : null;
    const worst = sent ? w.worstDay : null;
    const shared = w.tie === true || !sent;
    const figures = [
      {
        label: 'Busiest day',
        value: best ?? EM,
        note: 'More than one weekday shares the highest mean',
      },
      {
        label: 'Quietest day',
        value: worst ?? EM,
        note: 'More than one weekday shares the lowest mean',
      },
      { label: '28-day trend, per day', value: pct(w.trendPerDayPct) },
    ];
    const notes = !shared
      ? []
      : !best && !worst
        ? [
            'Busiest and quietest are left blank because more than one weekday shares the extreme, and naming one of them would be an arbitrary tie-break rather than a finding.',
          ]
        : !best
          ? [
              'Busiest is left blank because more than one weekday shares the highest mean, and naming one of them would be an arbitrary tie-break rather than a finding.',
            ]
          : !worst
            ? [
                'Quietest is left blank because more than one weekday shares the lowest mean, and naming one of them would be an arbitrary tie-break rather than a finding.',
              ]
            : [];
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
        measureLabel: 'Mean per day',
        // Same points as `data`; a weekday never observed is a gap in both.
        measures: [
          {
            key: 'spread',
            label: 'Spread',
            unit: 'bottles/day',
            format: (v) => figure(v),
            values: w.weekdayProfile.map((d) =>
              d.n > 0 && d.stdev != null ? Number(d.stdev.toFixed(2)) : null,
            ),
          },
          {
            key: 'seen',
            label: 'Days seen',
            unit: 'days',
            format: (v) => figure(v),
            values: w.weekdayProfile.map((d) => (d.n > 0 ? d.n : null)),
          },
        ],
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
  forecast: Array<{ date: string; value: number | null }>;
  totalForecastDemand: number | null;
  accuracy: { mape: number | null; scoredPoints: number; basis: string } | null;
  basis?: { demand?: string; model?: string; total?: string };
}

/**
 * How far the projection has missed in past weeks, in words (ADR 0104: people
 * read words, not error statistics). `mape` is the server's backtest error in
 * percent; the number itself stays in the API and in the working the server
 * writes. The bands are the whole rule, pinned by `rp-registers-trade.test.tsx`.
 */
export function heldWords(mape: number | null): string {
  if (mape == null || !Number.isFinite(mape) || mape < 0) return EM;
  if (mape <= 15) return 'Held close in past weeks';
  if (mape <= 35) return 'Off by a fair margin at times; read the total as rough';
  return 'Has missed often; read it as a direction, not a number';
}

/**
 * A projected count of bottles, said the way bottles are counted.
 *
 * The engine's expectation is a real number, and the sheet printed it raw:
 * "Next 14 days 202.964" (browser walk 2026-11-12) — three decimals of a
 * bottle, and no unit. The fortnight's total is said to the nearest bottle,
 * with its noun ("203 bottles"); a total above nothing that rounds to none is
 * "under 1 bottle", never "0". A single day's projection keeps one place,
 * because a slow wine expecting 0.4 of a bottle a day is not a wine expecting
 * none. The raw figure stays in the API.
 */
export function projectedBottles(v: unknown, per: 'total' | 'day'): string {
  const n = num(v);
  if (n === null) return EM;
  if (per === 'day') return figure(Math.round(n * 10) / 10);
  const whole = Math.round(n);
  if (whole === 0 && n > 0) return 'under 1 bottle';
  return countOf(whole, 'bottle', 'bottles');
}

const ahead = analysis<AheadRegister>({
  title: 'What’s coming',
  register: 'forecast register',
  answers: 'What the model expects the next fortnight to take out of the cellar',
  window: () => '120 days of history, 14 days ahead',
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
      forecast: arr(d.forecast).map((f) => ({ date: str(f.date), value: num(f.value) })),
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
        format: (v) => projectedBottles(v, 'day'),
        projectedLabel: 'projected',
        refs: seam ? [{ x: seam.label, label: 'projected from here' }] : undefined,
      },
      table: {
        cols: [
          { key: 'd', label: 'Day' },
          { key: 'v', label: 'Projected', numeric: true },
        ],
        rows: a.forecast.map((f) => ({ key: f.date, cells: [shortDay(f.date), projectedBottles(f.value, 'day')] })),
        more: 'Every row below is the model’s expectation. None of it is trade that happened.',
      },
      figures: [
        { label: `Next ${a.horizon} days`, value: projectedBottles(a.totalForecastDemand, 'total') },
        {
          label: 'How it has held',
          value: heldWords(a.accuracy?.mape ?? null),
          note: 'Not scoreable on this history',
        },
      ],
      notes: ['The dashed run is projected. It is the model’s expectation, not trade that happened.'],
      basis,
    };
  },
});

export { reading, till, pacing, week, ahead };
