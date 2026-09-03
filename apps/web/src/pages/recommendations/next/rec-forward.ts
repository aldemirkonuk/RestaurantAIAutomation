/**
 * The two forward doors — "make this a goal" and "see it in reports".
 *
 * The founder, fourth pass (2026-09-03): *"maybe add couple buttons — that will
 * let them set the recommendations as goals, or have them see this changes in
 * reports (research the possible endpoints it can reach to give them better
 * insight)."*
 *
 * Both doors are MAPPINGS, not measurements. Nothing in this file invents a
 * figure: it decides, per rule, which of the gateway's six goal metrics records
 * the thing the rule asks you to move, and which of the reports sheet's eleven
 * cuttings draws the register the rule read. Every mapping is stated to the
 * manager on screen with its basis, and a rule that maps to NEITHER says so on
 * a disabled control rather than pretending.
 *
 * ── Why a target is never derived ──────────────────────────────────────────
 * A rule states a gap, not a target. `EntryVM` carries the observation as a
 * SENTENCE — the numbers inside it were formatted for reading, not for
 * arithmetic — so a target scraped back out of that sentence would be a figure
 * this page invented. The manager types the target; everything else on the
 * goal is derived and shown before they commit.
 *
 * Sources for every claim below:
 *  - the six metrics, their labels and units: `analytics/goals.service.ts`
 *    `SUPPORTED_METRICS` (:32-70); `wine_attach_rate` and every ratio metric
 *    are stored as a FRACTION (`withWine / checks.length`, :387-398), which is
 *    why `toStored()` divides a typed percentage by 100;
 *  - the periods a goal accepts: `goals.service.ts` `periodStart` (:252-279) —
 *    `day | week | month | quarter`, anything else trailing 30 days;
 *  - the create route and its two refusals: `POST /analytics/goals/:rid`
 *    (`analytics.controller.ts:496-513`) → 400 "Unsupported metric …" and 400
 *    "targetValue must be > 0" (both curl-verified 2026-09-03);
 *  - the rules and what each one reads: `analytics/recommendations.service.ts`
 *    :150-372;
 *  - the eleven cuttings, their titles and their endpoints:
 *    `apps/web/src/pages/reports/next/rp-catalogue.tsx` and the two register
 *    files it assembles; which of them lie on an unarranged sheet:
 *    `rp-sheet.ts` `DEFAULT_ON`. Copied here rather than imported — pages do
 *    not import each other's modules (page brief §"Legacy untouched").
 */

import { EM } from './rec-format';

/* ── Door one: the goal ──────────────────────────────────────────────────── */

/** The six the gateway will accept. A seventh is a 400, not a goal. */
export type MetricKey =
  | 'wine_revenue'
  | 'bottles_sold'
  | 'purchase_spend'
  | 'checks'
  | 'avg_check'
  | 'wine_attach_rate';

export type MetricUnit = 'currency' | 'units' | 'count' | 'percent';

/** The two periods this page offers. `day` is an action window, not a goal. */
export type GoalPeriod = 'week' | 'month';

export interface MetricSpec {
  label: string;
  unit: MetricUnit;
}

/** `SUPPORTED_METRICS` as the gateway declares it, labels included. */
export const METRICS: Record<MetricKey, MetricSpec> = {
  wine_revenue: { label: 'Wine revenue', unit: 'currency' },
  bottles_sold: { label: 'Bottles sold', unit: 'units' },
  purchase_spend: { label: 'Purchasing spend', unit: 'currency' },
  checks: { label: 'Checks served', unit: 'count' },
  avg_check: { label: 'Average check', unit: 'currency' },
  wine_attach_rate: { label: 'Wine attach rate', unit: 'percent' },
};

export const UNIT_SUFFIX: Record<MetricUnit, string> = {
  currency: '$',
  units: 'bottles',
  count: 'checks',
  percent: '%',
};

/**
 * A ratio metric is stored as a fraction, so "60" typed under a `%` suffix is
 * `0.6` on the wire. Getting this wrong would set a target of 6000% and report
 * the house as 1% of the way there for ever.
 */
export function toStored(unit: MetricUnit, typed: number): number {
  return unit === 'percent' ? typed / 100 : typed;
}

