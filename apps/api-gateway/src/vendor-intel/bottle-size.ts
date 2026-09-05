/**
 * Reading a bottle's size off a vendor's page — the pure half.
 *
 * WHOSE QUESTION THIS ANSWERS
 * ---------------------------
 * `vendor-site-sighting.ts` refuses a scraped row that names no bottle size
 * (`no_bottle_volume`), because `normalizeUnitPrice`
 * (`analytics/engine/vendor-price-consensus.ts:132`) silently skips the volume
 * scaling when the volume is absent, so a 375ml half-bottle scraped without
 * its size enters the ladder at half its true per-750ml price and tops it.
 *
 * The founder asked on 2026-09-04 whether the sweep may take a size stated
 * ANYWHERE on the page rather than only beside the price, and said:
 * *"research do the best one if it was live SOTA"*.
 *
 * WHAT THE LIVE STATE OF THE ART ACTUALLY DOES
 * --------------------------------------------
 * Two commercial extractors publish how they answer this, and both were read
 * on 2026-09-04:
 *
 *  - **Zyte** (`zyte-common-items`, `zyte_common_items/items/product.py`,
 *    fetched 2026-09-04 from
 *    https://raw.githubusercontent.com/zytedata/zyte-common-items/main/zyte_common_items/items/product.py)
 *    ships the instruction it gives its own model, in order of preference:
 *    the size of *the default selected variant*, then *the most specific*,
 *    then *the most clarifying*, then *the most obvious one (e.g. introduced
 *    by a label like "Size", "Dimensions")* — and the product NAME only "as a
 *    very last resort … and only if you cannot find any other size
 *    information in the page." Its `additionalProperties` hint refuses
 *    cherry-picked pairs: a property counts only when it sits in a block that
 *    is "mostly key/value specifications". Zyte keeps `size` as the raw
 *    displayed string and does not normalise it.
 *  - **Diffbot**'s Product API returns `size` with its own caveat — "Highly
 *    experimental and often unreliable"
 *    (https://diffbot-php-client-docs.readthedocs.io/en/latest/api-product.html,
 *    fetched 2026-09-04).
 *
 * So the state of the art is not a magic field. It is a RANKED set of
 * identified places, the raw string kept beside the number, and the title last.
 * That is what this file implements, with one addition the two extractors do
 * not need and this register does: a refusal, because a wrong volume here is
 * not a blank cell in a dataset, it is a false best price on a ladder a person
 * acts on.
 *
 * WHY "ANYWHERE ON THE PAGE" IS NOT WHAT WE BUILT, AND THE MEASUREMENT THAT
 * SETTLED IT
 * -----------------------------------------------------------------------
 * On 2026-09-04 all 23 of the sweep's vendor sites were fetched (robots.txt
 * first, our own UA, 10s per host). Three of the recorded websites no longer
 * belong to the vendor at all: `www.banfivintners.com` now redirects to
 * `dtoto5000.com`, an online-gambling site; `www.henrywine.com` resolves to
 * `vinology.com`, a wine school; and `www.sevilen.com` — filed as the Turkish
 * winery Sevilen Şarapçılık — is a women's clothing shop whose product URLs
 * carry `beden=s` ("size: S"). A reader that took "a size stated anywhere on
 * the page" would have read a dress size and a casino's numbers under a wine
 * vendor's name. Every candidate this file produces therefore names WHERE it
 * was read, and free text that is not attached to a product, a variant, a
 * labelled field or the product's own name is not a candidate at all.
 *
 * WHY THIS RUNS ON THE MARKUP AND NOT ON THE MODEL'S OUTPUT
 * --------------------------------------------------------
 * `htmlToText` (`common/html/html-to-text.ts`) drops the CONTENTS of
 * `<script>`, deliberately and correctly — inline analytics payloads are full
 * of numbers that read like prices. But schema.org JSON-LD lives inside
 * `<script type="application/ld+json">`, so at HEAD the model that reads a
 * vendor page has never once been shown the page's structured data. Every
 * `Bottle Volume` a merchant publishes was being thrown away before the model
 * saw it. This module reads the markup itself, so that stops.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Where a size was read. The order of this list IS the precedence. */
export type VolumeSource =
  | "structured_offer"
  | "variant_option"
  | "unit_price_label"
  | "spec_field"
  | "title";

/**
 * The precedence, tightest binding first.
 *
 * The ordering principle is not "most machine-readable" — it is **how tightly
 * the statement is bound to the price we are about to record**, because the
 * only thing a sighting must never get wrong is which unit its number is in.
 *
 *  1. `structured_offer` — a volume inside the same schema.org Product/Offer
 *     node as the price. Same node, so the binding is the publisher's own.
 *  2. `variant_option` — the option label of the variant the price belongs to
 *     ("1x75cl"). Zyte puts the selected variant first for the same reason.
 *  3. `unit_price_label` — the per-litre / per-75cl figure printed beside the
 *     selling price. In the EU and the UK this figure is compulsory (Directive
 *     98/6/EC art. 3; Price Marking Order 2004 art. 5 and sch. 1, which sets
 *     the wine unit at **75 cl**), so where it exists it is a legal statement
 *     about this very price. It is third and not first because it yields the
 *     bottle size only by arithmetic on two rounded figures — see
 *     `deriveFromUnitPrice`.
 *  4. `spec_field` — a labelled key/value in the page's own specification
 *     block. Zyte's "most obvious one (introduced by a label)".
 *  5. `title` — the product's own name. Last, exactly as Zyte instructs.
 */
export const VOLUME_SOURCE_ORDER: readonly VolumeSource[] = Object.freeze([
  "structured_offer",
  "variant_option",
  "unit_price_label",
  "spec_field",
  "title",
]);

/**
 * Nominal quantities that a wine or spirit bottle is permitted to be.
 *
 * Not a taste list: Directive 2007/45/EC lays down the ranges of nominal
 * quantities for prepackaged wine and spirits, and within its ranges the
 * quantities are exhaustive (EUR-Lex CELEX:32007L0045, Annex point 1, fetched
 * 2026-09-04). Quoted from the Annex:
 *
 *   still wine        100 · 187 · 250 · 375 · 500 · 750 · 1000 · 1500 ml
 *   yellow wine       620 ml
 *   sparkling wine    125 · 200 · 375 · 750 · 1500 ml
 *   liqueur wine      100 · 200 · 375 · 500 · 750 · 1000 · 1500 ml
 *   aromatised wine   100 · 200 · 375 · 500 · 750 · 1000 · 1500 ml
 *   spirit drinks     100 · 200 · 350 · 500 · 700 · 1000 · 1500 · 1750 · 2000 ml
 *
 * The second list is the formats that trade outside that Annex's reach — large
 * formats, the US and Japanese sizes, beer and cider containers. It is a
 * measured-and-extended version of the `KNOWN_FORMATS` list that already lives
 * in `vendor-page-extraction.ts`, which carried no source at all.
 *
 * Used for exactly two things, and never as a refusal: snapping a unit-price
 * derivation (below), and flagging an unusual format on the row. An
 * unrecognised volume that a page STATES is still read — plenty of real
 * formats exist outside any list, and dropping one silently would make a 1.5L
 * rank as a 750ml.
 */
