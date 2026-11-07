import addressparser from "nodemailer/lib/addressparser";

/**
 * Inbound mail headers — the ONE place the gateway reads an address or a
 * human-readable string out of a received message's From / To / Cc / Subject.
 *
 * Why one module (QA round 6, N-1 / M-10 / N-2, 2026-11-07):
 *
 * - N-1. Four call sites each took "the first `<...>` in the header" as the
 *   sender: the bridge's provider match, the house inbox's admissibility gate
 *   (`gmail-mime.ts addressInFromHeader`), the transport-signal reader
 *   (`email-triage.ts extractEmailAddress`) and the inbound-address lookup.
 *   `From: "Sales <sales@bigdist.com>" <attacker@evil.example>` is legal
 *   RFC 5322 — the quoted part is a display name — and the first `<...>` in it
 *   is the vendor's address, so the attacker's mail was stored against the
 *   vendor's open negotiation and handed to the responder as the vendor's
 *   words. DMARC/DKIM cannot catch this: the message is honestly from
 *   evil.example and authenticates as such.
 * - M-10. `a@x.com, b@y.com` came back as one string (or `a@x.com,`), so a
 *   house's inbound address listed second in To was never looked up.
 * - N-2. RFC 2047 encoded words (`=?UTF-8?B?…?=`, Q, windows-1254) were stored
 *   and shown verbatim.
 *
 * THE RULE (recorded as the fix lane's call, 2026-11-07): a message is
 * attributed by the addr-spec a real RFC 5322 parser returns for its From
 * mailbox, and by nothing else. A display name — quoted, encoded or a comment —
 * never attributes, never labels a vendor when it carries an address other
 * than the real one, and a From that does not resolve to exactly one
 * unambiguous mailbox attributes to nobody.
 *
 * Parsing is nodemailer's `addressparser` (already a gateway dependency for
 * sending). Decoding happens AFTER parsing, never before: a display name whose
 * encoded word decodes to `<sales@bigdist.com>` must stay a name.
 */

export interface Mailbox {
  /** Display name with RFC 2047 words decoded; "" when the header had none. */
  name: string;
  /** The addr-spec, trimmed and lower-cased. */
  address: string;
}

type Parsed = { name?: string; address?: string; group?: Parsed[] };

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

/** Bytes of one encoded word's payload, or null when it is not decodable. */
function wordBytes(encoding: string, text: string): Buffer | null {
  if (encoding.toUpperCase() === "B") {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
    return Buffer.from(text, "base64");
  }
  // Q: "_" is a space, "=XX" is a byte, anything else is itself (RFC 2047 §4.2).
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "_") bytes.push(0x20);
    else if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(ch.charCodeAt(0) & 0xff);
  }
  return Buffer.from(bytes);
}

function decodeBytes(charset: string, bytes: Buffer): string | null {
  try {
    // WHATWG labels: utf-8, iso-8859-9 / windows-1254 (Turkish), latin1, ...
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return null; // unknown charset — the caller keeps the raw words
  }
}

/**
 * Decode RFC 2047 encoded words in an unstructured header value (Subject, or a
 * display name already separated from its address). Whitespace between two
 * adjacent encoded words is dropped (§6.2), and adjacent words in the same
 * charset are joined at the byte level so a character split across two words
 * by a sloppy mailer still decodes. A word in an unknown charset, or with a
 * malformed payload, is left exactly as received.
 */
export function decodeEncodedWords(value: string | null | undefined): string {
  const s = value ?? "";
  if (!s.includes("=?")) return s;

  type Tok = { raw: string; charset?: string; bytes?: Buffer | null };
  const toks: Tok[] = [];
  let last = 0;
  for (const m of s.matchAll(ENCODED_WORD)) {
    const at = m.index ?? 0;
    if (at > last) toks.push({ raw: s.slice(last, at) });
    const charset = m[1].split("*")[0].toLowerCase(); // drop an RFC 2231 *lang
    toks.push({ raw: m[0], charset, bytes: wordBytes(m[2], m[3]) });
    last = at + m[0].length;
  }
  if (last < s.length) toks.push({ raw: s.slice(last) });

  let out = "";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.charset) {
      const between =
        /^[ \t\r\n]+$/.test(t.raw) &&
        toks[i - 1]?.charset !== undefined &&
        toks[i + 1]?.charset !== undefined;
      if (!between) out += t.raw;
      continue;
    }
    // Gather this word and every following same-charset word separated only
    // by whitespace into one byte run.
    const run: Tok[] = [t];
    let rawRun = t.raw;
    let j = i;
    while (
      toks[j + 1] &&
      !toks[j + 1].charset &&
      /^[ \t\r\n]+$/.test(toks[j + 1].raw) &&
      toks[j + 2]?.charset === t.charset
    ) {
      run.push(toks[j + 2]);
      rawRun += toks[j + 1].raw + toks[j + 2].raw;
      j += 2;
    }
    const decoded = run.every((w) => w.bytes)
      ? decodeBytes(t.charset, Buffer.concat(run.map((w) => w.bytes!)))
      : null;
    out += decoded ?? rawRun;
    i = j;
  }
  return out;
}

