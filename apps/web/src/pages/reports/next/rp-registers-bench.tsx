/**
 * "Against ourselves" — the benchmark cutting, and the one honest shape a
 * benchmark can take in this product today.
 *
 *   "For competitor lens, I understand it. but also it s a great feature to
 *    have, but it has to be somehow editable for personalized screens."
 *                                        — the founder, /reports, 2026-09-03
 *   Answered: BOTH readings. The lens ideas already land as cuttings each
 *   person keeps or removes on their own sheet; this file is the second half —
 *   a benchmark cutting, editable per personal sheet like any other.
 *
 * WHAT IT COMPARES, AND WHAT IT REFUSES TO
 * ----------------------------------------
 * DESIGN-FOUNDATION §6 files *"benchmark that is not ourselves"* as a table
 * stake this product lacks, and it is still lacking: Mudavym holds no other
 * house's books. Production carries ten restaurant rows and one real tenant
 * (memory: production-tenant-shape), so any "market median" drawn here would be
 * this house compared with itself wearing a costume, or a number nobody
 * measured. Neither is going on a chart (ADR 0020, ADR 0051).
 *
 * So the cutting compares the two things that ARE real:
 *
 *  1. **This house against its own past** — the engine's own period comparison:
 *     `cashflow.spendLast30d` against `spendPrev30d` with the server's own
 *     `paceDeltaPct`, and `seasonality.trendPerDayPct` over 28 days. Both are
 *     computed in the gateway with their own basis sentences, so the page
 *     prints them rather than deriving a comparison of its own.
 *  2. **Each goal against its own baseline** — `baseline_value` is where the
 *     house stood when the goal was set, `current_value` is where it stands.
 *     Three columns, printed side by side, and NO delta computed here: both
 *     operands are on screen and the reader can see the distance without this
 *     page making a claim about it.
 *
 * And it says the third thing out loud: there are no peers in this data. A
 * cutting that quietly omitted that would be the exact fault this house keeps
 * finding — an absence rendered as though it were a measurement.
 *
 * The catalogue's own medians ARE drawn, where the engine publishes them: the
 * menu-engineering crosshair on "Margin against movement". This cutting names
 * that rather than duplicating it, because two cuttings drawing one median is
 * a duplicate, not a comparison.
 */

import { EM, countOf, figure, moneyIn, num, pct } from './rp-format';
import { analysis, arr, obj, str } from './rp-spec';
import { inUnit } from './rp-registers-goals';

export interface BenchGoalRow {
  name: string;
  metricKey: string;
  baseline: number | null;
  current: number | null;
  target: number | null;
  direction: string;
  /**
   * The metric's unit, carried on the overview (`currency`, `percent`,
   * `days`, ...); empty from an older gateway, which prints a bare figure.
   */
  unit: string;
  /** Why the latest reading was refused (the gateway then sends no current). */
  unread: string | null;
}

export interface BenchRegister {
  spendLast30d: number | null;
  spendPrev30d: number | null;
  paceDeltaPct: number | null;
  committed: number | null;
  openOrderCount: number | null;
  trendPerDayPct: number | null;
  bestDay: string | null;
  worstDay: string | null;
  tie: boolean;
  weekdays: Array<{ day: string; mean: number | null; n: number | null }>;
  goals: BenchGoalRow[];
  /**
   * Why a buying window is withheld: an order in it carries no recorded cost
   * (the cashflow lens's `unread`, the purchases goal's own sentence).
   */
  spendUnread: string | null;
  /** True when that register's own read failed: a read that did not happen, never "nothing". */
  cashflowMissing: boolean;
  seasonalityMissing: boolean;
  goalsMissing: boolean;
  /** The house has no time zone, so spend and weekdays are withheld (ADR 0296). */
  zoneUnset: boolean;
  basis: Array<string | null | undefined>;
}