export const EU_PRESCRIBED_VOLUMES_ML: readonly number[] = Object.freeze([
  100, 125, 187, 200, 250, 350, 375, 500, 620, 700, 750, 1000, 1500, 1750, 2000,
]);
export const TRADE_FORMATS_ML: readonly number[] = Object.freeze([
  50, 180, 300, 330, 355, 360, 473, 550, 650, 720, 3000, 4500, 5000, 6000, 9000,
  12000, 15000, 18000,
]);
export const NOMINAL_VOLUMES_ML: readonly number[] = Object.freeze(
  Array.from(new Set([...EU_PRESCRIBED_VOLUMES_ML, ...TRADE_FORMATS_ML])).sort(
    (a, b) => a - b,
  ),
);

/** A bottle smaller or larger than this is not a bottle; the band is wide on
 * purpose — 2cl samples and 18l Melchiors both exist. `parseVolumeMl`
 * (`vendor-page-extraction.ts:157`) already caps at 30_000 and this agrees. */
export const MIN_BOTTLE_ML = 20;
export const MAX_BOTTLE_ML = 30_000;

/** Text unit → millilitres. Keys are compared lowercased. */
const TEXT_UNIT_ML: Readonly<Record<string, number>> = Object.freeze({
  ml: 1,
  mls: 1,
  millilitre: 1,
  millilitres: 1,
  milliliter: 1,
  milliliters: 1,
  cl: 10,
  cls: 10,
  centilitre: 10,
  centilitres: 10,
  centiliter: 10,
  centiliters: 10,
  l: 1000,
  lt: 1000,
  ltr: 1000,
  litre: 1000,
  litres: 1000,
  liter: 1000,
  liters: 1000,
});

/**
 * UN/CEFACT Recommendation 20 common codes, which is what schema.org's
 * `unitCode` asks for. LTR / MLT / CLT confirmed against the published code
 * list (datasets/unece-units-of-measure, fetched 2026-09-04):
 * "litre,,1,l" LTR · "millilitre,,1S,ml" MLT · "centilitre,,1S,cl" CLT.
 * Case-sensitive on purpose: `MLT` is a code, `ml` is a word, and treating
 * them as the same token is how a `L` (a code that does NOT exist) would slip
 * through as litres.
 */
const UNIT_CODE_ML: Readonly<Record<string, number>> = Object.freeze({
  MLT: 1,
  CLT: 10,
  LTR: 1000,
  DLT: 100,
  // US fluid ounce, for the American shops that post in it.
  OZA: 29.5735295625,
});

/** One US fluid ounce. Bare "oz" is NOT accepted — see `parseVolume`. */
const FLUID_OUNCE_ML = 29.5735295625;

/** A number with a volume unit, anywhere inside a short piece of text. */
const VOLUME_IN_TEXT =
  /(?<![\w.,])(\d{1,5}(?:[.,]\d{1,3})?)\s{0,3}(ml|mls|cl|cls|l|lt|ltr|litres?|liters?|millilitres?|milliliters?|centilitres?|centiliters?|fl\.?\s?oz\.?|fluid\s?ounces?)(?![a-z0-9])/gi;

/** "6 x 75cl", "1x75cl", "12 × 75 cl" — a pack and a volume in one statement. */
const PACK_TIMES_VOLUME =
  /(?<![\w.])(\d{1,3})\s{0,2}[x×]\s{0,2}(\d{1,5}(?:[.,]\d{1,3})?)\s{0,3}(ml|cl|l|lt|litres?|liters?|centilitres?|centiliters?|millilitres?|milliliters?)(?![a-z0-9])/i;

/** "Bottle size cl: 75" — the LABEL names the unit and the value is bare.
 * Tanners writes exactly this, in a `title` attribute. */
const LABEL_CARRIES_UNIT =
  /(bottle\s?size|volume|capacity|content|contenance|inhalt|hacim)\s{0,2}\(?\s{0,2}(ml|cl|l|litres?|liters?)\s{0,2}\)?\s{0,3}[:=]\s{0,3}(\d{1,5}(?:[.,]\d{1,4})?)(?![\d])/i;

/**
 * An attribute whose value is a LABELLED field: a label word, optionally its
 * unit in brackets, then a colon or an equals sign. "Bottle size cl: 75" is
 * one; "Caymus Napa Valley Cabernet Sauvignon (1 Liter Bottle) 2023" is not.
 *
 * The distinction is load-bearing and was found by measurement: Wine Chateau
 * puts the whole product name in a `title=` attribute, and an earlier version
 * of this file — which only asked whether the attribute CONTAINED a label word
 * — read that name as a specification field and promoted a title-grade
 * statement two levels up the precedence. The precedence is only worth having
 * if each level means what it says.
 */
const ATTRIBUTE_IS_LABELLED_FIELD =
  /(?:^|[^a-z])(bottle\s?size|bottle\s?volume|net\s?content|contenance|f(?:ü|u)llmenge|inhalt|hacim|volume|capacity|format|size)\s{0,3}(?:\(?\s{0,2}(?:ml|cl|l|litres?|liters?)\s{0,2}\)?)?\s{0,3}[:=]/i;

/**
 * A specification label that means "how much liquid is in this container".
 *
 * `size` alone is deliberately ABSENT from the class-segment test below,
 * though it IS accepted as a written label. Measured reason: Tanners' page
 * carries `class="badge badge--0 non-standard-size top left"` on a NEIGHBOURING
 * product's 70cl badge, so a class containing the substring "size" is not
 * evidence about this product.
 */
const VOLUME_LABEL_WORDS =
  /\b(bottle\s?size|bottle\s?volume|dutiable\s?volume|net\s?content|netto|volume|capacity|contenance|f(?:ü|u)llmenge|inhalt|formato|hacim|(?:ş|s)i(?:ş|s)e\s?hacmi|size|format|bottle)\b/i;

