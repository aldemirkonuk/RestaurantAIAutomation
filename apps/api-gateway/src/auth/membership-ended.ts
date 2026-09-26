import { SupabaseClient } from "@supabase/supabase-js";

/**
 * How a house membership ended, and who that sends where (ADR 0164, brackets
 * of 2026-09-25: the founder, round 4, item 16, and round 5, item 26).
 *
 * Round 5, item 26: "Owner deletes own only house -> /get-started (only people
 * removed by someone else see /no-access)." A person with no house goes to
 * `/no-access` only when a membership of theirs was ended by someone else;
 * one who ended their own (left, or deleted the house they owned) goes to
 * `/get-started`, like an account that never had a house.
 *
 * `house_memberships_ended` (migration 20260926120000) is written by a trigger
 * on `user_restaurant_access`, which cannot see who acted. It records what it
 * can see: `end_reason` 'house_deleted' when the house row is gone (the FK
 * cascade of a house deletion), otherwise 'removed', and `ended_role`, the role
 * held. The paths where the person ends it themselves restamp the row 'left'
 * with `markMembershipLeft` below.
 */
export interface EndedMembership {
  end_reason?: string | null;
  ended_role?: string | null;
}

/**
 * True when this ending was someone else's act. Self-ended is exactly:
 * - 'left': the person ended it themselves (restamped by the gateway); or
 * - 'house_deleted' held as 'owner': the house they owned was deleted. A house
 *   is deleted by, or for, its owner; its other members were removed by that
 *   act, so their rows still read as someone else's.
 * Everything else, including a missing or unknown reason, is someone else's:
 * the safe side is `/no-access`, whose "Start here" link still reaches
 * `/get-started`; the other side would invite a removed person to open a
 * restaurant.
 */
export function endedBySomeoneElse(row: EndedMembership): boolean {
  if (row.end_reason === "left") return false;
  if (row.end_reason === "house_deleted" && row.ended_role === "owner")
    return false;
  return true;
}

/**
 * Restamp the row the trigger just wrote as 'left': the person ended this
 * membership themselves. Call it only after the membership row's delete
 * succeeded (the trigger writes the row inside that delete).
 *
 * A failed write is logged, not thrown, like `cancelPendingInvitesFrom`: the
 * person has already left, and refusing to finish over this would misreport
 * the leave. The row then stays 'removed', which is the safe side above.
 */
export async function markMembershipLeft(
  supabase: SupabaseClient,
  userId: string,
  restaurantId: string,
  logger?: { error: (message: string) => void },
): Promise<void> {
  const { error } = await supabase
    .from("house_memberships_ended")
    .update({ end_reason: "left" })
    .eq("user_id", userId)
    .eq("restaurant_id", restaurantId);

  if (error) {
    logger?.error(
      `markMembershipLeft could not record that ${userId} left ${restaurantId} ` +
        `themselves (it reads as removed): ${error.message}`,
    );
  }
}
