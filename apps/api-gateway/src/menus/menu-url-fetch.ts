import { promises as dns } from "node:dns";
import * as https from "node:https";
import { isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";

/**
 * Reading a menu from a web link (r108 menu-g11): the gateway fetches the
 * link itself. The session's call. Rejected: a client fetch (CORS blocks it on
 * most menu sites) and a headless browser (RAM, and a much larger attack
 * surface on a public gateway).
 *
 * A server that fetches a URL a person typed is a server-side request forgery
 * surface, so the fetch is fenced:
 *   - https only, port 443 only, no user:password in the link;
 *   - the host is resolved ONCE and every address it resolves to must be
 *     public: private, loopback, link-local, CGNAT, multicast, reserved,
 *     documentation and cloud-metadata ranges are refused, v4 and v6 (a
 *     v4-mapped or NAT64 v6 address is judged by the v4 inside it);
 *   - the connection goes to that resolved address (the TLS name stays the
 *     host, so the certificate is still checked), so a second DNS answer
 *     cannot swap a private address in after the check (DNS rebinding);
 *   - at most 3 redirects, each one re-checked from the top;
 *   - 15 s for the whole fetch, 5 MB at most, refused as soon as either is
 *     passed (a Content-Length over the cap is refused before a byte is read);
 *   - text/html, application/pdf or image/* only.
 * Every refusal is a sentence the person can read; nothing here names an
 * internal address back to them.
 */

export const URL_FETCH_TIMEOUT_MS = 15_000;
export const URL_FETCH_MAX_BYTES = 5 * 1024 * 1024;
export const URL_FETCH_MAX_REDIRECTS = 3;

export class MenuLinkRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MenuLinkRefused";
  }
}

export type MenuLinkKind = "html" | "pdf" | "image";

export interface FetchedMenuLink {
  /** The bytes as fetched: the kept source. */
  bytes: Buffer;
  kind: MenuLinkKind;
  /** The content type without its parameters, e.g. "text/html". */
  contentType: string;
  /** The link the bytes came from, after any redirects. */
  finalUrl: string;
  /** The host that was read, said back to the person. */
  host: string;
}

/** One hop of the transport: a GET to `url`, connected to `address`. */
export interface LinkResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Buffer>;
  /** Stops the transfer (called on a refusal mid-body). */
  abort: () => void;
}
export type LinkTransport = (url: URL, address: { address: string; family: 4 | 6 }, signal: AbortSignal) => Promise<LinkResponse>;
export type LinkLookup = (host: string) => Promise<Array<{ address: string; family: number }>>;

// ── Address ranges ──────────────────────────────────────────────────────────

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

/** [base, prefix] ranges that are never a public web server. */
const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255
];

function v4Blocked(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** The eight 16-bit groups of a v6 address (with any dotted v4 tail folded in). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4ToInt(dotted[1]);
    s = s.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  if (s.split("::").length > 2) return null;
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const fill = tail !== undefined ? 8 - h.length - t.length : 0;
  if (fill < 0) return null;
  const all = [...h, ...Array(fill).fill("0"), ...t];
  if (all.length !== 8) return null;
  const groups = all.map((g) => parseInt(g, 16));
  return groups.some((g) => !Number.isFinite(g) || g < 0 || g > 0xffff) ? null : groups;
}

function v6Blocked(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return true; // unparseable: never connect
  const zeroTo = (i: number) => g.slice(0, i).every((x) => x === 0);
  if (zeroTo(8)) return true; // ::
  if (zeroTo(7) && g[7] === 1) return true; // ::1 loopback
  const embedded = (a: number, b: number) => `${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`;
  if (zeroTo(5) && g[5] === 0xffff) return v4Blocked(embedded(g[6], g[7])); // ::ffff:a.b.c.d
  if (zeroTo(6)) return true; // deprecated v4-compatible ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Blocked(embedded(g[6], g[7])); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local, incl. fd00:ec2::254 metadata
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard prefix
  if (g[0] === 0x2002) return v4Blocked(embedded(g[1], g[2])); // 6to4 wraps a v4
  return false;
}

/** True when `ip` is an address a public web server can have. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return !v4Blocked(ip);
  if (v === 6) return !v6Blocked(ip);
  return false;
}

// ── The fetch ───────────────────────────────────────────────────────────────

const REFUSE_SCHEME = "Only an https:// link can be read. Copy the menu page's address as it shows in the browser.";
const REFUSE_PORT = "That link names a port other than the standard one, so it was not read.";
const REFUSE_CREDENTIALS = "That link carries a user name or password, so it was not read.";
const REFUSE_PRIVATE = "That link points inside a private network, so it was not read. Use the menu's public web address.";
const REFUSE_UNRESOLVED = "That web address could not be found. Check the link and try again.";

/** The link, checked before any address is looked up. */
export function checkLinkShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    throw new MenuLinkRefused("That is not a web link. Paste the menu page's address, starting with https://.");
  }
  if (url.protocol !== "https:") throw new MenuLinkRefused(REFUSE_SCHEME);
  if (url.port !== "" && url.port !== "443") throw new MenuLinkRefused(REFUSE_PORT);
  if (url.username || url.password) throw new MenuLinkRefused(REFUSE_CREDENTIALS);
  if (!url.hostname) throw new MenuLinkRefused(REFUSE_UNRESOLVED);
  return url;
}

