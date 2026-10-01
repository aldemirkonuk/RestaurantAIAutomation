/**
 * Is a `user_restaurant_access` row a CURRENT membership?
 *
 * One predicate, used by every reader that decides "is this person a member of
 * this house right now" for a send (2026-09-17, notify-lane review, minor 2).
 * Before it the answer depended on who asked: `RecipientResolverService`
 * checked `is_active` only, so a manager past `valid_until` was still
 * notified; the house-email sender this lane first built checked `is_active`
 * and `valid_until` but not `valid_from`. [2026-09-25: that sender was dropped
 * when the founder closed POST /notifications/send-email (PR #410); the
 * recipient resolver is this predicate's reader.]
 *
 * A row is live when ALL of:
 *   - `is_active` is exactly `true`
 *     (baseline `user_restaurant_access.is_active boolean DEFAULT true NOT NULL`);
 *   - `valid_from` is not more than `VALID_FROM_CLOCK_TOLERANCE_MS` ahead of
 *     `now` (`valid_from timestamptz DEFAULT now() NOT NULL`);
 *   - `valid_until` is null or in the future (`valid_until timestamptz`).
 *
 * A timestamp that is present but cannot be parsed fails the row (closed, not
 * open). An ABSENT `valid_from` is read as "no start bound": the column is
 * NOT NULL in the schema, so absence can only mean the caller did not select
 * it — so every reader selects all three columns, spelled out as a literal
 * so `scripts/check_read_columns_exist.py` verifies them against the schema.
 */

/**
 * How far ahead of `now` a `valid_from` may sit and still count as started:
 * two minutes (founder, 2026-10-01: "Small tolerance on valid_from
 * (Recommended)", ADR 0248).
 *
 * The two sides of the comparison usually come from different clocks. Every
 * insert into `user_restaurant_access` takes `valid_from` from the DATABASE
 * (`DEFAULT now()`; `acceptHeldMembership` alone writes the gateway's time);
 * this predicate compares it with the GATEWAY's `Date.now()`. Without a
 * tolerance, a row written a moment ago reads as not yet started for as long
 * as the gateway's clock runs behind the database's, and the role lookups
 * that apply this predicate (ADR 0248) refuse that person, a new house's
 * first owner included. `valid_until` has no tolerance.
 */
export const VALID_FROM_CLOCK_TOLERANCE_MS = 120_000;

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
  if (from !== null && from > now + VALID_FROM_CLOCK_TOLERANCE_MS) return false;

  const until = instant(row.valid_until);
  if (until === "unparseable") return false;
  if (until !== null && until <= now) return false;

  return true;
}

/**
 * The two roles owner/manager-only content is addressed to: what a vendor
 * charges this house (ADR 0124:357-362; `promotions.controller.ts` and
 * `vendor-intel.controller.ts` gate the reads the same way), whether it is sent
 * live or into the inbox.
 */
export const OWNER_AND_MANAGER = ["owner", "manager"] as const;

export type HouseRoleName = "owner" | "manager" | "staff";

/** The narrowest client shape the resolver needs, so a spec can pass a fake. */
interface MembershipClient {
  from(table: string): any;
}

/**
 * The user ids that hold one of `roles` in `restaurantId` right now
 * (fix/websocket-role-gate, 2026-09-28). This resolves who receives
 * owner/manager-only content, live or in the inbox. The websocket gateway's
 * `emitToHouseRoles`, the `roles` option of
 * `InboundResponderService.persistManagerNotification`, and the market-price
 * producer all read it, so "who is a manager here" has one answer for this
 * content.
 *
 * - Membership is read from `user_restaurant_access` only, filtered by
 *   `isLiveMembership`. There is no `users.restaurant_id` fallback. ADR 0164
 *   retired it, and a fallback that answered "everyone whose users row names
 *   the house" would give owner/manager content to staff.
 * - A failed read throws. Every caller turns that into "send nothing and say
 *   so", because "could not check" never means "yes".
 * - It is read at send time and never cached. A demotion or a removal takes
 *   effect at the next send, on every gateway instance, with no hook needed in
 *   the code that writes roles.
 *
 * The older role readers (counted by CLAIMS `SEC-2026-09-28-WEBSOCKET-ROLE-GATE`)
 * are not migrated to it here. That is a follow-up.
 */
export async function houseMembersInRoles(
  client: MembershipClient,
  restaurantId: string,
  roles: readonly HouseRoleName[],
  now: number = Date.now(),
): Promise<string[]> {
  if (!restaurantId || roles.length === 0) return [];
  const { data, error } = await client
    .from("user_restaurant_access")
    .select("user_id, role, is_active, valid_from, valid_until")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .in("role", [...roles]);
  if (error) {
    throw new Error(`user_restaurant_access read failed: ${error.message}`);
  }
  const wanted = new Set<string>(roles);
  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<
    MembershipWindow & { user_id?: unknown; role?: unknown }
  >) {
    // The role is checked again here, not only in the query, so a client that
    // ignored `.in` (a fake, or a later refactor) cannot widen the audience.
    if (!wanted.has(String(row?.role ?? ""))) continue;
    if (!isLiveMembership(row, now)) continue;
    const id = typeof row?.user_id === "string" ? row.user_id : "";
    if (id) ids.add(id);
  }
  return [...ids];
}
