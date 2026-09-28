import { lookup } from "dns/promises";
import { isIP } from "net";

/**
 * Where a probe is allowed to go.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------
 * `POST /mcp-connections/:id/probe` makes the SERVER fetch a URL a USER typed.
 * That is a server-side request forgery primitive unless something stops it:
 * `http://169.254.169.254/latest/meta-data/` is the cloud instance-metadata
 * endpoint, `http://127.0.0.1:4000/api/v1/...` is this gateway talking to
 * itself with whatever ambient trust the loopback carries, and `http://10.x`
 * is the rest of the private network. The declaration form's only validation
 * (`CreateMcpConnectionDto`, and the table's `url ~ '^https?://'` CHECK) is on
 * the SCHEME, which none of those violate.
 *
 * THE FIRST VERSION OF THIS FILE WAS BYPASSABLE. THIS IS WHY IT IS NOW PARSED.
 * --------------------------------------------------------------------------
 * The 2026-09-03 build detected IPv4-mapped IPv6 with a STRING test:
 *
 *     const tail = ip.includes(".") ? ip.slice(ip.lastIndexOf(":") + 1) : null;
 *
 * and its own comment said that closed `::ffff:127.0.0.1`. It did not. Node's
 * `URL` canonicalises an IPv4-mapped literal to hex BEFORE any of this code
 * sees it — `http://[::ffff:127.0.0.1]/` has hostname `[::ffff:7f00:1]`, with
 * no `.` left in the string — so the branch was dead code and the audit
 * reproduced a full MCP handshake against a loopback server through the
 * compiled `probe()`, in the default posture, with no dev flag.
 *
 * The lesson is not "add `::ffff:` to the string checks". It is that an address
 * is a 128-bit number and every textual form of it must be reduced to that
 * number before any judgement is made. So this file PARSES: `parseIPv6` expands
 * `::`, decodes an embedded dotted quad, and yields 16 bytes; every rule is then
 * a test on bytes, and a form nobody thought of cannot slip past a `.includes()`
 * that was never written for it. Anything that will not parse is REFUSED —
 * failing closed, because "we could not tell what this address is" must never
 * mean "call it".
 *
 * The embedded-IPv4 forms are enumerated rather than guessed at: IPv4-mapped
 * (`::ffff:0:0/96`), IPv4-compatible (`::/96`, deprecated but still routable
 * text), NAT64 (`64:ff9b::/96`), 6to4 (`2002::/16`) and Teredo
 * (`2001::/32`) all carry a v4 address in their bytes, and each is decoded and
 * re-checked against the v4 table rather than being judged on its v6 prefix.
 *
 * DNS IS RESOLVED, VETTED, AND THEN PINNED
 * ----------------------------------------
 * `checkEndpoint` resolves the host and requires EVERY address it resolves to
 * to pass — a name with one public A record and one 127.0.0.1 record is refused,
 * not raced. It then returns `pinned`, and `mcp-runtime.service.ts` hands that
 * address to `http.request`'s `lookup` hook so the socket connects to the
 * address that was checked. That closes DNS rebinding (filed as G16 when this
 * guard only resolved-and-refused): there is no second resolution for a hostile
 * resolver to answer differently.
 */

/** Every reason an endpoint can be refused, in the words the row will show. */
export type EndpointRefusal = string;

const PRIVATE_V4: Array<[string, number, string]> = [
  ["0.0.0.0", 8, "the unspecified block"],
  ["10.0.0.0", 8, "a private network"],
  ["100.64.0.0", 10, "carrier-grade NAT space"],
  ["127.0.0.0", 8, "this machine (loopback)"],
  ["169.254.0.0", 16, "link-local space, where cloud instance metadata lives"],
  ["172.16.0.0", 12, "a private network"],
  ["192.0.0.0", 24, "IETF protocol assignments"],
  ["192.0.2.0", 24, "documentation space"],
  ["192.168.0.0", 16, "a private network"],
  ["198.18.0.0", 15, "benchmarking space"],
  ["198.51.100.0", 24, "documentation space"],
  ["203.0.113.0", 24, "documentation space"],
  ["224.0.0.0", 4, "multicast space"],
  ["240.0.0.0", 4, "reserved space"],
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255 || p === "") return null;
    out = out * 256 + n;
  }
  return out >>> 0;
}

