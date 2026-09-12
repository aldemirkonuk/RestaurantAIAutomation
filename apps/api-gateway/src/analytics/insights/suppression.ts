/**
 * Suppression keys — what "dismissed" actually means, written down.
 *
 * The defect this closes
 * ----------------------
 * Before this file, "dismiss" wrote `recommendation_actions.status='dismissed'`
 * against a BARE rule key, and exactly one consumer honoured it:
 * `RecommendationsService.getRecommendations` filtered the card out of its own
 * feed. The insight generator — which produces the SENTENCE the card carries,
 * and which also feeds Reports, the mobile insight tab and the hourly
 * `analytics_insights` persist — had no idea the manager had ever spoken
 * (grep `insight-generator.service.ts` for `recommendation_actions` before this
 * change: no hits). So a dismissed observation kept being computed, kept being
 * stored, and kept being shown somewhere else. Dismiss did not hold.
 *
 * It was also, silently, the widest possible scope: one bare key per rule, so
 * dismissing "Wednesday came in low" suppressed that rule for every weekday and
 * every date, for ever, with nothing on screen saying so.
 *
 * The key
 * -------
 *     <ruleId>#<subject>#<grain>
 *
 *   ruleId   the rule that fired, as the engine emits it —
 *            `sales_below_weekday_baseline`, or `insight:<candidateKey>` for a
 *            raw insight (the prefix the Reports panel already uses).
 *   subject  the thing the sentence is ABOUT, slugged: `wednesday`, `table-4`,
 *            `caymus-cab`. `*` when the rule names no subject.
 *   grain    the period the observation covers, at its own grain:
 *            `d:2026-09-02` (a day), `p7:2026-09-02` (the 7 days ending then),
 *            `t28:2026-09-02` (a 28-day trend), `m:2026-09`. `*` when the rule
 *            is not about a period at all.
 *
 * Three scopes, and only three, are representable — deliberately, because the
 * founder has not yet said which one "dismiss" should mean (page note §13.14):
 *
 *   insight   rule#subject#grain   this exact entry, this subject, this period
 *   subject   rule#subject#*       this rule for this subject (every Wednesday)
 *   rule      rule#*#*             this rule, entirely
 *
 * `rule#*#*` normalises BACK to the bare `rule`, which is what every row
 * written before this change already looks like — so old dismissals keep
 * meaning exactly what they meant (the whole rule) instead of quietly becoming
 * unmatched and resurfacing. That equivalence is asserted in the spec.
 *
 * Matching is a set membership test over the five keys that could suppress a
 * target — never a prefix scan, so a key nobody can generate cannot hide
 * anything, and a key that IS generated can never be silently unmatched.
 */

export const SUPPRESSION_SEP = "#";
export const ANY = "*";

export type SuppressionScope = "insight" | "subject" | "rule";

export interface SuppressionTarget {
  /** The rule/candidate that fired. Required. */
  ruleId: string;
  /** What the sentence is about, human form ("Wednesday"). Null if none. */
  subject?: string | null;
  /** The period grain, e.g. "d:2026-09-02". Null if the rule has no period. */
  periodKey?: string | null;
}

export interface ParsedSuppressionKey {
  ruleId: string;
  subject: string;
  grain: string;
  scope: SuppressionScope;
}

/**
 * Slug a subject so "Wednesday", "wednesday" and " Wednesday " are one key.
 * Deliberately lossy and deliberately stable: the key is an identity, and the
 * words the manager reads come from the stored subject, never from the slug.
 */
export function slugSubject(subject: string | null | undefined): string {
  if (!subject) return ANY;
  const s = subject
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || ANY;
}

/** Grain strings are already machine-shaped; only `#` is forbidden in them. */
function safeGrain(periodKey: string | null | undefined): string {
  if (!periodKey) return ANY;
  const g = periodKey.trim().replace(new RegExp(SUPPRESSION_SEP, "g"), "-");
  return g || ANY;
}

/**
 * The key a dismissal at `scope` should be stored under.
 *
 * A scope narrower than the target can support degrades UPWARD, not silently:
 * asking for `insight` on a rule with no subject and no period yields the bare
 * rule key, and `scopeOf()` on that key returns `"rule"` — so the caller can
 * (and the UI does) tell the manager that dismissing this one hides the whole
 * rule. Never claim a narrow scope you did not store.
 */
