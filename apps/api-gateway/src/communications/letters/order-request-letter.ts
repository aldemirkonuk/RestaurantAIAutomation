/**
 * The order-request letter: the letter an order becomes when the house asks a
 * vendor for it (W25; ADR 0266 for the door it is staged through, ADR 0313 for
 * its shape).
 *
 * This is the pure half, on the `credit-letter.ts` model: the order's facts in,
 * a subject and a body out. It reads nothing and writes nothing, so what the
 * vendor would be told can be proved without a database.
 *
 * THE SHAPE (ADR 0313, option B). A template is house prose around a closed set
 * of BLOCK tokens. Each token stands for a whole block the renderer writes from
 * the facts; none stands for a single figure. There is no price, quantity or
 * order-number token, so the only figures in a letter are the ones a block
 * carries. The subject and the Mudavym line (F4) are the renderer's, never the
 * template's.
 *
 * WHAT 4a-i SHIPS. Only the DEFAULT template below. No house can save its own
 * words until 4a-ii adds `order_request` to `LETTER_CATEGORIES` with the
 * owner/manager guard, versions and publish (ADR 0313, Split). The prose
 * predicate is exported now so 4a-ii runs the same function at save and
 * publish; here it guards the default and the AI courtesy line (F2).
 *
 * WHAT IT REFUSES TO DO
 *   - Show a price a staff placer, or no known placer, put on the order (W12b
 *     F6): such a letter carries quantities only and the house signs it alone.
 *   - Treat "no price" as a price. A line with no positive price is "no price
 *     on file": `{{ask}}` then asks for a price and never asks the vendor to
 *     confirm. The header's `final_price` is never read here; a no-price order
 *     stores 0 there (`procurement.service.ts:1076`).
 *   - Convert money. A price is written in its line's own currency, or says the
 *     currency was not recorded.
 *   - Claim more than it holds. The predicate refuses numerals, currency signs
 *     and words, links (as `holdsLink` reads them), stray brackets,
 *     money-and-terms words and commitment phrases in the house's prose. It
 *     does NOT stop a figure by reference ("same price as last time"), a
 *     link in a shape `URL_RE`'s comment lists as not caught (a domain
 *     spelled out, spaced or broken across lines after the dot, among
 *     others), or a term in a language it does not list; the house's own
 *     reading is the backstop (0173:48, ADR 0313).
 *
 * LOCALE (F3, answered 2026-10-08: "Approve + Turkish now"). Every string the
 * renderer owns (subject, greeting, block texts, the Mudavym line, number and
 * date formats) is keyed by `locale`, "en" or "tr". The English words are
 * LOCKED as the founder approved them, and so are the Turkish words (approved
 * 2026-10-08, "Approve as drafted"). The service picks the locale from the house's country with
 * `houseLocale` below (ADR 0313). Turkish text never puts a suffix on a fact
 * value (a name, an order number, a figure): the sentence is built so the
 * suffix lands on a word the renderer owns ("PO-1042 sipariş numarasını").
 */

import { createHash } from "node:crypto";
import { COMMITMENT_PATTERN_SOURCES } from "../../common/orchestrator/commitment-patterns";

/** Bumped whenever the same facts and template would render different text. */
// 2: locale-keyed words, and the line unit written from its stored code.
export const RENDERER_VERSION = "order_request/2";

/** The `communication_templates.category` key, agreed with R4 (OrderLetter). */
export const ORDER_REQUEST_TEMPLATE_KEY = "order_request";

/** `procurement_conversations.outbound_email_type` for this letter. */
export const ORDER_REQUEST_KIND = "ORDER_REQUEST";

/**
 * The block tokens, closed. Adding a key here is a decision (ADR 0313): a
 * token that names a single figure would put a figure where the house's prose
 * can move it, which the whole shape exists to prevent. The CLAIMS row
 * W25-ORDER-REQUEST-NO-FIGURE-TOKEN pins that none of these is a figure.
 */
export const ORDER_REQUEST_TOKENS = {
  greeting: { required: true, says: "Hello and the vendor's first name" },
  order_lines: {
    required: true,
    says: "Each line: name, your reference, quantity and unit, and the price when one may be shown",
  },
  ask: {
    required: true,
    says: "Asks the vendor to confirm, or for a price when none is on file",
  },
  signer: { required: true, says: "Who placed the order, and the house" },
  deliver_to: { required: false, says: "The house's address" },
  needed_by: { required: false, says: "The date the order is needed by" },
  payment_terms: {
    required: false,
    says: "The payment terms the vendor gave, when they gave any",
  },
  courtesy_line: { required: false, says: "One courtesy sentence, no figures" },
} as const;

export type OrderRequestToken = keyof typeof ORDER_REQUEST_TOKENS;

// ── Locale ──────────────────────────────────────────────────────────────────

export type OrderRequestLocale = "en" | "tr";

/** The country spellings that mean Turkey, after `foldCountry`. */
const TURKEY = new Set(["tr", "turkey", "turkiye"]);

function foldCountry(country: string): string {
  return country
    .trim()
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i");
}

/**
 * The letter's locale, from the house's `restaurants.country` (ADR 0313, F3):
 * trimmed, lower-cased the Turkish way, diacritics folded (and dotless ı read
 * as i), then "tr", "turkey" or "türkiye"/"turkiye" is "tr". Anything else,
 * NULL and empty included, is "en". There is no locale column on restaurants
 * or providers; 0313 R4's `locale` key lands with 4a-ii's versions.
 */
export function houseLocale(country: string | null | undefined): OrderRequestLocale {
  if (typeof country !== "string") return "en";
  return TURKEY.has(foldCountry(country)) ? "tr" : "en";
}

/**
 * The default words, in the token form so 4a-ii can publish a house version
 * over them without the renderer changing. English: LOCKED (F3 answered
 * 2026-10-08, "Approve + Turkish now"). Turkish: LOCKED (2026-10-08, "Approve as
 * drafted").
 */
export const DEFAULT_ORDER_REQUEST_TEMPLATE_STATUS = {
  en: "locked (W25 F3, approved 2026-10-08)",
  tr: "locked (W25 F3, approved 2026-10-08)",
} as const;
export const DEFAULT_ORDER_REQUEST_TEMPLATE = [
  "{{greeting}}",
  "",
  "{{courtesy_line}}",
  "",
  "Here is our order request:",
  "",
  "{{order_lines}}",
  "",
  "{{deliver_to}}",
  "{{needed_by}}",
  "{{payment_terms}}",
  "",
  "{{ask}}",
  "",
  "Thank you,",
  "{{signer}}",
].join("\n");

