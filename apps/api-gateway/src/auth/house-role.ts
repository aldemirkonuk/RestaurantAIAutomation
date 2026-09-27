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
 * Membership only (ADR 0164, the founder, 2026-09-18: *"Membership only"*): an
 * active `user_restaurant_access` row in the house is the ONLY thing that makes
 * a person a member of it, and its role is the answer, so a NULL role is no
 * role. With no such row the session is refused outright
 * (`AuthService.validateJwtPayload`, 401 `HOUSE_ACCESS_ENDED`); it never gets
 * this far. [Until 2026-09-18 a `users` row whose `restaurant_id` named the
 * house was also read here, at `users.role || "staff"`: the seventh users-row
 * fallback site (44.1i). Retired with ADR 0164. Its precondition held:
 * migration 20260918153000 is applied, and no production `users` row names a
 * house without an active row there (read-only, 2026-09-18/19).]
 */

/**
 * The house a token names, or null for a token that names none.
 *
 * Exactly the test `JwtStrategy.validate` has always used to decide whether
 * the token names a house at all.
 */
export function tokenHouse(payload: {
  restaurantId?: string | null;
}): string | null {
  const house = payload?.restaurantId;
  return house && String(house).trim().length > 0 ? house : null;
}

/**
 * The role an active access row gives, or null. Null means no role.
 */
export function roleInHouse(
  access: { role?: string | null } | null,
): string | null {
  return access ? (access.role ?? null) : null;
}
