/**
 * Masks for the people a log line is about (F-702).
 *
 * Gateway logs go to the host's log store, where `DELETE /auth/me` cannot
 * reach them. A line that names a person by their typed address or phone
 * number outlives the account it was about, so log the `user_id` when there is
 * one and one of these masks when there is not.
 */

/** "m•••@example.com" -- enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  // String(): a login body is not validated before this line runs.
  const [local, domain] = String(email ?? "").split("@");
  if (!domain) return "your email address";
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** "•••42" -- the last two digits, enough to tell two sends apart. */
export function maskPhone(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `•••${digits.slice(-2)}`;
}