export const DEFAULT_ORDER_REQUEST_TEMPLATE_TR = [
  "{{greeting}}",
  "",
  "{{courtesy_line}}",
  "",
  "Sipariş talebimiz aşağıdadır:",
  "",
  "{{order_lines}}",
  "",
  "{{deliver_to}}",
  "{{needed_by}}",
  "{{payment_terms}}",
  "",
  "{{ask}}",
  "",
  "Teşekkür ederiz.",
  "Saygılarımızla,",
  "{{signer}}",
].join("\n");

export const DEFAULT_ORDER_REQUEST_TEMPLATES: Record<OrderRequestLocale, string> = {
  en: DEFAULT_ORDER_REQUEST_TEMPLATE,
  tr: DEFAULT_ORDER_REQUEST_TEMPLATE_TR,
};

/**
 * Where this letter would sit in ADR 0173 D1's catalogue. The catalogue itself
 * is not built (0173:3); the row appears when it is.
 */
export const ORDER_REQUEST_CATALOGUE = {
  key: ORDER_REQUEST_TEMPLATE_KEY,
  family: "vendor letters",
  when: "An order is placed with a vendor",
  who: "The vendor on the order; drafted for the house to approve before it is sent",
  channel: "email",
  // PR-4b's flag ORDER_REQUEST_LETTER, off until 4a-ii merges and F3's number-word lists are answered
  // (ADR 0313). The F3 words, English and Turkish, are locked.
  armed: false,
  kind: ORDER_REQUEST_KIND,
} as const;

// ── Facts ───────────────────────────────────────────────────────────────────

export interface OrderRequestPrice {
  amount: number;
  /** ISO code, or null when the line stated none. Never filled in. */
  currency: string | null;
  /** The stored unit one price buys (`price_uom`: bottle, case, …), or null. */
  uom: string | null;
  /** `price_pack_size`: how many a priced pack holds, or null. */
  packSize: number | null;
}

export interface OrderRequestLine {
  name: string;
  vendorSku: string | null;
  quantity: number;
  unit: string | null;
  bottlesPerUnit: number | null;
  /** The price already told to the vendor (W12c F7), or null. */
  price: OrderRequestPrice | null;
}

export interface OrderRequestFacts {
  orderId: string;
  orderNumber: string;
  houseName: string;
  vendorFirstName: string | null;
  lines: OrderRequestLine[];
  placer: {
    userId: string | null;
    name: string | null;
    /** The placer's role in THIS house at render time, or null. */
    role: string | null;
  };
  deliverTo: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  neededBy: string | null;
  paymentTerms: string | null;
  /** The letter's language; "en" when absent. The service sets it (houseLocale). */
  locale?: OrderRequestLocale;
}

// ── The prose predicate ─────────────────────────────────────────────────────

export interface ProseRefusal {
  rule:
    | "too_long"
    | "unknown_token"
    | "missing_required_token"
    | "numeral"
    | "currency"
    | "link"
    | "stray_bracket"
    | "money_or_terms_word"
    | "number_word"
    | "commitment_language";
  says: string;
}

const TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** NFKC, then strip format characters (zero-width joiners and the like). */
export function normaliseProse(text: string): string {
  return text.normalize("NFKC").replace(/\p{Cf}/gu, "");
}

const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{N}_])";
const NOT_LETTER_AFTER = "(?![\\p{L}\\p{N}_])";
const word = (alts: string[]) =>
  new RegExp(`${NOT_LETTER_BEFORE}(?:${alts.join("|")})${NOT_LETTER_AFTER}`, "u");
const stem = (alts: string[]) =>
  new RegExp(`${NOT_LETTER_BEFORE}(?:${alts.join("|")})\\p{L}*`, "u");

/** ISO codes, matched in capitals only ("try" is an English word, "TRY" is not). */
const ISO_CODE_RE =
  /(?<![\p{L}\p{N}_])(?:USD|EUR|GBP|TRY|CHF|JPY|CAD|AUD|NZD|SEK|NOK|DKK|PLN|CZK|HUF|RON|BGN|RUB|CNY|AED|ZAR|MXN|BRL|INR)(?![\p{L}\p{N}_])/u;
/** Currency words, matched on the lower-cased prose. */
const CURRENCY_WORD_RE = word([
  "tl",
  "lira",
  "liras",
  "euro",
  "euros",
  "dollar",
  "dollars",
  "dolar",
  "sterling",
  "kuruş",
  "kurus",
  "cent",
  "cents",
  "franc",
  "francs",
]);
/**
 * A link (ADR 0313:37). `holdsLink` refuses the prose when `URL_RE` matches
 * any of the three link views `linkViews` makes of it, or `SCHEME_RE` the
 * scheme view `schemeView` makes. `URL_RE` matches:
 *   - one ASCII letter and up to 31 more letters, digits, "+", "." or "-",
 *     followed by "//" after a colon ("https://"). Nothing is required before
 *     the letter, so "-https://x", "+http://a", ".https://x" and "…https://x"
 *     match on their "https://";
 *   - "www.", or an "@";
 *   - a known non-web scheme followed by a colon and a non-space character
 *     (`LINK_SCHEMES`: "javascript:", "data:text", "mailto:x", "tel:", "sms:",
 *     "ftp:", "file:", "vbscript:"), with no letter, digit or "_" right before
 *     it. A space after the colon is prose, so "Data: as before" and
 *     "Note: thanks" are kept, and so is "Metadata:kept";
 *   - a bare domain: two labels joined by a dot, the last starting with a
 *     letter and at least two characters long, with any path after it
 *     ("evil.xyz", "bit.ly/abc", "shop.example.ly"). A label may hold letters,
 *     digits, "_" and "-", so "evil_site.com" and "evil.com_" are refused.
 *     There is no suffix list, so an unlisted TLD is refused too. A one-letter
 *     last label passes, so "e.g." and "U.S." are kept; two words joined by a
 *     dot with no space ("St.Emilion", "Mod_name.Next") are refused. A last
 *     label starting with a digit is left to the numeral rule.
 * Not caught as a link (each pinned by a spec, ADR 0313:37):
 *   - a domain spelled out ("evil dot com", "name AT evil DOT com"), spaced
 *     ("evil . com"), or broken across lines after the dot ("evil.\ncom");
 *   - a dot written as a word inside brackets other than "dot" ("[d0t]" holds
 *     a digit, so the numeral rule refuses it in the house's prose);
 *   - "dot" in a bracket on one side only ("evil [dot com"), and a space
 *     outside an unmatched bracket ("evil [.com");
 *   - a dot-like character not in `DOT_LIKE_RE`, and a bracket not in
 *     `OPEN_BRACKETS` / `CLOSE_BRACKETS`;
 *   - a scheme not in `LINK_SCHEMES` without "//" ("foo:bar"; also "http:x",
 *     "http:/x" and "http:\\x", which a URL parser reads as "http://x": one
 *     slash or backslash after the colon is not two), and a "://" whose
 *     nearest ASCII letter before it is more than 31 characters back;
 *   - a scheme word split by a mark, format or control character, filler,
 *     backslash, tab or line break that no view shows whole with no letter,
 *     digit or "_" right before it ("x\u034Fjava\u034Fscript:alert",
 *     "x\tjava\tscript:alert"; see `linkViews`), and a tab or line break
 *     right after a scheme's colon when no "/" follows it
 *     ("javascript:\nalert"; see `schemeView`). A run of tab, line feed,
 *     carriage return, U+2028 or U+2029 between a scheme word and its colon,
 *     between the colon and "//", or between the two slashes ("http\t:\t//x",
 *     "javascript\n:alert", "https:\t//x", "http:/\t/x") is caught by the
 *     scheme view, and so is a backslash in place of either slash after the
 *     colon of http, https, ftp, ws, wss or file with no letter right before
 *     the scheme word once format and control characters are stripped (a
 *     tab or line break there is not a letter: "x\thttp:\\\\x" is caught)
 *     ("http:\\\\x", "http:/\\x", "http:\t\\//x"; see `schemeView`);
 *   - a link made with a fact block: the test reads the prose with each
 *     "{{token}}" replaced by a space, so "see {{signer}}.com" is clean here
 *     and renders as "see Acme.com". The shipped templates hold each token on
 *     its own line and no house can edit a template yet; this must be closed
 *     before houses edit templates (PR-4a-ii, ADR 0313:37).
 *
 * Speed: the "://" alternative reads at most 35 characters from any start,
 * and the bare-domain alternative starts only at the first character of a
 * label run, so a long run ("aaaa…", "a-a-a-…") is scanned a bounded number
 * of times per character (gate note, 2e6ee4c48: the unanchored scheme was
 * quadratic, 1.4-6 s at 100 KB).
 */
