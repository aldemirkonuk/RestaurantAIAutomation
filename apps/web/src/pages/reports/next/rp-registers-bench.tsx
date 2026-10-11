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
 *     house stood when the goal was set; "now" is the Goals cutting's own
 *     progress read (`ctx.goalsNow`, F-816), or the stored `current_value`,
 *     labelled as such, where that read did not answer.
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

import { EM, codeOf, countOf, figure, money, num, pct, ratioPct, shortDay } from './rp-format';
import { AMOUNTS_WITHHELD } from './rp-registers-house';
import { unpricedNotes } from './rp-registers-trade';
import { analysis, arr, obj, str, type ViewCtx } from './rp-spec';

export interface BenchGoalRow {
  id: string;
  name: string;
  metricKey: string;
  /** The metric's unit, from the gateway: currency, percent, units, count or days. */
  unit: string;
  /** When `current` was last stored (the goal last opened), YYYY-MM-DD; null when not sent. */
  readOn: string | null;
  baseline: number | null;
  current: number | null;
  target: number | null;
  direction: string;
}

export interface BenchRegister {
  /** Staff are sent no spend or committed money (F-203). */
  amountsWithheld?: boolean;
  spendLast30d: number | null;
  spendPrev30d: number | null;
  paceDeltaPct: number | null;
  committed: number | null;
  /** The codes the buying and committed figures are in (F-1145). */
  spendCurrency?: string | null;
  committedCurrency?: string | null;
  openOrderCount: number | null;
  /** Orders the buying and committed figures leave out for want of a price (F-701). */
  spendUnpricedCount?: number;
  committedUnpricedCount?: number;
  /** Why the buying figures are blank: paid in two currencies (F-1042). */
  spendNote?: string | null;
  committedNote?: string | null;
  trendPerDayPct: number | null;
  bestDay: string | null;
  worstDay: string | null;
  tie: boolean;
  weekdays: Array<{ day: string; mean: number | null; n: number | null }>;
  goals: BenchGoalRow[];
  /** True when the gateway left the goals out — it does for any role but
   *  owner and manager (F-794) — so the cutting says nothing about them. */
  goalsWithheld: boolean;
  /** True when the goals read failed inside the parallel call (F-573). */
  goalsMissing: boolean;
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
      amountsWithheld: d.amountsWithheld === true,
      spendLast30d: num(cf.spendLast30d),
      spendPrev30d: num(cf.spendPrev30d),
      paceDeltaPct: num(cf.paceDeltaPct),
      committed: num(cf.committedOpenOrders),
      spendCurrency: codeOf(cf.spendCurrency),
      committedCurrency: codeOf(cf.committedCurrency),
      openOrderCount: num(cf.openOrderCount),
      spendUnpricedCount: num(cf.spendUnpricedCount) ?? undefined,
      committedUnpricedCount: num(cf.committedUnpricedCount) ?? undefined,
      spendNote: typeof cf.spendNote === 'string' ? cf.spendNote : null,
      committedNote: typeof cf.committedNote === 'string' ? cf.committedNote : null,
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
        id: str(g.id),
        name: str(g.name) || 'Untitled goal',
        metricKey: str(g.metric_key),
        unit: str(g.unit) || 'count',
        readOn: typeof g.updated_at === 'string' ? g.updated_at.slice(0, 10) : null,
        baseline: num(g.baseline_value),
        current: num(g.current_value),
        target: num(g.target_value),
        direction: str(g.direction) || 'at_least',
      })),
      goalsWithheld: !('activeGoals' in d),
      // `getOverview` runs its eight lenses through Promise.allSettled and
      // returns `null` for any that threw. A null lens is a read that did not
      // happen — never "this house bought nothing".
      // A null goals lens is a read that failed, never "no goal is running" (F-573).
      // Absent is withheld (F-794); present and null is a failed read (F-573).
      goalsMissing: 'activeGoals' in d && d.activeGoals == null,
      cashflowMissing: d.cashflow == null,
      seasonalityMissing: d.seasonality == null,
      basis: [cfBasis.outflow, seBasis.weekday, seBasis.extremes] as Array<
        string | null | undefined
      >,
    };
  },
  view: (b, ctx: ViewCtx) => {
    const noPeers =
      'No other house is in this comparison. Mudavym holds only this restaurant’s books, so there is no market median to stand beside these figures — every one of them is this house against its own past. The one median the engine does publish, over this house’s own list, is drawn as the crosshair on “Margin against movement”.';

    const allFigures = [
      {
        label: 'Bought, last 30 days',
        value: money(b.spendLast30d, 'full', b.spendCurrency),
        note: b.cashflowMissing ? 'the buying lens did not answer' : undefined,
      },
      { label: 'Bought, the 30 before', value: money(b.spendPrev30d, 'full', b.spendCurrency) },
      {
        label: 'Pace against last month',
        value: b.paceDeltaPct === null ? EM : pct(b.paceDeltaPct),
        note:
          b.paceDeltaPct === null
            ? 'the server withholds a pace when the two windows are not comparable'
            : undefined,
      },
      { label: 'Committed, not yet delivered', value: money(b.committed, 'full', b.committedCurrency) },
      {
        label: 'Trend per day, last 28 days',
        value: b.trendPerDayPct === null ? EM : pct(b.trendPerDayPct),
      },
      ...(b.goalsWithheld
        ? []
        : [{
            label: 'Goals running',
            value: b.goalsMissing ? EM : figure(b.goals.length),
            note: b.goalsMissing ? 'the goals could not be read' : undefined,
          }]),
    ];
    const withheld = b.amountsWithheld === true;
    const spendLabels = ['Bought, last 30 days', 'Bought, the 30 before', 'Committed, not yet delivered'];
    const figures = withheld
      ? allFigures.filter((x) => !spendLabels.includes(x.label))
      : allFigures;

    if (b.cashflowMissing && b.seasonalityMissing && b.goalsMissing)
      return {
        say: `Nothing in the overview register answered — neither the buying lens, the weekday lens nor the goals returned. ${noPeers}`,
        figures,
        notes: [],
        basis: b.basis,
      };
    if (b.cashflowMissing && b.seasonalityMissing && b.goals.length === 0)
      return {
        say: b.goalsWithheld
          ? `Nothing in the overview register answered — neither the buying lens nor the weekday lens returned. ${noPeers}`
          : `Nothing in the overview register answered — neither the buying lens nor the weekday lens returned, and no goal is running. ${noPeers}`,
        figures,
        notes: [],
        basis: b.basis,
      };

    // Two bars at zero are an empty axis that reads as "nothing happened", which
    // is the one rendering this page refuses (§1b). The pair is only DRAWN when
    // at least one window carries a figure; otherwise the note below says why,
    // matching what "Spend pacing" already does with the same payload.
    const bothWindows =
      !withheld &&
      b.spendLast30d !== null &&
      b.spendPrev30d !== null &&
      (b.spendLast30d !== 0 || b.spendPrev30d !== 0);

    const rows: Array<{ key: string; cells: string[] }> = [];
    if (!withheld)
      rows.push({
        key: 'buying',
        cells: [
          'Buying, 30 days against the 30 before',
          money(b.spendLast30d, 'table', b.spendCurrency),
          money(b.spendPrev30d, 'table', b.spendCurrency),
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
    // "Now" is the Goals cutting's own reading of the goal where it answered,
    // so the two cuttings on one sheet print one figure (F-816). Where it did
    // not, the overview's stored value is printed and the row says so, with
    // the day it was last read where the gateway sends it (F-573). Each
    // figure in the goal's own unit (F-573).
    let storedNow = false;
    for (const g of b.goals) {
      const fresh = !!ctx.goalsNow && g.id !== '' && g.id in ctx.goalsNow;
      const now = fresh ? ctx.goalsNow![g.id] : g.current;
      if (!fresh) storedNow = true;
      rows.push({
        key: `goal-${g.id || g.name}`,
        cells: [
          fresh
            ? `${g.name} — since it was set`
            : g.readOn
              ? `${g.name} — when set, last read ${shortDay(g.readOn)}, target`
              : `${g.name} — since it was set (now: last stored)`,
          inUnit(g.baseline, g.unit),
          inUnit(now, g.unit),
          inUnit(g.target, g.unit),
        ],
      });
    }

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
            format: (v: number) => money(v, 'compact', b.spendCurrency),
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
        withheld ? AMOUNTS_WITHHELD : null,
        ...(withheld ? [] : unpricedNotes(b.spendUnpricedCount, b.committedUnpricedCount)),
        !withheld && b.spendNote ? b.spendNote : null,
        !withheld && b.committedNote ? b.committedNote : null,
        // Since ADR 0292 / F-186 the cashflow loader reads the whole window or
        // refuses (`loadOrders`, advanced-analytics.service.ts); a refusal
        // nulls the lens, which `cashflowMissing` below says in its own words.
        // So a pair of zeros that did come back is a measured "no delivered
        // order in either window", not an unanswered read (F-797).
        !withheld && b.spendLast30d === 0 && b.spendPrev30d === 0
          ? 'Both buying windows came back at zero, so no bars are drawn — two bars at zero would say the same thing less clearly. The zeros mean no order was delivered in either window; if the buying records could not be read, this cutting says the buying lens did not answer instead.'
          : null,
        b.cashflowMissing && !withheld
          ? 'The buying lens did not answer inside the overview call, so its four figures are em dashes rather than zeros.'
          : null,
        b.seasonalityMissing
          ? 'The weekday lens did not answer inside the overview call.'
          : null,
        b.goalsMissing
          ? 'The goals could not be read just now, so whether any goal is running is not known. The goals desk reads them on its own.'
          : b.goals.length === 0
            ? b.goalsWithheld
              ? null
              : 'No goal is running, so there is nothing to measure against a baseline. Set one on the goals desk and it appears here.'
            : storedNow
              ? 'A goal marked “last stored” or “last read” shows where it stood the last time it was opened on the goals desk, not a fresh count, so it can trail the Goals cutting. Open the Goals cutting for where it stands right now.'
              : null,
      ].filter((n): n is string => n !== null),
      basis: b.basis,
    };
  },
});

/**
 * The Goals register's payload as the bench reads it: goal id → its current
 * figure. Read structurally so the two register files do not import each
 * other. `undefined` until the Goals register has answered.
 */
export function goalsNowFrom(goalsData: unknown): Record<string, number | null> | undefined {
  if (!goalsData) return undefined;
  const out: Record<string, number | null> = {};
  for (const g of arr(obj(goalsData).goals)) {
    const id = str(g.id);
    if (id) out[id] = typeof g.current === 'number' && Number.isFinite(g.current) ? g.current : null;
  }
  return out;
}

/** A goal figure in its own unit — a percent is not a count is not money. */
function inUnit(v: number | null, unit: string): string {
  if (v === null) return EM;
  if (unit === 'percent') return ratioPct(v);
  if (unit === 'currency') return money(v, 'compact');
  return figure(v, 'compact');
}
