/**
 * The two doors the founder added on 2026-09-04: the day-book, and the goal.
 *
 *  1. **"Put it on the day-book"** — every entry under *Schedule it* opens the
 *     calendar with a drafted new entry (`/calendar?new=<url-safe JSON>`).
 *  2. **"See where the goal stands"** — every entry under *Goals slipping*
 *     deep-links to that goal's progress in the reports desk, and lists the
 *     levers the rule names.
 *
 * ── What the calendar link can and cannot claim TODAY ──────────────────────
 * LANDED 2026-09-04. `apps/web/src/pages/calendar/next/CalendarNext.tsx` now
 * reads `?new=` (`readNewParam`, :66-106, consumed by the arrival effect at
 * :233-250) and `SheetTarget`'s create arm carries a `prefill`
 * (`EventSheet.tsx:63-76`), which seeds title, type and note
 * (`EventSheet.tsx:112-115,134`). So the copy may now say the entry opens
 * FILLED IN. The draft is still printed in full on this page before you
 * leave — a person about to cross from one page to another should see what is
 * being carried — and the calendar validates every field again on arrival,
 * because a URL is untrusted input wherever it was minted.
 *
 * ── Why the date is not scraped out of the rule's sentence ─────────────────
 * `weekday_gap`'s observation names the weakest weekday in prose ("Friday is
 * reliably your strongest day; Tuesday the weakest"). Reading a day back out
 * of that would be the same move this page refuses for targets in
 * `rec-forward.ts`: a value formatted for a reader, parsed as a field, from a
 * template the gateway can change without telling anyone. So the draft opens
 * on the day the ribbon has selected, or today when nothing is selected, and
 * the control says which. The manager moves it in the calendar, where the
 * date is a field rather than a guess.
 *
 * ── Why most drafts are `custom` ───────────────────────────────────────────
 * `eventType` must be a member of the gateway's `CalendarEventType`
 * (`calendar.dto.ts:44-59`, enumerated in `EventSheet.tsx:43-58`). A rule gets
 * a specific member only when its sentence names exactly one calendar object;
 * `weekly_demand_slide` names "a staff tasting" and gets `tasting`.
 * `weekday_gap` names three (training, deliveries, counts) and gets `custom`,
 * because picking one of the three would be this page choosing the manager's
 * evening for them.
 */

import { EM } from './rec-format';
import type { EntryVM, GoalRow } from './useRecommendationsNextData';

/* ── door one: the day-book ──────────────────────────────────────────────── */

/** The draft the calendar's `?new=` carries. Every field is a field, not prose. */
export interface DayBookDraft {
  title: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** A member of the gateway's CalendarEventType. */
  type: string;
  /** Names the rule this entry came from, in words. */
  note: string;
}

interface DraftSpec {
  title: string;
  type: string;
  /** Why this type and not another — shown to the manager, never assumed. */
  basis: string;
}

/**
 * Rule → what a day-book line for it would say.
 *
 * Only rules filed under *Schedule it* appear here. A rule that reaches this
 * module without a spec gets a draft built from its own act, never a silent
 * default: see `daybookDraftFor`.
 */
const RULE_DRAFT: Record<string, DraftSpec> = {
  weekday_gap: {
    title: 'Move training, deliveries and counts into the quiet day',
    type: 'custom',
    basis:
      'The rule names three things to move (staff training, deliveries, inventory counts). The calendar has a type for one of them (`inventory_count`) and none for the other two, so the draft is `custom` rather than this page choosing which of the three the evening is really about.',
  },
  weekly_demand_slide: {
    title: 'Staff tasting — the two highest-margin slow movers',
    type: 'tasting',
    basis:
      'The rule names exactly one calendar object, “a staff tasting”, and `tasting` is a member of the gateway’s CalendarEventType. This is the only rule on the page whose type is not a judgement.',
  },
};

/**
 * The draft for an entry, on a date.
 *
 * `on` is the ribbon's selected day when one is selected, and today otherwise.
 * Nothing here reads a weekday out of the rule's sentence — see the header.
 */