const LINK_SCHEMES = ["javascript", "vbscript", "data", "mailto", "tel", "sms", "ftp", "file"];
const SCHEME_SOURCES = [
  "[a-z][a-z0-9+.-]{0,31}:\\/\\/",
  `(?<![\\p{L}\\p{N}_])(?:${LINK_SCHEMES.join("|")}):(?=\\S)`,
];
/** The two scheme alternatives of `URL_RE`, alone, for `schemeView`. */
const SCHEME_RE = new RegExp(SCHEME_SOURCES.join("|"), "iu");
const URL_RE = new RegExp(
  [
    SCHEME_SOURCES[0],
    "www\\.",
    SCHEME_SOURCES[1],
    "(?<![\\p{L}\\p{N}_-])[\\p{L}\\p{N}_-]+\\.\\p{L}[\\p{L}\\p{N}_-]+",
    "@",
  ].join("|"),
  "iu",
);
/**
 * Dot-like characters that survive NFKC, folded to "." for the link test
 * only (the courtesy line keeps its own characters). NFKC already turns
 * U+FF0E, U+FE52, U+2024 into "."; U+FF61, U+FE12 into U+3002; U+0387 into
 * U+00B7; U+FF65 into U+30FB; U+0F0C into U+0F0B — so those are covered too.
 *   U+3002 ideographic full stop (an IDNA label dot), U+00B7 middle dot,
 *   U+0589 Armenian full stop, U+06D4 Arabic full stop, U+0700-U+0702 Syriac
 *   end/full stops, U+0F0B and U+0F0D Tibetan tsheg and shad, U+1362
 *   Ethiopic full stop, U+166E Canadian syllabics full stop, U+1803 and
 *   U+1809 Mongolian full stops, U+1C3B Lepcha punctuation, U+2022 bullet,
 *   U+2027 hyphenation point, U+2219 bullet operator, U+22C5 dot operator,
 *   U+2E31 word separator middle dot, U+2E33 raised dot, U+2E3C stenographic
 *   full stop, U+30FB katakana middle dot, U+A4FF Lisu full stop, U+A60E Vai
 *   full stop, U+A6F3 Bamum full stop, U+10A56 Kharoshthi danda.
 * Cost: letters joined by one of these with no space are refused like
 * "St.Emilion" (Catalan "l·l", a katakana name split by ・, Tibetan prose).
 */
const DOT_LIKE_RE =
  /[\u3002\u00B7\u0589\u06D4\u0700-\u0702\u0F0B\u0F0D\u1362\u166E\u1803\u1809\u1C3B\u2022\u2027\u2219\u22C5\u2E31\u2E33\u2E3C\u30FB\uA4FF\uA60E\uA6F3\u{10A56}\uFF0E\uFF61]/gu;
/**
 * Brackets a defanged dot may sit in, after NFKC (which already turns the
 * fullwidth ( [ { < and the small ( { < into ASCII, the small tortoise shell
 * into 〔, and U+2329 into 〈): ASCII ( [ { <, the CJK 【 〔 「 『 〖 〘 〚 《 〈,
 * the math ⟨, and the guillemets « ‹ — with their closing pairs.
 */
const OPEN_BRACKETS = "\\[({<\u3010\u3014\u300C\u300E\u3016\u3018\u301A\u300A\u3008\u27E8\u00AB\u2039";
const CLOSE_BRACKETS = "\\])}>\u3011\u3015\u300D\u300F\u3017\u3019\u301B\u300B\u3009\u27E9\u00BB\u203A";
const O = `[${OPEN_BRACKETS}]`;
/**
 * Whitespace for the folds: JS `\s` plus U+0085 (NEL), which `\s` does not
 * match although Unicode counts it as a line break.
 */
const WS = "\\s\\u0085";
const C = `[${CLOSE_BRACKETS}]`;
/** "&period;", the HTML entity for ".". */
const DOT_ENTITY_RE = /&period;/giu;
/**
 * Whitespace (`WS`) before a dot that holds a line break ("evil\n.com",
 * "evil\u0085.com"). It starts only at the first whitespace of a run, so a
 * long run is scanned once.
 */
const BREAK_BEFORE_DOT_RE = new RegExp(`(?<![${WS}])[${WS}]+(?=\\.)`, "gu");
const LINE_BREAK_RE = /[\n\r\v\f\u0085\u2028\u2029]/u;
/**
 * A defanged dot: "." or "dot" with one or more brackets before it and one
 * or more after it, any of them nested or mixed, spaces allowed inside and
 * around ("evil[.]com", "evil (.) com", "evil[[.]]com", "evil【.】com",
 * "evil<.>com", "evil [dot] com"). A nest of any depth is one run, so one
 * pass folds it. It starts only at the first character of a run of spaces
 * and opening brackets, so a long run is scanned once.
 * Cost: it swallows the spaces around it, so prose that brackets a dot or
 * "dot" between two words is refused ("Merci (dot) beaucoup", "Hello [.]
 * Goodbye"). `OPEN_AFTER_DOT_RE` refuses "U.S.(as before)" and
 * `CLOSE_AFTER_DOT_RE` refuses "(Thanks.)Next" the same way. Each is pinned
 * by a spec (ADR 0313:37).
 */