/** Class/id segments that name a volume field on their own. */
const VOLUME_CLASS_SEGMENTS = new Set([
  "volume",
  "bottlevolume",
  "bottlesize",
  "capacity",
  "netcontent",
  "contenance",
  "fullmenge",
  "inhalt",
  "hacim",
]);

export interface SizeCandidate {
  source: VolumeSource;
  /** The volume, in millilitres, as the page states it. Never a default. */
  ml: number;
  /** The page's own words, verbatim, trimmed only of surrounding whitespace. */
  statement: string;
  /** Where on the page it was read, precisely enough to go and look. */
  locator: string;
  /** The pack size the SAME statement names, when it names one ("6 x 75cl"). */
  packFromStatement: number | null;
  /** The product this statement was attached to, when the page attaches it. */
  boundTo: string | null;
}

/** A unit price printed on the page, with the quantity it refers to. */
export interface UnitPriceLabel {
  amount: number;
  referenceMl: number;
  statement: string;
  /** Character offset in the page text, for the proximity test. */
  offset: number;
}

/** A schema.org product node found in the markup, with its identity. */
export interface ProductNode {
  name: string | null;
  sku: string | null;
  mpn: string | null;
  url: string | null;
  locator: string;
  /** Volume statements carried INSIDE this node. */
  statements: Array<{ ml: number; statement: string; locator: string }>;
}