// `%` and `*` are refused in the domain (QA round 24): no mail host is named
// with them, and they are the LIKE / PostgREST wildcards a forged `%@%` uses.
const ADDR_SPEC = /^[^\s@<>()",;]+@[^\s@<>()",;%*]+$/;
const ADDRESS_TOKEN = /[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+/g;

function flatten(list: Parsed[]): Parsed[] {
  const out: Parsed[] = [];
  for (const p of list) {
    if (Array.isArray(p.group)) out.push(...flatten(p.group));
    else out.push(p);
  }
  return out;
}

/**
 * The header with quoted strings reduced to `"` and (comments) to a space —
 * only syntax left —
 * and whether it is simple enough to believe: every quote and comment closed,
 * and no comment nested in another (`addressparser` does not nest them, so a
 * nested comment is a shape the two readings of the header disagree on).
 */
function scan(value: string): { syntax: string; simple: boolean } {
  let out = "";
  let quoted = false;
  let depth = 0;
  let nested = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && (quoted || depth > 0)) {
      i += 1;
      continue;
    }
    if (quoted) {
      if (ch === '"') quoted = false;
      continue;
    }
    if (ch === "(") {
      // A comment reads as one space, so it cannot glue two tokens together.
      if (depth === 0) out += " ";
      depth += 1;
      if (depth > 1) nested = true;
    } else if (ch === ")" && depth > 0) depth -= 1;
    else if (depth === 0) {
      // A quoted string leaves one `"` behind: its text is hidden, but an
      // addr-spec next to it (`"a b"x@y.com`, `<"x"@y.com>`) no longer looks
      // like a clean address.
      if (ch === '"') quoted = true;
      out += ch;
    }
  }
  return { syntax: out, simple: !quoted && depth === 0 && !nested };
}

/** RFC 5322 folding: CRLF (or a bare LF) followed by white space. */
const FOLD = /\r?\n(?=[ \t])/g;
/** Any C0 control except TAB, and DEL — left after unfolding, it is injection. */
const CONTROL = /[\u0000-\u0008\u000A-\u001F\u007F]/;

/**
 * The address a header's syntax (quotes and comments removed) holds when it
 * has the shape of exactly one mailbox — `addr-spec` alone, or
 * `[display-name] <addr-spec>` with nothing after the `>` and no `@` in the
 * name — lower-cased; otherwise null. QA round 22 (N-1 tail):
 * each of these used to resolve to the address an attacker chose to show —
 *
 *   `<sales@bigdist.com> attacker@evil.example`   angle, then a bare address
 *   `undisclosed: sales@bigdist.com;`              group syntax (also `:` of
 *                                                  a source route or an
 *                                                  injected header name)
 *   `a@x.com, b@y.com` / `a@x.com,`                a list, or a broken one
 */
function singleMailboxShape(syntax: string): string | null {
  if (/[:;,]/.test(syntax)) return null;
  const lt = syntax.split("<").length - 1;
  const gt = syntax.split(">").length - 1;
  let address: string;
  if (lt === 0 && gt === 0) address = syntax.trim();
  else {
    if (lt !== 1 || gt !== 1) return null;
    const open = syntax.indexOf("<");
    const close = syntax.indexOf(">");
    if (close < open || syntax.slice(0, open).includes("@")) return null;
    if (syntax.slice(close + 1).trim() !== "") return null;
    address = syntax.slice(open + 1, close).trim();
  }
  return ADDR_SPEC.test(address) ? address.toLowerCase() : null;
}

function parse(value: string): Parsed[] {
  try {
    const raw = addressparser(value, { flatten: true }) as unknown as Parsed[];
    return flatten(Array.isArray(raw) ? raw : []);
  } catch {
    return [];
  }
}

/**
 * Every mailbox in an address-list header (From / To / Cc / Delivered-To),
 * groups flattened, in header order, de-duplicated by address. Entries with
 * no valid addr-spec are dropped.
 */
export function parseAddressList(header: string | null | undefined): Mailbox[] {
  const value = (header ?? "").toString().trim();
  if (!value) return [];
  const seen = new Set<string>();
  const out: Mailbox[] = [];
  for (const p of parse(value)) {
    const address = (p.address ?? "").trim().toLowerCase();
    if (!ADDR_SPEC.test(address) || seen.has(address)) continue;
    seen.add(address);
    out.push({ name: decodeEncodedWords((p.name ?? "").trim()), address });
  }
  return out;
}

/** Every address in an address-list header — see `parseAddressList`. */
export function addressesIn(header: string | null | undefined): string[] {
  return parseAddressList(header).map((m) => m.address);
}

