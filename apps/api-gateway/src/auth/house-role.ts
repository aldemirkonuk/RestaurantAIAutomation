/**
 * A person's role IN ONE HOUSE, the one their session's token names.
 *
 * The founder's rule (ADR 0162, answer A, 2026-09-18): *"Only that house"*. A
 * role in one house must never change what a person may do in another.
 *
 * `RolesGuard` gates every `@Roles` route on `req.user.role`, and
 * `JwtStrategy.validate` used to fill that from `users.role`: one value per
 * person for every house they belong to. So a person demoted to staff in house
 * B kept manager on every `@Roles` route in B while their `users` row named
 * house A, and a person with no membership in B at all carried their house-A
 * role into it (PR #393's round-3 audit, finding 1; v3.0-TECH-DEBT 44.1q).
 *
 * The role is read the way `MembersService.assertMembership` reads a member
 * (`restaurants/members.service.ts`): an active `user_restaurant_access` row in
 * the house decides, and its role is the answer, so a NULL role is no role.
 * With no such row, a `users` row whose `restaurant_id` names the house is read
 * at `users.role || "staff"`. Anything else is no role, and every `@Roles` route
 * refuses it. This is the seventh site that reads the `users` row that way;
 * it retires with the other six (v3.0-TECH-DEBT 44.1i), and not before
 * migration 20260918153000 is applied in production.
 */

/**
 * The house a token names, or null for a token that names none.
 *
 * Exactly the test `JwtStrategy.validate` has always used to decide whether
 * the token's `restaurantId` wins over the `users` row's.
 */
export function tokenHouse(payload: {
  restaurantId?: string | null;
}): string | null {
  const house = payload?.restaurantId;
  return house && String(house).trim().length > 0 ? house : null;
}

/**
 * The role in `house`, from the active access row read there (or null when
 * there is none) and the person's `users` row. Null means no role.
 */
export function roleInHouse(
  access: { role?: string | null } | null,
  user: { restaurant_id?: string | null; role?: string | null } | null,
  house: string,
): string | null {
  if (access) {
    return access.role ?? null;
  }
  if (user && user.restaurant_id === house) {
    return user.role || "staff";
  }
  return null;
}
