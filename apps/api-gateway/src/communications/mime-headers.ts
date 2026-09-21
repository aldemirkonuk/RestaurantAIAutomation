/**
 * Writing outbound MIME headers and bodies — the one implementation, shared.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Two places build a raw RFC 5322 message by hand for the Gmail API `raw`
 * field: `GmailService.createMimeMessage` and `sendThroughGrant`
 * (letters/house-letters.service.ts). Both interpolated every header value
 * raw, so:
 *
 *  - a subject such as "₺12,300 to Trakya Direct is due Monday — Meyhouse" or
 *    "Şarap siparişi · İstanbul" went out as bare UTF-8 bytes in a header,
 *    which RFC 5322 does not allow and which receivers render as mojibake;
 *  - a subject is attacker-influenced — the reply subject is built from the
 *    inbound vendor subject (inbound-responder.service.ts `normalizeReplySubject`,
 *    which only `.trim()`s), so "x\r\nBcc: someone@else" became a real header;
 *  - the text/html parts declared charset UTF-8 but no
 *    Content-Transfer-Encoding, i.e. 8-bit data under the 7bit default.
 *
 * THE RULES THIS MODULE ENFORCES
 * ------------------------------
 *  - Free text (Subject, display names): CR, LF and every other C0 control and
 *    DEL collapse to one space. A subject cannot carry a line break, and
 *    refusing would let a vendor block replies to their own thread by putting
 *    one in theirs. This matches what nodemailer does on the SMTP fallback.
 *  - Addresses and our own Message-ID: a control character is REFUSED
 *    (throws). An address with a line break inside it is corrupt, and silently
 *    repairing it sends mail somewhere nobody chose. Whitespace AROUND an
 *    address (a contact saved with a trailing "\n" or "\t") is trimmed first,
 *    so only an interior control character refuses the send. An address-list
 *    entry holding two named mailboxes ("A <a@x>, B <b@x>") is refused rather
 *    than written with the first address demoted to display text.
 *  - The vendor's threading values (In-Reply-To, References) are REBUILT, not
 *    refused: only their `<msg-id>` tokens survive (see `threadingHeader`).
 *    Like the Subject, they come from the vendor's own mail, and RFC 5322
 *    folding (CRLF + TAB) is legal there — refusing would stop the house
 *    replying on that thread forever.
 *  - Free text that is not plain printable ASCII — or that contains "=?", which
 *    a reader would otherwise decode as an encoded-word — is written as RFC 2047
 *    `=?UTF-8?B?…?=` encoded-words, each at most 75 characters, each holding
 *    only whole UTF-8 characters (so every word decodes on its own), and every
 *    header line at most 76 characters (RFC 2047 §2).
 *  - Bodies are base64 (RFC 2045 §6.8) in lines of at most 76 characters. The
 *    base64 alphabet has no "_", so a `mudavym_alt_…` delimiter (128 random
 *    bits, gmail.service.ts createMimeMessage) can never occur inside a body
 *    part.
 */

/**
 * RFC 2047 §2: a header line containing an encoded-word is at most 76
 * characters. This one limit also enforces the other §2 limit — an
 * encoded-word is at most 75 — because a folded line is one space followed by
 * the word. (A separate 75 cap was dead code: mutating it changed nothing.)
 */
const MAX_LINE = 76;
/** RFC 5322 §2.1.1 hard line limit, CRLF excluded. */
const HARD_LINE_LIMIT = 998;
const WORD_PREFIX = "=?UTF-8?B?";
const WORD_SUFFIX = "?=";
const WORD_OVERHEAD = WORD_PREFIX.length + WORD_SUFFIX.length;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_G = /[\x00-\x1f\x7f]+/g;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
/** RFC 5322 atext — a display name made only of these (and single spaces) needs no quoting. */
const ATOM_PHRASE =
  /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?: [A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/;

export class MimeHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MimeHeaderError";
  }
}

/** Collapse CR, LF and every other control character in free text to one space. */
export function sanitizeHeaderText(value: string): string {
  return String(value ?? "").replace(CONTROL_CHARS_G, " ");
}

/** Refuse a structured value (address, message id) that carries a control character. */
export function assertNoControlChars(
  headerName: string,
  value: string,
): string {
  const v = String(value ?? "");
  if (CONTROL_CHARS.test(v)) {
    throw new MimeHeaderError(
      `Refusing to write the ${headerName} header: its value contains a line break or control character.`,
    );
  }
  return v;
}

