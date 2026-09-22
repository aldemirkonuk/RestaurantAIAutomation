/**
 * What leaves for Jev, with the people taken out of it (ADR 0207).
 *
 * THE FOUNDER, 2026-09-21, on sending vendor mail to Jev: *"Only with names
 * removed"*. This is the one function that stands between a vendor's message
 * and a third party, so it is pure, total and tested on its own
 * (`pii-mask.spec.ts`), and the caller sends ONLY what it returns.
 *
 * WHAT IS REMOVED, in this order (an email address holds a name, so emails go
 * first and the name pass never sees their parts):
 *
 *   1. email addresses          -> "[email]"
 *   2. phone numbers            -> "[phone]"   7 to 15 digits, with the usual
 *                                               separators; a date is not one
 *   3. person names             -> "[name]"    two sources:
 *        a. every name the house's own records hold for the people around
 *           this mail — the vendor's contacts, the vendor's contact person,
 *           the house's members — whole and by each part (a first name alone
 *           is still a name), as written, capitalised or in capitals;
 *        b. the places mail puts a name it has never been told: the word(s)
 *           after a greeting ("Hi Deniz,", "Dear Ms Aydın"), the line under a
 *           sign-off ("Best regards,\nCan Yılmaz") or a signature separator
 *           ("--\nCan Yılmaz"), before a Turkish address word ("Deniz Bey"),
 *           and "my name is …" / "this is … from" — and a name found there is
 *           then removed everywhere else in the message too.
 *      The sweep adds the sender's own display name (the `From:` header,
 *      `displayNameOf`) to (a).
 *
 * WHAT IS NOT REMOVED: the company's own name, a product, a price, a date. The
 * question Jev answers is how the message reads, and those carry tone.
 *
 * The counts come back so the stored score can prove the masker ran on the text
 * it read (`vendor_message_tone_scores.masked`) — never the values.
 *
 * A name pass that misses a name it was never told and that sits nowhere a
 * name usually sits is the residual risk. It is named in ADR 0207 rather than
 * papered over: the sweep reads the house's names BEFORE it sends anything, and
 * a house whose names cannot be read sends nothing that run.
 */

export const MASK = {
  email: "[email]",
  phone: "[phone]",
  name: "[name]",
} as const;

export interface MaskCounts {
  emails: number;
  phones: number;
  names: number;
}

export interface MaskResult {
  text: string;
  masked: MaskCounts;
  /**
   * The names the placed-name pass found (a greeting's, a sign-off's). Held in
   * memory only, so the same person is masked in every sentence cut from this
   * message afterwards — never stored, never logged, never sent.
   */
  found: string[];
}

const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * A run that starts and ends on a digit and holds only digits and phone
 * separators. Counted as a phone only when it carries 7 to 15 digits and is not
 * shaped like a date — so "PO-2291", "1,620.00" and "2026-09-21" survive.
 */
const PHONE_CANDIDATE = /(?:\+|\b00)?\(?\d[\d\s().\-/]{5,}\d\)?/g;
const DATE_SHAPES = [
  /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/,
  /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/,
];

const GREETINGS = [
  "hi",
  "hello",
  "hey",
  "dear",
  "good morning",
  "good afternoon",
  "good evening",
  "merhaba",
  "sayın",
  "selam",
  "iyi günler",
];
const SIGN_OFFS = [
  "best regards",
  "kind regards",
  "warm regards",
  "regards",
  "best wishes",
  "best",
  "thanks",
  "thank you",
  "many thanks",
  "cheers",
  "sincerely",
  "yours sincerely",
  "yours",
  "saygılarımla",
  "saygılarımızla",
  "teşekkürler",
  "iyi çalışmalar",
];
const HONORIFICS = "(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Bay|Bayan|Sn)\\.?";
/** A capitalised word, Unicode-aware — "Deniz", "Aydın", "O'Neill", "Jean-Luc". */
const CAP_WORD = "\\p{Lu}[\\p{L}'’\\-]+";
const L = "\\p{L}";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A case-insensitive spelling of a fixed word WITHOUT the `i` flag. Under
 * `/iu`, `\p{Lu}` matches lower-case letters too, which would let "Hi there,"
 * read "there" as a name — so the fixed words carry their own case classes and
 * the name run keeps its capital.
 */