export function buildSuppressionKey(
  target: SuppressionTarget,
  scope: SuppressionScope = "insight",
): string {
  const rule = target.ruleId.trim();
  if (!rule) throw new Error("ruleId is required for a suppression key");
  const subject = scope === "rule" ? ANY : slugSubject(target.subject);
  const grain = scope === "insight" ? safeGrain(target.periodKey) : ANY;
  if (subject === ANY && grain === ANY) return rule; // canonical bare key
  return [rule, subject, grain].join(SUPPRESSION_SEP);
}

/** All three scopes for a target, so a UI can offer them without re-deriving. */
export function suppressionKeys(
  target: SuppressionTarget,
): Record<SuppressionScope, string> {
  return {
    insight: buildSuppressionKey(target, "insight"),
    subject: buildSuppressionKey(target, "subject"),
    rule: buildSuppressionKey(target, "rule"),
  };
}

/**
 * The scope a dismissal at `scope` would ACTUALLY have on this target.
 *
 * Asking for `insight` on a rule that names no subject and no period stores the
 * bare rule key, which silences the whole rule. The UI is required to say that
 * out loud, so it has to be able to ask.
 */
export function effectiveScope(
  target: SuppressionTarget,
  scope: SuppressionScope = "insight",
): SuppressionScope {
  return parseSuppressionKey(buildSuppressionKey(target, scope)).scope;
}

export function parseSuppressionKey(key: string): ParsedSuppressionKey {
  const parts = key.split(SUPPRESSION_SEP);
  const ruleId = parts[0] ?? "";
  const subject = parts[1] ?? ANY;
  const grain = parts[2] ?? ANY;
  return { ruleId, subject, grain, scope: scopeOf(subject, grain) };
}

export function scopeOf(subject: string, grain: string): SuppressionScope {
  if (subject === ANY) return "rule";
  return grain === ANY ? "subject" : "insight";
}

/**
 * Every stored key that would suppress this target. Five, not four: the bare
 * rule key is listed explicitly because that is the shape of every dismissal
 * written before this file existed.
 */
export function suppressingKeysFor(target: SuppressionTarget): string[] {
  const rule = target.ruleId.trim();
  const subject = slugSubject(target.subject);
  const grain = safeGrain(target.periodKey);
  const keys = new Set<string>([
    rule, // legacy bare key === rule#*#*
    [rule, ANY, ANY].join(SUPPRESSION_SEP),
    [rule, subject, ANY].join(SUPPRESSION_SEP),
    [rule, ANY, grain].join(SUPPRESSION_SEP),
    [rule, subject, grain].join(SUPPRESSION_SEP),
  ]);
  return Array.from(keys);
}

/** True when any key in `stored` suppresses `target`. */
export function isSuppressed(
  target: SuppressionTarget,
  stored: ReadonlySet<string>,
): boolean {
  if (stored.size === 0) return false;
  return suppressingKeysFor(target).some((k) => stored.has(k));
}

/** The `insight:` prefix the Reports panel already writes for raw insights. */
export function insightRuleId(candidateKey: string): string {
  return `insight:${candidateKey}`;
}

/**
 * Day grain from an ISO date (YYYY-MM-DD). Returns null for anything else, so
 * a malformed date produces NO grain rather than a grain nobody can match.
 */
export function dayGrain(date: string | null | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return `d:${date}`;
}

/** The window grain for a period-over-period comparison ending on `date`. */
export function windowGrain(
  windowDays: number,
  date: string | null | undefined,
): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return `p${windowDays}:${date}`;
}

/** The trend grain for an n-day trend ending on `date`. */
export function trendGrain(
  spanDays: number,
  date: string | null | undefined,
): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return `t${spanDays}:${date}`;
}

/** The date a `d:` grain names, or null. Used to offer a day exclusion. */
export function dateOfGrain(
  periodKey: string | null | undefined,
): string | null {
  if (!periodKey) return null;
  const m = /^[a-z]+\d*:(\d{4}-\d{2}-\d{2})$/.exec(periodKey);
  return m ? m[1] : null;
}