export const bench = analysis<BenchRegister>({
  title: 'Against ourselves',
  register: 'comparison register',
  answers:
    'How this house stands against its own past — and, plainly, that no other house is in this comparison',
  window: () => '180 days of buying, 90 days of weekdays, each goal since it was set',
  // The three registers it compares, read directly and shared with "Spend
  // pacing", "The week's shape" and the goals desk, rather than
  // /analytics/overview, which ran eight lenses to return three (audit G9).
  path: null,
  sources: {
    cashflow: (rid) => `/analytics/cashflow/${rid}`,
    seasonality: (rid) => `/analytics/seasonality/${rid}`,
    goals: (rid) => `/analytics/goals/${rid}?status=active`,
  },
  graphs: ['bars', 'table', 'figure'],
  graphNote:
    'Bars draw the one pair that shares a unit — money paid to vendors this month against last. No line or area: two windows are not a sequence. No scatter and no heat map: there is no second axis and no second dimension to lay one out on.',
  select: (raw) => {
    const d = obj(raw);
    const cf = obj(d.cashflow);
    const se = obj(d.seasonality);
    const cfBasis = obj(cf.basis);
    const seBasis = obj(se.basis);
    return {
      spendLast30d: num(cf.spendLast30d),
      spendPrev30d: num(cf.spendPrev30d),
      paceDeltaPct: num(cf.paceDeltaPct),
      committed: num(cf.committedOpenOrders),
      spendUnread: (() => {
        const u = obj(cf.unread);
        const first = [u.spendLast30d, u.spendPrev30d].find(
          (v) => typeof v === 'string' && v.trim() !== '',
        );
        return first == null ? null : String(first);
      })(),
      openOrderCount: num(cf.openOrderCount),
      trendPerDayPct: num(se.trendPerDayPct),
      bestDay: se.bestDay == null ? null : str(se.bestDay),
      worstDay: se.worstDay == null ? null : str(se.worstDay),
      tie: se.tie === true,
      weekdays: arr(se.weekdayProfile).map((w) => ({
        day: str(w.day),
        mean: num(w.mean),
        n: num(w.n),
      })),
      goals: arr(d.goals).map((g) => ({
        name: str(g.name) || 'Untitled goal',
        metricKey: str(g.metric_key),
        baseline: num(g.baseline_value),
        current: num(g.current_value),
        target: num(g.target_value),
        direction: str(g.direction) || 'at_least',
        unit: str(g.unit),
        unread: str(g.current_unread) || null,
      })),
      // A source whose read failed arrives as `null` (useReportsNextData):
      // a read that did not happen, never "this house bought nothing".
      cashflowMissing: d.cashflow == null,
      seasonalityMissing: d.seasonality == null,
      goalsMissing: d.goals == null,
      zoneUnset: cf.zoneUnset === true || se.zoneUnset === true,
      basis: [cfBasis.outflow, seBasis.weekday, seBasis.extremes] as Array<
        string | null | undefined
      >,
    };
  },
  view: (b, ctx) => {
    const money = moneyIn(ctx.currency);
    const noPeers =
      'No other house is in this comparison. Mudavym holds only this restaurant’s books, so there is no market median to stand beside these figures — every one of them is this house against its own past. The one median the engine does publish, over this house’s own list, is drawn as the crosshair on “Margin against movement”.';

    const figures = [
      {
        label: 'Bought, last 30 days',
        value: money(b.spendLast30d),
        note: b.cashflowMissing
          ? 'the cashflow register could not be read'
          : b.spendLast30d === null && b.spendUnread
            ? 'an order in this window has no recorded cost'
            : undefined,
      },
      { label: 'Bought, the 30 before', value: money(b.spendPrev30d) },
      {
        label: 'Pace against last month',
        value: b.paceDeltaPct === null ? EM : pct(b.paceDeltaPct),
        note:
          b.paceDeltaPct === null
            ? 'the server withholds a pace when the two windows are not comparable'
            : undefined,
      },
      { label: 'Committed, not yet delivered', value: money(b.committed) },
      {
        label: 'Trend per day, last 28 days',
        value: b.trendPerDayPct === null ? EM : pct(b.trendPerDayPct),
      },
      { label: 'Goals running', value: b.goalsMissing ? EM : figure(b.goals.length) },
    ];

    if (b.cashflowMissing && b.seasonalityMissing && b.goalsMissing)
      return {
        say: `None of the three registers this compares could be read — buying, weekdays and goals. ${noPeers}`,
        figures,
        notes: [],
        basis: b.basis,
      };

    // Two bars at zero are an empty axis that reads as "nothing happened", which
    // is the one rendering this page refuses (§1b). The pair is only DRAWN when
    // at least one window carries a figure; otherwise the note below says why,
    // matching what "Spend pacing" already does with the same payload.
    const bothWindows =
      b.spendLast30d !== null &&
      b.spendPrev30d !== null &&
      (b.spendLast30d !== 0 || b.spendPrev30d !== 0);

    // The real reason no pair is drawn, said ONCE: in place of the generic
    // "cannot be drawn as bars" line when the reader picked bars, and among the
    // notes otherwise (r56: bars mode printed the generic line above it).
    const zeroNote =
      'No delivered purchase order falls in either 30-day window, so no bars are drawn — two bars at zero would say the same thing less clearly.';
    const zoneNote =
      'This house’s time zone isn’t set, so spend and weekdays cannot be filed on the house’s day; those figures are em dashes until it is set in Settings, under Time zone.';
    const cashflowNote =
      'The cashflow register could not be read, so its four figures are em dashes rather than zeros.';
    const whyNoBars = bothWindows
      ? undefined
      : b.cashflowMissing
        ? cashflowNote
        : b.zoneUnset
          ? zoneNote
          : b.spendUnread
            ? b.spendUnread
            : b.spendLast30d === 0 && b.spendPrev30d === 0
            ? zeroNote
            : 'One of the two 30-day windows has no figure, so the pair is not drawn — one bar alone is not a comparison.';

    const rows: Array<{ key: string; cells: string[] }> = [];
    rows.push({
      key: 'buying',
      cells: [
        'Buying, 30 days against the 30 before',
        // "Then" is the earlier window and "Now" the latest, as the header says.
        money(b.spendPrev30d, 'table'),
        money(b.spendLast30d, 'table'),
        b.paceDeltaPct === null ? EM : pct(b.paceDeltaPct),
      ],
    });
    rows.push({
      key: 'week',
      cells: [
        'The week’s own extremes',
        b.tie ? EM : (b.bestDay ?? EM),
        b.tie ? EM : (b.worstDay ?? EM),
        b.tie
          ? 'shared — withheld'
          : b.trendPerDayPct === null
            ? EM
            : `${pct(b.trendPerDayPct)} a day`,
      ],
    });
    for (const w of b.weekdays)
      rows.push({
        key: `wd-${w.day}`,
        cells: [
          `${w.day}, mean per service`,
          w.mean === null ? EM : figure(w.mean, 'compact'),
          w.n === null ? EM : countOf(w.n, 'observation', 'observations'),
          '',
        ],
      });
    for (const g of b.goals)
      rows.push({
        key: `goal-${g.name}`,
        cells: [
          `${g.name} — since it was set`,
          inUnit(g.baseline, g.unit, ctx.currency),
          inUnit(g.current, g.unit, ctx.currency),
          inUnit(g.target, g.unit, ctx.currency),
        ],
      });

    return {
      cats: bothWindows
        ? {
            data: [
              { label: 'Last 30 days', value: b.spendLast30d },
              { label: 'The 30 before', value: b.spendPrev30d },
            ],
            xLabel: 'window',
            yLabel: 'paid to vendors',
            unit: 'paid to vendors',
            format: (v: number) => money(v, 'compact'),
          }
        : undefined,
      table: {
        cols: [
          { key: 'what', label: 'Against' },
          { key: 'a', label: 'Then / best', numeric: true },
          { key: 'b', label: 'Now / worst', numeric: true },
          { key: 'c', label: 'Change / target', numeric: true },
        ],
        rows,
      },
      figures,
      undrawn: whyNoBars,
      notes: [
        noPeers,
        // The cashflow lens reads its orders whole now (ADR 0292): a failed
        // read refuses the lens, so a pair of zeros is a quiet stretch.
        b.spendLast30d === 0 && b.spendPrev30d === 0 ? zeroNote : null,
        b.zoneUnset ? zoneNote : null,
        b.cashflowMissing ? cashflowNote : null,
        b.spendUnread,
        b.seasonalityMissing
          ? 'The seasonality register could not be read, so the week’s extremes are em dashes.'
          : null,
        b.goalsMissing
          ? 'The goals list could not be read, so no goal is compared with its baseline — this is not the same as no goal running.'
          : b.goals.length === 0
          ? 'No goal is running, so there is nothing to measure against a baseline. Set one on the goals desk and it appears here.'
          : null,
        // A refused reading leaves no "now": the older number is not shown as
        // where the goal stands, and the reason is the gateway's own.
        ...b.goals
          .filter((g) => g.unread !== null)
          .map((g) => `${g.name}: its latest reading was refused, so it has no figure for now (${g.unread?.replace(/\.$/, '')}).`),
      ].filter((n): n is string => n !== null),
      basis: b.basis,
    };
  },
});
