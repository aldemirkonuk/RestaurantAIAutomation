/**
 * The book of goal scenarios, read once for the whole app.
 *
 *   *"we're going to create possible analytic scenarios a restaurant might set
 *    as a goal"*                                — the founder, 2026-09-04
 *
 * Both goal sheets — `/reports`' goals desk and `/recommendations`' "make this
 * a goal" panel — offer the same picker, so they read it through the same hook.
 * That is deliberate rather than convenient: `report-cuttings.ts` documents what
 * happens when one vocabulary lives in two files that cannot import each other,
 * and a scenario list that differed between the two sheets would let a manager
 * see a scenario on one page and not on the other with no way to tell which was
 * right. A hook is the one place both pages CAN share (they may not import each
 * other's modules), so the vocabulary lives here.
 *
 * NOT TENANT-KEYED, ON PURPOSE
 * ----------------------------
 * `GET /analytics/goal-scenarios` reads no restaurant (the route takes no id;
 * `goalScenarioBook()` takes no argument). So the query key carries no
 * `activeRestaurantId`: adding one would refetch an identical payload on every
 * restaurant switch and imply the book is a reading of that house's books,
 * which is the exact impression the payload's own `basis` line exists to
 * prevent. Every OTHER query on both pages stays tenant-keyed.
 *
 * FAILURE POSTURE
 * ---------------
 * There is no bundled copy of the catalogue to fall back to. A copy would drift
 * from the gateway's silently — and, worse, would render as a working picker
 * over a failed fetch. When the read fails the picker says so in words and the
 * metric list underneath still works, because a manager who knows what they
 * want must never be blocked by a browsing aid being down.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api/client';

export type ScenarioPeriod = 'week' | 'month' | 'quarter';

export interface ScenarioRangePublished {
  kind: 'published';
  words: string;
  source: string;
  url: string;
  published: string;
  caveat: string;
}

export interface ScenarioRangeNone {
  kind: 'none';
  why: string;
}

export type ScenarioRange = ScenarioRangePublished | ScenarioRangeNone;

export interface GoalScenario {
  id: string;
  name: string;
  question: string;
  /** Null when the gateway has no measure for it — the row is then unselectable. */
  metricKey: string | null;
  metricLabel: string | null;
  needsMetric: string | null;
  direction: 'at_least' | 'at_most';
  period: ScenarioPeriod;
  range: ScenarioRange;
  cuttingId: string | null;
  cuttingWhy: string;
  cuttingAnswers: string | null;
  producer: 'goal-reached' | 'ceiling-held' | null;
  ruleKeys: string[];
  servable: boolean;
}

export interface GoalScenarioBook {
  caveat: string;
  scenarios: GoalScenario[];
  counts: { total: number; servable: number; needsAMetric: number };
  basis: string;
}

/* ── decoding: a field this page cannot read is dropped, never guessed ───── */

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function orNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function decodeRange(raw: unknown): ScenarioRange {
  const r = obj(raw);
  if (r.kind === 'published') {
    return {
      kind: 'published',
      words: str(r.words),
      source: str(r.source),
      url: str(r.url),
      published: str(r.published),
      caveat: str(r.caveat),
    };
  }
  return {
    kind: 'none',
    // An empty reason would render as a blank line where an explanation
    // belongs, which reads as "there is no range and no reason" rather than
    // "this payload is older than the field".
    why: str(r.why) || 'No reason was given for the missing range.',
  };
}

const PERIODS: ScenarioPeriod[] = ['week', 'month', 'quarter'];

export function decodeBook(raw: unknown): GoalScenarioBook {
  const d = obj(raw);
  const scenarios = (Array.isArray(d.scenarios) ? d.scenarios : [])
    .map((entry): GoalScenario => {
      const s = obj(entry);
      const period = PERIODS.includes(s.period as ScenarioPeriod)
        ? (s.period as ScenarioPeriod)
        : 'month';
      const metricKey = orNull(s.metricKey);
      return {
        id: str(s.id),
        name: str(s.name),
        question: str(s.question),
        metricKey,
        metricLabel: orNull(s.metricLabel),
        needsMetric: orNull(s.needsMetric),
        direction: s.direction === 'at_most' ? 'at_most' : 'at_least',
        period,
        range: decodeRange(s.range),
        cuttingId: orNull(s.cuttingId),
        cuttingWhy: str(s.cuttingWhy),
        cuttingAnswers: orNull(s.cuttingAnswers),
        producer:
          s.producer === 'goal-reached' || s.producer === 'ceiling-held' ? s.producer : null,
        ruleKeys: (Array.isArray(s.ruleKeys) ? s.ruleKeys : []).map(str).filter(Boolean),
        // Derived from the metric rather than trusted from the wire: `servable`
        // is what enables a control, and a stale `true` beside a null metric
        // would be a button that 400s.
        servable: metricKey !== null,
      };
    })
    .filter((s) => s.id !== '');
  const counts = obj(d.counts);
  return {
    caveat: str(d.caveat),
    scenarios,
    counts: {
      total: typeof counts.total === 'number' ? counts.total : scenarios.length,
      servable:
        typeof counts.servable === 'number'
          ? counts.servable
          : scenarios.filter((s) => s.servable).length,
      needsAMetric:
        typeof counts.needsAMetric === 'number'
          ? counts.needsAMetric
          : scenarios.filter((s) => !s.servable).length,
    },
    basis: str(d.basis),
  };
}

export interface GoalScenarios {
  book: GoalScenarioBook | undefined;
  loading: boolean;
  /** Words for the reader when the book could not be read. Never an empty list. */
  failure: string | null;
}

export function useGoalScenarios(): GoalScenarios {
  const query = useQuery({
    queryKey: ['goal-scenarios'],
    queryFn: async () => {
      const { data } = await apiClient.get('/analytics/goal-scenarios');
      return decodeBook(data);
    },
    // The book changes when this repo deploys, not when a restaurant trades.
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  return {
    book: query.data,
    loading: query.isLoading,
    failure: query.isError
      ? 'The book of scenarios could not be read, so only the measure list below is offered. Nothing about your goals is affected.'
      : null,
  };
}
