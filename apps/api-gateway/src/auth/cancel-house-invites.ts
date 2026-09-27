import { SupabaseClient } from "@supabase/supabase-js";

/**
 * When a person is removed from a house, the invitations they issued for
 * that house — the ones nobody has accepted yet — stop being good. Without
 * this, `acceptInviteAsExistingUser` grants exactly what the invite said
 * days after the person who could grant it lost standing to, since nothing
 * ever revisited a pending invite once it was minted (item 5, 2026-09-19;
 * v3.0-TECH-DEBT probe P8).
 *
 * Called from every removal path: `MembersService.removeMember`,
 * `TeamService.deleteMember`, `AuthService.leaveRestaurant`, and
 * `AuthService.deleteAccount` (which can end membership in several houses at
 * once, and calls this once per house; wired 2026-09-19, round 3, P9 — the
 * fourth path was the only one not wired to either eviction or invite
 * cancellation). Reuses the
 * existing `expires_at` column rather than a new one — an invite this makes
 * expire fails exactly the check `acceptInviteAsExistingUser` already runs
 * (`.gt("expires_at", now)`), with the same "invalid, expired, or already
 * used" answer a genuinely expired code gets. A failed write here is logged,
 * not thrown: the removal itself already happened, and refusing to finish it
 * over a housekeeping step would leave the person still a member.
 */
export async function cancelPendingInvitesFrom(
  supabase: SupabaseClient,
  invitedBy: string,
  restaurantId: string,
  logger?: { error: (message: string) => void },
): Promise<void> {
  const { error } = await supabase
    .from("organization_invites")
    .update({ expires_at: new Date().toISOString() })
    .eq("invited_by", invitedBy)
    .eq("restaurant_id", restaurantId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString());

  if (error) {
    logger?.error(
      `cancelPendingInvitesFrom could not cancel ${invitedBy}'s pending ` +
        `invites for ${restaurantId}: ${error.message}`,
    );
  }
}