const DEFANGED_DOT_RE = new RegExp(
  `(?<![${WS}${OPEN_BRACKETS}])[${WS}${OPEN_BRACKETS}]*(?:\\.|dot)(?<=${O}[${WS}]*(?:\\.|dot))(?=[${WS}]*${C})[${WS}${CLOSE_BRACKETS}]*`,
  "giu",
);
/** An unmatched opening bracket before a dot ("evil[.com", "evil[[.com"). */
const OPEN_BEFORE_DOT_RE = new RegExp(
  `(?<![${WS}${OPEN_BRACKETS}])([${WS}]*)${O}[${WS}${OPEN_BRACKETS}]*\\.`,
  "gu",
);
/** An unmatched closing bracket after a dot ("evil.]com"); spaces after it stay. */
const CLOSE_AFTER_DOT_RE = new RegExp(`\\.(?=[${WS}]*${C})[${WS}${CLOSE_BRACKETS}]*`, "gu");
/** An opening bracket between a dot and a letter ("evil.(com)", left by "(.)(com)"). */
const OPEN_AFTER_DOT_RE = new RegExp(`\\.${O}+(?=\\p{L})`, "gu");

/** Folds dot-like characters and defanged dots to "." (one pass, in this order). */
function foldDots(text: string): string {
  return text
    .replace(DOT_LIKE_RE, ".")
    .replace(DOT_ENTITY_RE, ".")
    .replace(BREAK_BEFORE_DOT_RE, (ws) => (LINE_BREAK_RE.test(ws) ? "" : ws))
    .replace(DEFANGED_DOT_RE, ".")
    .replace(OPEN_BEFORE_DOT_RE, (_m, lead: string) => `${lead}.`)
    .replace(CLOSE_AFTER_DOT_RE, (m) => `.${m.slice(m.replace(/[\s\u0085]+$/u, "").length)}`)
    .replace(OPEN_AFTER_DOT_RE, ".");
}
/**
 * Control characters (`\p{Cc}`) a reader does not see as a space or a line
 * break: U+0000-U+0008, U+000E-U+001F, U+007F-U+0084 and U+0086-U+009F. Tab,
 * line feed, U+000B, U+000C, carriage return and U+0085 (NEL) are left out:
 * they are whitespace here, and the line breaks among them separate lines.
 */
const CONTROLS = "\\u0000-\\u0008\\u000E-\\u001F\\u007F-\\u0084\\u0086-\\u009F";
const VIEW1_STRIP_RE = new RegExp(`[\\p{M}\\p{Cf}\\\\${CONTROLS}]`, "gu");
const VIEW2_STRIP_RE = new RegExp(`[\\p{Cf}${CONTROLS}]`, "gu");
const VIEW3_SPACE_RE = /[\p{Cf}\u115F\u1160\u3164\uFFA0]/gu;
const SCHEME_VIEW_STRIP_RE = new RegExp(`[\\p{Cf}${CONTROLS}]`, "gu");
const SCHEME_VIEW_JOIN_RE = /(?<=[\p{L}\p{N}])[\t\n\r\u2028\u2029]+(?=[\p{L}\p{N}])/gu;
const SCHEME_VIEW_COLON_JOIN_RE =
  /(?<=[\p{L}\p{N}+.-])[\t\n\r\u2028\u2029]+(?=:)/gu;
/** A run the scheme view may remove inside a special scheme word. */
const SCHEME_RUN = "[\\t\\n\\r\\u2028\\u2029]*";
/** A special scheme word, any case, with such runs allowed between its letters. */
const SPECIAL_SCHEME = [
  `[Hh]${SCHEME_RUN}[Tt]${SCHEME_RUN}[Tt]${SCHEME_RUN}[Pp](?:${SCHEME_RUN}[Ss])?`,
  `[Ff]${SCHEME_RUN}[Tt]${SCHEME_RUN}[Pp]`,
  `[Ww]${SCHEME_RUN}[Ss](?:${SCHEME_RUN}[Ss])?`,
  `[Ff]${SCHEME_RUN}[Ii]${SCHEME_RUN}[Ll]${SCHEME_RUN}[Ee]`,
].join("|");
/**
 * A special scheme word with no letter right before it, its colon, and the
 * slashes, backslashes and runs after it. No `i` flag: under `iu`, `\p{L}`
 * also matches U+0345 (it case-folds to U+03B9).
 */
const SCHEME_VIEW_BACKSLASH_RE = new RegExp(
  `(?<!\\p{L})(?:${SPECIAL_SCHEME}):[\\\\/\\t\\n\\r\\u2028\\u2029]+`,
  "gu",
);
const SCHEME_VIEW_SLASH_JOIN_RE =
  /(?<=:[\t\n\r\u2028\u2029]*\/)[\t\n\r\u2028\u2029]+(?=\/)|(?<=:)[\t\n\r\u2028\u2029]+(?=\/[\t\n\r\u2028\u2029]*\/)/gu;
/**
 * The three copies of the prose the link test reads (the courtesy line and
 * the house's words keep their own characters). `holdsLink` is given the
 * prose after NFKC only, before `normaliseProse` strips format characters.
 * Each copy goes through `foldDots`:
 *   1. with every combining mark (`\p{M}`: U+034F, U+0301, U+0338, the
 *      variation selectors U+FE00-U+FE0F, the Mongolian U+180B-U+180D …),
 *      every format character (`\p{Cf}`) and every backslash stripped first.
 *      UTS 46 ignores or maps the marks, so "evil͏.com" reaches evil.com; here
 *      it reads "evil.com", and "evil\.com" reads "evil.com";
 *   2. with only the format characters stripped;
 *   3. with nothing stripped, and every format character and Hangul filler
 *      (U+115F, U+1160, U+3164, U+FFA0: letters that render as nothing)
 *      turned into a space.
 * The control characters in `CONTROLS` are stripped in copies 1 and 2, like
 * format characters, so "evil\u001C.com" reads "evil.com" there. Copy 3
 * keeps them: a control character is not a letter, digit or "_", so it
 * already separates a scheme word from a letter before it.
 * Stripping can join a letter onto a scheme word ("x\u0301javascript:alert"
 * and "x\u200Bjavascript:alert" read "xjavascript:alert" in copy 1, which the
 * scheme's lookbehind lets through); copy 2 keeps a mark or backslash as the
 * separator, copy 3 a format character, control character or filler.
 * Copy 2 is defence in depth: the scheme view also keeps marks and
 * backslashes and strips format and control characters, and copy 1 strips
 * more around a dot. No spec fails without copy 2, and no input has been
 * found that only copy 2 refuses (ADR 0313:37).
 * `holdsLink` refuses when any copy matches `URL_RE`, or the scheme view
 * (`schemeView`) matches `SCHEME_RE`.
 * Not caught: a scheme word that is itself split by a mark, format or
 * control character, filler, backslash, tab or line break, whenever no view
 * shows it whole with no letter, digit or "_" right before it. For example
 * "x\u034Fjava\u034Fscript:alert", "x\\java\\script:alert",
 * "x\u200Bjava\u200Bscript:alert", "x\u200Bjava\u0301script:alert",
 * "xjava\u034Fscript:alert", "x\u001Cjava\u001Cscript:alert" and
 * "x\tjava\tscript:alert". No mail client reads a split scheme as one.
 * Pinned by a spec (ADR 0313:37).
 */
