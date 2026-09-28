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

import { EM, countOf, figure, money, num, pct } from './rp-format';
import { analysis, arr, obj, str } from './rp-spec';

export interface BenchGoalRow {
  name: string;
  metricKey: string;
  baseline: number | null;
  current: number | null;
  target: number | null;
  direction: string;
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
  /** True when the whole cashflow lens failed inside the parallel call. */
  cashflowMissing: boolean;
  seasonalityMissing: boolean;
  basis: Array<string | null | undefined>;
}

export const bench = analysis<BenchRegister>({
  title: 'Against ourselves',
  register: 'overview register',
  answers:
    'How this house stands against its own past — and, plainly, that no other house is in this comparison',
  window: () => '180 days of buying, 90 days of weekdays, each goal since it was set',
  path: (rid) => `/analytics/overview/${rid}`,
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
      goals: arr(d.activeGoals).map((g) => ({
        name: str(g.name) || 'Untitled goal',
        metricKey: str(g.metric_key),
        baseline: num(g.baseline_value),
        current: num(g.current_value),
        target: num(g.target_value),
        direction: str(g.direction) || 'at_least',
      })),
      // `getOverview` runs its eight lenses through Promise.allSettled and
      // returns `null` for any that threw. A null lens is a read that did not
      // happen — never "this house bought nothing".
      cashflowMissing: d.cashflow == null,
      seasonalityMissing: d.seasonality == null,
      basis: [cfBasis.outflow, seBasis.weekday, seBasis.extremes] as Array<
        string | null | undefined
      >,
    };
  },
  view: (b) => {
    const noPeers =
      'No other house is in this comparison. Mudavym holds only this restaurant’s books, so there is no market median to stand beside these figures — every one of them is this house against its own past. The one median the engine does publish, over this house’s own list, is drawn as the crosshair on “Margin against movement”.';

    const figures = [
      {
        label: 'Bought, last 30 days',
        value: money(b.spendLast30d),
        note: b.cashflowMissing ? 'the cashflow lens did not answer' : undefined,
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
        label: 'The week’s trend',
        value: b.trendPerDayPct === null ? EM : pct(b.trendPerDayPct),
      },
      { label: 'Goals running', value: figure(b.goals.length) },
    ];

    if (b.cashflowMissing && b.seasonalityMissing && b.goals.length === 0)
      return {
        say: `Nothing in the overview register answered — neither the buying lens nor the weekday lens returned, and no goal is running. ${noPeers}`,
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

    const rows: Array<{ key: string; cells: string[] }> = [];
    rows.push({
      key: 'buying',
      cells: [
        'Buying, 30 days against the 30 before',
        money(b.spendLast30d, 'table'),
        money(b.spendPrev30d, 'table'),
        b.paceDeltaPct === null ? EM : pct(b.paceDeltaPct),
      ],
    });
    rows.push({
      key: 'week',
      cells: [
        'The week’s own extremes',
        b.tie ? EM : (b.bestDay ?? EM),
        b.tie ? EM : (b.worstDay ?? EM),
        b.tie ? 'shared — withheld' : b.trendPerDayPct === null ? EM : pct(b.trendPerDayPct),
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
          g.baseline === null ? EM : figure(g.baseline, 'compact'),
          g.current === null ? EM : figure(g.current, 'compact'),
          g.target === null ? EM : figure(g.target, 'compact'),
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
      notes: [
        noPeers,
        // Measured on the running gateway, 2026-09-03: this tenant returns
        // spendLast30d = spendPrev30d = 0. `getCashflow` sums a loader that
        // degrades a FAILED query to `[]` (`advanced-analytics.service.ts:125-146`,
        // logged but not signalled in the payload), so a pair of zeros is "no
        // delivered order came back", which is either no buying or a read that
        // did not answer. That is the same shape `financial.cogs` was fixed for
        // (§9.2); it is NOT fixed in cashflow yet, so the cutting says so rather
        // than presenting $0 against $0 as a measured standstill. This is a
        // statement about the register, not a verdict dressed as the server's.
        b.spendLast30d === 0 && b.spendPrev30d === 0
          ? 'Both buying windows came back at zero, so no bars are drawn — two bars at zero would say the same thing less clearly. And the zeros are ambiguous: the cashflow lens sums a loader that returns an empty list for a failed query as well as for a quiet month, so a pair of zeros means "no delivered order was returned", not necessarily "nothing was bought".'
          : null,
        b.cashflowMissing
          ? 'The buying lens did not answer inside the overview call, so its four figures are em dashes rather than zeros.'
          : null,
        b.seasonalityMissing
          ? 'The weekday lens did not answer inside the overview call.'
          : null,
        b.goals.length === 0
          ? 'No goal is running, so there is nothing to measure against a baseline. Set one on the goals desk and it appears here.'
          : null,
      ].filter((n): n is string => n !== null),
      basis: b.basis,
    };
  },
});
