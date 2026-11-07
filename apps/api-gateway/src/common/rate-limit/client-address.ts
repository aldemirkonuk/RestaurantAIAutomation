/**
 * Where a request came from, for every per-address limit in the gateway
 * (QA round 11, R11-10).
 *
 * Until 2026-11-07 the three limiters (`RateLimitGuard`,
 * `PasswordResetThrottleGuard`, the emailed-code `requestSource`) each keyed
 * on the FIRST `x-forwarded-for` entry. A caller that reaches the gateway's
 * Railway URL directly writes that entry itself, so a script that sent a fresh
 * value on every request had a fresh bucket every time: the 10/min on
 * /auth/login, /auth/join, the invite read and the emailed-code verify did not
 * hold.
 *
 * Two roads reach the gateway, and one header has to serve both:
 *
 *   browser -> Vercel (/api rewrite, vercel.json) -> Railway edge -> gateway
 *   anyone  ------------------------------------->  Railway edge -> gateway
 *
 * Vercel OVERWRITES `x-forwarded-for` with the address it saw ("to prevent IP
 * spoofing", Vercel request-header docs), so on the first road the entry
 * Vercel wrote is the real browser. On the second road every entry the caller
 * sent is theirs to invent. Nothing in the request says which road it took:
 * Vercel publishes no egress range, and a rewrite cannot add a secret header.
 *
 * So two addresses are read, and each limiter checks both:
 *
 *   - `peer`: the `TRUSTED_PROXY_HOPS`-th entry from the RIGHT (default 1),
 *     the address Railway's edge saw. Nobody but the edge writes it, whether
 *     the edge appends to the header or replaces it (Railway's own staff
 *     answers disagree on which; it was not measured in production). On the
 *     Vercel road it is a Vercel egress address, shared by many browsers; on
 *     the direct road it is the caller's own address.
 *   - `client`: the entry just left of `peer`, or `peer` when there is none.
 *     On the Vercel road it is the browser; on the direct road it is
 *     caller-written.
 *
 * Each limit keys on `client`, as before, and a second bucket keyed on
 * `peer` allows `PEER_LIMIT_FACTOR` times as much. A browser behind Vercel is
 * held to its own limit; a script that invents `client` values is held to the
 * factor times the limit, at its real address, instead of to nothing.
 *
 * What is assumed about Railway: ONE edge hop that appends or replaces. If a
 * further proxy that appends sits in front of the edge (a CDN), `peer` would
 * be that proxy and `client` the Vercel egress or the caller: set
 * `TRUSTED_PROXY_HOPS` to the number of appending hops. A count too low makes
 * buckets coarser (stricter), never bypassable on `peer`.
 *
 * `x-real-ip` is not read: on some Railway routes it carried a CDN's address,
 * and one rule read one way is easier to audit than two.
 */

/** The `peer` bucket allows this many times a route's own limit. */
export const PEER_LIMIT_FACTOR = 10;

/** No address is longer than an IPv6 literal; cap what a caller can make us store. */
const MAX_ENTRY = 64;

/** Appending proxy hops in front of the gateway that we trust; default 1. */
export function trustedProxyHops(
  raw: string | undefined = process.env.TRUSTED_PROXY_HOPS,
): number {
  if (raw === undefined || raw.trim() === "") return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 1;
}

export interface AddressedRequest {
  headers?: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string | null } | null;
  connection?: { remoteAddress?: string | null } | null;
}

export interface RequestAddresses {
  /** The address the trusted edge saw. Unforgeable; may be a shared proxy. */
  peer: string | null;
  /** The best guess at the end user. Real behind Vercel; forgeable when direct. */
  client: string | null;
}

function socketAddress(req: AddressedRequest): string | null {
  return (
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    req.ip ||
    null
  );
}

function forwardedChain(req: AddressedRequest): string[] {
  const raw = req.headers?.["x-forwarded-for"];
  // Node joins repeated headers with ", "; an array arrives from some adapters.
  const joined = Array.isArray(raw) ? raw.join(",") : raw;
  if (typeof joined !== "string") return [];
  return joined
    .split(",")
    .map((s) => s.trim().slice(0, MAX_ENTRY))
    .filter((s) => s.length > 0);
}

export function requestAddresses(
  req: AddressedRequest,
  hops: number = trustedProxyHops(),
): RequestAddresses {
  const chain = forwardedChain(req);
  if (hops > 0 && chain.length >= hops) {
    const at = chain.length - hops;
    const peer = chain[at];
    return { peer, client: at > 0 ? chain[at - 1] : peer };
  }
  // A direct connection (local dev, a health check): the socket is all there is.
  const own = socketAddress(req);
  return { peer: own, client: own };
}

/** The end user's address, for records and single-key limits. */
export function clientAddress(req: AddressedRequest): string | null {
  return requestAddresses(req).client;
}
