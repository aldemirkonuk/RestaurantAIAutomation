/**
 * Two rules about an address nobody has proved yet (ADR 0229, forks 7 and 8;
 * the founder, 2026-09-27, items 72 and 73).
 *
 * Fork 7, item 72, "Bind invite to address (Recommended)": an invitation
 * verifies the account it creates only when the address typed at the join is
 * the address the invite was made for (`organization_invites.target_email`,
 * written by `AuthService.generateInvite` from its `targetEmail`). An invite
 * made with no address, or a join with another address, creates the account
 * unverified, and the person proves the address once through /verify-email.
 *
 * Fork 8, item 73, "Expire the password, 7 days (Recommended)": a password on
 * an account still unverified more than seven days after it was registered
 * (`users.created_at`) no longer signs in. The row is kept (ADR 0149 answer 2:
 * no `users` row is deleted); the refusal is the wrong-password refusal, word
 * for word, so it says nothing about the account; an emailed code still signs
 * in, and fork 6 then removes the unproven password.
 */
import { normalizeEmail } from "../passkeys/sign-in-codes.service";

/** How long an unproven password keeps signing in after registration. */
export const UNPROVEN_PASSWORD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True only when the invite named an address and the joiner typed that same
 * address (trimmed, case-insensitive). An invite with no address never
 * verifies anyone.
 */
export function inviteVerifiesAddress(
  inviteTargetEmail: unknown,
  joiningEmail: unknown,
): boolean {
  const target = normalizeEmail(inviteTargetEmail);
  return target.length > 0 && target === normalizeEmail(joiningEmail);
}

/**
 * True when this account's password may no longer sign in: the address is
 * unproven and the account was registered more than
 * `UNPROVEN_PASSWORD_WINDOW_MS` ago. A missing or unreadable registration time
 * on an unverified account counts as lapsed (fails closed; the emailed code
 * still works). A verified account never lapses.
 */
export function unprovenPasswordHasLapsed(
  user: { email_verified?: boolean | null; created_at?: unknown },
  now: number,
): boolean {
  if (user.email_verified === true) return false;
  const registered =
    typeof user.created_at === "string" ? Date.parse(user.created_at) : NaN;
  if (!Number.isFinite(registered)) return true;
  return now - registered > UNPROVEN_PASSWORD_WINDOW_MS;
}
