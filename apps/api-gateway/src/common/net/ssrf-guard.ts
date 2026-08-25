import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for server-side fetches of user-supplied URLs (OD-54).
 *
 * `vendor-page-extractor.service.ts` fetches a vendor URL that a user supplies.
 * CodeQL rated it critical (`js/request-forgery`), and it was right: the only
 * check was `robots.txt`, which is politeness, not an allowlist. A vendor URL of
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/` would have
 * been fetched, parsed, and had its contents written into vendor observations.
 *
 * Three things have to be true together, and any one alone is bypassable:
 *
 *  1. **Resolve DNS and check the ADDRESS, not the hostname.** A blocklist of
 *     names is defeated by any domain whose A record points at 127.0.0.1 — and
 *     several public ones deliberately do.
 *  2. **Check EVERY resolved address.** A hostname resolving to one public and
 *     one private address must be refused; taking the first is a coin flip.
 *  3. **Re-check every redirect hop.** `fetch` follows redirects by default, so
 *     a public URL that 302s to the metadata endpoint defeats checks 1 and 2
 *     entirely. This is the hole most SSRF fixes leave open.
 *
 * DNS rebinding (a TTL-0 record that answers public here and private at connect
 * time) is NOT closed by this and cannot be without pinning the socket to the
 * validated address. That is a real residual risk, recorded rather than implied
 * away: it needs a custom agent, and is out of scope for OD-54.
 */

/** Blocked IPv4 ranges, as [network, prefix-length]. */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918 private
  ["100.64.0.0", 10], // RFC6598 carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — the cloud metadata endpoint lives here
  ["172.16.0.0", 12], // RFC1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC1918 private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes 255.255.255.255
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255) return null;
    n = (n << 8) | b;
  }
  return n >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const addr = v4ToInt(ip);
  if (addr === null) return true; // unparseable is not provably public
  return BLOCKED_V4.some(([net, bits]) => {
    const base = v4ToInt(net);
    if (base === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (addr & mask) >>> 0 === (base & mask) >>> 0;
  });
}

function isBlockedV6(ip: string): boolean {
  const a = ip.toLowerCase().split("%")[0]; // strip any zone index
  if (a === "::" || a === "::1") return true; // unspecified, loopback
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — judge by the v4 address,
  // or a private v4 sails through wearing a v6 costume.
  const mapped = a.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);
  if (
    a.startsWith("fe8") ||
    a.startsWith("fe9") ||
    a.startsWith("fea") ||
    a.startsWith("feb")
  )
    return true; // fe80::/10 link-local
  if (a.startsWith("fc") || a.startsWith("fd")) return true; // fc00::/7 unique-local
  if (a.startsWith("ff")) return true; // ff00::/8 multicast
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isBlockedV4(ip);
  if (v === 6) return isBlockedV6(ip);
  return true; // not an IP at all — refuse rather than guess
}

export class SsrfBlockedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "SsrfBlockedError";
  }
}

/**
 * Throws unless every address `url`'s host resolves to is publicly routable.
 * Literal IPs are checked directly; hostnames are resolved with `all: true`.
 */
export async function assertPublicHttpTarget(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`Unsupported protocol ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // unwrap [::1]

  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new SsrfBlockedError(
        `Refusing to fetch a non-public address: ${host}`,
      );
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch (err: any) {
    throw new SsrfBlockedError(
      `Could not resolve ${host}: ${err?.message ?? err}`,
    );
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`${host} resolved to no addresses`);
  }
  // EVERY address, not the first. A host answering with one public and one
  // private address is a deliberate SSRF technique, not a misconfiguration.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new SsrfBlockedError(
        `Refusing to fetch ${host}: it resolves to the non-public address ${address}`,
      );
    }
  }
}

/**
 * `fetch`, with the target validated before the request AND before following
 * each redirect. Without the per-hop check the pre-flight validation is
 * decorative — a public URL can 302 straight to the metadata endpoint.
 */
export async function safeFetch(
  input: URL | string,
  init: RequestInit & { maxRedirects?: number } = {},
): Promise<Response> {
  const { maxRedirects = 3, ...rest } = init;
  let current = new URL(input.toString());

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHttpTarget(current);
    const res = await fetch(current.toString(), {
      ...rest,
      redirect: "manual",
    });

    const isRedirect = res.status >= 300 && res.status < 400;
    const location = res.headers.get("location");
    if (!isRedirect || !location) return res;

    if (hop === maxRedirects) {
      throw new SsrfBlockedError(
        `Too many redirects (>${maxRedirects}) starting from ${input.toString()}`,
      );
    }
    current = new URL(location, current); // resolve relative Location headers
  }
  // Unreachable: the loop either returns or throws.
  throw new SsrfBlockedError("Redirect handling fell through");
}