export interface GoalPlan {
  metricKey: MetricKey;
  metricLabel: string;
  unit: MetricUnit;
  direction: 'at_least' | 'at_most';
  /** The period the urgency implies. The manager can widen it before writing. */
  period: GoalPeriod;
  /** The default name, editable in the sheet. */
  name: string;
  /** Why this metric and not another — shown, never assumed. */
  basis: string;
}

export type GoalOffer =
  | { kind: 'plan'; plan: GoalPlan }
  | { kind: 'refused'; why: string };

interface RuleGoal {
  metricKey: MetricKey;
  direction: 'at_least' | 'at_most';
  name: (subject: string | null) => string;
  basis: string;
}

/**
 * Rule → the metric its own prescription moves.
 *
 * Read the `recommendation` field of each rule in `recommendations.service.ts`
 * and ask "what would record that this was done?". Where the answer is not one
 * of the six, the rule is ABSENT from this map on purpose and the control goes
 * dark with its reason — three of the thirteen rules are in that state, and
 * inventing a metric for them would be the fake button the house forbids.
 */
const RULE_GOAL: Record<string, RuleGoal> = {
  sales_below_weekday_baseline: {
    metricKey: 'wine_revenue',
    direction: 'at_least',
    name: (s) => (s ? `${s} wine revenue back to baseline` : 'Wine revenue back to baseline'),
    basis:
      'The rule compares a day’s wine sales with the same weekday’s baseline, so wine revenue is the figure that records the recovery.',
  },
  weekly_demand_slide: {
    metricKey: 'wine_revenue',
    direction: 'at_least',
    name: () => 'Wine revenue back to last week’s level',
    basis:
      'The rule reads a week-over-week fall in sales; wine revenue is the same quantity at a longer grain.',
  },
  weekday_gap: {
    metricKey: 'wine_revenue',
    direction: 'at_least',
    name: (s) => (s ? `Lift ${s} wine revenue` : 'Lift the quiet day’s wine revenue'),
    basis:
      'The rule prescribes an offer on the weakest weekday; what it would move is wine revenue.',
  },
  dead_stock_capital: {
    metricKey: 'bottles_sold',
    direction: 'at_least',
    name: () => 'Move the idle bottles',
    basis:
      'The rule asks you to convert idle stock back into cash. Bottles sold is the metric that records bottles leaving the shelf; the capital figure itself is not one the gateway will hold a goal on.',
  },
  plowhorse_repricing: {
    metricKey: 'wine_revenue',
    direction: 'at_least',
    name: () => 'Wine revenue after the reprice',
    basis:
      'A 5–8% rise on wines that already move is a revenue move at constant volume, so wine revenue is where it lands.',
  },
  puzzle_activation: {
    metricKey: 'bottles_sold',
    direction: 'at_least',
    name: () => 'Bottles sold on the by-the-glass feature',
    basis:
      'The rule puts a high-margin slow mover by the glass; the test of it is whether the bottles move.',
  },
  spend_acceleration: {
    metricKey: 'purchase_spend',
    direction: 'at_most',
    name: () => 'Hold purchasing spend',
    basis:
      'The rule is about spend running ahead of demand, and purchasing spend is the same number the rule read — the one goal on this page that counts DOWN.',
  },
  staff_spread: {
    metricKey: 'avg_check',
    direction: 'at_least',
    name: () => 'Average check across the floor',
    basis:
      'The insight behind this rule is `waiter.avg_check.peer_rank` — it ranks servers by average check, so closing the spread shows up as the house average check.',
  },
  pairing_promotion: {
    metricKey: 'wine_attach_rate',
    direction: 'at_least',
    name: () => 'Wine attach rate on the pairing',
    basis:
      'A pairing promoted at the table is an attach-rate move: more checks carrying wine, not necessarily a bigger check.',
  },
};