/** The one address this hop connects to: every address the host has must be public. */
export async function resolvePublic(url: URL, lookup: LinkLookup): Promise<{ address: string; family: 4 | 6 }> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new MenuLinkRefused(REFUSE_PRIVATE);
    return { address: host, family: isIP(host) as 4 | 6 };
  }
  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await lookup(host);
  } catch {
    throw new MenuLinkRefused(REFUSE_UNRESOLVED);
  }
  if (!answers || answers.length === 0) throw new MenuLinkRefused(REFUSE_UNRESOLVED);
  if (answers.some((a) => !isPublicAddress(a.address))) throw new MenuLinkRefused(REFUSE_PRIVATE);
  const first = answers[0];
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

function kindOf(contentType: string): MenuLinkKind | null {
  if (contentType === "text/html" || contentType === "application/xhtml+xml") return "html";
  if (contentType === "application/pdf") return "pdf";
  if (/^image\/[a-z0-9.+-]+$/.test(contentType)) return "image";
  return null;
}

const defaultLookup: LinkLookup = (host) => dns.lookup(host, { all: true, verbatim: true });

/** The real transport: a GET connected to the checked address, the TLS name still the host. */
const defaultTransport: LinkTransport = (url, addr, signal) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: isIP(url.hostname) ? undefined : url.hostname,
        headers: { "user-agent": "MenuReader/1.0", accept: "text/html,application/pdf,image/*;q=0.9" },
        // The connection goes to the address that was checked, never to a
        // second DNS answer.
        // (Node asks for every address when it races families: `all`.)
        lookup: (_h: string, o: { all?: boolean } | undefined, cb: (...a: unknown[]) => void) =>
          o && o.all ? cb(null, [{ address: addr.address, family: addr.family }]) : cb(null, addr.address, addr.family),
        signal,
      } as https.RequestOptions,
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res, abort: () => res.destroy() }),
    );
    req.on("error", reject);
    req.end();
  });

/**
 * Fetches a menu link through the fence. Throws MenuLinkRefused, in words,
 * for anything the fence does not let through.
 */
export async function fetchMenuLink(
  raw: string,
  deps: { lookup?: LinkLookup; transport?: LinkTransport; timeoutMs?: number; maxBytes?: number } = {},
): Promise<FetchedMenuLink> {
  const lookup = deps.lookup ?? defaultLookup;
  const transport = deps.transport ?? defaultTransport;
  const maxBytes = deps.maxBytes ?? URL_FETCH_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? URL_FETCH_TIMEOUT_MS);
  const tooSlow = () => new MenuLinkRefused("That page took longer than 15 seconds to answer, so it was not read.");
  const tooBig = new MenuLinkRefused("That file is larger than 5 MB, so it was not read. Save the menu as a smaller PDF or a photo and upload it.");
  try {
    let url = checkLinkShape(raw);
    for (let hop = 0; ; hop++) {
      const address = await resolvePublic(url, lookup);
      let res: LinkResponse;
      try {
        res = await transport(url, address, controller.signal);
      } catch (e) {
        if (controller.signal.aborted) throw tooSlow();
        throw new MenuLinkRefused("That page could not be reached just now. Check the link and try again.");
      }
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        res.abort();
        if (hop >= URL_FETCH_MAX_REDIRECTS) {
          throw new MenuLinkRefused("That link sent the reader on through more than 3 other addresses, so it was not read.");
        }
        let next: URL;
        try {
          next = new URL(String(res.headers.location), url);
        } catch {
          throw new MenuLinkRefused("That link sent the reader to an address that is not a web link.");
        }
        // Every hop is checked from the top: scheme, port, credentials, address.
        url = checkLinkShape(next.toString());
        continue;
      }
      if (res.status !== 200) {
        res.abort();
        throw new MenuLinkRefused(`That page answered ${res.status}, not the menu, so nothing was read.`);
      }
      const contentType = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      const kind = kindOf(contentType);
      if (!kind) {
        res.abort();
        throw new MenuLinkRefused(
          `That link is ${contentType || "a file of no stated kind"}, not a web page, a PDF or a photo, so it was not read.`,
        );
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.abort();
        throw tooBig;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of res.body) {
          size += chunk.length;
          if (size > maxBytes) {
            res.abort();
            throw tooBig;
          }
          chunks.push(chunk);
        }
      } catch (e) {
        if (e === tooBig) throw e;
        if (controller.signal.aborted) throw tooSlow();
        throw new MenuLinkRefused("That page stopped sending part way, so nothing was read.");
      }
      return { bytes: Buffer.concat(chunks), kind, contentType, finalUrl: url.toString(), host: url.hostname };
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── HTML to visible text ────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * The visible text of a menu page: script, style, nav, header, footer,
 * noscript, svg, template, iframe and the head are dropped with what they
 * hold; block elements end a line; tags go; entities are decoded; blank lines
 * fold. What is left is what a guest reads on the page.
 */
export function htmlToMenuText(html: string): string {
  let s = String(html ?? "");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|nav|noscript|svg|template|iframe|head|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<(script|style|nav|noscript|svg|template|iframe|head|header|footer)\b[^>]*\/?>/gi, " ");
  s = s.replace(/<(br|hr)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/?(p|div|li|ul|ol|tr|table|section|article|h[1-6]|dt|dd|dl|figcaption|caption|main|aside|blockquote|pre)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/?(td|th)\b[^>]*>/gi, " \t ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}
