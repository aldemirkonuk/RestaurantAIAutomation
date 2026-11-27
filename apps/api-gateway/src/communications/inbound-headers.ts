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

const ADDR_SPEC = /^[^\s@<>()",;]+@[^\s@<>()",;]+$/;
const ADDRESS_TOKEN = /[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+/g;

function flatten(list: Parsed[]): Parsed[] {
  const out: Parsed[] = [];
  for (const p of list) {
    if (Array.isArray(p.group)) out.push(...flatten(p.group));
    else out.push(p);
  }
  return out;
}

/** The header with quoted strings and (comments) removed — only syntax left. */
function syntaxOnly(value: string): string {
  let out = "";
  let quoted = false;
  let depth = 0;
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
    if (ch === "(") depth += 1;
    else if (ch === ")" && depth > 0) depth -= 1;
    else if (depth === 0) {
      if (ch === '"') quoted = true;
      else out += ch;
    }
  }
  return out;
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
 * Null — attribute to nobody — when the header holds no valid address, more
 * than one distinct mailbox, or more angle-addrs outside quotes and comments
 * than the parser found mailboxes: `Sales <sales@bigdist.com>
 * <attacker@evil.example>` is not valid syntax, and which of its two
 * addresses a mail client shows is anyone's guess, so neither is believed.
 */
export function parseSender(header: string | null | undefined): Mailbox | null {
  const value = (header ?? "").toString().trim();
  if (!value) return null;
  const parsed = parse(value);
  const angles = (syntaxOnly(value).match(/</g) ?? []).length;
  if (angles > parsed.length) return null;
  const list = parseAddressList(value);
  return list.length === 1 ? list[0] : null;
}

/** The sender's addr-spec, lower-cased, or null — see `parseSender`. */
export function senderAddress(
  header: string | null | undefined,
): string | null {
  return parseSender(header)?.address ?? null;
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
