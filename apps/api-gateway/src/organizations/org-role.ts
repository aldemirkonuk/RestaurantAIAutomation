/**
 * Who is an owner of an organisation, and what a house grant writes there.
 *
 * The founder (2026-09-18, ADR 0164): *"Organisation owners only"* may open a
 * new location in an organisation, and they become its owner. The owner of an
 * organisation is the person whose `organization_members` row there says
 * `owner`. `registerRestaurant` writes that row for whoever opens the first
 * house, and `seed_sim_restaurant()` for the simulation owner.
 *
 * That column was read by nothing before 2026-09-18, and three writers
 * overwrote it with a HOUSE role on every grant (`acceptInviteAsExistingUser`,
 * `joinViaInvite`, `MembersService.addMember`, each an upsert on
 * `(organization_id, user_id)`). Once it decides who may open a location, that
 * overwrite would do two wrong things: an organisation owner who accepted a
 * staff invite to another of their own houses would silently stop being one,
 * and anyone invited as the owner of one house would become an owner of the
 * whole organisation. So a house grant now:
 *
 *   - never changes an existing organisation row (insert only, ignoring a
 *     duplicate), and
 *   - never writes `owner` on a new one: an owner of a house is a `manager` of
 *     its organisation until someone who owns the organisation says otherwise
 *     (there is no such route yet).
 *
 * Measured read-only 2026-09-18/19: every production organisation row's role
 * equals its holder's `users.role`, and the 5 `owner` rows are the 4 people who
 * opened their organisation plus the simulation owner, so no row was ever
 * overwritten and none changes by this.
 */
export const ORG_OWNER = "owner";

/** The organisation role a new row gets from a house grant. Never `owner`. */
export function orgRoleForHouseGrant(
  houseRole: string | null | undefined,
): "manager" | "staff" {
  return houseRole === "owner" || houseRole === "manager" ? "manager" : "staff";
}

/** The options every house-grant write to `organization_members` passes. */
export const ORG_ROW_INSERT_ONLY = {
  onConflict: "organization_id,user_id",
  ignoreDuplicates: true,
} as const;
