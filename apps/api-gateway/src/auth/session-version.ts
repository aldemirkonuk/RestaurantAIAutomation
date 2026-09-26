/**
 * A password reset or change signs out every other session of that person
 * (ADR 0225; the founder, 2026-09-25, round 4, item 17: "Password
 * reset/change signs out every other session").
 *
 * The mechanism is a per-person session version. `users.session_version`
 * (migration 20260926120500) starts at 0 and goes up by one each time the
 * password is set. Every token this API mints carries the version it was
 * minted under as `sv`. A token whose `sv` is below the person's current
 * version belongs to a session that ended, and every place that reads a
 * token refuses it:
 *
 *   - `AuthService.validateJwtPayload` (every authenticated HTTP request; it
 *     already reads the `users` row, so this costs no extra query),
 *   - `AuthService.refreshAccessToken` (the web's and the phone's refresh),
 *   - `WebsocketGateway.handleConnection` (a socket's handshake).
 *
 * The session that changed the password is given a new pair minted under the
 * new version, so it alone survives. A reset has no such session: every
 * session ends.
 *
 * A token with no `sv` (minted before this shipped) reads as version 0, so it
 * lives exactly until the first password change after the deploy. A `users`
 * row with no `session_version` (the column not yet migrated) reads as 0 too,
 * which is the truth: no version has ever been bumped where the column does
 * not exist.
 */

/** The code a request carries when its session was signed out this way. */
export const SESSION_ENDED = "SESSION_ENDED";

function asVersion(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

/** The person's current session version, from their `users` row. */
export function sessionVersionOf(
  user: { session_version?: unknown } | null | undefined,
): number {
  return asVersion(user?.session_version);
}

/** The version a token was minted under. */
export function tokenSessionVersion(
  payload: { sv?: unknown } | null | undefined,
): number {
  return asVersion(payload?.sv);
}

/**
 * Whether a token still belongs to a live session: minted under the person's
 * current version, or a later one.
 */
export function sessionIsCurrent(
  payload: { sv?: unknown } | null | undefined,
  user: { session_version?: unknown } | null | undefined,
): boolean {
  return tokenSessionVersion(payload) >= sessionVersionOf(user);
}