/** The rules that map to no metric, each with the reason the manager sees. */
const GOAL_REFUSAL: Record<string, string> = {
  stockout_imminent:
    'A stockout is an availability event, not one of the six figures a goal can be held on (wine revenue · bottles sold · purchasing spend · checks · average check · attach rate). Ruling it off when the order is placed is the record this one keeps.',
  vendor_concentration:
    'Vendor concentration is an HHI over your purchase book. The gateway holds goals on six figures only, and a concentration index is not among them.',
  revenue_concentration:
    'Revenue concentration is a Gini coefficient across wines. The gateway holds goals on six figures only, and a distribution measure is not among them.',
};

/** The prefix the goal-behind family uses — one rule per goal already set. */
const GOAL_RULE_PREFIX = 'goal_behind';

export interface ForwardEntry {
  ruleKey: string;
  category: string;
  urgency: string;
  subject: string | null;
}

/** `now` is an action window; the shortest window a goal can be read over is a week. */
export function periodFor(urgency: string): GoalPeriod {
  return urgency === 'this_month' ? 'month' : 'week';
}

export const PERIOD_LABEL: Record<GoalPeriod, string> = {
  week: 'This week',
  month: 'This month',
};

/**
 * The deadline a period implies, as a business date.
 *
 * Stated on the sheet before the write because it CANNOT be changed
 * afterwards: the gateway's only goal mutation is
 * `PUT /analytics/goals/:rid/:goalId/status` (`analytics.controller.ts:536`),
 * which moves a goal between active / achieved / missed / archived and touches
 * nothing else.
 */
export function deadlineFor(period: GoalPeriod, now = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + (period === 'week' ? 7 : 30));
  return d.toISOString().substring(0, 10);
}

export function goalOfferFor(entry: ForwardEntry): GoalOffer {
  if (entry.ruleKey.startsWith(GOAL_RULE_PREFIX))
    return {
      kind: 'refused',
      why: 'This entry is already about a goal you set — it fired because that goal is behind its pace. Making a second goal from it would double-count the same target.',
    };
  const refusal = GOAL_REFUSAL[entry.ruleKey];
  if (refusal) return { kind: 'refused', why: refusal };
  const spec = RULE_GOAL[entry.ruleKey];
  if (!spec)
    return {
      kind: 'refused',
      why: `This page has no metric filed for the rule ${entry.ruleKey}, so it will not guess one ${EM} a goal on the wrong figure is worse than no goal.`,
    };
  const metric = METRICS[spec.metricKey];
  return {
    kind: 'plan',
    plan: {
      metricKey: spec.metricKey,
      metricLabel: metric.label,
      unit: metric.unit,
      direction: spec.direction,
      period: periodFor(entry.urgency),
      name: spec.name(entry.subject),
      basis: spec.basis,
    },
  };
}

/* ── Door two: the cutting ───────────────────────────────────────────────── */

/**
 * `same-register` — the cutting reads the SAME gateway endpoint the rule read,
 * so the drawing is the rule's own arithmetic laid out.
 * `same-question` — a different register that plots the quantity the rule
 * names. Useful, but not the same fetch, and the row says so rather than
 * letting the manager assume it is.
 */
export type CuttingBasis = 'same-register' | 'same-question';

export interface CuttingLink {
  /** The catalogue id on the reports sheet (`rp-sheet.ts` `ANALYSIS_IDS`). */
  id: string;
  /** The reader's title for it, as the catalogue prints it. */
  title: string;
  /** The gateway path the cutting reads. */
  path: string;
  basis: CuttingBasis;
  /** True when it lies on a sheet nobody has arranged (`rp-sheet.ts` DEFAULT_ON). */
  onDefaultSheet: boolean;
  /** The href this page mints. */
  href: string;
}

interface CuttingSpec {
  id: string;
  title: string;
  path: string;
  basis: CuttingBasis;
}

/** `DEFAULT_ON` copied from `rp-sheet.ts` — the eight on an unarranged sheet. */
const DEFAULT_SHEET = new Set([
  'reading',
  'till',
  'pacing',
  'week',
  'ahead',
  'quadrants',
  'ledger',
  'writing',
]);

