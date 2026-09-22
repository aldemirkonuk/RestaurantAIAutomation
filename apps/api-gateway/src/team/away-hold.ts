/**
 * A message to one person who is Away waits until they are back (ADR 0218,
 * the founder's round-2 answer 3, 2026-09-21) — the rules, as PURE functions.
 *
 * `AwayHoldService` reads and writes the hold table and `AwayReleaseService`
 * delivers; everything they DECIDE is here, so each rule is tested and
 * mutation-tested without a stub standing in for the thing under test.
 */

export type HeldKind = "team_message" | "team_note";

/** One row of `house_away_held` (migration 20260921171000). */
export interface HeldRow {
  id: string;
  restaurant_id: string;
  /** The person it waits for, `public.users.user_id`. */
  user_id: string;
  kind: HeldKind;
  /** A note: the record it belongs to. Its words stay on `team_notes`. */
  note_id: string | null;
  member_id: string | null;
  /** A message: its words, kept only until it is delivered. */
  title: string | null;
  body: string | null;
  /** A message: which of the product's own channels the sender asked for. */
  channels: string[] | null;
  sent_by: string | null;
  /** The last Away day when it was held — what the sender was told. */
  away_until: string;
  created_at: string;
  claimed_at: string | null;
}

/**
 * Split an audience into the people it reaches now and the people it waits
 * for. Nobody is dropped: `now` + `held` is the whole list, each in the order
 * it arrived. A person with no account is never held — nothing can reach them
 * either way, and the caller's own receipt already says so.
 */
export function splitForAway<T>(
  people: readonly T[],
  userIdOf: (person: T) => string | null | undefined,
  awayUntil: ReadonlyMap<string, string>,
): { now: T[]; held: Array<{ person: T; until: string }> } {
  const now: T[] = [];
  const held: Array<{ person: T; until: string }> = [];
  for (const person of people) {
    const id = userIdOf(person);
    const until = id ? awayUntil.get(id) : undefined;
    if (until) held.push({ person, until });
    else now.push(person);
  }
  return { now, held };
}

export type ReleaseVerdict =
  /** Back, awake, still in the house: deliver it now. */
  | "release"
  /** Away today (the window may have been moved or extended): keep waiting. */
  | "still_away"
  /** Back, but inside their own quiet hours: the next sweep delivers it. */
  | "quiet_hours"
  /** No longer a member of this house: it is never delivered. */
  | "not_in_house";

export interface ReleaseFacts {
  members: ReadonlySet<string>;
  awayToday: ReadonlySet<string>;
  quietNow: ReadonlySet<string>;
}

/**
 * What to do with one held item for `userId` now.
 *
 * Membership is asked FIRST: a person who left the house is not owed a
 * message about it, whatever their dates say. Away before quiet hours, so the
 * tally can tell "still away" from "back but asleep".
 */
export function releaseVerdict(userId: string, facts: ReleaseFacts): ReleaseVerdict {
  if (!facts.members.has(userId)) return "not_in_house";
  if (facts.awayToday.has(userId)) return "still_away";
  if (facts.quietNow.has(userId)) return "quiet_hours";
  return "release";
}

/**
 * A release claims a row before it delivers and deletes it after. A claim
 * older than this belongs to a release that died between the two, and the
 * next sweep may take it over — delivering twice is the smaller fault than
 * never delivering, and it can only happen after a crash.
 */
export const STALE_CLAIM_MS = 30 * 60 * 1000;

export function isClaimable(claimedAt: string | null, now: Date): boolean {
  if (claimedAt === null || claimedAt === undefined) return true;
  const at = Date.parse(claimedAt);
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at > STALE_CLAIM_MS;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "28 Sep" for a house-local calendar day, never sliding across a zone. A
 * fixed table, not `Intl`: ICU versions disagree ("Sep" vs "Sept"), and a
 * receipt stored today must read the same on every server that serves it.
 */
export function heldDay(isoDay: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (!m) return isoDay;
  const d = new Date(`${isoDay}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== isoDay) return isoDay;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** The sentence a sender reads on a held receipt. */
export function heldDetail(until: string): string {
  return (
    `Away until ${heldDay(until)}. It waits and is delivered when they are back, ` +
    "outside their quiet hours."
  );
}

/** The sentence on a held receipt whose person left the house before returning. */
export const LEFT_BEFORE_RETURN =
  "They left this house before their Away ended, so it was never delivered.";

/**
 * A held text channel the house no longer has a sender for when the person
 * came back: nothing was attempted, and the receipt says why.
 */
export const NO_SENDER_ON_RETURN =
  "When this person came back, this house had no connected sender for this channel, so no text was sent.";
