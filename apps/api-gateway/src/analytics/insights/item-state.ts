/**
 * One shared per-item state — what every surface reads (ADR 0191, founder
 * answers of 2026-09-21).
 *
 * The founder, verbatim: "Build it right, in order" — the engine gets ONE
 * shared per-item state (dismissed with a reason / snoozed-until / done) that
 * the feed, the catalogue, reports and the rails all read.
 *
 * Before this file, "hidden" meant three different things in three places:
 *
 *   - the insight generator (Reports, the rails, the catalogue's live items,
 *     the mobile tab) honoured `dismissed` rows only, at every scope;
 *   - the recommendations feed honoured `dismissed` at every scope, but
 *     `snoozed` and `done` only on the bare rule key;
 *   - the stored-insight read (`getStored`) honoured nothing written after
 *     the last hourly persist, and the legacy rails filtered client-side on a
 *     key shape (`insight:<candidate>:<entity>`) nothing server-side writes.
 *
 * So a snooze from the feed held on the feed and nowhere else, and a
 * dismissal from a rail held on that rail and nowhere else. This is the one
 * definition. It is pure: the rows come in, the state of one item comes out,
 * and every reader calls the same function with the same rows.
 *
 * The state, in precedence order (the first that holds wins):
 *
 *   dismissed  a standing instruction, with a labelled reason (the signal)
 *   done       completed — hidden, and carries NO negative signal: a done row
 *              never holds a dismissal reason (`recommendation-actions.
 *              service.ts` clears it on write)
 *   snoozed    hidden until `snoozeUntil`, then it returns by itself. A snooze
 *              with no instant, or with one that has passed, is not a snooze:
 *              the item is back.
 *   active     none of the above
 *
 * Every state is honoured at every scope a key can carry (`suppressingKeysFor`
 * — this finding, this subject, this rule), because the state belongs to the
 * key that was written, and the key names how wide it reaches.
 */

import {
  ANY,
  SuppressionTarget,
  parseSuppressionKey,
  suppressingKeysFor,
} from "./suppression";

/**
 * The dismissal reasons — a closed set of labels, not free text.
 *
 * The founder: "the reason is a labelled signal". A label a person did not
 * choose is not a signal, and a free-text string is not a label, so a
 * dismissal is refused without one of these (the gateway, every surface).
 * These four are the vocabulary the feed and the legacy page already offered
 * (`Entry.tsx` REASONS, `Recommendations.tsx` DISMISS_REASONS) — kept, not
 * invented.
 */
export const DISMISS_REASONS = [
  "not_relevant",
  "already_handled",
  "disagree",
  "not_now",
] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

export function isDismissReason(value: unknown): value is DismissReason {
  return (
    typeof value === "string" &&
    (DISMISS_REASONS as readonly string[]).includes(value)
  );
}

export type ItemState = "active" | "dismissed" | "snoozed" | "done";

/** The fields of one `recommendation_actions` row the state is read from. */
export interface StateRow {
  ruleKey: string;
  status: string;
  reason: string | null;
  snoozeUntil: string | null;
}

/** Every hiding row, by the state it holds. Built once per read. */
export interface StateBook {
  dismissed: Map<string, StateRow>;
  done: Map<string, StateRow>;
  /** Only snoozes whose instant is still in the future. */
  snoozed: Map<string, StateRow>;
}

export interface ResolvedState {
  state: ItemState;
  /** The stored key that decided it, or null when the item is active. */
  key: string | null;
  /** The dismissal label, only when `state === 'dismissed'`. */
  reason: string | null;
  /** When the item returns, only when `state === 'snoozed'`. */
  snoozeUntil: string | null;
}

const ACTIVE: ResolvedState = {
  state: "active",
  key: null,
  reason: null,
  snoozeUntil: null,
};

/** A snooze is in force only with an instant that has not passed. */
export function snoozeHolds(
  snoozeUntil: string | null | undefined,
  now: number,
): boolean {
  if (!snoozeUntil) return false;
  const at = new Date(snoozeUntil).getTime();
  return Number.isFinite(at) && at > now;
}

export function stateBookFrom(
  rows: Iterable<StateRow>,
  now: number = Date.now(),
): StateBook {
  const book: StateBook = {
    dismissed: new Map(),
    done: new Map(),
    snoozed: new Map(),
  };
  for (const r of rows) {
    if (r.status === "dismissed") book.dismissed.set(r.ruleKey, r);
    else if (r.status === "done") book.done.set(r.ruleKey, r);
    else if (r.status === "snoozed" && snoozeHolds(r.snoozeUntil, now))
      book.snoozed.set(r.ruleKey, r);
  }
  return book;
}

/**
 * The state of one item. Keys are tried widest first (`suppressingKeysFor`
 * lists the bare rule key first), so the key reported is the widest one in
 * force — the one that has to be lifted for the item to come back.
 */
export function resolveItemState(
  target: SuppressionTarget,
  book: StateBook,
): ResolvedState {
  const keys = suppressingKeysFor(target);
  for (const k of keys) {
    const row = book.dismissed.get(k);
    if (row)
      return {
        state: "dismissed",
        key: k,
        reason: row.reason ?? null,
        snoozeUntil: null,
      };
  }
  for (const k of keys) {
    if (book.done.has(k))
      return { state: "done", key: k, reason: null, snoozeUntil: null };
  }
  for (const k of keys) {
    const row = book.snoozed.get(k);
    if (row)
      return {
        state: "snoozed",
        key: k,
        reason: null,
        snoozeUntil: row.snoozeUntil,
      };
  }
  return ACTIVE;
}

/**
 * Whether a stored key silences a WHOLE rule (or a whole catalogue type):
 * no subject and no period. `rule` and `rule#*#*` are the same instruction.
 *
 * Deliberately not `parseSuppressionKey(key).scope === 'rule'` alone: a key
 * with a period and no subject (`rule#*#p7:2026-09-02`) silences one period,
 * not the rule, and gating it as rule-wide would take a one-finding dismiss
 * away from staff.
 */
export function isRuleWideKey(key: string): boolean {
  const p = parseSuppressionKey(key);
  return p.subject === ANY && p.grain === ANY;
}

/**
 * Whether a status write is a rule-wide dismiss or restore — the founder's
 * owner/manager-only, audited act (2026-09-21, answer 1).
 *
 * A dismiss: `dismissed` written at a rule-wide key. A restore: any status
 * written over a rule-wide key that is currently dismissed (back to active,
 * or to snoozed/done, both of which lift the standing instruction). Pin,
 * feedback, assignment and acted-on never are; a snooze or done over a
 * rule-wide key that is NOT dismissed is not a dismiss or a restore.
 */
export function isRuleWideDismissOrRestore(
  key: string,
  nextStatus: string | undefined,
  currentStatus: string | null | undefined,
): boolean {
  if (nextStatus === undefined) return false;
  if (!isRuleWideKey(key)) return false;
  return nextStatus === "dismissed" || currentStatus === "dismissed";
}

/** The roles that may make a rule-wide act — `RolesGuard`'s owner/manager set. */
export function mayActRuleWide(role: string | null | undefined): boolean {
  const r = role ? String(role).toLowerCase() : "";
  return r === "owner" || r === "manager" || r === "admin";
}