function linkViews(text: string): string[] {
  return [
    foldDots(text.replace(VIEW1_STRIP_RE, "")),
    foldDots(text.replace(VIEW2_STRIP_RE, "")),
    foldDots(text.replace(VIEW3_SPACE_RE, " ")),
  ];
}
/**
 * The scheme view: the prose with every format character and every control
 * character in `CONTROLS` removed, and then every run of ASCII tab, line
 * feed, carriage return, U+2028 or U+2029 that has a letter or digit on both
 * sides. A browser's URL parser removes tab, line feed and carriage return
 * from anywhere in an href, so "java\tscript:alert" is "javascript:alert" to
 * it; here it reads so too, and so do "jav\u2028ascript:alert" and
 * "java\u001Cscript:alert". Only `SCHEME_RE` is tested on it: joining two
 * lines can make a bare domain ("Thank you.\nBest" would read "you.Best"), so
 * the domain, "www." and "@" alternatives are not.
 * Such a run is also removed between a letter, digit, "+", "." or "-" and a
 * colon right after it ("http\t://x", "javascript\n:alert"); between a colon
 * and a "/" that has another "/" after it (with only such runs between
 * them); and between those two slashes. So "https:\t//x", "http:/\t/x" and
 * "http:\t/\n/x" read "https://x" / "http://x".
 * The steps run in this order: strip, the join before the colon, the
 * backslash fold below, the join between letters or digits, the two slash
 * joins. The fold turns every backslash into "/" in the run of slashes,
 * backslashes and such runs right after the colon of a WHATWG special
 * scheme word (http, https, ftp, ws, wss, file; any case, spelled out with
 * no `i` flag), because a URL parser reads "\\" as "/" there: "http:\\\\x",
 * "http:/\\x" and "https:\\/intranet" read "http://x" /
 * "https://intranet". The scheme word may hold such runs between its
 * letters ("ht\ntp:\\\\x"): tab, line feed and carriage return because a
 * URL parser removes them, U+2028 and U+2029 on purpose to fail closed (a
 * parser keeps them, but the letter join removes them too). The fold is off only
 * when the character right before the scheme word, once format and control
 * characters are stripped, is a letter: a tab or line break is not one, so
 * "Thanks\nhttp:\\\\intranet" and "x\thttp:\\\\x" are refused (the fold runs
 * before the letter join, which would read "Thankshttp"), and so is
 * "\u0345http:\\\\x" (under an `i` flag `\p{L}` would match U+0345). A digit
 * or "_" is not a letter either ("1http:\\\\x" is refused). A drive or a word
 * that is not one of those schemes keeps its backslashes ("C:\\\\server",
 * "D:\\path", "Not:\\ foo"). The lookbehind is letters only so that a word
 * ending in a scheme name keeps them too ("Profile:\\\\ ok",
 * "News:\\\\ see"). The cost, kept on purpose: "xhttp:\\\\x", a non-ASCII
 * letter ("\u4E2Dhttp:\\\\x", "\u0647http:\\\\x"), the Hangul filler U+3164
 * (a letter) and "x\u200Bhttp:\\\\y" or "x\u00ADhttp:\\\\y" (format
 * characters, stripped) all pass, although a URL parser reading from "http"
 * gives "http://x/". Each example in this paragraph is pinned by a spec
 * (ADR 0313:37). With one slash or backslash after the colon the scheme view
 * holds no "//" ("http:\\x" stays "http:\\x", "http:/x" stays "http:/x"), so
 * it does not refuse them, although a URL parser reads both as "http://x/"
 * (see `URL_RE`).
 * Refused although they hold no link (fail closed, pinned by a spec): a
 * scheme's shape (an ASCII letter and up to 31 more ASCII letters, digits,
 * "+", "." or "-"), then a colon, then "/" and "/", where only such runs (at
 * least one) sit between that shape and the colon, the colon and the first
 * "/", or the two slashes: "Note:\n// see below",
 * "Ek:\n/\t/", "Date:\t/\t/", "Dear team:\n\n// ok", "Note\n:// see"; and
 * such a run between a named scheme word and its colon when a non-space
 * character follows the colon ("Data\n:x"). A space anywhere in the gap,
 * or before the colon, keeps the line ("Sizes:\n/ small", "Remarque :\n// merci",
 * "Note\n: see below").
 * Not caught: such a run next to any other character that is not a letter
 * or digit, as right after the colon with no "/" after it
 * ("javascript:\nalert"), because there a line break separates prose
 * ("Data:" at a line's end, the next line below it). Pinned by a spec
 * (ADR 0313:37).
 */
function schemeView(text: string): string {
  return text
    .replace(SCHEME_VIEW_STRIP_RE, "")
    .replace(SCHEME_VIEW_COLON_JOIN_RE, "")
    .replace(SCHEME_VIEW_BACKSLASH_RE, (m) => m.replace(/\\/g, "/"))
    .replace(SCHEME_VIEW_JOIN_RE, "")
    .replace(SCHEME_VIEW_SLASH_JOIN_RE, "");
}
function holdsLink(text: string): boolean {
  return linkViews(text).some((v) => URL_RE.test(v)) || SCHEME_RE.test(schemeView(text));
}
/** EN + TR money-and-terms words (ADR 0313; adversary change 3). */
const MONEY_TERMS_EN_RE = word([
  "price",
  "prices",
  "priced",
  "pricing",
  "free",
  "discount",
  "discounts",
  "discounted",
  "payment",
  "payments",
]);
const MONEY_TERMS_TR_RE = stem(["fiyat", "bedava", "ücret", "indirim", "iskonto", "ödeme", "vade"]);
/**
 * Number words — PROPOSED under F3, not decided (ADR 0313): EN "two" upward
 * plus dozen and hundred; TR only a number word followed by a unit or currency
 * noun, because bir/on/altı/yüz/bin are everyday words.
 */
