/**
 * Where sign-in sends a person back to (F-213).
 *
 * Two sources: the `?redirect=` query a link carries, and the location a
 * signed-out page handed to /login in router state (ProtectedRoute). Both keep
 * the whole address — path, query and hash — because the deep links in our
 * mails carry their meaning in the query (a low-stock alert opens
 * /inventory?item=…, a recurring order opens /orders?…). Router state used to
 * keep only the path, so the person landed on the page without the thing the
 * mail was about.
 *
 * Anything that is not a path on this site is refused and becomes "/": a
 * `redirect=` is typed by whoever wrote the link, so it must never send a
 * person to another site after they sign in.
 */

const FALLBACK = "/";

function sameSitePath(raw: string): string | null {
  // A path on this site starts with exactly one "/". "//host" and "/\host"
  // are read by browsers as another site.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\"))
    return null;
  try {
    const base = window.location.origin;
    const url = new URL(raw, base);
    if (url.origin !== base) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

type FromState = { from?: { pathname?: unknown; search?: unknown; hash?: unknown } } | null | undefined;

export function returnPathAfterSignIn(search: string, state: unknown): string {
  const redirect = new URLSearchParams(search).get("redirect");
  if (redirect) return sameSitePath(redirect) ?? FALLBACK;
  const from = (state as FromState)?.from;
  if (from && typeof from.pathname === "string") {
    const query = typeof from.search === "string" ? from.search : "";
    const hash = typeof from.hash === "string" ? from.hash : "";
    return sameSitePath(from.pathname + query + hash) ?? FALLBACK;
  }
  return FALLBACK;
}
