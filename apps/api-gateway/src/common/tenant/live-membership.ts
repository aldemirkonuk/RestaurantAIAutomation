/**
 * Is a `user_restaurant_access` row a CURRENT membership?
 *
 * One predicate, used by every reader that decides "is this person a member of
 * this house right now" for a send (2026-09-17, notify-lane review, minor 2).
 * Before it the answer depended on who asked: `RecipientResolverService`
 * checked `is_active` only, so a manager past `valid_until` was still
 * notified; `HouseEmailService` checked `is_active` and `valid_until` but not
 * `valid_from`, so a grant dated in the future could already send.
 *
 * A row is live when ALL of:
 *   - `is_active` is exactly `true`
 *     (baseline `user_restaurant_access.is_active boolean DEFAULT true NOT NULL`);
 *   - `valid_from` is not in the future
 *     (`valid_from timestamptz DEFAULT now() NOT NULL`);
 *   - `valid_until` is null or in the future (`valid_until timestamptz`).
 *
 * A timestamp that is present but cannot be parsed fails the row (closed, not
 * open). An ABSENT `valid_from` is read as "no start bound": the column is
 * NOT NULL in the schema, so absence can only mean the caller did not select
 * it — so every reader selects all three columns, spelled out as a literal
 * so `scripts/check_read_columns_exist.py` verifies them against the schema.
 */

export interface MembershipWindow {
  is_active?: boolean | null;
  valid_from?: string | null;
  valid_until?: string | null;
}

function instant(value: unknown): number | null | "unparseable" {
  if (value === null || value === undefined || value === "") return null;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? "unparseable" : t;
}

export function isLiveMembership(
  row: MembershipWindow | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!row || row.is_active !== true) return false;

  const from = instant(row.valid_from);
  if (from === "unparseable") return false;
  if (from !== null && from > now) return false;

  const until = instant(row.valid_until);
  if (until === "unparseable") return false;
  if (until !== null && until <= now) return false;

  return true;
}