const RULE_CUTTING: Record<string, CuttingSpec> = {
  sales_below_weekday_baseline: {
    id: 'week',
    title: 'The week’s shape',
    path: '/analytics/seasonality/:rid',
    basis: 'same-question',
  },
  weekly_demand_slide: {
    id: 'till',
    title: 'Through the till',
    path: '/analytics/pos-revenue/:rid',
    basis: 'same-question',
  },
  weekday_gap: {
    id: 'week',
    title: 'The week’s shape',
    path: '/analytics/seasonality/:rid',
    basis: 'same-register',
  },
  stockout_imminent: {
    id: 'restock',
    title: 'What to buy back',
    path: '/analytics/inventory-science/:rid',
    basis: 'same-register',
  },
  dead_stock_capital: {
    id: 'ledger',
    title: 'Figures of record',
    path: '/analytics/financial/:rid',
    basis: 'same-register',
  },
  plowhorse_repricing: {
    id: 'quadrants',
    title: 'Margin against movement',
    path: '/analytics/menu-engineering/:rid',
    basis: 'same-register',
  },
  puzzle_activation: {
    id: 'quadrants',
    title: 'Margin against movement',
    path: '/analytics/menu-engineering/:rid',
    basis: 'same-register',
  },
  spend_acceleration: {
    id: 'pacing',
    title: 'Spend pacing',
    path: '/analytics/cashflow/:rid',
    basis: 'same-register',
  },
  staff_spread: {
    id: 'service',
    title: 'Who served it',
    path: '/analytics/waiters/:rid',
    basis: 'same-question',
  },
};

/** Rules whose register is not on the sheet at all, with the reason. */
const CUTTING_REFUSAL: Record<string, string> = {
  vendor_concentration:
    'No cutting answers this one: the concentration register (`/analytics/risk`) is not among the eleven analyses the reports sheet can lay down.',
  revenue_concentration:
    'No cutting answers this one: the concentration register (`/analytics/risk`) is not among the eleven analyses the reports sheet can lay down.',
  pairing_promotion:
    'No cutting answers this one: basket affinity reaches the sheet only as a sentence inside “The reading”, never as its own drawing.',
};

export type CuttingOffer =
  | { kind: 'cutting'; link: CuttingLink }
  | { kind: 'refused'; why: string };

export function cuttingFor(entry: ForwardEntry): CuttingOffer {
  if (entry.ruleKey.startsWith(GOAL_RULE_PREFIX))
    return {
      kind: 'refused',
      why: 'No cutting answers this one: goal progress is read from `/analytics/goals/:rid/:goalId/progress`, which is not among the eleven analyses the reports sheet can lay down.',
    };
  const refusal = CUTTING_REFUSAL[entry.ruleKey];
  if (refusal) return { kind: 'refused', why: refusal };
  const spec = RULE_CUTTING[entry.ruleKey];
  if (!spec)
    return {
      kind: 'refused',
      why: `This page has no cutting filed for the rule ${entry.ruleKey}, so it will not send you to a drawing that may not be about it.`,
    };
  const q = `cutting=${encodeURIComponent(spec.id)}&rec=${encodeURIComponent(
    entry.ruleKey,
  )}&from=recommendations`;
  return {
    kind: 'cutting',
    link: {
      ...spec,
      onDefaultSheet: DEFAULT_SHEET.has(spec.id),
      href: `/reports?${q}`,
    },
  };
}

export const CUTTING_BASIS_WORDS: Record<CuttingBasis, string> = {
  'same-register':
    'the same register this rule read — the drawing is its own arithmetic, laid out',
  'same-question':
    'a different register that plots what this rule is about — not the same fetch',
};

/**
 * What the manager is told about landing.
 *
 * The reports sheet does not read `?cutting=` yet (grepped 2026-09-03: no
 * `useSearchParams` and no `URLSearchParams` anywhere under
 * `apps/web/src/pages/reports/`), so this link opens the sheet and names the
 * cutting; it does not scroll to it or add it. Saying that is cheaper than a
 * button that quietly under-delivers. Filed as §13.
 */
export function landingWords(link: CuttingLink): string {
  return link.onDefaultSheet
    ? 'It lies on the sheet already. Reports does not yet open on a named cutting, so you land on the sheet with it in place.'
    : 'It is not on an unarranged sheet — add it with “Add a cutting” while arranging. Reports does not yet open on a named cutting.';
}
