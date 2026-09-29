/**
 * A notification's `action_url`, reduced to a path inside this app, or null.
 *
 * Why this exists (fix/websocket-role-gate, 2026-09-28). The web's View button
 * runs `window.location.href = action_url` (web `lib/websocket.tsx`). The web
 * has no CSP, and it keeps tokens in localStorage. So an `action_url` of
 * `javascript:…` takes over the account of whoever clicks it. Before this
 * fix, `POST /notifications` let any member write one, and it was broadcast to
 * the whole house.
 *
 * A prefix test ("starts with /, not //") is not enough. `/\evil.com` passes
 * it, and browsers normalise the backslash to `//evil.com`. `/.//evil.com`
 * passes it too, and URL parsing leaves the path as `//evil.com`, which a
 * browser reads as protocol-relative. So the value is parsed, and what is
 * returned is the parsed path, never the raw string:
 *
 * - it must be a string that starts with `/`, is at most 2048 characters long,
 *   and holds no backslash, no C0 control or space, and no DEL. The URL parser
 *   strips tab and newline, which is how `/\t/evil.com` would become
 *   `//evil.com`;
 * - it must parse against a fixed base and keep that base's origin;
 * - the returned `pathname + search + hash` must not start with `//`.
 *
 * The web sinks do not use this yet (they are listed as a follow-up in
 * v3.0-TECH-DEBT.md). Rows written before this fix are not rewritten.
 *
 * The base is the reserved `.invalid` placeholder that
 * `IntegrationsOAuthService.safeReturnPath` already parses against, and that
 * `scripts/check_data_terms_name_every_host.py` excuses as never requested.
 * Which base is used does not matter, only that the parsed URL stays on it.
 */
const BASE = "https://return-path.invalid";
// Control characters are the point of the check.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\\u0000- \u007f]/;

export function safeActionPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > 2048) return null;
  if (!raw.startsWith("/")) return null;
  if (FORBIDDEN.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (parsed.origin !== BASE) return null;
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}
