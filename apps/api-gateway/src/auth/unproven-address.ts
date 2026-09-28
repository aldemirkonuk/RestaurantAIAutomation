/**
 * The rules about an address nobody has proved yet (ADR 0229, forks 7-10;
 * the founder, 2026-09-27, items 72, 73, 77 and 78).
 *
 * Fork 7, item 72, "Bind invite to address (Recommended)": an invitation
 * verifies the account it creates only when the address typed at the join is
 * the address the invite was made for (`organization_invites.target_email`,
 * written by `AuthService.generateInvite` from its `targetEmail`). An invite
 * made with no address, or a join with another address, creates the account
 * unverified, and the person proves the address once through /verify-email.
 *
 * Fork 9, item 77, "Email invite + (c) interim (Recommended)": the address
 * alone is only the minter's word, so it is not enough. The gateway mails the
 * invite to that address with a second secret that exists only in that mail
 * (`organization_invites.email_secret_hash` holds its SHA-256), and a join
 * verifies only when it carries that secret AND the address matches. The
 * minter's copied link still works, but joins unverified.
 *
 * Fork 8, item 73, "Expire the password, 7 days (Recommended)": a password on
 * an account still unverified more than seven days after it was registered
 * (`users.created_at`) no longer signs in. The row is kept (ADR 0149 answer 2:
 * no `users` row is deleted); the refusal is the wrong-password refusal, word
 * for word, so it says nothing about the account; an emailed code still signs
 * in, and fork 6 then removes the unproven password.
 *
 * Fork 10, item 78, "Refresh refuses lapsed (Recommended)": a refresh is not
 * a sign-in, but it must not outlive the password either.
 * `AuthService.refreshAccessToken` refuses an account whose unproven password
 * has lapsed (`holdsUnprovenPassword` and `unprovenPasswordHasLapsed`), so the
 * session ends with the password and the person signs in by emailed code.
 *
 * Fork 11, item 83, "Per address + per sender": besides the house's 20 a day,
 * invite mails are capped per target address across all houses and per
 * minting person (`INVITE_EMAILS_PER_ADDRESS`, `INVITE_EMAILS_PER_SENDER`).
 *
 * Fork 12, item 81, "Link needs sign-in (Recommended)": the /verify-email link
 * verifies only for a caller signed in to that same account
 * (`AuthService.verifyEmail`); someone holding only the mailbox signs in with
 * an emailed code, and fork 6 removes a password they never set.
 *
 * Fork 13, item 82, "Hold until accepted (Recommended)": a house membership an
 * invite join grants before the address is proved is written held
 * (`membershipIsHeld`), and grants nothing until the proven person accepts it.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { normalizeEmail } from "../passkeys/sign-in-codes.service";

/** How long an unproven password keeps signing in after registration. */
export const UNPROVEN_PASSWORD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How many invite mails one house may send in `INVITE_EMAIL_WINDOW_MS`
 * (item 77: "rate-limit invite emails per house"). Past it the invite is still
 * made, and its link still joins, but nothing is mailed, so a join from it is
 * unverified.
 */
export const INVITE_EMAILS_PER_HOUSE = 20;
export const INVITE_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How many invite mails one ADDRESS may receive in `INVITE_EMAIL_WINDOW_MS`,
 * whichever houses send them (ADR 0229 fork 11; the founder, 2026-09-28,
 * item 83, "Per address + per sender": "cap invite mails per target address
 * across all houses (3/day)"). The founder's number. Past it the invite is
 * made, not mailed, and the minter is told.
 */
export const INVITE_EMAILS_PER_ADDRESS = 3;

/**
 * How many invite mails one MINTING PERSON may send in
 * `INVITE_EMAIL_WINDOW_MS`, across every house they run (item 83, "AND per
 * minting person"; the number chosen as industry leaders choose it, item 67).
 * The two published figures for the same shape: Google Groups caps the
 * external invitations one user sends across all their groups at 500 a day
 * ("External member invitations per day, per user", Google Workspace Admin
 * Help, "Understand groups policies and limits"), and GitHub caps a new or
 * free organization at 50 invitations per 24 hours (500 once it is a month
 * old or paid; GitHub Docs, "Inviting users to join your organization"). An
 * account that opens houses to mail a victim is new by construction, so the
 * stricter, new-account figure is taken: 50. A person running several
 * houses still gets more than one house's 20. Changeable: it is a number in
 * ADR 0229 § Fork 11, not a rule.
 */
export const INVITE_EMAILS_PER_SENDER = 50;

/** A fresh 256-bit secret for one invite mail, URL-safe. */
export function newInviteEmailSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored for that secret: its SHA-256, hex. The secret is random, so
 * a plain hash is enough (nothing to guess). */
export function hashInviteEmailSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * True only when all three hold: the invite named an address, the joiner typed
 * that same address (trimmed, case-insensitive), and the join carries the
 * secret that was mailed to it (its hash equals the invite's). An invite with
 * no address, no stored hash (never mailed, or minted before item 77), or a
 * join without the secret, verifies nobody: that is item 77's "(c) interim",
 * and it is permanent for every join that did not come from the mail.
 */
export function inviteVerifiesAddress(
  invite: { targetEmail: unknown; emailSecretHash: unknown },
  join: { email: unknown; emailSecret: unknown },
): boolean {
  const target = normalizeEmail(invite.targetEmail);
  if (target.length === 0 || target !== normalizeEmail(join.email)) {
    return false;
  }
  return inviteEmailSecretMatches(invite.emailSecretHash, join.emailSecret);
}

/** Constant-time compare of a presented secret against the stored hash. */
export function inviteEmailSecretMatches(
  storedHash: unknown,
  presented: unknown,
): boolean {
  if (typeof storedHash !== "string" || !/^[0-9a-f]{64}$/.test(storedHash)) {
    return false;
  }
  if (typeof presented !== "string" || presented.length === 0) return false;
  const got = Buffer.from(hashInviteEmailSecret(presented), "hex");
  return timingSafeEqual(got, Buffer.from(storedHash, "hex"));
}

/**
 * True when a password on this account is one nobody has proved: the account
 * holds a password and its address is unverified. Item 78 ends a session only
 * when such a password has lapsed; an account with no password has no
 * unproven password to lapse.
 */
export function holdsUnprovenPassword(user: {
  email_verified?: boolean | null;
  password_hash?: unknown;
}): boolean {
  return (
    user.email_verified !== true &&
    typeof user.password_hash === "string" &&
    user.password_hash.length > 0
  );
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

/**
 * Whether a membership an invite join grants is HELD (ADR 0229 fork 13; the
 * founder, 2026-09-28, item 82, "Hold until accepted (Recommended)"): true
 * when the joining account's address is not proved at the moment of the
 * join. A new account is proved only by the mailed secret
 * (`inviteVerifiesAddress`); an existing account only by `email_verified`.
 * A held row is written inactive with `held_since` set, and becomes active
 * only when the person, once proven, accepts it.
 */
export function membershipIsHeld(addressProved: boolean): boolean {
  return addressProved !== true;
}