export interface PageSizeEvidence {
  productNodes: ProductNode[];
  /** Candidates that are not attached to a schema.org product node. */
  loose: SizeCandidate[];
  unitPriceLabels: UnitPriceLabel[];
  /** Selling prices seen in the text, for the unit-price proximity test. */
  priceOffsets: Array<{ amount: number; offset: number }>;
  titles: string[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Parsing one statement
// ---------------------------------------------------------------------------

/**
 * "1,500 ml" is fifteen hundred millilitres; "1,5 l" is one and a half litres;
 * "0,375 l" is a French half-bottle. The comma is genuinely ambiguous and the
 * unit is what settles it, so the unit is passed in:
 *
 *   - a leading `0,` is always a decimal comma — nobody writes nought thousand;
 *   - with a LITRE unit the comma is a decimal comma, because a bottle is
 *     never a thousand litres;
 *   - with ml or cl and exactly three digits after it, it is a thousands
 *     separator.
 *
 * Reading "0,375 l" as 375 litres — which an earlier cut of this function did
 * — produces a number outside the bottle band and therefore a silent refusal,
 * which is the quiet kind of wrong: the row simply disappears.
 */
function toNumber(raw: string, unitMl?: number): number | null {
  const t = raw.trim();
  const looksLikeThousands = /^[1-9]\d{0,1},\d{3}$/.test(t);
  const unitIsLitres = unitMl !== undefined && unitMl >= 1000;
  const normalised =
    looksLikeThousands && !unitIsLitres
      ? t.replace(",", "")
      : t.replace(",", ".");
  const n = Number(normalised);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unitFactor(unitRaw: string): number | null {
  const u = unitRaw.toLowerCase().replace(/[\s.]/g, "");
  if (u === "floz" || u === "fluidounce" || u === "fluidounces")
    return FLUID_OUNCE_ML;
  return TEXT_UNIT_ML[u] ?? null;
}

/**
 * Read every volume stated in a short piece of text.
 *
 * Bare `oz` is refused. On a drinks page `oz` is usually a fluid ounce, but it
 * is also how weight is written, and a sighting that guessed wrong would be
 * off by a factor of nothing visible — the number would simply be somewhat
 * wrong, which is worse than absent. `fl oz` is unambiguous and is accepted.
 */
export function parseVolumes(
  text: string,
): Array<{ ml: number; statement: string }> {
  if (typeof text !== "string" || !text) return [];
  const out: Array<{ ml: number; statement: string }> = [];
  const slice = text.length > 4000 ? text.slice(0, 4000) : text;

  const labelled = slice.match(LABEL_CARRIES_UNIT);
  if (labelled) {
    const f = unitFactor(labelled[2]);
    const n = toNumber(labelled[3], f ?? undefined);
    if (f !== null && n !== null) {
      const ml = Math.round(n * f);
      if (ml >= MIN_BOTTLE_ML && ml <= MAX_BOTTLE_ML)
        out.push({ ml, statement: labelled[0].trim() });
    }
  }

  VOLUME_IN_TEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = VOLUME_IN_TEXT.exec(slice)) !== null && guard++ < 64) {
    const f = unitFactor(m[2]);
    const n = toNumber(m[1], f ?? undefined);
    if (f === null || n === null) continue;
    const ml = Math.round(n * f);
    if (ml < MIN_BOTTLE_ML || ml > MAX_BOTTLE_ML) continue;
    out.push({ ml, statement: m[0].trim() });
  }
  return out;
}

/** The single volume a statement names, or null when it names none or many. */
export function parseVolume(
  text: string,
): { ml: number; statement: string; pack: number | null } | null {
  const pack = text.match(PACK_TIMES_VOLUME);
  if (pack) {
    const f = unitFactor(pack[3]);
    const n = toNumber(pack[2], f ?? undefined);
    const p = Number(pack[1]);
    if (f !== null && n !== null && Number.isInteger(p) && p >= 1) {
      const ml = Math.round(n * f);
      if (ml >= MIN_BOTTLE_ML && ml <= MAX_BOTTLE_ML)
        return { ml, statement: pack[0].trim(), pack: p };
    }
  }
  const all = parseVolumes(text);
  if (all.length === 0) return null;
  const distinct = new Set(all.map((a) => a.ml));
  if (distinct.size > 1) return null;
  return { ml: all[0].ml, statement: all[0].statement, pack: null };
}

/** The nearest permitted nominal quantity, when one is within `tolerance`. */
/**
 * The nearest permitted nominal quantity, when one is within `tolerance`.
 *
 * WHY 1% AND NOT 2%. The closest pair on the combined list is 700ml and 720ml,
 * 2.86% apart; a 2% window around 730 reaches 720 and would snap a derivation
 * that means neither. 1% cannot bridge any pair on the list, and it is still
 * far wider than the rounding a unit-price derivation introduces: both inputs
 * are rounded to the currency's minor unit, which on a realistic wine price is
 * under half a per cent of the quotient.
 */
export function snapToNominal(
  ml: number,
  tolerance = 0.01,
): number | null {
  let best: number | null = null;
  let bestErr = Infinity;
  for (const n of NOMINAL_VOLUMES_ML) {
    const err = Math.abs(ml - n) / n;
    if (err < bestErr) {
      bestErr = err;
      best = n;
    }
  }
  return best !== null && bestErr <= tolerance ? best : null;
}

export function isNominalVolume(ml: number): boolean {
  return NOMINAL_VOLUMES_ML.includes(ml);
}

// ---------------------------------------------------------------------------
// Harvesting the page — once per page, before any row is judged
// ---------------------------------------------------------------------------

/** Longest input we will scan. A page beyond this is truncated, not refused. */
const MAX_HTML = 2_000_000;

/** How far a unit-price label may sit from the selling price and still be
 * read as a statement ABOUT that price. Hedonism's page prints "£2.87 per
 * 75cl bottle" in a duty table 20kB away from the product's own price; without
 * this test that table derives a 25-litre bottle. */
const UNIT_PRICE_PROXIMITY_CHARS = 400;

function scriptBodies(
  html: string,
  where: (openTag: string) => boolean,
  cap = 40,
): Array<{ body: string; openTag: string; offset: number }> {
  const out: Array<{ body: string; openTag: string; offset: number }> = [];
  let i = 0;
  while (out.length < cap) {
    const start = html.indexOf("<script", i);
    if (start < 0) break;
    const gt = html.indexOf(">", start);
    if (gt < 0) break;
    const openTag = html.slice(start, gt + 1);
    // Find the closing tag, tolerating "</script >".
    let end = -1;
    let j = gt + 1;
    for (;;) {
      const k = html.indexOf("</", j);
      if (k < 0) break;
      const m = /^<\/\s{0,4}script\s{0,4}>/i.exec(html.slice(k, k + 20));
      if (m) {
        end = k;
        j = k + m[0].length;
        break;
      }
      j = k + 2;
    }
    if (end < 0) break;
    if (where(openTag))
      out.push({ body: html.slice(gt + 1, end), openTag, offset: start });
    i = j;
  }
  return out;
}

/** Parse the JSON objects in a script body, whether or not the body IS JSON. */
function jsonObjectsIn(body: string, cap = 4): any[] {
  const out: any[] = [];
  const direct = tryParse(body);
  if (direct !== undefined) {
    out.push(direct);
    return out;
  }
  let i = 0;
  while (out.length < cap && i < body.length) {
    const start = body.indexOf("{", i);
    if (start < 0) break;
    const end = matchingBrace(body, start);
    if (end < 0) break;
    const v = tryParse(body.slice(start, end + 1));
    if (v !== undefined) out.push(v);
    i = end + 1;
  }
  return out;
}

function tryParse(s: string): any | undefined {
  const t = s.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return undefined;
  if (t.length > 4_000_000) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/**
 * The nearest enclosing JSON object around `anchor`, or null.
 *
 * Walks back over at most `MAX_BACKTRACK` characters trying each `{` as a
 * candidate start. The first one whose braces balance past the anchor AND
 * whose slice parses as JSON with a `variants` array is the object. Bounded in
 * both directions so a hostile page cannot make this quadratic.
 */
function enclosingJsonObject(body: string, anchor: number): any | null {
  const MAX_BACKTRACK = 300_000;
  const MAX_TRIES = 400;
  let tries = 0;
  for (let k = anchor; k >= 0 && anchor - k < MAX_BACKTRACK && tries < MAX_TRIES; k--) {
    if (body[k] !== "{") continue;
    tries++;
    const end = matchingBrace(body, k);
    if (end < anchor) continue;
    const v = tryParse(body.slice(k, end + 1));
    if (v && typeof v === "object" && Array.isArray((v as any).variants)) return v;
  }
  return null;
}

/** Index of the `}` closing the `{` at `start`, respecting strings/escapes. */
function matchingBrace(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function asText(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function typeList(node: any): string[] {
  const t = node?.["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x) => typeof x === "string");
  return [];
}

/**
 * A schema.org QuantitativeValue → millilitres, using its `unitCode`
 * (UN/CEFACT) or its `unitText`. Returns null when the unit is not a volume,
 * which is the correct answer for a weight, a length or a bare number.
 */
function quantitativeToMl(
  v: any,
): { ml: number; statement: string } | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") {
    const p = parseVolume(String(v));
    return p ? { ml: p.ml, statement: p.statement } : null;
  }
  if (typeof v !== "object") return null;
  const value = Number(v.value ?? v.minValue);
  const code = asText(v.unitCode);
  const text = asText(v.unitText);
  if (Number.isFinite(value) && value > 0) {
    const f =
      (code && UNIT_CODE_ML[code]) ??
      (text ? unitFactor(text) : null) ??
      (code ? unitFactor(code) : null);
    if (f) {
      const ml = Math.round(value * f);
      if (ml >= MIN_BOTTLE_ML && ml <= MAX_BOTTLE_ML)
        return { ml, statement: `${v.value} ${code ?? text ?? ""}`.trim() };
    }
  }
  const name = asText(v.name) ?? asText(v.description);
  if (name) {
    const p = parseVolume(name);
    if (p) return { ml: p.ml, statement: p.statement };
  }
  return null;
}

/**
 * The volume statements carried inside one schema.org product node.
 *
 * `weight` is deliberately NOT read, and this is the single most important
 * omission in the file. Measured on 2026-09-04: Tanners publishes
 * `"weight": 75000` on a 75cl champagne, Slurp `2000` on a 75cl rosé,
 * Hedonism `1500` on a 75cl champagne and Wine Chateau `2722` on a 1L
 * cabernet. Not one of those is the liquid; three of the four are shipping
 * weights in grams and the fourth is 75cl typed into the wrong box. A reader
 * that took `weight` would have priced all four wrongly and none of them
 * visibly.
 */
function statementsInNode(
  node: any,
  locator: string,
): Array<{ ml: number; statement: string; locator: string }> {
  const out: Array<{ ml: number; statement: string; locator: string }> = [];
  const push = (
    r: { ml: number; statement: string } | null,
    where: string,
  ) => {
    if (r) out.push({ ...r, locator: `${locator}.${where}` });
  };

  const props = Array.isArray(node?.additionalProperty)
    ? node.additionalProperty
    : node?.additionalProperty
      ? [node.additionalProperty]
      : [];
  for (const p of props.slice(0, 64)) {
    const name = asText(p?.name);
    if (!name || !VOLUME_LABEL_WORDS.test(name)) continue;
    const raw = p?.value;
    // "Dutiable Volume (ml)" : "750.0000" — the LABEL carries the unit and the
    // value is bare. Handing the pair over as one string lets
    // LABEL_CARRIES_UNIT read it; handing the value alone reads nothing, which
    // is how BBR's second, more precise statement was being dropped.
    const bare =
      (typeof raw === "number" || (typeof raw === "string" && /^[\d.,\s]+$/.test(raw))) &&
      /(ml|cl|l|litres?|liters?)/i.test(name);
    push(
      quantitativeToMl(bare ? `${name}: ${raw}` : raw),
      `additionalProperty[${name}]`,
    );
  }

  const measurements = Array.isArray(node?.hasMeasurement)
    ? node.hasMeasurement
    : node?.hasMeasurement
      ? [node.hasMeasurement]
      : [];
  for (const m of measurements.slice(0, 16))
    push(quantitativeToMl(m), "hasMeasurement");

  push(quantitativeToMl(node?.size), "size");
  push(quantitativeToMl(node?.netContent ?? node?.["gs1:netContent"]), "netContent");

  return out;
}

function collectProductNodes(
  root: any,
  locator: string,
  out: ProductNode[],
  depth = 0,
): void {
  if (!root || typeof root !== "object" || depth > 8 || out.length > 64) return;
  if (Array.isArray(root)) {
    root.slice(0, 64).forEach((x, i) =>
      collectProductNodes(x, `${locator}[${i}]`, out, depth + 1),
    );
    return;
  }
  const types = typeList(root);
  if (types.some((t) => /product/i.test(t))) {
    out.push({
      name: asText(root.name),
      sku: asText(root.sku),
      mpn: asText(root.mpn),
      url: asText(root.url),
      locator,
      statements: statementsInNode(root, locator),
    });
  }
  for (const key of ["@graph", "hasVariant", "isVariantOf", "itemListElement", "item", "mainEntity"]) {
    if (root[key] !== undefined)
      collectProductNodes(root[key], `${locator}.${key}`, out, depth + 1);
  }
}

/**
 * Attribute value from an open tag, or null. Bounded scan, no backtracking.
 *
 * The patterns are built once and cached: this runs against every open tag on
 * every page, and constructing a RegExp per tag per attribute name was roughly
 * a third of a million allocations on an 800 kB page for no gain.
 */
const ATTR_PATTERNS = new Map<string, RegExp>();
function attrPattern(name: string): RegExp {
  let re = ATTR_PATTERNS.get(name);
  if (!re) {
    re = new RegExp(
      `\\b${name}\\s{0,2}=\\s{0,2}("([^"]{0,400})"|'([^']{0,400})')`,
      "i",
    );
    ATTR_PATTERNS.set(name, re);
  }
  return re;
}

function attr(openTag: string, name: string): string | null {
  const m = openTag.match(attrPattern(name));
  if (!m) return null;
  return (m[2] ?? m[3] ?? "").trim() || null;
}

function classSegments(openTag: string): string[] {
  const c = `${attr(openTag, "class") ?? ""} ${attr(openTag, "id") ?? ""}`;
  return c
    .toLowerCase()
    .split(/[^a-z0-9ğüşöçı]+/)
    .filter(Boolean);
}

/** The handful of entities that appear in a product title. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d{2,5});/g, (_, d) => String.fromCharCode(Number(d)))
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]{0,600}>/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Read every place on the page that states a bottle size, once.
 *
 * Pure and context-free: it records WHAT the page says and WHERE, and attaches
 * each statement to the product the page attaches it to. Deciding which of
 * them applies to a given priced row is `readBottleSize`'s job, because that
 * decision needs the row and this parse needs only the page.
 */
export function readPageSizeEvidence(html: string): PageSizeEvidence {
  const notes: string[] = [];
  const productNodes: ProductNode[] = [];
  const loose: SizeCandidate[] = [];
  const unitPriceLabels: UnitPriceLabel[] = [];
  const priceOffsets: Array<{ amount: number; offset: number }> = [];
  const titles: string[] = [];

  if (typeof html !== "string" || !html) {
    return { productNodes, loose, unitPriceLabels, priceOffsets, titles, notes: ["Empty document."] };
  }
  const doc = html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;
  if (html.length > MAX_HTML)
    notes.push(`Document truncated to ${MAX_HTML} characters for the size read.`);

  // --- 1. schema.org, in <script type="application/ld+json"> ---------------
  const ldBlocks = scriptBodies(doc, (t) => /ld\+json/i.test(t));
  ldBlocks.forEach((b, i) => {
    for (const obj of jsonObjectsIn(b.body, 2))
      collectProductNodes(obj, `ld+json[${i}]`, productNodes);
  });
  if (ldBlocks.length === 0) notes.push("The page publishes no JSON-LD.");

  // --- 2. microdata ---------------------------------------------------------
  // itemprop="size" / "additionalProperty" carrying a content= value.
  const microRe =
    /<[a-z][a-z0-9-]{0,20}\b[^>]{0,600}itemprop\s{0,2}=\s{0,2}["'](size|volume|netContent|hasMeasurement)["'][^>]{0,600}>/gi;
  let mm: RegExpExecArray | null;
  let microGuard = 0;
  while ((mm = microRe.exec(doc)) !== null && microGuard++ < 32) {
    const tag = mm[0];
    const content = attr(tag, "content");
    const tail = stripTags(doc.slice(mm.index + tag.length, mm.index + tag.length + 200));
    const p = parseVolume(content ?? tail);
    if (p)
      loose.push({
        source: "spec_field",
        ml: p.ml,
        statement: p.statement,
        locator: `microdata itemprop=${mm[1]}`,
        packFromStatement: p.pack,
        boundTo: null,
      });
  }

  // --- 3. the platform's own product JSON (Shopify and friends) -------------
  //
  // These objects are rarely a whole script body. Measured on 2026-09-04:
  // Slurp ships them inside a theme JSON island, while Wine Chateau ships the
  // same product serialised inside two ordinary JavaScript programs — a Bold
  // subscriptions config and a tag-manager loader whose first statement holds
  // a regex literal containing braces. Scanning for the first `{` and matching
  // braces therefore fails on exactly the pages that need it. So the anchor is
  // the field we actually want, `"variants":[`, and the object is recovered by
  // walking back to the nearest `{` that both contains the anchor and parses.
  for (const s of scriptBodies(doc, () => true, 80)) {
    const whole = tryParse(s.body);
    if (whole !== undefined) {
      harvestVariantJson(whole, loose, notes, 0);
      continue;
    }
    let from = 0;
    let found = 0;
    while (found < 8) {
      const anchor = s.body.indexOf('"variants"', from);
      if (anchor < 0) break;
      const obj = enclosingJsonObject(s.body, anchor);
      if (obj) {
        harvestVariantJson(obj, loose, notes, 0);
        found++;
      }
      from = anchor + 10;
    }
  }

  // --- 4. labelled specification fields in the markup ------------------------
  const openTagRe = /<([a-z][a-z0-9-]{0,20})\b([^>]{0,800})>/gi;
  let ot: RegExpExecArray | null;
  let tagGuard = 0;
  while ((ot = openTagRe.exec(doc)) !== null && tagGuard++ < 60_000) {
    const openTag = ot[0];
    if (/^<(script|style|noscript|template)/i.test(openTag)) continue;

    for (const a of ["title", "aria-label", "data-volume", "data-bottle-size", "data-capacity", "data-size"]) {
      const v = attr(openTag, a);
      if (!v) continue;
      if (!a.startsWith("data-") && !ATTRIBUTE_IS_LABELLED_FIELD.test(v))
        continue;
      const p = parseVolume(v);
      if (p)
        loose.push({
          source: "spec_field",
          ml: p.ml,
          statement: p.statement,
          locator: `<${ot[1]} ${a}="${v.slice(0, 60)}">`,
          packFromStatement: p.pack,
          boundTo: null,
        });
    }

    const segs = classSegments(openTag);
    const classNames = `${attr(openTag, "class") ?? ""} ${attr(openTag, "id") ?? ""}`;
    // "size" on its own is not evidence — Tanners marks a NEIGHBOURING
    // product's 70cl badge `class="badge badge--0 non-standard-size"`. It is
    // evidence when the qualifier in front of it names the thing being
    // measured: Hedonism writes `class="text-block product__unit-size"`.
    // No `\b` in front: the qualifier is usually glued to a BEM prefix
    // (`product__unit-size`), and `_u` is not a word boundary in JavaScript.
    const qualifiedSize =
      /(unit|bottle|pack|container|format|net)[-_ ]?size(?![a-z0-9])/i.test(
        classNames,
      );
    if (segs.some((s) => VOLUME_CLASS_SEGMENTS.has(s)) || qualifiedSize) {
      const inner = stripTags(doc.slice(ot.index + openTag.length, ot.index + openTag.length + 400));
      const p = parseVolume(inner);
      if (p)
        loose.push({
          source: "spec_field",
          ml: p.ml,
          statement: p.statement,
          locator: `.${
            segs.filter((s) => VOLUME_CLASS_SEGMENTS.has(s)).join(".") ||
            (classNames.match(/[\w-]*(?:unit|bottle|pack|container|format|net)[-_ ]?size/i)?.[0] ?? "size")
          }`,
          packFromStatement: p.pack,
          boundTo: null,
        });
    }
  }

  // --- 5. the rendered text: written labels, unit prices, printed prices -----
  const text = renderText(doc);
  const labelRe =
    /(bottle\s?size|bottle\s?volume|net\s?content|contenance|f(?:ü|u)llmenge|inhalt|formato|(?:ş|s)i(?:ş|s)e\s?hacmi|hacim|volume|capacity|size|format)\s{0,2}[:\-–—]?[ \t]{0,3}\n?[ \t]{0,3}([^\n]{0,40})/gi;
  let lr: RegExpExecArray | null;
  let labelGuard = 0;
  while ((lr = labelRe.exec(text)) !== null && labelGuard++ < 400) {
    const p = parseVolume(lr[2]);
    if (!p) continue;
    loose.push({
      source: "spec_field",
      ml: p.ml,
      statement: `${lr[1]}: ${p.statement}`,
      locator: `text label "${lr[1]}"`,
      packFromStatement: p.pack,
      boundTo: null,
    });
  }

  const unitRe =
    /([$£€₺]\s{0,2}\d{1,5}(?:[.,]\d{1,2})?)\s{0,3}(?:\/|per|par|pro|je)\s{0,3}(\d{1,4}\s{0,2}(?:ml|cl|l|litres?|liters?)|litre|liter|litro)\b/gi;
  let ur: RegExpExecArray | null;
  let unitGuard = 0;
  while ((ur = unitRe.exec(text)) !== null && unitGuard++ < 200) {
    const amount = toNumber(ur[1].replace(/[^0-9.,]/g, ""));
    const refWord = ur[2].toLowerCase();
    const ref = /^(litre|liter|litro)$/.test(refWord)
      ? 1000
      : (parseVolume(refWord)?.ml ?? null);
    if (amount === null || ref === null) continue;
    unitPriceLabels.push({
      amount,
      referenceMl: ref,
      statement: ur[0].trim(),
      offset: ur.index,
    });
  }

  const priceRe = /[$£€₺]\s{0,2}(\d{1,5}(?:[.,]\d{2})?)/g;
  let pr: RegExpExecArray | null;
  let priceGuard = 0;
  while ((pr = priceRe.exec(text)) !== null && priceGuard++ < 3000) {
    const n = toNumber(pr[1]);
    if (n !== null) priceOffsets.push({ amount: n, offset: pr.index });
  }

  // --- 6. the page's own names ---------------------------------------------
  const t = /<title[^>]{0,200}>([\s\S]{0,300}?)<\/title>/i.exec(doc);
  if (t) {
    const v = decodeEntities(stripTags(t[1]));
    if (v) titles.push(v);
  }
  const ogRe = /<meta[^>]{0,600}(?:property|name)\s{0,2}=\s{0,2}["']og:title["'][^>]{0,600}>/gi;
  let og: RegExpExecArray | null;
  let ogGuard = 0;
  while ((og = ogRe.exec(doc)) !== null && ogGuard++ < 8) {
    const c = attr(og[0], "content");
    if (c) titles.push(decodeEntities(c));
  }

  return { productNodes, loose, unitPriceLabels, priceOffsets, titles, notes };
}

/**
 * Text as the model would see it, but WITHOUT dropping script contents twice.
 * Kept local rather than importing `htmlToText` so that this module has no
 * dependency on the extractor's own text budget, and so a change to that
 * budget cannot silently change what a size read can see.
 */
function renderText(html: string): string {
  let out = "";
  let i = 0;
  let guard = 0;
  while (i < html.length && guard++ < 400_000) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    const drop = /^<(script|style|noscript|template)\b/i.exec(html.slice(lt, lt + 12));
    if (drop) {
      const name = drop[1].toLowerCase();
      const closeRe = new RegExp(`</\\s{0,4}${name}\\s{0,4}>`, "i");
      const rest = html.slice(lt);
      const m = closeRe.exec(rest);
      i = m ? lt + m.index + m[0].length : html.length;
      out += "\n";
      continue;
    }
    const gt = html.indexOf(">", lt);
    if (gt < 0) break;
    out += /^<(\/?)(p|div|br|tr|li|h[1-6]|dt|dd|td|th|section|ul|ol|option|span)\b/i.test(
      html.slice(lt, lt + 12),
    )
      ? "\n"
      : " ";
    i = gt + 1;
  }
  return out
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d{2,5});/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]{2,}/g, " ");
}

/** Variants and options from a platform's embedded product JSON. */
function harvestVariantJson(
  obj: any,
  out: SizeCandidate[],
  notes: string[],
  depth: number,
): void {
  if (!obj || typeof obj !== "object" || depth > 6) return;
  if (Array.isArray(obj)) {
    obj.slice(0, 40).forEach((x) => harvestVariantJson(x, out, notes, depth + 1));
    return;
  }
  const variants = obj.variants;
  if (Array.isArray(variants) && variants.length) {
    const productName = asText(obj.title) ?? asText(obj.name) ?? null;
    const optionNames: string[] = Array.isArray(obj.options)
      ? obj.options
          .map((o: any) => (typeof o === "string" ? o : asText(o?.name)))
          .filter((x: any): x is string => typeof x === "string")
      : [];
    for (const v of variants.slice(0, 60)) {
      if (!v || typeof v !== "object") continue;
      // Shopify's own unit pricing: a declared measurement, not a parse.
      const upm = v.unit_price_measurement ?? v.unitPriceMeasurement;
      if (upm && String(upm.measured_type ?? upm.measuredType) === "volume") {
        const f = unitFactor(String(upm.quantity_unit ?? upm.quantityUnit ?? ""));
        const q = Number(upm.quantity_value ?? upm.quantityValue);
        if (f && Number.isFinite(q) && q > 0) {
          const ml = Math.round(q * f);
          if (ml >= MIN_BOTTLE_ML && ml <= MAX_BOTTLE_ML)
            out.push({
              source: "structured_offer",
              ml,
              statement: `${q} ${upm.quantity_unit ?? upm.quantityUnit}`,
              locator: "variants[].unit_price_measurement",
              packFromStatement: null,
              boundTo: productName,
            });
        }
      }
      const optionValues: string[] = Array.isArray(v.options)
        ? v.options.filter((x: any) => typeof x === "string")
        : [v.option1, v.option2, v.option3].filter(
            (x: any): x is string => typeof x === "string",
          );
      // An option NAMED for a size is the strongest of the option statements.
      optionValues.forEach((val, idx) => {
        const p = parseVolume(val);
        if (!p) return;
        const named = optionNames[idx];
        out.push({
          source: "variant_option",
          ml: p.ml,
          statement: p.statement,
          locator: named
            ? `variant option "${named}" = "${val}"`
            : `variant option "${val}"`,
          packFromStatement: p.pack,
          boundTo: productName,
        });
      });
      for (const key of ["title", "public_title", "name"]) {
        const val = asText(v[key]);
        if (!val) continue;
        const p = parseVolume(val);
        if (!p) continue;
        out.push({
          source: "variant_option",
          ml: p.ml,
          statement: p.statement,
          locator: `variants[].${key} = "${val.slice(0, 60)}"`,
          packFromStatement: p.pack,
          boundTo: productName,
        });
      }
    }
  }
  for (const k of Object.keys(obj).slice(0, 40)) {
    // `variants` was just read; recursing into it would file every statement
    // twice and make one page look like two agreeing pages.
    if (k === "variants" || k === "options") continue;
    const v = (obj as any)[k];
    if (v && typeof v === "object") harvestVariantJson(v, out, notes, depth + 1);
  }
}

// ---------------------------------------------------------------------------
// Deciding which statement applies to one priced row
// ---------------------------------------------------------------------------

const NAME_STOPWORDS = new Set([
  "the", "and", "de", "du", "di", "da", "le", "la", "les", "el", "of", "by",
  "vin", "wine", "wines", "bottle", "nv",
]);

export function normaliseName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normaliseName(s)
    .split(" ")
    .filter((t) => t.length > 1 && !NAME_STOPWORDS.has(t));
}

