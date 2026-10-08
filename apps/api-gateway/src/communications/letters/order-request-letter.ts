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
 *     and words, links, stray brackets, money-and-terms words and commitment
 *     phrases in the house's prose. It does NOT stop a figure by reference
 *     ("same price as last time") or a term in a language it does not list;
 *     the house's own reading is the backstop (0173:48, ADR 0313).
 */

import { createHash } from "node:crypto";
import { COMMITMENT_PATTERN_SOURCES } from "../../common/orchestrator/commitment-patterns";

/** Bumped whenever the same facts and template would render different text. */
export const RENDERER_VERSION = "order_request/1";

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

/**
 * The default words. F3 DRAFT — the founder has not approved them (W25 F3,
 * OPEN-DECISIONS OD-TBD). Written in the token form so 4a-ii can publish a
 * house version over it without the renderer changing.
 */
export const DEFAULT_ORDER_REQUEST_TEMPLATE_STATUS = "draft (W25 F3 open)";
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
  // PR-4b's flag ORDER_REQUEST_LETTER, off until F3 is answered and 4a-ii merges.
  armed: false,
  kind: ORDER_REQUEST_KIND,
} as const;

// ── Facts ───────────────────────────────────────────────────────────────────

export interface OrderRequestPrice {
  amount: number;
  /** ISO code, or null when the line stated none. Never filled in. */
  currency: string | null;
  /** What one price buys ("bottle", "case of 6"), or null when unstated. */
  per: string | null;
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
}

// ── The prose predicate ─────────────────────────────────────────────────────

export interface ProseRefusal {
  rule:
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
const URL_RE =
  /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|(?<![\p{L}\p{N}_])[\p{L}\p{N}-]+\.(?:com|net|org|io|co|tr|uk|de|fr|it|es|eu|info|biz|app|shop|wine|me|us)(?![\p{L}\p{N}_])|@)/iu;
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
 * Every reason the house's prose in `template` may not be used, empty when it
 * may. "Prose" is everything outside the tokens. Run over the default here, and
 * at save and publish in 4a-ii.
 */
export function orderRequestProseRefusals(template: string): ProseRefusal[] {
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
  if (URL_RE.test(prose)) {
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
  const line = normaliseProse(sentence).replace(/\s+/g, " ").trim();
  if (!line || line.length > 240) return null;
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
    placer: { userId: f.placer.userId, name: f.placer.name, role: f.placer.role },
    priceShown: placerMayShowPrice(f.placer),
    deliverTo: f.deliverTo,
    neededBy: f.neededBy,
    paymentTerms: f.paymentTerms,
  };
  return createHash("sha256").update(JSON.stringify(canonical(facts))).digest("hex");
}

function money(p: OrderRequestPrice): string {
  const fixed = p.amount.toFixed(2);
  const amount = p.currency ? `${fixed} ${p.currency}` : `${fixed} (currency not recorded)`;
  return p.per ? `${amount} per ${p.per}` : amount;
}

function lineText(l: OrderRequestLine, showPrice: boolean): string {
  const ref = l.vendorSku ? ` (your ref ${l.vendorSku})` : "";
  const unit = l.unit ? ` ${l.unit}` : " (unit not recorded)";
  const pack =
    l.bottlesPerUnit != null && l.bottlesPerUnit > 1 ? `, ${l.bottlesPerUnit} bottles each` : "";
  const price =
    showPrice && l.price && Number.isFinite(l.price.amount) && l.price.amount > 0
      ? ` at ${money(l.price)}`
      : "";
  return `- ${l.name}${ref}: ${l.quantity}${unit}${pack}${price}`;
}

/** The Mudavym line (F4, ADR 0266): today's words, always present. */
export function mudavymLine(houseName: string): string {
  return `—\nThis message was drafted by Mudavym on behalf of ${houseName}.`;
}

export interface OrderRequestRender {
  subject: string;
  body: string;
  /** Each block as rendered; "" for an optional block with nothing to say. */
  parts: Record<OrderRequestToken, string>;
  rendererVersion: string;
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
  const template = opts.template ?? DEFAULT_ORDER_REQUEST_TEMPLATE;
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
    greeting: f.vendorFirstName?.trim() ? `Hello ${f.vendorFirstName.trim()},` : "Hello,",
    courtesy_line: courtesy ?? "",
    order_lines: f.lines.map((l) => lineText(l, showPrice)).join("\n"),
    deliver_to: f.deliverTo?.trim() ? `Deliver to: ${f.deliverTo.trim()}` : "",
    needed_by: f.neededBy
      ? `Needed by: ${f.neededBy}`
      : "Please tell us the delivery date you can make.",
    payment_terms: f.paymentTerms?.trim() ? `Payment terms you gave us: ${f.paymentTerms.trim()}` : "",
    // Only a letter with a price on file asks the vendor to confirm; with no
    // price it asks for one (last-agreement.ts:141-143, "nothing is assumed").
    ask: hasPrice
      ? `Please confirm this order and the delivery date by reply, quoting ${f.orderNumber}.`
      : `We have no price on file for this order. Please reply with your price for each line, quoting ${f.orderNumber}.`,
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
    `Order ${f.orderNumber} — ${f.houseName}` +
    (f.lines.length === 1 ? ` — ${f.lines[0].name}` : "");

  return {
    subject,
    body: `${filled}\n\n${mudavymLine(f.houseName)}`,
    parts,
    rendererVersion: RENDERER_VERSION,
    factsHash: orderRequestFactsHash(f),
    priceShown: showPrice,
    ask: hasPrice ? "confirm" : "price",
    courtesyDropped: opts.courtesySentence != null && courtesy == null,
  };
}
