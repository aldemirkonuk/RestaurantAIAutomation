/**
 * Reading an auth link that someone pasted.
 *
 * Every link this parser exists for is minted server-side against the *web*
 * origin: the password-reset link (`auth.service.ts:1596`), the verification
 * link (`:705`), the invite link (`:893`). Tapping one on a phone opens a
 * browser. For the app to intercept them it would need Universal Links — an
 * `associatedDomains` entry in `app.json` **and** an
 * `apple-app-site-association` file served from that origin — and the second
 * half lives outside `apps/mobile`. Recorded as a blocker, not built.
 *
 * So the honest mobile flow is: open the mail, copy the link or the code,
 * paste it. `/reset-password` and `/verify-email` have a paste box; `/register`
 * accepts a pasted invite URL in its code field. Each accepts the whole URL or
 * just the interesting part, because nobody should have to know which part of
 * a link mattered.
 *
 * Matching is on **path only** — never on host. Mobile has no reliable
 * knowledge of the web origin (`config.ts:48` leaves `WEB_URL` empty unless
 * `EXPO_PUBLIC_WEB_URL` is set), so a host check would reject exactly the links
 * this is for. That does mean a link from any origin is read; it is read for a
 * *token*, which the server then validates, so the origin was never the thing
 * being trusted. The one place origin does matter — `?redirect=` — is handled
 * by `safeRedirectTarget` at the bottom of this file.
 *
 * Navigating a `wineops://` URL is **not** done here. expo-router installs its
 * own linking config (`expo-router/build/getLinkingConfig.js:52-68`) and
 * resolves incoming URLs against the file route tree; an auth-specific handler
 * alongside it pushed every screen twice. The `routeForAuthLink` that used to
 * live here was deleted for that reason, and `noOrphanExports.test.ts` now
 * fails on any replacement that nothing calls.
 */

import { normalizeInviteCode, isCompleteInviteCode } from "./inviteCode";
import { isValidResetToken } from "./credentials";

export interface ParsedLink {
  /** Path with no query, leading slash, no trailing slash. */
  path: string;
  query: Record<string, string>;
}

/**
 * Split any of `https://host/p?q=1`, `wineops://p?q=1`, `wineops:///p?q=1`,
 * `/p?q=1` or `p?q=1` into a path and a query bag.
 *
 * Hand-rolled rather than using `URL`: Hermes ships a partial WHATWG URL and
 * `searchParams` has historically been one of the missing parts, so a parser
 * that works in the test runner is not evidence it works on the device.
 */
export function parseLink(raw: string): ParsedLink | null {
  const input = raw.trim();
  if (!input) return null;

  // Strip scheme and authority. `wineops://reset-password` puts the path in
  // the authority slot, which is why this cannot just take everything after
  // the third slash.
  let rest = input;
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(rest);
  if (schemeMatch) {
    rest = rest.slice(schemeMatch[0].length);
    const isCustomScheme = !/^https?$/i.test(schemeMatch[1]);
    if (isCustomScheme) {
      // `wineops://reset-password?token=x` — no authority, the path is first.
      // `wineops:///reset-password?token=x` — empty authority, leading slash.
      if (rest.startsWith("/")) rest = rest.slice(1);
    } else {
      const slash = rest.indexOf("/");
      rest = slash === -1 ? "" : rest.slice(slash + 1);
    }
  } else if (rest.startsWith("/")) {
    rest = rest.slice(1);
  }

  const hashAt = rest.indexOf("#");
  if (hashAt !== -1) rest = rest.slice(0, hashAt);

  const queryAt = rest.indexOf("?");
  const pathPart = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const queryPart = queryAt === -1 ? "" : rest.slice(queryAt + 1);

  const query: Record<string, string> = {};
  for (const pair of queryPart.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? "" : pair.slice(eq + 1);
    if (!key) continue;
    query[safeDecode(key)] = safeDecode(value);
  }

  const path = "/" + pathPart.replace(/^\/+|\/+$/g, "");
  return { path, query };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/**
 * What the paste box on `/reset-password` should do with whatever landed in
 * it: a whole URL, or a bare token someone copied out of one.
 */
export function resetTokenFromPaste(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isValidResetToken(trimmed)) return trimmed;
  const parsed = parseLink(trimmed);
  const token = parsed?.query.token?.trim();
  return token && isValidResetToken(token) ? token : null;
}

/**
 * Same for `/verify-email`. Verification tokens are not UUID-shaped, so
 * anything non-empty that is not obviously a URL is taken at face value and
 * the server decides.
 */
export function verifyTokenFromPaste(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = parseLink(trimmed);
  const fromQuery = parsed?.query.token?.trim();
  if (fromQuery) return fromQuery;
  // A bare token has no scheme and no slashes; a URL we failed to read a token
  // out of is a mistake, not a token.
  if (/[\s/]/.test(trimmed) || trimmed.includes("://")) return null;
  return trimmed;
}

/**
 * And for the invite box: a pasted `${FRONTEND_URL}/invite/ABCD2345`, a
 * `/register?invite=…`, or the eight characters on their own.
 */
export function inviteCodeFromPaste(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const direct = normalizeInviteCode(trimmed);
  if (isCompleteInviteCode(direct)) return direct;

  const parsed = parseLink(trimmed);
  if (!parsed) return null;
  const segments = parsed.path.split("/").filter(Boolean);
  const fromPath =
    segments[0] === "invite" ? normalizeInviteCode(segments[1] ?? "") : "";
  if (isCompleteInviteCode(fromPath)) return fromPath;

  const fromQuery = normalizeInviteCode(parsed.query.invite ?? "");
  return isCompleteInviteCode(fromQuery) ? fromQuery : null;
}

/**
 * `?redirect=` from `/login`, sanitised.
 *
 * Only same-app paths survive. An absolute URL in a redirect parameter is the
 * classic open-redirect, and on a phone it would mean an emailed link could
 * bounce a freshly-authenticated session out to an arbitrary origin.
 */
export function safeRedirectTarget(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith("/")) return null;
  // `//evil.example` is protocol-relative — a URL wearing a path's clothes.
  if (value.startsWith("//")) return null;
  if (value.includes("://")) return null;
  return value;
}
