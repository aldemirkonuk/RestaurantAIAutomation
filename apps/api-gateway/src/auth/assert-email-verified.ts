import { ForbiddenException } from "@nestjs/common";

/** Thrown as `error.code` so the web client can route on it rather than parse prose. */
export const EMAIL_NOT_VERIFIED_CODE = "EMAIL_NOT_VERIFIED";

/**
 * The email-verification check, placed where the answer is knowable (OD-79).
 *
 * Before this existed, the gate lived only in the browser
 * (`ProtectedRoute.tsx:42`) and could not fire, because the field it compared
 * was never sent. Two separate omissions produced that: `getProfileForUser`
 * did not select `email_verified`, and `JwtStrategy.validate` dropped it from
 * `request.user`. So `undefined === false` was the whole gate, on every
 * render, and no server-side check existed to fall back on.
 *
 * A browser-only gate is not enforcement in any case — it stops a redirect,
 * not a request. `curl` with a valid token never went near `ProtectedRoute`.
 * This runs inside `JwtAuthGuard`, immediately after passport populates
 * `request.user`, for the same reason `assertTenantMatch` does: guards run
 * global → controller → route, and `JwtAuthGuard` is applied per route, so a
 * global guard would execute before there is a user to inspect and would wave
 * everything through.
 *
 * Fails CLOSED on a missing field. If `emailVerified` is absent, that means a
 * caller populated `request.user` by some path that does not carry it, and the
 * safe reading of "I cannot tell" is "not verified" — the alternative is the
 * silent always-allow this entry was filed for.
 */
export function assertEmailVerified(
  request: { user?: { emailVerified?: boolean } | null },
  allowUnverified: boolean,
): void {
  if (allowUnverified) return;

  const user = request.user;
  if (!user) return; // authentication is JwtAuthGuard's job, not this one's

  if (user.emailVerified !== true) {
    throw new ForbiddenException({
      message:
        "Verify your email address to continue. Check your inbox for the verification link, or request a new one.",
      code: EMAIL_NOT_VERIFIED_CODE,
    });
  }
}