function needsEncoding(text: string): boolean {
  return !PRINTABLE_ASCII.test(text) || text.includes("=?");
}

type Piece =
  /** Written verbatim; never split. Must be printable ASCII. */
  | { kind: "atom"; text: string }
  /** Written as RFC 2047 encoded-words sized to the space left on each line. */
  | { kind: "encoded"; text: string };

/**
 * Lay pieces out after `Name:`, one space between pieces, folding with CRLF +
 * space so that no line passes 76 characters where that can be helped. An
 * atom longer than a line is still written whole (it cannot be split).
 */
function renderHeader(name: string, pieces: Piece[]): string {
  const lines: string[] = [];
  let current = `${name}:`;

  const newLine = () => {
    lines.push(current);
    current = "";
  };

  for (const piece of pieces) {
    if (piece.kind === "atom") {
      if (
        current.length > 0 &&
        current.length + 1 + piece.text.length > MAX_LINE &&
        current !== `${name}:`
      ) {
        newLine();
      }
      current += ` ${piece.text}`;
      continue;
    }

    const chars = Array.from(piece.text); // code points: surrogate pairs stay whole
    let i = 0;
    while (i < chars.length) {
      // Room for " =?UTF-8?B?" + base64 + "?=" on what is left of this line.
      const room = MAX_LINE - current.length - 1 - WORD_OVERHEAD;
      const maxBytes = Math.floor(Math.max(room, 0) / 4) * 3;
      let bytes = 0;
      let j = i;
      while (j < chars.length) {
        const n = Buffer.byteLength(chars[j], "utf8");
        if (bytes + n > maxBytes) break;
        bytes += n;
        j++;
      }
      if (j === i) {
        // Not even one character fits on this line; start a fresh one.
        if (current.length === 0) {
          // Unreachable: an empty line always has room for a 4-byte character.
          throw new MimeHeaderError(`Could not fold the ${name} header.`);
        }
        newLine();
        continue;
      }
      const word =
        WORD_PREFIX +
        Buffer.from(chars.slice(i, j).join(""), "utf8").toString("base64") +
        WORD_SUFFIX;
      current += ` ${word}`;
      i = j;
      if (i < chars.length) newLine();
    }
  }

  lines.push(current);
  return lines.join("\r\n");
}

/**
 * An unstructured header (Subject). Plain printable ASCII stays readable and
 * unfolded; anything else becomes RFC 2047 encoded-words.
 */
export function unstructuredHeader(name: string, value: string): string {
  const text = sanitizeHeaderText(value);
  if (
    !needsEncoding(text) &&
    name.length + 2 + text.length <= HARD_LINE_LIMIT
  ) {
    return `${name}: ${text}`;
  }
  if (text.length === 0) return `${name}: `;
  return renderHeader(name, [{ kind: "encoded", text }]);
}

/** Index of the closing quote of the quoted-string opening at 0, or -1. */
function quotedStringEnd(text: string): number {
  for (let i = 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i;
  }
  return -1;
}

/**
 * Split `Name <addr>` or a bare `addr` into its parts. No regex: linear by
 * construction.
 *
 * A NAMED entry (`... <addr>`) must hold exactly one mailbox. Splitting at the
 * last `<` would otherwise demote every earlier mailbox to display text and
 * silently drop it as a recipient, so these are REFUSED, never collapsed:
 *  - a quoted name that is not one quoted-string (`"A" <a@x>, "B" <b@x>`);
 *  - an unquoted name holding `<`, `>`, `@` or `,` (`A <a@x>, B <b@x>`,
 *    `a@x, B <b@x>`).
 * A bare entry with no `<...>` (`a@x, b@y`) is written as it is, as before.
 */
export function parseMailbox(
  entry: string,
  headerName = "address",
): { name: string; address: string } {
  const raw = String(entry ?? "").trim();
  if (raw.endsWith(">")) {
    const open = raw.lastIndexOf("<");
    if (open >= 0) {
      let name = raw.slice(0, open).trim();
      const refuse = () =>
        new MimeHeaderError(
          `Refusing to write the ${headerName} header: one entry holds more than one address.`,
        );
      if (name.startsWith('"')) {
        if (quotedStringEnd(name) !== name.length - 1) {
          throw refuse();
        }
        name = name.slice(1, -1).replace(/\\(.)/g, "$1");
      } else if (/[<>@,]/.test(name)) {
        throw refuse();
      }
      return { name, address: raw.slice(open + 1, -1).trim() };
    }
  }
  return { name: "", address: raw };
}