export function daybookDraftFor(entry: EntryVM, on: string): DayBookDraft {
  const spec = RULE_DRAFT[entry.ruleKey];
  return {
    title: spec?.title ?? `Follow up: ${entry.ruleKey}`,
    date: on,
    type: spec?.type ?? 'custom',
    note: `From the recommendations book — rule ${entry.ruleKey}. ${entry.recommendation}`,
  };
}

/** Why this draft carries the type it carries. Null when the rule has no spec. */
export function daybookBasis(ruleKey: string): string | null {
  return RULE_DRAFT[ruleKey]?.basis ?? null;
}

/**
 * `/calendar?new=<url-safe JSON>`.
 *
 * The JSON is `encodeURIComponent`'d, so it survives a router that re-encodes
 * and a paste into a chat window. It is deliberately NOT base64: a link a
 * person can read is a link a person can check, and this one carries nothing
 * secret.
 */
export function daybookHref(draft: DayBookDraft): string {
  return `/calendar?new=${encodeURIComponent(JSON.stringify(draft))}`;
}

/**
 * What the control is allowed to promise.
 *
 * Re-verified 2026-09-04 against `pages/calendar/next/CalendarNext.tsx` AFTER
 * the `?new=` patch landed: `readNewParam` (:66-106) is read by the arrival
 * effect (:233-250), which opens the create sheet on the drafted date with
 * `prefill` seeding title, type and note (`EventSheet.tsx:112-115,134`). An
 * unknown type falls back to the sheet's default rather than being seeded, so
 * the promise is deliberately “filled in” and not “filed”: nothing is written
 * until the manager saves it.
 */
export const DAYBOOK_LANDING =
  `The calendar opens on the date below with this entry already filled in ${EM} title, type and note ${EM} for you to check and save. It is printed here too, so you can see what is being carried across.`;

/* ── door two: the goal that is slipping ─────────────────────────────────── */

/** `goal_behind_<goalId>` — the key the engine mints per goal (one per row). */
const GOAL_RULE_PREFIX = 'goal_behind_';

/** The goal id inside a `goal_behind_…` rule key, or null for any other rule. */
export function goalIdOf(ruleKey: string): string | null {
  if (!ruleKey.startsWith(GOAL_RULE_PREFIX)) return null;
  const id = ruleKey.slice(GOAL_RULE_PREFIX.length);
  return id.length > 0 ? id : null;
}

export interface GoalSlip {
  goalId: string;
  /** The goal's own name, or null when the goal list could not be read. */
  name: string | null;
  /** The metric the goal is held on, or null when unknown. */
  metricKey: string | null;
  href: string;
  /** What the manager is told about landing. */
  landing: string;
}

/**
 * `insightCategories` per metric, copied verbatim from the gateway's
 * `GoalsService.SUPPORTED_METRICS` (`analytics/goals.service.ts`).
 *
 * This is what makes "this goal's category" — the phrase in the rule's own
 * sentence — a real thing rather than a figure of speech. A goal row carries
 * a `metric_type`, never a category; the gateway's table is the only place the
 * two are joined, so the levers below are ITS mapping, not this page's guess.
 * Copied rather than imported: pages do not import gateway modules.
 */
export const METRIC_CATEGORIES: Record<string, string[]> = {
  wine_revenue: ['sales', 'efficiency'],
  bottles_sold: ['sales', 'basket'],
  purchase_spend: ['purchasing', 'risk'],
  checks: ['sales', 'tables'],
  avg_check: ['efficiency', 'staff', 'basket'],
  wine_attach_rate: ['efficiency', 'basket', 'staff'],
  // The seventh, 2026-09-04 (ADR 0120). Its parity test caught this copy the
  // moment the gateway grew a metric, which is exactly what it is for.
  days_of_inventory: ['purchasing', 'risk'],
};