/**
 * Is this schema.org node about the row we are pricing?
 *
 * THE MEASUREMENT THAT MADE THIS GATE NECESSARY. On 2026-09-04
 * `https://www.bbr.com/products-20188000200-2018-champagne-dom-perignon-brut`
 * returned HTTP 200 with `<meta property="og:title" content="2018 Champagne
 * Dom Pérignon, Brut">`, the words "Dom P" 29 times in the body — and exactly
 * ONE JSON-LD block, describing *"Caol Ila, 25-Year-Old, Islay, Single Malt
 * Scotch Whisky (43%)"* at £225 with SKU `1000-01-00700-00-8086983`. A reader
 * that trusted structured data because it is structured would have filed a
 * 700ml whisky's size and price under a champagne. Structured data is the
 * highest-precedence SOURCE and the lowest-trust IDENTITY: it is machine
 * written, therefore it can be machine wrong, and nothing on the page says so.
 */
export function sameProduct(
  node: { name: string | null; sku: string | null; mpn: string | null },
  ctx: { productName: string | null; sku?: string | null },
): boolean {
  const nodeSku = (node.sku ?? node.mpn ?? "").trim().toLowerCase();
  const ctxSku = (ctx.sku ?? "").trim().toLowerCase();
  if (nodeSku && ctxSku && nodeSku === ctxSku) return true;

  const a = normaliseName(node.name);
  const b = normaliseName(ctx.productName);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const ta = new Set(tokens(a));
  const tb = tokens(b);
  if (ta.size === 0 || tb.length === 0) return false;
  const shared = tb.filter((t) => ta.has(t)).length;
  return shared / Math.min(ta.size, tb.length) >= 0.6;
}

