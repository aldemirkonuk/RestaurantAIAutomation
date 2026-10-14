/**
 * Round 6 — sketch 122 direction B, "Goals in the Masthead".
 *
 * The founder, 2026-09-25 (item 24): *"direction B is better"* — confirmed as
 * sketch 122 — and, the same day, "Recommended" on every one of the sketch's
 * questions 2-10 (round 5; ADR 0160 §108's bracket). This file is the pure
 * half of what that round adds to the page: nothing here reads the network or
 * renders, so each reading is testable on its own.
 *
 *  - THE MARGIN. The house's decided goals sit in a narrow column at the
 *    masthead's right, under "The Morning Letter", read from
 *    `GET /analytics/goals/:rid/progress` — the one read that RECOMPUTES a
 *    goal (the stored `current_value` column is only refreshed by the hourly
 *    insight sweep, so a bar drawn off the plain list reads "nothing done"
 *    for a goal that is half met; `rp-registers-goals.tsx` says the same).
 *  - THE SUGGESTION. One standing entry whose rule maps to a goal metric
 *    (`rec-forward.ts`'s own map) on which the house holds NO active goal. Its
 *    target is never derived: the tap opens the goal sheet with the target
 *    blank (sketch 122 "Setting a goal is a deliberate exception").
 *  - THE QUIET TIER, as its substitute (Q4, "Substitute now, field next
 *    (Recommended)"): the engine's own `sourcesUnread` names which sources did
 *    not answer, so a short book is not read as a quiet week.
 *  - THE DELTA, per reader (Q9, "Per reader (Recommended)"): what stands now
 *    that this reader's own last letter did not carry, and what it carried
 *    that no longer stands.
 */

import { inHouseMarks } from '@/lib/currency';
import type { GroupMark } from '@/lib/parseDecimal';
import { goalOfferFor, type GoalPlan } from './rec-forward';
import { ratioPct } from '../../reports/next/rp-format';
import type { EntryVM, GoalsVM } from './useRecommendationsNextData';

/* ── the margin's rows ───────────────────────────────────────────────────── */

/** One goal as `GET /analytics/goals/:rid/progress` returns it, read defensively. */
export interface GoalProgressRow {
  id: string;
  name: string;
  metricKey: string;
  /** The gateway's own unit word: currency · units · count · percent · days. */
  unit: string;
  direction: 'at_least' | 'at_most';
  /** null = not read. Never 0 standing in for it. */
  current: number | null;
  target: number | null;
  /** 0..1 as the gateway computes it (current / target). null = not read. */
  progressPct: number | null;
  /**
   * null = no pace was judged. That is "no deadline" only when `deadline` is
   * null: a goal with one whose pace the gateway did not judge (a house with
   * no time zone, ADR 0296) still has its deadline.
   */
  onTrack: boolean | null;
  /** The goal's deadline (`YYYY-MM-DD`), or null when it has none. */
  deadline: string | null;
  daysLeft: number | null;
  /** Why this goal could not be read, or null. */
  unreadable: string | null;
  /**
   * w109-gross-basis (ADR 0341): an Average check or Wine revenue goal at a
   * house whose till prices include tax says the figure holds it, in the
   * gateway's words. null (or absent) for every other goal and house.
   */
  taxNote?: string | null;
}

/** undefined = not asked yet · null = the read failed · otherwise the book. */
export type GoalBookVM =
  | { goals: GoalProgressRow[]; total: number; truncated: boolean }
  | null
  | undefined;

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** One entry of the progress response — `{ goal, current, … }` or `{ goal, unreadable, reason }`. */
export function toProgressRow(raw: Record<string, unknown>): GoalProgressRow {
  const g = (raw.goal ?? {}) as Record<string, unknown>;
  const unreadable = raw.unreadable === true;
  return {
    id: String(g.id ?? ''),
    name: typeof g.name === 'string' && g.name ? g.name : 'Untitled goal',
    metricKey: typeof g.metric_key === 'string' ? g.metric_key : '',
    unit: typeof raw.unit === 'string' ? raw.unit : 'count',
    direction: g.direction === 'at_most' ? 'at_most' : 'at_least',
    current: unreadable ? null : num(raw.current),
    target: unreadable ? num(g.target_value) : num(raw.target),
    progressPct: unreadable ? null : num(raw.progressPct),
    onTrack: unreadable || typeof raw.onTrack !== 'boolean' ? null : raw.onTrack,
    deadline: typeof g.deadline === 'string' && g.deadline ? g.deadline : null,
    daysLeft: unreadable ? null : num(raw.daysLeft),
    unreadable: unreadable
      ? typeof raw.reason === 'string' && raw.reason
        ? raw.reason
        : 'no reason given'
      : null,
    taxNote: !unreadable && typeof raw.taxNote === 'string' && raw.taxNote ? raw.taxNote : null,
  };
}

export function toGoalBook(data: unknown): Exclude<GoalBookVM, undefined> {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.goals)) return null;
  const goals = (d.goals as Record<string, unknown>[]).map(toProgressRow);
  return {
    goals,
    total: num(d.total) ?? goals.length,
    truncated: d.truncated === true,
  };
}

/**
 * A figure in its own unit — a percent is a fraction on the wire. Money is
 * printed WITHOUT a symbol, as the reports goals desk prints it
 * (`rp-registers-goals.tsx` `inUnit`): the progress read carries no currency,
 * and a `$` on a lira house's goal would be a figure this page invented.
 * Grouped with the house's own mark (`useHouseGroupMark`, F-1251): a Turkish
 * house reads "6.180", not "6,180". An unknown mark leaves the en-US grouping.
 *
 * A percent goes to one decimal, through the Reports desk's `ratioPct`, and
 * money under 1,000 keeps its cents (F-1290): rounded whole, "35% of 35% ·
 * Behind" or "43 of 45" for 42.50 read as met while the pace word, taken from
 * the true figure, said not. The cents take the house's marks too ("42,50").
 */