function v4BytesReason(b: Uint8Array, offset: number): string | null {
  const dotted = `${b[offset]}.${b[offset + 1]}.${b[offset + 2]}.${b[offset + 3]}`;
  return v4Reason(dotted);
}

function v4Reason(address: string): string | null {
  const value = v4ToInt(address);
  if (value === null) return "it is not a usable address";
  for (const [base, bits, why] of PRIVATE_V4) {
    const baseValue = v4ToInt(base);
    if (baseValue === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) === (baseValue & mask)) return why;
  }
  return null;
}

/**
 * 16 bytes, or null when the text is not an IPv6 address this code understands.
 *
 * Null is a REFUSAL upstream, never a pass. Handles `::` compression, a zone id,
 * and an embedded dotted quad in the last two groups (`::ffff:127.0.0.1`), which
 * is the form `new URL()` will already have rewritten to hex — decoded here too,
 * so the guard behaves the same whether the text reached it through a URL or
 * from a resolver.
 */
export function parseIPv6(input: string): Uint8Array | null {
  let text = input.split("%")[0].trim();
  if (text === "") return null;

  // An embedded dotted quad occupies the final two groups. Rewrite it to hex so
  // the group parser below has one shape to handle.
  const lastColon = text.lastIndexOf(":");
  if (lastColon !== -1 && text.slice(lastColon + 1).includes(".")) {
    const quad = text.slice(lastColon + 1);
    const value = v4ToInt(quad);
    if (value === null || isIP(quad) !== 4) return null;
    const hi = (value >>> 16).toString(16);
    const lo = (value & 0xffff).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const split = (s: string): string[] => (s === "" ? [] : s.split(":"));
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];

  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const g = groups[i];
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes[i * 2] = (n >> 8) & 0xff;
    bytes[i * 2 + 1] = n & 0xff;
  }
  return bytes;
}

function allZero(b: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) if (b[i] !== 0) return false;
  return true;
}

/** The reason this address is off limits, or null when it is fine. */
export function privateAddressReason(address: string): string | null {
  const family = isIP(address);

  if (family === 4) return v4Reason(address);

  if (family === 6) {
    const b = parseIPv6(address);
    // Fail closed. `isIP` said this is an IPv6 address and the parser disagreed,
    // which is a disagreement about what will be connected to — never a pass.
    if (!b) return "it is not an address this gateway can check";

    // ---- forms that carry an IPv4 address in their bytes ------------------
    // Each is DECODED and re-checked against the v4 table, because judging them
    // on their v6 prefix is exactly the bypass that shipped.

    // ::ffff:0:0/96 — IPv4-mapped. `::ffff:127.0.0.1` / `::ffff:7f00:1`.
    if (allZero(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) {
      return v4BytesReason(b, 12) ?? null;
    }
    // ::/96 — IPv4-compatible (deprecated) plus `::` and `::1` themselves.
    if (allZero(b, 0, 12)) {
      if (allZero(b, 12, 16)) return "the unspecified block";
      if (b[12] === 0 && b[13] === 0 && b[14] === 0 && b[15] === 1) {
        return "this machine (loopback)";
      }
      return v4BytesReason(b, 12) ?? "IPv4-compatible space";
    }
    // 64:ff9b::/96 and 64:ff9b:1::/48 — NAT64, a v4 destination in v6 clothing.
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
      return v4BytesReason(b, 12) ?? "NAT64 translation space";
    }
    // 2002::/16 — 6to4 carries the v4 relay address in bytes 2..5.
    if (b[0] === 0x20 && b[1] === 0x02) {
      return v4BytesReason(b, 2) ?? null;
    }
    // 2001:0000::/32 — Teredo. Server v4 at 4..7; client v4 at 12..15, stored
    // inverted. Both are checked; either being private refuses the address.
    if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) {
      const server = v4BytesReason(b, 4);
      if (server) return server;
      const client = new Uint8Array([
        b[12] ^ 0xff,
        b[13] ^ 0xff,
        b[14] ^ 0xff,
        b[15] ^ 0xff,
      ]);
      return v4BytesReason(client, 0) ?? "Teredo tunnelling space";
    }

    // ---- native v6 ranges --------------------------------------------------
    if ((b[0] & 0xfe) === 0xfc) return "unique-local space";
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return "link-local space";
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return "site-local space";
    if (b[0] === 0xff) return "multicast space";
    // 2001:db8::/32 — documentation.
    if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) {
      return "documentation space";
    }
    return null;
  }

  return "it is not a usable address";
}