/**
 * The single mailbox a From (or Return-Path / Sender) header names, or null.
 *
 * WHAT THIS TRUSTS (QA round 22, N-1, 2026-11-07). Attribution believes the
 * syntax of the From header and nothing else; it does not consult SPF, DKIM,
 * DMARC or ARC. The bridge does, after this (QA round 24): when the receiving
 * server's own verdict says the letter did not come from the From's domain,
 * the letter is held, not filed as the vendor's (`sender-authentication.ts`,
 * `rabbitmq-bridge.service.ts holdLetter`). A vendor that publishes no SPF,
 * DKIM or DMARC can still be imitated. Other consumers of an
 * authentication result are the responder's `sender_unverified` guardrail (a
 * reply is held for a manager) and the promotion extractor's trust weight. What this function does
 * guarantee is narrower: an address shown in a display name, a comment, a
 * group, a second angle, a trailing bare address or an injected line never
 * becomes the sender.
 *
 * Null — attribute to nobody — when the header, after RFC 5322 unfolding,
 * still holds a control character (CR, LF, NUL ...), has an unclosed quote or
 * comment or a nested comment, is not shaped like exactly one mailbox
 * (`singleMailboxShape`), the parser's address differs from the one that
 * shape holds, holds no valid address, more than one distinct mailbox, or more
 * angle-addrs outside quotes and comments than the parser found mailboxes:
 * `Sales <sales@bigdist.com> <attacker@evil.example>` is not valid syntax,
 * and which of its two addresses a mail client shows is anyone's guess, so
 * neither is believed.
 */
export function parseSender(header: string | null | undefined): Mailbox | null {
  const value = (header ?? "").toString().replace(FOLD, "").trim();
  if (!value || CONTROL.test(value)) return null;
  const { syntax, simple } = scan(value);
  const shaped = simple ? singleMailboxShape(syntax) : null;
  if (!shaped) return null;
  const parsed = parse(value);
  const angles = (syntax.match(/</g) ?? []).length;
  if (angles > parsed.length) return null;
  const list = parseAddressList(value);
  // Two independent readings of the header must name the same address.
  return list.length === 1 && list[0].address === shaped ? list[0] : null;
}

/** The sender's addr-spec, lower-cased, or null — see `parseSender`. */
export function senderAddress(
  header: string | null | undefined,
): string | null {
  return parseSender(header)?.address ?? null;
}

const BARE_DOMAIN = /^[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/**
 * A sender address as a PostgREST `ilike` value that matches that address
 * and nothing else (QA round 24: a From of `%@%` was read as a pattern and
 * filed against another house's vendor). `\\`, `%`, `_` and `*` are escaped.
 *
 * `*` is not quite exact (QA round 25, measured on PostgREST v14 + Postgres
 * 15): PostgREST rewrites every `*` in an ilike value to `%` before Postgres
 * sees it, escaped or not, so `\\*` arrives as `\\%`, a literal percent sign.
 * An address with a `*` in its local part therefore matches a stored `%` in
 * the same place and misses a stored `*`. It never becomes a wildcard: the
 * worst case is one wrong vendor of the same house whose address differs
 * only by `*` versus `%`, and a lookup scoped to one house cannot cross to
 * another. (This comment used to promise an escaped `*` could only miss.)
 *
 * Why ilike and not `eq`: `providers.contact_email` keeps the case a manager
 * typed and is unique on `lower(contact_email)`, so `eq` on the folded
 * address would stop matching a vendor stored as `Sales@BigDist.com`.
 */
export function likeExactly(address: string): string {
  return address.replace(/[\\%_*]/g, (c) => `\\${c}`);
}

/**
 * The domain a sender belongs to, or "". A header or an address goes through
 * `parseSender` (so `"x <a@trusted.com>" <b@evil.example>` is evil.example,
 * never trusted.com); a bare domain such as `bigdist.com` — what a manager
 * types to trust a sender — is returned as given. Used by the prospect and
 * sender-reputation readers, which used to take the first `<...>`.
 */
export function senderDomain(emailOrDomain: string | null | undefined): string {
  const s = (emailOrDomain ?? "").toString().trim().toLowerCase();
  if (!s) return "";
  if (!s.includes("@") && !s.includes("<")) {
    return BARE_DOMAIN.test(s) ? s : "";
  }
  const address = senderAddress(s);
  return address ? address.slice(address.lastIndexOf("@") + 1) : "";
}

/**
 * A display name safe to show as the sender's label, or null.
 *
 * Null when the name is empty or carries any address other than the mailbox's
 * own: `"sales@bigdist.com" <sales@bigdist.com.evil.example>` must not put
 * the vendor's address on a prospect notice.
 */
export function displayLabel(
  mailbox: Mailbox | null | undefined,
): string | null {
  const name = (mailbox?.name ?? "").trim();
  if (!name) return null;
  const tokens = name.toLowerCase().match(ADDRESS_TOKEN) ?? [];
  if (tokens.some((t) => t !== mailbox!.address)) return null;
  return name;
}
