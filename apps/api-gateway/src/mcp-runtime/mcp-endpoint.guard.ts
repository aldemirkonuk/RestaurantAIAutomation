import { lookup } from "dns/promises";
import { isIP } from "net";

/**
 * Where a probe is allowed to go.
 *
 * WHY THIS FILE EXISTS AT ALL
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
 * So the address is resolved and checked before the request is made, and every
 * address the name resolves to must pass — a name with one public A record and
 * one 127.0.0.1 record is refused, not raced.
 *
 * WHAT THIS DOES NOT CLOSE, STATED RATHER THAN IMPLIED
 * ---------------------------------------------------
 * DNS rebinding. The check resolves the name, then `fetch` resolves it again,
 * and a hostile resolver can answer differently the second time. Closing that
 * needs the connection pinned to the address that passed (a custom agent /
 * `lookup` hook), which this build does not do. The residual is recorded in
 * ADR 0106 and in `profile.md` §9 as G13 rather than left for a reader to
 * discover. What IS closed is the whole class of "someone typed a metadata URL
 * into the form", which is the reachable one.
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
  ["192.168.0.0", 16, "a private network"],
  ["198.18.0.0", 15, "benchmarking space"],
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

/** The reason this address is off limits, or null when it is fine. */
export function privateAddressReason(address: string): string | null {
  const family = isIP(address);

  if (family === 4) {
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

  if (family === 6) {
    const ip = address.toLowerCase().split("%")[0];
    if (ip === "::" ) return "the unspecified block";
    if (ip === "::1") return "this machine (loopback)";
    // IPv4-mapped and IPv4-compatible forms carry a v4 address in the tail, and
    // checking only the v6 prefixes would let ::ffff:127.0.0.1 straight through.
    const tail = ip.includes(".") ? ip.slice(ip.lastIndexOf(":") + 1) : null;
    if (tail && isIP(tail) === 4) return privateAddressReason(tail);
    const head = parseInt(ip.split(":")[0] || "0", 16);
    if ((head & 0xfe00) === 0xfc00) return "unique-local space";
    if ((head & 0xffc0) === 0xfe80) return "link-local space";
    if ((head & 0xff00) === 0xff00) return "multicast space";
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
}

/**
 * Resolve and vet an endpoint.
 *
 * `allowPrivate` exists for exactly two callers: a developer running an MCP
 * server on `localhost`, and this module's own specs, whose stub binds to
 * 127.0.0.1. It is off unless `MCP_ALLOW_PRIVATE_ENDPOINTS` says otherwise, and
 * the service names the variable in the refusal so an operator can see what
 * would change the answer.
 */
export async function checkEndpoint(
  raw: string,
  allowPrivate: boolean,
): Promise<EndpointCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "that is not a URL.", addresses: [] };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: `only http and https endpoints are called; this one is ${url.protocol.replace(":", "")}.`,
      addresses: [],
    };
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  // A literal address needs no resolver, and asking one for it would be a way
  // to get a different answer than the one we checked.
  if (isIP(host)) {
    const why = privateAddressReason(host);
    if (why && !allowPrivate) {
      return {
        ok: false,
        reason: `${host} is in ${why}, which this gateway will not call. Set MCP_ALLOW_PRIVATE_ENDPOINTS=true only on a development machine.`,
        addresses: [host],
      };
    }
    return { ok: true, reason: null, addresses: [host] };
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(host, { all: true, verbatim: true });
  } catch (err) {
    return {
      ok: false,
      reason: `${host} did not resolve (${(err as NodeJS.ErrnoException).code ?? (err as Error).message}).`,
      addresses: [],
    };
  }

  const addresses = resolved.map((r) => r.address);
  if (addresses.length === 0) {
    return { ok: false, reason: `${host} resolved to no address.`, addresses };
  }

  if (!allowPrivate) {
    for (const address of addresses) {
      const why = privateAddressReason(address);
      if (why) {
        return {
          ok: false,
          reason: `${host} resolves to ${address}, which is in ${why}; this gateway will not call it. Set MCP_ALLOW_PRIVATE_ENDPOINTS=true only on a development machine.`,
          addresses,
        };
      }
    }
  }

  return { ok: true, reason: null, addresses };
}
