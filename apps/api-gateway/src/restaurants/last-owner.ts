/**
 * The database refuses a change that would leave a house with no owner
 * (trigger `user_restaurant_access_keeps_an_owner`, migration
 * a_removal_ends_their_grants_and_a_house_keeps_an_owner, F-582): SQLSTATE
 * 23514 with the marker `house_keeps_an_owner`. The gateway's own count runs
 * first, so this answers only the case it cannot see: two owners demoting or
 * removing each other at the same moment.
 */
export function leavesNoOwner(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    !!err &&
    err.code === "23514" &&
    /house_keeps_an_owner/.test(err.message ?? "")
  );
}

export const NO_OWNER_LEFT =
  "That would leave the restaurant with no owner. Another owner may have " +
  "just changed their own role. Make someone else an owner first.";
