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
 * The peer bucket is sized for a SHARED egress (QA round 14, the session's
 * call under the 2026-11-07 /goal). Every browser behind Vercel reaches the
 * gateway from a Vercel egress address, so at 10x the 10/min login limit 40
 * browsers at 5 logins each were cut off after 100, and ten real addresses at
 * ten attempts each drained the egress for everyone. At 100x it takes a
 * hundred real addresses to do that; what bounds guessing at ONE account from
 * many addresses is the per-account bucket on /auth/login
 * (rate-limit.guard.ts, `accountField`), not this one. Vercel's egress count
 * and real per-egress volume were not measured.
 *
 * Bucket keys collapse an IPv6 address to its /64 (one subscriber's
 * allocation: rotating inside it bought 2^64 fresh buckets) and an
 * IPv4-mapped IPv6 address to its IPv4 form (`bucketAddress`).
 *
 * What is assumed about Railway: ONE edge hop that appends or replaces. That
 * is the most this code will trust: `TRUSTED_PROXY_HOPS` is clamped to
 * `MAX_TRUSTED_PROXY_HOPS` (1), because a count higher than the real number
 * of appending hops makes `peer` a caller-written entry -- the bypass QA round
 * 14 measured at 500 of 500. 0 means "no proxy: ignore the header". A further
 * appending hop (a CDN in front of the edge) needs this constant raised in
 * code, with the hop measured, not an environment variable.
 *
 * The header is ignored -- fail closed onto the socket address -- when it does
 * not fit: fewer entries than the trusted hops, or an edge-written entry that
 * is not an IP address. A `client` entry that is not an IP address is
 * replaced by `peer`.
 *
 * `x-real-ip` is not read: on some Railway routes it carried a CDN's address,
 * and one rule read one way is easier to audit than two.
 */

import { isIP } from "net";

/** The `peer` bucket allows this many times a route's own limit. */
export const PEER_LIMIT_FACTOR = 100;

/** Peer budget factor for attempts without a valid known-device token (sign-in-device.ts). */
export const UNTRUSTED_PEER_FACTOR = 10;

/** The appending hops that are known to sit in front of the gateway: Railway's edge. */
export const MAX_TRUSTED_PROXY_HOPS = 1;

/** No address is longer than an IPv6 literal; cap what a caller can make us store. */
const MAX_ENTRY = 64;

/**
 * Appending proxy hops in front of the gateway that we trust: default 1,
 * never more than `MAX_TRUSTED_PROXY_HOPS`, 0 to ignore the header.
 */
export function trustedProxyHops(
  raw: string | undefined = process.env.TRUSTED_PROXY_HOPS,
): number {
  if (raw === undefined || raw.trim() === "") return MAX_TRUSTED_PROXY_HOPS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return MAX_TRUSTED_PROXY_HOPS;
  return Math.min(n, MAX_TRUSTED_PROXY_HOPS);
}

/**
 * An address as one canonical string, or null when it is not an IP address:
 * brackets and an IPv4 port are dropped, `::ffff:a.b.c.d` becomes `a.b.c.d`,
 * and IPv6 is lower-cased.
 */
export function canonicalAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) s = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  const zone = s.indexOf("%");
  if (zone > 0) s = s.slice(0, zone);
  const kind = isIP(s);
  if (kind === 4) return s;
  if (kind !== 6) return null;
  s = s.toLowerCase();
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];
  return s;
}

/** The eight 16-bit groups of a valid IPv6 literal. */
function ipv6Groups(s: string): number[] {
  let text = s;
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4) {
    const o = v4[1].split(".").map(Number);
    text =
      text.slice(0, -v4[1].length) +
      ((o[0] << 8) | o[1]).toString(16) +
      ":" +
      ((o[2] << 8) | o[3]).toString(16);
  }
  const [head, tail] = text.includes("::") ? text.split("::") : [text, null];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = tail === null ? [] : Array(8 - h.length - t.length).fill("0");
  return [...h, ...fill, ...t].map((g) => parseInt(g, 16));
}

/**
 * The key a limiter counts an address under: IPv4 as is, IPv6 as its /64.
 * Anything that is not an address is passed through (callers only hand it
 * addresses `requestAddresses` returned, or the socket's).
 */
export function bucketAddress(addr: string | null): string | null {
  const canonical = canonicalAddress(addr);
  if (!canonical) return addr;
  if (isIP(canonical) === 4) return canonical;
  const g = ipv6Groups(canonical);
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
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
  const trusted = Math.min(Math.max(hops, 0), MAX_TRUSTED_PROXY_HOPS);
  const chain = forwardedChain(req);
  if (trusted > 0 && chain.length >= trusted) {
    const at = chain.length - trusted;
    const peer = canonicalAddress(chain[at]);
    // An edge-written entry that is not an address: the header does not fit
    // the chain we trust, so none of it is read (below).
    if (peer) {
      const left = at > 0 ? canonicalAddress(chain[at - 1]) : null;
      return { peer, client: left ?? peer };
    }
  }
  // A direct connection (local dev, a health check), or a header that does
  // not fit: the socket is all there is.
  const own = canonicalAddress(socketAddress(req)) ?? socketAddress(req);
  return { peer: own, client: own };
}

/** The end user's address, for records and single-key limits. */
export function clientAddress(req: AddressedRequest): string | null {
  return requestAddresses(req).client;
}