function mailboxPieces(
  headerName: string,
  name: string,
  address: string,
): Piece[] {
  // Trim FIRST: surrounding whitespace (a stored "a@b\n") is not corruption.
  const addr = assertNoControlChars(headerName, String(address ?? "").trim());
  if (!addr) {
    throw new MimeHeaderError(
      `Refusing to write the ${headerName} header: an address is empty.`,
    );
  }
  if (addr.includes("<") || addr.includes(">")) {
    throw new MimeHeaderError(
      `Refusing to write the ${headerName} header: malformed address.`,
    );
  }
  const display = sanitizeHeaderText(name).trim();
  if (!display) return [{ kind: "atom", text: addr }];

  const angle: Piece = { kind: "atom", text: `<${addr}>` };
  if (!needsEncoding(display) && ATOM_PHRASE.test(display)) {
    return [{ kind: "atom", text: display }, angle];
  }
  if (!needsEncoding(display)) {
    const quoted = `"${display.replace(/[\\"]/g, "\\$&")}"`;
    return [{ kind: "atom", text: quoted }, angle];
  }
  return [{ kind: "encoded", text: display }, angle];
}

/** One mailbox header (From, Reply-To) from a display name and an address. */
export function mailboxHeader(
  headerName: string,
  displayName: string,
  address: string,
): string {
  return renderHeader(
    headerName,
    mailboxPieces(headerName, displayName, address),
  );
}

/**
 * An address-list header (To, Cc, Bcc, Reply-To). Each entry may be a bare
 * address or `Display Name <address>`; display names are encoded as needed.
 */
export function addressListHeader(
  headerName: string,
  entries: string[],
): string {
  const pieces: Piece[] = [];
  entries.forEach((entry, idx) => {
    const { name, address } = parseMailbox(
      assertNoControlChars(headerName, String(entry ?? "").trim()),
      headerName,
    );
    const mp = mailboxPieces(headerName, name, address);
    if (idx < entries.length - 1) {
      const last = mp[mp.length - 1];
      mp[mp.length - 1] = { kind: "atom", text: `${last.text},` };
    }
    pieces.push(...mp);
  });
  return renderHeader(headerName, pieces);
}

/**
 * Our own Message-ID: refused on a control character, folded between ids.
 * We mint it, so a control character in it is a bug, not vendor input — the
 * vendor's threading values go through `threadingHeader` instead.
 */
export function messageIdHeader(headerName: string, value: string): string {
  const v = assertNoControlChars(headerName, value).trim();
  if (!v)
    throw new MimeHeaderError(
      `Refusing to write an empty ${headerName} header.`,
    );
  if (!PRINTABLE_ASCII.test(v)) {
    throw new MimeHeaderError(
      `Refusing to write the ${headerName} header: message ids must be ASCII.`,
    );
  }
  return renderHeader(
    headerName,
    v
      .split(" ")
      .filter(Boolean)
      .map((text) => ({ kind: "atom", text }) as Piece),
  );
}

/**
 * A threading header (In-Reply-To, References) rebuilt from the msg-id tokens
 * in a vendor-supplied value. Only `<...>` tokens of printable ASCII survive,
 * so CR/LF can never reach the header block; folding whitespace (CRLF + tab,
 * RFC 5322 §3.2.2), stray text and non-ASCII are dropped rather than refused,
 * because the value comes from the vendor's own mail and refusing it would
 * stop the house replying on that thread. No usable id means no header
 * (the reply loses threading, it is still sent) — returns null.
 */
export function threadingHeader(
  headerName: string,
  value: string | null | undefined,
): string | null {
  // A token too long for `Name: <id>` to fit RFC 5322's 998-character line
  // is dropped like any other unusable id: it cannot be folded.
  const ids = (
    String(value ?? "").match(/<[\x21-\x3b\x3d\x3f-\x7e]+>/g) ?? ([] as string[])
  ).filter((id) => headerName.length + 2 + id.length <= HARD_LINE_LIMIT);
  if (!ids.length) return null;
  return renderHeader(
    headerName,
    ids.map((text) => ({ kind: "atom", text }) as Piece),
  );
}

/** A UTF-8 body as base64 in lines of at most 76 characters (RFC 2045 §6.8). */
export function base64Body(text: string): string {
  const b64 = Buffer.from(String(text ?? ""), "utf8").toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join("\r\n");
}