export function inUnit(v: number | null, unit: string, group: GroupMark | null = null): string {
  if (v === null) return '—';
  if (unit === 'percent') return ratioPct(v);
  if (unit === 'days') return `${inHouseMarks(Math.round(v).toLocaleString('en-US'), ',', group)} days`;
  if (unit === 'currency' && Math.abs(v) < 1000 && Math.round(v * 100) % 100 !== 0)
    return inHouseMarks(
      v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      ',',
      group,
    );
  return inHouseMarks(Math.round(v).toLocaleString('en-US'), ',', group);
}

export type PaceWord = 'On pace' | 'Behind' | 'No deadline' | 'Pace unknown' | 'Not read';

/**
 * The gateway's own pace judgement, in one word. `onTrack` is its linear
 * schedule check (`goals.service.ts` getGoalProgress), with the direction
 * already applied — an at-most goal over its straight line is behind. A goal
 * with a deadline and no judgement is 'Pace unknown', never 'No deadline'
 * (ADR 0296: the gateway judges no pace for a house with no time zone).
 */
export function paceOf(g: GoalProgressRow): PaceWord {
  if (g.unreadable) return 'Not read';
  if (g.onTrack === null) return g.deadline === null ? 'No deadline' : 'Pace unknown';
  return g.onTrack ? 'On pace' : 'Behind';
}

/** The bar's fill, 0..1. null = draw no bar (unread), never an empty one. */
export function fillOf(g: GoalProgressRow): number | null {
  if (g.progressPct === null) return null;
  return Math.max(0, Math.min(1, g.progressPct));
}

/**
 * A "keep at most" goal past its limit (F-1742). The fill is current/target
 * either way, so a broken limit drew a full bar that read as met. The phone
 * fixed the same defect under F-1304 (`apps/mobile/src/lib/goalBars.ts`);
 * the words below are its words, so web and phone say the same thing.
 */
export function overLimitOf(g: GoalProgressRow): boolean {
  return g.direction === 'at_most' && g.progressPct !== null && g.progressPct > 1;
}

/** What the bar says, in words, for its label. null = no bar (unread). */
export function barSaysOf(g: GoalProgressRow): string | null {
  if (g.progressPct === null) return null;
  const whole = Math.round(g.progressPct * 100);
  if (g.direction === 'at_most')
    return overLimitOf(g) ? `Over the limit (${whole}%)` : `${whole}% of the limit`;
  return `${whole}% of the target`;
}

/** How many goals the column holds before it crowds (sketch 122's own limit). */
export const MARGIN_ROWS = 3;

/* ── the suggestion ──────────────────────────────────────────────────────── */

export interface GoalSuggestion {
  entry: EntryVM;
  plan: GoalPlan;
}

/**
 * The first standing entry whose rule maps to a goal metric the house holds
 * no active goal on. Null when the goal list could not be read: "no goal on
 * this figure" is not a claim an unread list can support.
 */
export function suggestGoal(entries: EntryVM[], goals: GoalsVM): GoalSuggestion | null {
  if (!Array.isArray(goals)) return null;
  const held = new Set(goals.map((g) => g.metricKey));
  for (const e of entries) {
    const offer = goalOfferFor({
      ruleKey: e.ruleKey,
      category: e.category,
      urgency: e.urgency,
      subject: e.subject,
    });
    if (offer.kind !== 'plan') continue;
    if (held.has(offer.plan.metricKey)) continue;
    return { entry: e, plan: offer.plan };
  }
  return null;
}

/* ── the quiet tier, as its substitute (Q4) ──────────────────────────────── */

/**
 * The engine sources that did not answer, in one sentence — the gateway's
 * own `sourcesUnreadWords` (`digest-schedule.ts`), restated here so the page
 * and the letter say it the same way. `null` from an older gateway that does
 * not send the field: not stated, and the page says that rather than "all
 * answered".
 */
export function quietTierWords(sources: string[] | null | undefined): string {
  if (!Array.isArray(sources))
    return 'This read does not say which of the engine’s sources answered.';
  if (sources.length === 0)
    return 'Every source the engine reads answered, so what did not fire had nothing to say.';
  const list =
    sources.length === 1
      ? sources[0]
      : `${sources.slice(0, -1).join(', ')} and ${sources[sources.length - 1]}`;
  return `The engine could not read ${
    sources.length === 1 ? 'one of its sources' : `${sources.length} of its sources`
  } (${list}), so entries that depend on ${sources.length === 1 ? 'it' : 'them'} could not fire.`;
}

/* ── the delta, per reader (Q9) ──────────────────────────────────────────── */

export interface LetterDelta {
  /** Standing now, not in the letter. */
  notCarried: EntryVM[];
  /** In the letter, not standing now (ruled off, dismissed, snoozed or quiet). */
  gone: number;
}

/**
 * Compares the book standing now with the rule keys this reader's own last
 * letter carried. The letter only ever carried entries at or above the
 * house's urgency floor, so "not carried" is said as that, never as "new".
 */
export function deltaSince(entries: EntryVM[], carried: string[]): LetterDelta {
  const inLetter = new Set(carried);
  const standing = new Set(entries.map((e) => e.ruleKey));
  return {
    notCarried: entries.filter((e) => !inLetter.has(e.ruleKey)),
    gone: carried.filter((k) => !standing.has(k)).length,
  };
}