export interface BottleSizeContext {
  /** The product name on the row being priced, as the page printed it. */
  productName: string | null;
  sku?: string | null;
  /** The printed price of that row, in the page's own currency. */
  price?: number | null;
}

export interface BottleSizeHit {
  read: true;
  ml: number;
  source: VolumeSource;
  statement: string;
  locator: string;
  /** The pack the winning statement itself names ("6 x 75cl" → 6). */
  packFromStatement: number | null;
  /** True when the volume is not one the EU Annex or the trade lists know. */
  nonStandardFormat: boolean;
  candidates: SizeCandidate[];
  notes: string[];
}

export interface BottleSizeMiss {
  read: false;
  reason: "no_bottle_volume" | "volume_conflict";
  message: string;
  candidates: SizeCandidate[];
  notes: string[];
}

export type BottleSizeReading = BottleSizeHit | BottleSizeMiss;

/**
 * Derive a bottle size from a legally-required unit price.
 *
 * bottle = reference × (selling price ÷ unit price). Both inputs are rounded
 * to the currency's minor unit before we ever see them, so the quotient is
 * approximate by construction: a 187ml quarter-bottle at £4.50 with a £18.04
 * per-75cl label derives 187.08ml, not 187. That is why the result is only
 * accepted when it lands within 2% of a quantity a bottle is actually allowed
 * to be (Directive 2007/45/EC), and is then SNAPPED to that quantity. Outside
 * the tolerance the derivation is discarded, not rounded — 2% of 750ml is
 * 15ml, and no legal format sits inside that window of another.
 *
 * The proximity test matters as much as the arithmetic: Hedonism's page prints
 * "£2.87 per 75cl bottle" in a duty-rates table. Against a £97 champagne that
 * derives a 25-litre bottle; the snap rejects it anyway, but the proximity test
 * means it is never even attempted.
 */
