/**
 * Shared gate for the local-only auth bypass.
 *
 * Used by two call sites that must agree on exactly the same conditions:
 *   - JwtAuthGuard, which lets an already-issued dev session skip real JWT
 *     verification on every request.
 *   - AuthController#devBypassLogin, which is what issues that session's
 *     tokens in the first place, minted through the real `generateTokens`
 *     path so refresh, `/auth/me`, `/auth/me/role` and every other endpoint
 *     that reads `accessToken` from localStorage work completely unmodified.
 *
 * Defined once so the two can never drift — a gate that is checked one way in
 * the guard and a looser way at the login endpoint would make the login
 * endpoint the actual hole.
 */
export function isLocalhostRequest(request: {
  ip?: string;
  hostname?: string;
  headers?: Record<string, unknown>;
}): boolean {
  const ip = request.ip ?? "";
  const localIps = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
  if (localIps.includes(ip)) return true;
  const host = String(request.headers?.host ?? request.hostname ?? "");
  return /^localhost(:\d+)?$/.test(host) || /^127\.0\.0\.1(:\d+)?$/.test(host);
}

export interface DevBypassRequest {
  ip?: string;
  hostname?: string;
  headers?: Record<string, unknown>;
}

/**
 * True only when every one of these holds:
 *   1. NODE_ENV is not "production".
 *   2. DEV_AUTH_BYPASS=true is set (in a local, gitignored .env.local).
 *   3. DEV_AUTH_BYPASS_EMAIL names the account to impersonate.
 *   4. The request is from localhost.
 *   5. The request carries `X-Dev-Bypass: <DEV_AUTH_BYPASS_SECRET>`.
 *
 * Fails closed: any missing piece of config or any header mismatch returns
 * false, never a default identity.
 */
export function devBypassAllowed(request: DevBypassRequest): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.DEV_AUTH_BYPASS !== "true") return false;
  if (!process.env.DEV_AUTH_BYPASS_EMAIL) return false;
  if (!isLocalhostRequest(request)) return false;

  const secret = process.env.DEV_AUTH_BYPASS_SECRET;
  const provided = request.headers?.["x-dev-bypass"];
  return !!secret && provided === secret;
}