function ci(word: string): string {
  let out = "";
  for (const ch of word) {
    const variants = new Set([
      ch,
      ch.toLowerCase(),
      ch.toUpperCase(),
      ch.toLocaleLowerCase("tr"),
      ch.toLocaleUpperCase("tr"),
    ]);
    const letters = [...variants].filter((v) => v.length === 1);
    if (letters.length > 1) out += `[${letters.map(escapeRegExp).join("")}]`;
    else out += escapeRegExp(ch);
  }
  return out;
}

function digitCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= "0" && ch <= "9") n += 1;
  return n;
}

/**
 * Every spelling of the house's known names worth removing: the whole name and
 * each part of two or more letters, longest first so "Can Yılmaz" goes before
 * "Can". Blank, one-letter and mask-token entries are dropped.
 */
export function nameVariants(
  known: readonly (string | null | undefined)[],
): string[] {
  const out = new Set<string>();
  for (const raw of known) {
    if (typeof raw !== "string") continue;
    const whole = raw.replace(/\s+/g, " ").trim();
    if (whole.length < 2) continue;
    out.add(whole);
    for (const part of whole.split(/[\s,]+/)) {
      const p = part.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
      if (p.length >= 2) out.add(p);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

function maskEmails(text: string): { text: string; n: number } {
  let n = 0;
  const out = text.replace(EMAIL, () => {
    n += 1;
    return MASK.email;
  });
  return { text: out, n };
}

function maskPhones(text: string): { text: string; n: number } {
  let n = 0;
  const out = text.replace(PHONE_CANDIDATE, (m) => {
    const trimmed = m.trim();
    const digits = digitCount(trimmed);
    if (digits < 7 || digits > 15) return m;
    if (DATE_SHAPES.some((re) => re.test(trimmed))) return m;
    n += 1;
    // Keep the whitespace the match swallowed at its edges, so words stay apart.
    const lead = m.match(/^\s*/)?.[0] ?? "";
    const tail = m.match(/\s*$/)?.[0] ?? "";
    return `${lead}${MASK.phone}${tail}`;
  });
  return { text: out, n };
}

function maskKnownNames(
  text: string,
  variants: readonly string[],
): { text: string; n: number } {
  let n = 0;
  let out = text;
  for (const v of variants) {
    // As written, capitalised, and in capitals — not in lower case: a name in
    // running text is capitalised, and "can" / "may" / "bill" in lower case
    // are words whose loss would change the very tone being read.
    const forms = new Set([
      v,
      v.charAt(0).toLocaleUpperCase("tr") + v.slice(1),
      v.charAt(0).toUpperCase() + v.slice(1),
      v.toLocaleUpperCase("tr"),
      v.toUpperCase(),
    ]);
    const alt = [...forms].map(escapeRegExp).join("|");
    const re = new RegExp(`(?<!${L})(?:${alt})(?!${L})`, "gu");
    out = out.replace(re, () => {
      n += 1;
      return MASK.name;
    });
  }
  return { text: out, n };
}

/**
 * One to three capitalised words on ONE line, optionally after an honorific —
 * a name never runs across a line break, so a signature's company line below
 * the name is left alone.
 */
const NAME_RUN = `(?:${HONORIFICS}[ \\t]+)?${CAP_WORD}(?:[ \\t]+${CAP_WORD}){0,2}`;

function maskPlacedNames(text: string): {
  text: string;
  n: number;
  found: string[];
} {
  let n = 0;
  let out = text;
  const found: string[] = [];
  const hit = (prefix: string, name: string) => {
    n += 1;
    found.push(name.replace(new RegExp(`^${HONORIFICS}[ \\t]+`, "u"), ""));
    return `${prefix}${MASK.name}`;
  };
  const greet = GREETINGS.map(ci).join("|");
  // "Hi Deniz," / "Dear Ms Aydın" / "Merhaba Can Bey" — at a line start.
  out = out.replace(
    new RegExp(`(^|\\n)(\\s*(?:${greet})[ \\t]+)(${NAME_RUN})`, "gu"),
    (_m, nl: string, lead: string, name: string) => hit(`${nl}${lead}`, name),
  );
  // "Best regards,\nCan Yılmaz" — the line under a sign-off.
  const sign = SIGN_OFFS.map(ci).join("|");
  out = out.replace(
    new RegExp(
      `(^|\\n)(\\s*(?:${sign})[ \\t]*[,!.]?[ \\t]*(?:\\r?\\n)+[ \\t]*)(${NAME_RUN})`,
      "gu",
    ),
    (_m, nl: string, lead: string, name: string) => hit(`${nl}${lead}`, name),
  );
  // "Best, Can" on one line.
  out = out.replace(
    new RegExp(
      `(^|\\n)(\\s*(?:${sign}),[ \\t]+)(${NAME_RUN})(?=[ \\t]*[.!]?[ \\t]*(?:\\r?\\n|$))`,
      "gu",
    ),
    (_m, nl: string, lead: string, name: string) => hit(`${nl}${lead}`, name),
  );
  // "--\nCan Yılmaz" — the line under a signature separator (RFC 3676's
  // "-- ", and the bare "--" most mail writes), with or without a sign-off.
  out = out.replace(
    new RegExp(
      `(^|\\n)([ \\t]*--[ \\t]*(?:\\r?\\n)+[ \\t]*)(${NAME_RUN})`,
      "gu",
    ),
    (_m, nl: string, lead: string, name: string) => hit(`${nl}${lead}`, name),
  );
  // "Deniz Bey merhaba," / "Selin Hanım'a" — Turkish mail names a person
  // BEFORE the address word, with no greeting in front. The address word is
  // kept (it carries the courtesy being read); the one or two words before it
  // go.
  out = out.replace(
    new RegExp(
      `(?<!${L})(${CAP_WORD}(?:[ \\t]+${CAP_WORD})?)([ \\t]+(?:Bey|Hanım|Hanim|Hn\\.))(?!${L})`,
      "gu",
    ),
    (_m, name: string, address: string) => {
      n += 1;
      found.push(name);
      return `${MASK.name}${address}`;
    },
  );
  // "my name is Deniz" / "this is Deniz from …" / "adım Deniz".
  out = out.replace(
    new RegExp(
      `((?<!${L})(?:${["my name is", "this is", "i am", "i'm", "ben", "adım"].map(ci).join("|")})[ \\t]+)(${NAME_RUN})`,
      "gu",
    ),
    (_m, lead: string, name: string) => {
      // "this is The …" / "I am Happy" read as names by shape; only a word the
      // sentence cannot be continuing with a lower-case reading is taken, so
      // require the first word to not be a common sentence word.
      const first = name.split(/\s+/)[0].toLowerCase();
      if (NOT_NAMES.has(first)) return `${lead}${name}`;
      return hit(lead, name);
    },
  );
  return { text: out, n, found };
}

/** Capitalised words that open a sentence after "this is" / "I am" and are not names. */
const NOT_NAMES = new Set([
  "the",
  "a",
  "an",
  "our",
  "your",
  "not",
  "just",
  "only",
  "sorry",
  "happy",
  "glad",
  "afraid",
  "writing",
  "confirming",
  "regarding",
  "about",
  "to",
  "in",
  "on",
]);

/**
 * Mask a message for egress. Total: any string in, a string out, never throws
 * on content. `knownNames` are the house's names for the people around this
 * mail; an empty list still runs the placed-name pass.
 */
export function maskForEgress(
  text: string,
  knownNames: readonly (string | null | undefined)[],
): MaskResult {
  const source = typeof text === "string" ? text : "";
  const e = maskEmails(source);
  const p = maskPhones(e.text);
  const k = maskKnownNames(p.text, nameVariants(knownNames));
  const placed = maskPlacedNames(k.text);
  // A name found where mail places it ("Best,\nDeniz") is the same person
  // everywhere else in the message ("Deniz here from Kestrel"), so it is
  // removed from the whole text too — not only from the sentences cut later.
  const again = maskKnownNames(placed.text, nameVariants(placed.found));
  return {
    text: again.text,
    masked: { emails: e.n, phones: p.n, names: k.n + placed.n + again.n },
    found: placed.found,
  };
}

/**
 * The display name of a `From:` header — `"Deniz Kaya" <deniz@kestrel.com>`
 * gives `Deniz Kaya` — or null when the header holds only an address. The
 * sender is the person likeliest to sign the message, so the sweep masks this
 * name as one the house knows. Pure; never throws.
 */
export function displayNameOf(from: unknown): string | null {
  if (typeof from !== "string") return null;
  const lt = from.indexOf("<");
  const raw = (lt >= 0 ? from.slice(0, lt) : from)
    .replace(/["'“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (raw.length < 2 || raw.includes("@")) return null;
  return raw;
}