const NUMBER_WORDS_EN_RE = word([
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "hundreds",
  "thousand",
  "thousands",
  "dozen",
  "dozens",
]);
const NUMBER_WORDS_TR_RE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on|yirmi|otuz|kırk|elli|altmış|yetmiş|seksen|doksan|yüz|bin|milyon)\\s+(?:koli|kasa|şişe|adet|kutu|paket|litre|kilo|kg|gram|lira|tl|euro|dolar|kuruş|gün|hafta|ay)\\p{L}*`,
  "u",
);
const COMMITMENT_RES = COMMITMENT_PATTERN_SOURCES.map((s) => new RegExp(s, "i"));

/**
 * The most UTF-16 code units (`template.length`) a letter template may hold,
 * counted on the raw text before NFKC. NFKC turns one code point into at most
 * eighteen (U+FDFA becomes an 18-letter phrase), so every scan after it is
 * bounded by a fixed multiple of this. The shipped defaults are under 600
 * code units.
 */
export const ORDER_REQUEST_TEMPLATE_MAX_CHARS = 16_384;

/**
 * The most UTF-16 code units (`length`) the AI's courtesy sentence may hold,
 * raw and after normalising. The raw count is taken first, so an over-long
 * sentence is dropped before NFKC or the link test reads it.
 */
const COURTESY_MAX_CHARS = 240;

/**
 * Every reason the house's prose in `template` may not be used, empty when it
 * may. "Prose" is everything outside the tokens. Run over the default here, and
 * at save and publish in 4a-ii. A template over
 * ORDER_REQUEST_TEMPLATE_MAX_CHARS raw UTF-16 code units is refused as too_long
 * alone, before NFKC or any pattern reads it.
 */
export function orderRequestProseRefusals(template: string): ProseRefusal[] {
  if (template.length > ORDER_REQUEST_TEMPLATE_MAX_CHARS) {
    return [
      {
        rule: "too_long",
        says: `This letter is ${template.length} characters long; a letter may hold at most ${ORDER_REQUEST_TEMPLATE_MAX_CHARS}.`,
      },
    ];
  }
  return orderRequestProseRefusalsUncapped(template);
}

/**
 * orderRequestProseRefusals without the length cap. Exported only so the
 * linear-time spec can prove the patterns themselves scan in linear time at
 * lengths past the cap; every caller uses orderRequestProseRefusals.
 */
export function orderRequestProseRefusalsUncapped(template: string): ProseRefusal[] {
  const refusals: ProseRefusal[] = [];
  const found = new Set<string>();
  for (const m of template.matchAll(TOKEN_RE)) found.add(m[1]);

  const unknown = [...found].filter(
    (k) => !Object.prototype.hasOwnProperty.call(ORDER_REQUEST_TOKENS, k),
  );
  if (unknown.length > 0) {
    refusals.push({
      rule: "unknown_token",
      says: `This letter uses ${unknown.map((k) => `{{${k}}}`).join(", ")}, which the order letter does not know. The blocks it knows are ${Object.keys(ORDER_REQUEST_TOKENS).map((k) => `{{${k}}}`).join(", ")}.`,
    });
  }
  const missing = (Object.keys(ORDER_REQUEST_TOKENS) as OrderRequestToken[]).filter(
    (k) => ORDER_REQUEST_TOKENS[k].required && !found.has(k),
  );
  if (missing.length > 0) {
    refusals.push({
      rule: "missing_required_token",
      says: `This letter must carry ${missing.map((k) => `{{${k}}}`).join(", ")}: the vendor cannot act on an order letter without it.`,
    });
  }

  const prose = normaliseProse(template.replace(TOKEN_RE, " "));
  // Two lower-casings, so a Turkish dotted capital (FİYAT) and an English one
  // (PRICE) both reach the word lists.
  const lowers = [prose.toLowerCase(), prose.toLocaleLowerCase("tr")];
  const anyLower = (re: RegExp) => lowers.some((l) => re.test(l));

  // Before NFKC too: it turns a Roman-numeral sign (Ⅻ) into the letters XII.
  if (/\p{N}/u.test(prose) || /\p{N}/u.test(template.replace(TOKEN_RE, " "))) {
    refusals.push({
      rule: "numeral",
      says: "Your words may not hold a number. Quantities and prices come from {{order_lines}}, dates from {{needed_by}}; write the sentence without the figure.",
    });
  }
  if (/\p{Sc}/u.test(prose) || ISO_CODE_RE.test(prose) || anyLower(CURRENCY_WORD_RE)) {
    refusals.push({
      rule: "currency",
      says: "Your words may not name money (a currency sign, code or word). A price, when one may be shown, comes from {{order_lines}}.",
    });
  }
  if (holdsLink(template.replace(TOKEN_RE, " ").normalize("NFKC"))) {
    refusals.push({
      rule: "link",
      says: "Your words may not hold a link, a web address or an email address (ADR 0173 D5).",
    });
  }
  if (/[{}<>]/.test(prose)) {
    refusals.push({
      rule: "stray_bracket",
      says: "Your words hold a stray { } < or >. Blocks are written {{name}}; anything else in braces or angle brackets is refused.",
    });
  }
  if (anyLower(MONEY_TERMS_EN_RE) || anyLower(MONEY_TERMS_TR_RE)) {
    refusals.push({
      rule: "money_or_terms_word",
      says: "Your words may not talk about price, discounts, free goods or payment. {{ask}} and {{payment_terms}} carry those, from what is on file.",
    });
  }
  if (anyLower(NUMBER_WORDS_EN_RE) || anyLower(NUMBER_WORDS_TR_RE)) {
    refusals.push({
      rule: "number_word",
      says: "Your words may not spell out a quantity. Quantities come from {{order_lines}}.",
    });
  }
  const committed = COMMITMENT_RES.find((re) => re.test(prose));
  if (committed) {
    const phrase = committed.exec(prose)?.[0];
    refusals.push({
      rule: "commitment_language",
      says: `Your words contain language that can form a binding purchase commitment${phrase ? ` — "${phrase}"` : ""}. The order is the commitment; {{ask}} carries it.`,
    });
  }
  return refusals;
}

// ── The courtesy line (F2) ──────────────────────────────────────────────────

const DATE_WORD_RE = word([
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "today", "tomorrow", "tonight", "yesterday",
  "ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos",
  "eylül", "ekim", "kasım", "aralık",
  "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi", "pazar",
  "bugün", "yarın", "dün",
]);

/**
 * The AI's one courtesy sentence, or null when it must be dropped (F2, ADR
 * 0266:35): any digit, currency, date word, `[` or `{{`, and anything the prose
 * predicate refuses. Dropping costs nothing — the letter stands without it.
 */
export function courtesyLineOrNull(sentence: string | null | undefined): string | null {
  if (typeof sentence !== "string") return null;
  // Raw length first: nothing (NFKC, the link test) reads an over-long sentence.
  if (sentence.length > COURTESY_MAX_CHARS) return null;
  const line = normaliseProse(sentence).replace(/\s+/g, " ").trim();
  if (!line || line.length > COURTESY_MAX_CHARS) return null;
  // The link test also reads the sentence before its whitespace is collapsed
  // and its format characters stripped, so a line break before a dot
  // ("evil\n.com") is folded and a format character before a scheme
  // separates it, as in house prose.
  if (holdsLink(sentence.normalize("NFKC"))) return null;
  if (/\p{N}|\p{Sc}|\[|\]|\{|\}/u.test(line)) return null;
  const lowers = [line.toLowerCase(), line.toLocaleLowerCase("tr")];
  if (lowers.some((l) => DATE_WORD_RE.test(l))) return null;
  // The same predicate as house prose, minus the token rules (a sentence
  // carries no blocks, so "missing {{greeting}}" is not a reason to drop it).
  const refused = orderRequestProseRefusals(
    `{{greeting}}{{order_lines}}{{ask}}{{signer}}\n${line}`,
  );
  return refused.length === 0 ? line : null;
}

// ── The render ──────────────────────────────────────────────────────────────

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** May this placer's letter show money? Owner or manager only (W12b F6). */
export function placerMayShowPrice(placer: OrderRequestFacts["placer"]): boolean {
  const role = (placer.role ?? "").toLowerCase();
  return placer.userId != null && (role === "owner" || role === "manager");
}

function priceOnFile(lines: OrderRequestLine[]): boolean {
  return (
    lines.length > 0 &&
    lines.every((l) => l.price != null && Number.isFinite(l.price.amount) && l.price.amount > 0)
  );
}

/**
 * sha256 over every fact any template can show, plus the placer's role (which
 * decides whether money shows). A template edit does not change it (ADR 0313
 * R5); a changed quantity, price, role or address does.
 */
export function orderRequestFactsHash(f: OrderRequestFacts): string {
  const facts = {
    orderId: f.orderId,
    orderNumber: f.orderNumber,
    houseName: f.houseName,
    vendorFirstName: f.vendorFirstName,
    lines: f.lines,
    locale: f.locale ?? "en",
    placer: { userId: f.placer.userId, name: f.placer.name, role: f.placer.role },
    priceShown: placerMayShowPrice(f.placer),
    deliverTo: f.deliverTo,
    neededBy: f.neededBy,
    paymentTerms: f.paymentTerms,
  };
  return createHash("sha256").update(JSON.stringify(canonical(facts))).digest("hex");
}

// ── Words, per locale ───────────────────────────────────────────────────────

/** The stored unit codes (`order_line_capture_and_units`, `an_agreed_price_states_its_unit`). */
const UNIT_WORDS: Record<OrderRequestLocale, Record<string, [string, string]>> = {
  // [one, many]
  en: {
    bottle: ["bottle", "bottles"],
    case: ["case", "cases"],
    keg: ["keg", "kegs"],
    pack: ["pack", "packs"],
    split_case: ["split case", "split cases"],
    each: ["each", "each"],
    liter: ["liter", "liters"],
  },
  // A Turkish noun after a number stays singular ("3 koli", "12 şişe").
  tr: {
    bottle: ["şişe", "şişe"],
    case: ["koli", "koli"],
    keg: ["fıçı", "fıçı"],
    pack: ["paket", "paket"],
    split_case: ["karışık koli", "karışık koli"],
    each: ["adet", "adet"],
    liter: ["litre", "litre"],
  },
};

/** Legacy plural spellings, read as the code they were normalised to. */
const UNIT_ALIASES: Record<string, string> = {
  bottles: "bottle",
  cases: "case",
  kegs: "keg",
  packs: "pack",
  split_cases: "split_case",
  "split cases": "split_case",
  litre: "liter",
  litres: "liter",
  liters: "liter",
};

/** A unit in the letter's words; an unknown unit is written as stored. */
function unitWord(unit: string, quantity: number, locale: OrderRequestLocale): string {
  const key = unit.trim().toLowerCase();
  const words = UNIT_WORDS[locale][UNIT_ALIASES[key] ?? key];
  if (!words) return unit.trim();
  return quantity === 1 ? words[0] : words[1];
}

/** Turkish figures: decimal comma, thousands dot ("1.250,00"). */
function trNumber(n: number, decimals: number | null): string {
  const fixed = decimals == null ? String(n) : n.toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const digits = sign ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped}${frac ? `,${frac}` : ""}`;
}

interface LetterWords {
  subject: (orderNumber: string, house: string) => string;
  greeting: (name: string | null) => string;
  ref: (sku: string) => string;
  unitMissing: string;
  pack: (n: number) => string;
  quantity: (n: number) => string;
  amount: (n: number) => string;
  currencyMissing: string;
  price: (amount: string, per: string | null) => string;
  per: (uom: string, packSize: number | null) => string;
  deliverTo: (address: string) => string;
  neededBy: (isoDate: string) => string;
  noDate: string;
  terms: (terms: string) => string;
  askConfirm: (orderNumber: string) => string;
  askPrice: (orderNumber: string) => string;
  mudavym: (house: string) => string;
}

const WORDS: Record<OrderRequestLocale, LetterWords> = {
  // LOCKED: the words the founder approved on 2026-10-08.
  en: {
    subject: (no, house) => `Order ${no} — ${house}`,
    greeting: (name) => (name ? `Hello ${name},` : "Hello,"),
    ref: (sku) => ` (your ref ${sku})`,
    unitMissing: " (unit not recorded)",
    pack: (n) => `, ${n} bottles each`,
    quantity: (n) => String(n),
    amount: (n) => n.toFixed(2),
    currencyMissing: "(currency not recorded)",
    price: (amount, per) => ` at ${amount}${per ? ` per ${per}` : ""}`,
    per: (uom, pack) => (pack && pack > 1 ? `${uom} of ${pack}` : uom),
    deliverTo: (a) => `Deliver to: ${a}`,
    neededBy: (d) => `Needed by: ${d}`,
    noDate: "Please tell us the delivery date you can make.",
    terms: (t) => `Payment terms you gave us: ${t}`,
    askConfirm: (no) => `Please confirm this order and the delivery date by reply, quoting ${no}.`,
    askPrice: (no) =>
      `We have no price on file for this order. Please reply with your price for each line, quoting ${no}.`,
    mudavym: (house) => `—\nThis message was drafted by Mudavym on behalf of ${house}.`,
  },
  // LOCKED: approved by the founder 2026-10-08. "siz" throughout; no suffix on a fact.
  tr: {
    subject: (no, house) => `Sipariş ${no} — ${house}`,
    greeting: (name) => (name ? `Merhaba ${name},` : "Merhaba,"),
    ref: (sku) => ` (sizdeki kod: ${sku})`,
    unitMissing: " (birim kayıtlı değil)",
    pack: (n) => `, her biri ${trNumber(n, null)} şişe`,
    quantity: (n) => trNumber(n, null),
    amount: (n) => trNumber(n, 2),
    currencyMissing: "(para birimi kayıtlı değil)",
    price: (amount, per) => `; ${per ? `${per} başına` : "birim fiyat"} ${amount}`,
    per: (uom, pack) => (pack && pack > 1 ? `${uom} (${trNumber(pack, null)} adet)` : uom),
    deliverTo: (a) => `Teslimat adresi: ${a}`,
    neededBy: (d) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
      return `İstenen teslim tarihi: ${m ? `${m[3]}.${m[2]}.${m[1]}` : d}`;
    },
    noDate: "Lütfen yapabileceğiniz teslim tarihini bize bildiriniz.",
    terms: (t) => `Bize bildirdiğiniz ödeme koşulları: ${t}`,
    askConfirm: (no) =>
      `Lütfen bu siparişi ve teslim tarihini, ${no} sipariş numarasını belirterek yanıtınızla onaylayınız.`,
    askPrice: (no) =>
      `Bu sipariş için kayıtlı bir fiyatımız bulunmuyor. Lütfen her kalem için fiyatınızı, ${no} sipariş numarasını belirterek yanıtınızla bildiriniz.`,
    mudavym: (house) => `—\nBu mesaj Mudavym tarafından ${house} adına hazırlanmıştır.`,
  },
};

function money(p: OrderRequestPrice, w: LetterWords, locale: OrderRequestLocale): string {
  const amount = `${w.amount(p.amount)} ${p.currency ?? w.currencyMissing}`;
  const uom = p.uom?.trim() ? unitWord(p.uom, 1, locale) : null;
  return w.price(amount, uom ? w.per(uom, p.packSize) : null);
}

function lineText(l: OrderRequestLine, showPrice: boolean, locale: OrderRequestLocale): string {
  const w = WORDS[locale];
  const ref = l.vendorSku ? w.ref(l.vendorSku) : "";
  const unit = l.unit?.trim() ? ` ${unitWord(l.unit, l.quantity, locale)}` : w.unitMissing;
  const pack = l.bottlesPerUnit != null && l.bottlesPerUnit > 1 ? w.pack(l.bottlesPerUnit) : "";
  const price =
    showPrice && l.price && Number.isFinite(l.price.amount) && l.price.amount > 0
      ? money(l.price, w, locale)
      : "";
  return `- ${l.name}${ref}: ${w.quantity(l.quantity)}${unit}${pack}${price}`;
}

/** The Mudavym line (F4, ADR 0266): always present, in the letter's language. */
export function mudavymLine(houseName: string, locale: OrderRequestLocale = "en"): string {
  return WORDS[locale].mudavym(houseName);
}

export interface OrderRequestRender {
  subject: string;
  body: string;
  /** Each block as rendered; "" for an optional block with nothing to say. */
  parts: Record<OrderRequestToken, string>;
  rendererVersion: string;
  locale: OrderRequestLocale;
  factsHash: string;
  priceShown: boolean;
  ask: "confirm" | "price";
  courtesyDropped: boolean;
}

export class OrderRequestTemplateRefused extends Error {
  constructor(readonly refusals: ProseRefusal[]) {
    super(refusals.map((r) => r.says).join(" "));
  }
}

export function renderOrderRequest(
  f: OrderRequestFacts,
  opts: { template?: string; courtesySentence?: string | null } = {},
): OrderRequestRender {
  const locale: OrderRequestLocale = f.locale ?? "en";
  const w = WORDS[locale];
  const template = opts.template ?? DEFAULT_ORDER_REQUEST_TEMPLATES[locale];
  const refused = orderRequestProseRefusals(template);
  if (refused.length > 0) throw new OrderRequestTemplateRefused(refused);
  if (f.lines.length === 0) {
    throw new Error("An order letter needs at least one line; this order has none written down.");
  }

  const showPrice = placerMayShowPrice(f.placer);
  const hasPrice = priceOnFile(f.lines);
  const courtesy = courtesyLineOrNull(opts.courtesySentence);
  // A placer with a role signs with the house; a NULL creator or a person with
  // no role here leaves the house alone as signer (fail closed, ADR 0313).
  const knownPlacer = f.placer.userId != null && f.placer.role != null && !!f.placer.name?.trim();

  const parts: Record<OrderRequestToken, string> = {
    greeting: w.greeting(f.vendorFirstName?.trim() || null),
    courtesy_line: courtesy ?? "",
    order_lines: f.lines.map((l) => lineText(l, showPrice, locale)).join("\n"),
    deliver_to: f.deliverTo?.trim() ? w.deliverTo(f.deliverTo.trim()) : "",
    needed_by: f.neededBy ? w.neededBy(f.neededBy) : w.noDate,
    payment_terms: f.paymentTerms?.trim() ? w.terms(f.paymentTerms.trim()) : "",
    // Only a letter with a price on file asks the vendor to confirm; with no
    // price it asks for one (last-agreement.ts:141-143, "nothing is assumed").
    ask: hasPrice ? w.askConfirm(f.orderNumber) : w.askPrice(f.orderNumber),
    signer: knownPlacer ? `${f.placer.name!.trim()}\n${f.houseName}` : f.houseName,
  };
  // A line that holds nothing but an empty optional block goes, with it.
  const filled = template
    .split("\n")
    .flatMap((line) => {
      const only = /^\s*\{\{\s*([a-z_]+)\s*\}\}\s*$/.exec(line);
      if (only && parts[only[1] as OrderRequestToken] === "") return [];
      return [line.replace(TOKEN_RE, (_m, k: string) => parts[k as OrderRequestToken])];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const subject =
    w.subject(f.orderNumber, f.houseName) +
    (f.lines.length === 1 ? ` — ${f.lines[0].name}` : "");

  return {
    subject,
    body: `${filled}\n\n${mudavymLine(f.houseName, locale)}`,
    locale,
    parts,
    rendererVersion: RENDERER_VERSION,
    factsHash: orderRequestFactsHash(f),
    priceShown: showPrice,
    ask: hasPrice ? "confirm" : "price",
    courtesyDropped: opts.courtesySentence != null && courtesy == null,
  };
}