export function deriveFromUnitPrice(
  label: UnitPriceLabel,
  sellingPrice: number,
): { ml: number; raw: number } | null {
  if (!(label.amount > 0) || !(sellingPrice > 0)) return null;
  const raw = label.referenceMl * (sellingPrice / label.amount);
  if (!Number.isFinite(raw) || raw < MIN_BOTTLE_ML || raw > MAX_BOTTLE_ML)
    return null;
  const snapped = snapToNominal(raw);
  return snapped === null ? null : { ml: snapped, raw };
}

/**
 * Choose the statement that applies to this row, or refuse and say why.
 *
 * Two refusals, and they are different facts:
 *  - `no_bottle_volume` — the page states no size we can attach to this row.
 *  - `volume_conflict`  — the page states two, and they disagree. Guessing
 *    between them is exactly the failure this whole module exists to stop, so
 *    the row is refused with both statements named.
 */
export function readBottleSize(
  evidence: PageSizeEvidence,
  ctx: BottleSizeContext,
): BottleSizeReading {
  const notes = [...evidence.notes];
  const candidates: SizeCandidate[] = [];

  // 1. schema.org, gated on identity.
  const matching = evidence.productNodes.filter((n) => sameProduct(n, ctx));
  if (evidence.productNodes.length > 0 && matching.length === 0) {
    const named = evidence.productNodes
      .map((n) => n.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(" · ");
    notes.push(
      `The page's structured data names another product (${named || "unnamed"}), ` +
        `not ${JSON.stringify(ctx.productName ?? "")}; it was not read.`,
    );
  }
  for (const node of matching) {
    for (const s of node.statements) {
      candidates.push({
        source: "structured_offer",
        ml: s.ml,
        statement: s.statement,
        locator: s.locator,
        packFromStatement: null,
        boundTo: node.name,
      });
    }
  }

  // 2/4. everything harvested loose, filtered by whatever binding it carries.
  for (const c of evidence.loose) {
    if (c.boundTo && ctx.productName && !sameProduct(
      { name: c.boundTo, sku: null, mpn: null },
      ctx,
    ))
      continue;
    candidates.push(c);
  }

  // 3. the unit-price label, only beside this row's own price.
  if (typeof ctx.price === "number" && ctx.price > 0) {
    const near = evidence.priceOffsets.filter(
      (p) => Math.abs(p.amount - (ctx.price as number)) < 0.005,
    );
    for (const label of evidence.unitPriceLabels) {
      const beside = near.some(
        (p) => Math.abs(p.offset - label.offset) <= UNIT_PRICE_PROXIMITY_CHARS,
      );
      if (!beside) continue;
      const derived = deriveFromUnitPrice(label, ctx.price);
      if (!derived) continue;
      candidates.push({
        source: "unit_price_label",
        ml: derived.ml,
        statement: label.statement,
        locator: `unit price beside the selling price (derived ${derived.raw.toFixed(1)}ml, snapped to ${derived.ml}ml)`,
        packFromStatement: null,
        boundTo: null,
      });
    }
  }

  // 5. the product's own name, last, exactly as Zyte instructs.
  const nameSources: Array<{ text: string; where: string }> = [];
  if (ctx.productName) nameSources.push({ text: ctx.productName, where: "product name" });
  for (const t of evidence.titles) {
    if (sameProduct({ name: t, sku: null, mpn: null }, ctx))
      nameSources.push({ text: t, where: "page title" });
  }
  for (const n of nameSources) {
    const p = parseVolume(n.text);
    if (!p) continue;
    candidates.push({
      source: "title",
      ml: p.ml,
      statement: p.statement,
      locator: n.where,
      packFromStatement: p.pack,
      boundTo: ctx.productName,
    });
  }

  const deduped = dedupe(candidates);
  if (deduped.length === 0) {
    return {
      read: false,
      reason: "no_bottle_volume",
      message:
        `No bottle size could be read for ${JSON.stringify(ctx.productName ?? "")}: ` +
        `nothing on the page states one in a place that is attached to this row ` +
        `(checked, in order: ${VOLUME_SOURCE_ORDER.join(" → ")}).` +
        (notes.length ? ` ${notes.join(" ")}` : ""),
      candidates: [],
      notes,
    };
  }

  const ranked = [...deduped].sort(
    (a, b) =>
      VOLUME_SOURCE_ORDER.indexOf(a.source) - VOLUME_SOURCE_ORDER.indexOf(b.source),
  );
  const winner = ranked[0];
  const disagreeing = ranked.find((c) => c.ml !== winner.ml);
  if (disagreeing) {
    return {
      read: false,
      reason: "volume_conflict",
      message:
        `No sighting written for ${JSON.stringify(ctx.productName ?? "")}: the page ` +
        `states two different bottle sizes for it — ${winner.ml}ml from ` +
        `${winner.source} (${JSON.stringify(winner.statement)} at ${winner.locator}) ` +
        `and ${disagreeing.ml}ml from ${disagreeing.source} ` +
        `(${JSON.stringify(disagreeing.statement)} at ${disagreeing.locator}). ` +
        `Choosing between them would be a guess, and a wrong unit is a wrong price.`,
      candidates: ranked,
      notes,
    };
  }

  const packStatement =
    ranked.find((c) => c.ml === winner.ml && c.packFromStatement !== null)
      ?.packFromStatement ?? null;

  return {
    read: true,
    ml: winner.ml,
    source: winner.source,
    statement: winner.statement,
    locator: winner.locator,
    packFromStatement: packStatement,
    nonStandardFormat: !isNominalVolume(winner.ml),
    candidates: ranked,
    notes,
  };
}

function dedupe(cs: SizeCandidate[]): SizeCandidate[] {
  const seen = new Set<string>();
  const out: SizeCandidate[] = [];
  for (const c of cs) {
    const k = `${c.source}|${c.ml}|${c.locator}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