export interface EndpointCheck {
  ok: boolean;
  /** One sentence naming what was refused and why. Null when ok. */
  reason: string | null;
  /** Every address the host resolved to. Empty when the name did not resolve. */
  addresses: string[];
  /**
   * The address the request must connect to, so the socket cannot be pointed
   * anywhere else by a second DNS answer. Null exactly when `ok` is false.
   */
  pinned: string | null;
  /** The parsed URL, so a caller need not re-parse (and re-normalise) it. */
  url: URL | null;
}

const ALLOW_HINT =
  "Set MCP_ALLOW_PRIVATE_ENDPOINTS=true only on a development machine.";

/**
 * Resolve and vet an endpoint.
 *
 * `allowPrivate` exists for exactly two callers: a developer running an MCP
 * server on `localhost`, and this module's own specs, whose stub binds to
 * 127.0.0.1. It is off unless `MCP_ALLOW_PRIVATE_ENDPOINTS` says otherwise, and
 * the refusal names the variable so an operator can see what would change the
 * answer.
 */
export async function checkEndpoint(
  raw: string,
  allowPrivate: boolean,
): Promise<EndpointCheck> {
  const no = (reason: string, addresses: string[] = []): EndpointCheck => ({
    ok: false,
    reason,
    addresses,
    pinned: null,
    url: null,
  });

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return no("that is not a URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return no(
      `only http and https endpoints are called; this one is ${url.protocol.replace(":", "")}.`,
    );
  }

  // Credentials in the URL would be sent as an Authorization header this module
  // did not build, to a host it is about to pin. Refused rather than stripped,
  // so nothing is silently dropped from what the operator typed.
  if (url.username || url.password) {
    return no(
      "the endpoint carries a username or password in the URL; put the credential in this server's Credential field instead.",
    );
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  // A literal address needs no resolver, and asking one for it would be a way
  // to get a different answer than the one we checked.
  if (isIP(host)) {
    const why = privateAddressReason(host);
    if (why && !allowPrivate) {
      return no(`${host} is in ${why}, which this gateway will not call. ${ALLOW_HINT}`, [
        host,
      ]);
    }
    return { ok: true, reason: null, addresses: [host], pinned: host, url };
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(host, { all: true, verbatim: true });
  } catch (err) {
    return no(
      `${host} did not resolve (${(err as NodeJS.ErrnoException).code ?? (err as Error).message}).`,
    );
  }

  const addresses = resolved.map((r) => r.address);
  if (addresses.length === 0) {
    return no(`${host} resolved to no address.`);
  }

  if (!allowPrivate) {
    for (const address of addresses) {
      const why = privateAddressReason(address);
      if (why) {
        return no(
          `${host} resolves to ${address}, which is in ${why}; this gateway will not call it. ${ALLOW_HINT}`,
          addresses,
        );
      }
    }
  }

  // Pin the FIRST address, which — because the loop above required every one of
  // them to pass — is an address that was actually vetted. The request connects
  // to this and to nothing else.
  return { ok: true, reason: null, addresses, pinned: addresses[0], url };
}