/**
 * Where a slipping goal is read.
 *
 * The reports desk holds a *Goals* cutting (`rp-sheet.ts` `ANALYSIS_IDS`
 * includes `goals`; `rp-registers-goals.tsx:456-460` reads
 * `GET /analytics/goals/:rid/progress`), and it is on `DEFAULT_ON`, so it is
 * standing on an unarranged sheet. The per-goal route the founder named,
 * `GET /analytics/goals/:rid/:goalId/progress`
 * (`analytics.controller.ts:583`), is what the desk's *Ask the book* control
 * calls per row; the desk itself is read from the list route.
 *
 * **There is no query parameter to address one goal.** Re-grepped 2026-09-04:
 * `apps/web/src/pages/reports/` contains no `useSearchParams`, no
 * `URLSearchParams` and no `location.search` — the sheet reads nothing off the
 * URL at all. So this link goes to `/reports`, carrying the ids for the day
 * the sheet learns to read them, and the control NAMES THE GOAL IN WORDS so a
 * manager can find its row. That is stated on the entry, not hidden.
 */
export function goalSlipFor(entry: EntryVM, goals: GoalRow[] | null | undefined): GoalSlip | null {
  const goalId = goalIdOf(entry.ruleKey);
  if (!goalId) return null;
  const row = Array.isArray(goals) ? goals.find((g) => g.id === goalId) : undefined;
  const q = `cutting=goals&goal=${encodeURIComponent(goalId)}&rec=${encodeURIComponent(
    entry.ruleKey,
  )}&from=recommendations`;
  return {
    goalId,
    name: row?.name ?? null,
    metricKey: row?.metricKey ?? null,
    href: `/reports?${q}`,
    landing: row
      ? `Reports does not read this link’s query yet, so you land on the sheet with the Goals desk already on it (it is one of the ten an unarranged sheet carries) and find “${row.name}” by name.`
      : `Reports does not read this link’s query yet, so you land on the sheet with the Goals desk already on it. This page could not read your goal list, so it cannot name the row for you ${EM} it is the one whose id ends ${goalId.slice(-6)}.`,
  };
}

/**
 * The levers the rule names, made concrete.
 *
 * The rule's sentence is *"Pick the single biggest lever from the insight feed
 * for this goal's category and commit to it for 7 days"*. The levers are
 * therefore the OTHER entries standing on this page whose category is one of
 * the metric's `insightCategories` above — not a list this module writes, and
 * not every entry on the page.
 *
 * Returns `null`, not `[]`, when the goal row could not be read: a goal whose
 * metric is unknown has no known category, and an empty list would read as
 * "there are no levers" when the truth is "we could not look".
 */
export function leversFor(slip: GoalSlip, standing: EntryVM[]): EntryVM[] | null {
  if (!slip.metricKey) return null;
  const cats = METRIC_CATEGORIES[slip.metricKey];
  if (!cats) return null;
  return standing.filter((e) => !e.ruleKey.startsWith(GOAL_RULE_PREFIX) && cats.includes(e.category));
}

/** The words under a lever list — what the categories are and where they come from. */
export function leverWords(slip: GoalSlip, levers: EntryVM[] | null): string {
  if (!slip.metricKey)
    return `The rule points at “the insight feed for this goal’s category”, and this page could not read the goal, so it cannot say which category that is ${EM} no lever is named rather than the wrong one.`;
  const cats = METRIC_CATEGORIES[slip.metricKey];
  if (!cats)
    // The COUNT is read off the table, never written out. It said "six" until
    // 2026-09-04, when the gateway grew a seventh (`days_of_inventory`, ADR
    // 0120) and the sentence quietly became false while every test stayed
    // green. A number about a list belongs to the list.
    return `This goal is held on ${slip.metricKey}, which is not one of the ${Object.keys(METRIC_CATEGORIES).length} metrics the gateway maps to insight categories, so the rule’s “this goal’s category” has no answer here.`;
  const where = `The gateway holds this goal on ${slip.metricKey}, and its own table maps that metric to the ${cats.join(' and ')} ${cats.length === 1 ? 'category' : 'categories'}.`;
  if (!levers || levers.length === 0)
    return `${where} Nothing standing on this page is in ${cats.length === 1 ? 'it' : 'them'} today, so the rule’s lever is not on the book ${EM} it is somewhere the engine has not fired on.`;
  return `${where} ${levers.length === 1 ? 'One entry standing here is' : `${levers.length} entries standing here are`} in ${cats.length === 1 ? 'it' : 'them'}. The rule asks for ONE of them, held for seven days.`;
}
