/**
 * Client-side validation for the credentials the auth screens collect.
 *
 * Every rule here mirrors a server rule and is pinned to it by
 * `__tests__/authContract.test.ts`. The point of mirroring rather than just
 * letting the server answer is latency and honesty: on a phone, a round trip
 * to be told "8 characters minimum" is a second of nothing followed by a
 * rejection the client already knew about. The point of *pinning* it is that a
 * client-side rule which drifts looser than the server's is worse than none —
 * it promises a submit that will fail.
 */

/** Mirrors `@MinLength(8)` on the password fields of every auth DTO. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * `@IsUUID()` on `ResetPasswordDto.token`. Reset tokens are UUIDs, which is
 * why a mistyped or truncated paste can be caught before it is spent — the
 * token is single-use server-side, so a wasted round trip on a mangled paste
 * costs a whole new email.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loose on purpose. The server owns the real answer (`@IsEmail()`); this only
 * has to stop the obviously-unsendable so the keyboard can stay up.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function emailError(raw: string): string | null {
  const email = normalizeEmail(raw);
  if (email.length === 0) return "Enter your email address.";
  if (!EMAIL_RE.test(email)) return "That doesn't look like an email address.";
  return null;
}

export function passwordError(password: string): string | null {
  if (password.length === 0) return "Choose a password.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export function confirmationError(
  password: string,
  confirmation: string,
): string | null {
  if (confirmation.length === 0) return "Type the password again.";
  if (password !== confirmation) return "Those two don't match.";
  return null;
}

export type PasswordStrength = "weak" | "fair" | "strong";

/**
 * A hint, never a gate — the only rule that can block a submit is the length
 * minimum above, because that is the only rule the server has. Showing a
 * strength meter that refuses a password the server would accept would be the
 * client inventing policy.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) return "weak";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (password.length >= 12 && classes >= 3) return "strong";
  if (classes >= 2) return "fair";
  return "weak";
}

export function isValidResetToken(token: string): boolean {
  return UUID_RE.test(token.trim());
}

export function resetTokenError(token: string): string | null {
  const t = token.trim();
  if (t.length === 0) {
    return "Paste the code from your reset email.";
  }
  if (!isValidResetToken(t)) {
    return "That reset code isn't in the right shape — copy the whole thing from the email.";
  }
  return null;
}

/** Name is required by both registration DTOs but carries no format rule. */
export function nameError(raw: string): string | null {
  return raw.trim().length === 0 ? "Enter your name." : null;
}
