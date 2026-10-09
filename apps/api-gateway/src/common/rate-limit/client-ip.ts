/**
 * The caller's address, as the gateway's per-address limiters key it
 * (F-510, 2026-10-09).
 *
 * Read the LAST `x-forwarded-for` entry, never the first. The first entry is
 * whatever the client typed whenever a proxy appends to the header instead of
 * replacing it, so keying on it let anyone rotate a header and get a fresh
 * limit on every request.
 *
 * How the hops forward, as far as could be checked without probing
 * production (2026-10-09):
 *   - Railway's edge is the hop in front of this process. Its docs name only
 *     `X-Real-IP` ("for identifying client's remote IP",
 *     docs.railway.com/networking/public-networking/specs-and-limits). Its
 *     staff have said both that the edge APPENDS the connecting address to
 *     `x-forwarded-for` (rightmost is trustworthy) and, more recently, that it
 *     OVERWRITES the header with the connecting address. Under either answer
 *     the last entry is the address Railway's edge saw, so the last entry is
 *     the one that holds under both. `X-Real-IP` was seen duplicated (client
 *     copy kept) in one report, so it is not read here.
 *   - Vercel's `/api/*` rewrite (apps/web/vercel.json) overwrites
 *     `x-forwarded-for` with the real client before it forwards, so a request
 *     that comes through Vercel cannot carry a client-chosen first entry
 *     either. If Railway appends, such a request's last entry is a Vercel
 *     egress address shared by many people; if Railway overwrites, the old
 *     first-entry read already saw that same Vercel address. A shared key is
 *     the safe failure (it limits sooner), a client-chosen key is not.
 *
 * Not used: Express `trust proxy` with a hop count. The count differs by path
 * (browser → Vercel → Railway, or straight to the Railway domain), so no one
 * number is right for both.
 *
 * The socket address is the fallback for a direct connection (local dev,
 * health checks, tests).
 */
export function clientIp(request: any): string {
  const forwarded = request?.headers?.["x-forwarded-for"];
  const chain = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  if (typeof chain === "string" && chain.length > 0) {
    const entries = chain
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const last = entries[entries.length - 1];
    if (last) return last;
  }
  return (
    request?.socket?.remoteAddress ||
    request?.connection?.remoteAddress ||
    request?.ip ||
    "unknown"
  );
}
