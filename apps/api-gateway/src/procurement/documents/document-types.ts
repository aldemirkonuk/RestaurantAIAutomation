/**
 * document-types — the vocabulary of the procurement document spine.
 *
 * Every list here mirrors a CHECK constraint in
 * supabase/migrations/20260727120000_procurement_document_spine.sql. They are
 * kept in one file, and exported as const so a typo is a compile error rather
 * than a runtime insert failure: a varchar+CHECK column whose allowed values
 * drift from the code fails at write time, in production, silently from the
 * caller's point of view.
 */

/**
 * The documents in a delivery, in the order they exist in the real world.
 *
 *   purchase_order    what we asked for            (EDI 850)
 *   packing_slip      what the distributor shipped (EDI 856 / ASN)
 *   delivery_receipt  what a human signed for at the door
 *   invoice           what we are billed           (EDI 810)
 *   credit_memo       what they agreed to give back(EDI 812)
 *   statement         a period roll-up used to tie out
 *
 * Five more arrived with ADR 0104 D2/S6 (migration
 * 20260903160000_canonical_document_and_delivery.sql, which WIDENS the CHECK
 * rather than replacing it — every literal above still writes):
 *
 *   receiving_advice  OUR door count. The document that makes "received" a fact
 *                     rather than an inference (ADR 0103 A6).
 *   delivery_note     irsaliye / e-İrsaliye / despatch advice. In Türkiye this is
 *                     the correctable document the whole flow turns on (0103 D2).
 *   informal_note     the farmer's handwritten slip (0104 S6). A legally normal
 *                     transaction must not read like a broken intake.
 *   price_list        a vendor price sheet.
 *   portal_export     a CSV or PDF pulled from a distributor portal.
 *
 * The extractor emits all twelve as of the slice-1 gap fix: the prompt names
 * each with a one-line definition and `DocumentExtractorService.coerceDocType`
 * accepts every literal in this list. `unknown` REMAINS the fallback, with its
 * warning — widening the vocabulary must never turn "we do not know what this
 * is" into a confident guess, which is the failure the fallback exists for.
 */
export const DOC_TYPES = [
  "purchase_order",
  "packing_slip",
  "delivery_receipt",
  "invoice",
  "credit_memo",
  "statement",
  "unknown",
  "receiving_advice",
  "delivery_note",
  "informal_note",
  "price_list",
  "portal_export",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** How a document reached us. Downstream code must never branch on this. */
export const SOURCE_CHANNELS = [
  "email",
  "photo",
  "upload",
  "edi",
  "sftp",
  "manual",
  "api",
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

export const DOC_STATUSES = [
  "received",
  "extracting",
  "needs_review",
  "verified",
  "rejected",
  "superseded",
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const UOMS = [
  "bottle",
  "case",
  "keg",
  "pack",
  "split_case",
  "each",
  "liter",
  "kg",
  "g",
  "lb",
  "oz",
  "gal",
  "floz",
] as const;
export type Uom = (typeof UOMS)[number];

/**
 * Weights (R8, mail-receipts lane 2026-11-11). A cheese invoiced `3 KGM @ 450`
 * was filed as `3 each` and booked as three pieces. A line may now say `kg` or
 * `g`; `procurement_document_lines.uom` and `price_base_uom` accept them
 * (migration 20270727120000). An ORDER and the order door do not: their columns
 * keep the seven container units (`ORDER_UNIT_TYPES`), and both refuse a weight
 * by name rather than write it into a CHECK that would fail.
 *
 * A weight is never a number of bottles (`toBottles` passes it through 1:1 and
 * `comparableUnits` keeps it apart, as for a keg or a liter). It converts only
 * to another weight, by `massFactor`, into the unit the house item is kept in
 * (ADR 0070: integer quantities, the unit belongs to the item).
 */
export const MASS_UOMS = ["kg", "g", "lb", "oz"] as const;
export type MassUom = (typeof MASS_UOMS)[number];

export function isMass(u: unknown): u is MassUom {
  return (MASS_UOMS as readonly unknown[]).includes(u);
}

/**
 * US units (r36 invoices R4). A US food invoice prints `10 LB`, `16 OZ`,
 * `4 GAL` or `64 FL OZ`; the vocabulary had none of them, so the reader filed
 * the line as `each` and the door booked `10 LB` of chicken into an item kept
 * in grams as 10 g. A line may now say `lb` or `oz` (weights) and `gal` or
 * `floz` (volumes); `procurement_document_lines.uom` and `price_base_uom`
 * accept them (migration 20271114203700). The ITEM stays metric (ADR 0070):
 * these convert, by the exact legal definitions below, into the item's g, kg,
 * mg, ml or l, and never into bottles.
 *
 * `oz` alone is the avoirdupois ounce, a weight; a fluid ounce is `floz`. An
 * `oz` line into an item kept in ml is refused by name (a weight is not a
 * volume), never read as fluid ounces. `gal` is the US gallon: the houses that
 * print it are US houses, and the imperial gallon is not a unit any of them buys in.
 */
export const IMPERIAL_UOMS = ["lb", "oz", "gal", "floz"] as const;

export function isImperial(u: unknown): boolean {
  return (IMPERIAL_UOMS as readonly unknown[]).includes(u);
}

/**
 * Grams in one of a weight unit, the item's `mg` included (`restaurant_inventory.uom`).
 * `lb` is the international avoirdupois pound, exactly 453.59237 g; `oz` is 1/16 of it.
 */
const GRAMS: Readonly<Record<string, number>> = {
  kg: 1000,
  g: 1,
  mg: 0.001,
  lb: 453.59237,
  oz: 28.349523125,
};

/**
 * How many `to` make one `from`, both weights, or null when either is not a
 * weight this file knows. `massFactor("kg", "g")` is 1000.
 */
export function massFactor(from: string, to: string): number | null {
  const a = GRAMS[from];
  const b = GRAMS[to];
  return a == null || b == null ? null : a / b;
}

/**
 * Volumes (r21): an item is kept in `ml` (or `l` on an older row); a line
 * measures in `liter`. `5 liter @ 120` into ml was booked as 5 ml at 120.
 */
const MILLILITRES: Readonly<Record<string, number>> = {
  liter: 1000,
  l: 1000,
  ml: 1,
  // The US gallon is exactly 231 cubic inches; a US fluid ounce is 1/128 of it.
  gal: 3785.411784,
  floz: 29.5735295625,
};

/** The units a LINE may measure a volume in: `liter`, and the US `gal` and `floz` (R4). */
export const VOLUME_LINE_UOMS = ["liter", "gal", "floz"] as const;

export function isVolumeLineUnit(u: unknown): u is (typeof VOLUME_LINE_UOMS)[number] {
  return (VOLUME_LINE_UOMS as readonly unknown[]).includes(u);
}

/**
 * A line converted into the item's unit. A metric line is booked only when it
 * is a whole number of the item's unit (ADR 0070: `2.5 kg` into kg is refused,
 * not rounded). A US line can never be whole (1 lb is 453.59237 g), so into
 * the FINEST unit a house keeps (g, mg, ml) it is rounded to the nearest one
 * and says so: half a gram or half a millilitre is below what any kitchen
 * scale or jug reads, and the lot's cost is still the paper's money over what
 * was booked. Into kg or l it is refused unless whole, as a metric line is:
 * `10 lb` is 4.536 kg, and 5 kg would be 10% wrong.
 */
export function inItemUnit(
  n: number,
  lineUom: string,
  itemUom: string,
): { ok: true; qty: number; exact: number; rounded: boolean } | { ok: false; exact: number | null } {
  const f = massFactor(lineUom, itemUom) ?? volumeFactor(lineUom, itemUom);
  if (f == null) return { ok: false, exact: null };
  const exact = n * f;
  const whole = Math.round(exact);
  if (Math.abs(exact - whole) <= 1e-9) return { ok: true, qty: whole, exact, rounded: false };
  if (isImperial(lineUom) && FINEST.has(itemUom)) return { ok: true, qty: whole, exact, rounded: true };
  return { ok: false, exact };
}

/** The finest weight and volume a house item is kept in (`restaurant_inventory_uom_check`). */
const FINEST: ReadonlySet<string> = new Set(["g", "mg", "ml"]);

/**
 * The unit a stored line really counts in (R4). Before the US units existed the
 * reader filed `10 LB` as `each` and kept the paper's glyph in `printed.uom`
 * (audit D1). Such a line is read by its printed weight or volume, so a row
 * stored before this change books 10 lb, not 10 pieces or 10 g. Any other line
 * is returned unchanged; an unmapped glyph is still left to the refusals that
 * already read it.
 */
export function withStatedUnit<T extends { uom?: string | null; printed?: unknown }>(line: T): T {
  if (line.uom !== "each") return line;
  const p = line.printed && typeof line.printed === "object" ? (line.printed as Record<string, unknown>).uom : null;
  const said = typeof p === "string" ? normalizeUom(p) : null;
  return said && (isMass(said) || isVolumeLineUnit(said)) ? { ...line, uom: said } : line;
}

/** True for an item unit that is a volume: `ml` or `l` (`restaurant_inventory.uom`). */
export function isVolumeItemUnit(u: unknown): u is "ml" | "l" {
  return u === "ml" || u === "l";
}

/**
 * How many `to` make one `from`, both volumes, or null when either is not a
 * volume this file knows. `volumeFactor("liter", "ml")` is 1000.
 */
export function volumeFactor(from: string, to: string): number | null {
  const a = MILLILITRES[from];
  const b = MILLILITRES[to];
  return a == null || b == null ? null : a / b;
}

export const MATCH_METHODS = [
  "vendor_sku",
  "description",
  "qty_price",
  "manual",
  "edi_reference",
] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

export const LINK_METHODS = [
  "manual",
  "doc_reference",
  "po_number",
  "provider_date",
  "line_overlap",
  "edi_reference",
] as const;
export type LinkMethod = (typeof LINK_METHODS)[number];

export const RECEIPT_STAGES = [
  "signed_at_door",
  "case_count",
  "bottle_count",
  "reconciled",
] as const;
export type ReceiptStage = (typeof RECEIPT_STAGES)[number];

/**
 * Coerce a free-text unit into the canonical vocabulary.
 *
 * Originally necessary because the schema was not self-consistent:
 * `procurement_order_items.unit_type` had NO check constraint and defaulted to
 * the PLURAL `'bottles'`, `procurement_orders.unit_type` had none either, and
 * only `procurement_document_lines.uom` was CHECK-constrained to singulars.
 * `20260901150000_order_line_capture_and_units.sql` closed that: all four unit
 * columns now share one CHECK over the same seven singulars, and this function
 * is what every writer funnels through to produce them.
 *
 * It is still necessary, because the inputs are not ours. Extracted and EDI
 * documents add their own spellings (`BT`, `CS`, `EA` are the common X12 codes),
 * and every quantity comparison funnels through here so one stray plural cannot
 * silently become an unrecognised unit and skip bottle normalisation — which
 * would resurface the split-case false alarm the whole mechanism exists to
 * prevent.
 *
 * Unrecognised input returns null rather than guessing `bottle`: a wrong unit
 * produces confident, wrong quantity maths, and silence is worse than a refusal.
 *
 * TURKISH SPELLINGS, AND WHY THE FOLD IS NOT DECORATIVE (ADR 0104 slice 2).
 * A Turkish invoice prints `KS`, `koli` or `kasa` for a case and `şişe` for a
 * bottle, and `toLowerCase()` alone does NOT reach them: JavaScript lowercases
 * the Turkish dotted capital `İ` to `i` + U+0307 (a combining dot above), so
 * `"ŞİŞE".toLowerCase()` is `"şi̇şe"` and never equals the `"şişe"` in a switch
 * arm. Every such spelling would fall through to `null` — a refusal that looks
 * like a decision. So the input is decomposed and its combining marks removed
 * before matching, which folds `ş→s`, `ı→i` and `İ→i` alike and leaves every
 * ASCII spelling this function already accepted byte-identical.
 *
 * `adet` is mapped to `each`, NOT to `bottle`. It means a countable piece and
 * says nothing about the container; `each` is already in this vocabulary and
 * converts through `toBottles` exactly as `bottle` does, so nothing downstream
 * changes — while calling it `bottle` would assert a format the paper never
 * printed. `kutu` (box) is deliberately NOT mapped: it is used for a case and
 * for a single retail carton on different documents, and no source settles
 * which — see the report's undecided list rather than a guess here.
 */
export function normalizeUom(raw?: string | null): Uom | null {
  if (!raw) return null;
  const s = raw
    .trim()
    .toLowerCase()
    // Decompose, then drop combining marks: see the Turkish note above.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // `ı` (U+0131, dotless i) has no decomposition, so the pass above cannot
    // reach it. Folded explicitly rather than left to fall through as null.
    .replace(/ı/g, "i")
    // `btl.`, `St.`, `bottle(s)`: an abbreviation's dot and a plural's `(s)`
    // say nothing about the unit (QA 10a (3)).
    .replace(/\((?:s|es|e)\)$/, "")
    .replace(/[\s_.-]+/g, "");
  switch (s) {
    case "bottle":
    case "bottles":
    case "btl":
    case "bt":
    case "sise": // TR `şişe`, folded to `sise` by the pass above.
    case "siseler":
    case "bouteille": // FR
    case "bouteilles":
    case "botella": // ES
    case "botellas":
    case "bottiglia": // IT
    case "bottiglie":
    case "flasche": // DE
    case "flaschen":
    case "fles": // NL
    case "flessen":
      return "bottle";
    case "case":
    case "cases":
    case "cs":
    case "ca":
    case "ks": // TR, the abbreviation a price base prints: `142,00 / KS(12)`.
    case "koli": // TR, the word for the same shipping case.
    case "kasa": // TR, likewise.
      return "case";
    case "keg":
    case "kegs":
      return "keg";
    case "pack":
    case "packs":
    case "pk":
      return "pack";
    case "splitcase":
    case "splitcases":
    case "split":
      return "split_case";
    case "each":
    case "ea":
    case "unit":
    case "units":
    case "adet": // TR, a countable piece. NOT `bottle` — see the header note.
    case "ad": // TR, `Ad.` / `AD`, the abbreviation of `adet`.
    case "c62": // UN/ECE Rec 20 "one", what a UBL-TR e-Fatura prints for `adet`.
    case "h87": // UN/ECE Rec 20 "piece".
    case "pcs": // EN piece(s), like `adet` a count, not a container (QA 10a (3)).
    case "pc":
    case "piece":
    case "pieces":
    case "stk": // DE/NL/Nordic Stück / stuk / styk.
    case "st":
    case "stuck": // DE `Stück`, folded by the pass above.
      return "each";
    case "liter":
    case "liters":
    case "litre":
    case "litres":
    case "l":
    case "lt":
    case "ltr": // UN/ECE Rec 20 `LTR`, as a UBL-TR e-Fatura prints it.
      return "liter";
    case "kg":
    case "kgs":
    case "kgm": // UN/ECE Rec 20 `KGM`, as a UBL-TR e-Fatura prints a kilogram (R8).
    case "kilo":
    case "kilos":
    case "kilogram":
    case "kilograms":
    case "kilogramm":
    case "kilogramme":
      return "kg";
    case "g":
    case "gr": // TR `gr`, a gram.
    case "grm": // UN/ECE Rec 20 `GRM`.
    case "gram":
    case "grams":
    case "gramm":
    case "gramme":
      return "g";
    // US units (R4). `#` is how a US produce or meat invoice prints a pound.
    case "lb":
    case "lbs":
    case "lbr": // UN/ECE Rec 20 `LBR`, pound.
    case "pound":
    case "pounds":
    case "#":
      return "lb";
    case "oz":
    case "ozs":
    case "onz": // UN/ECE Rec 20 `ONZ`, ounce (avoirdupois).
    case "ounce":
    case "ounces":
      return "oz";
    case "gal":
    case "gals":
    case "gll": // UN/ECE Rec 20 `GLL`, US gallon.
    case "gallon":
    case "gallons":
      return "gal";
    case "floz": // `fl oz`, `fl. oz.`, `FL-OZ`: spaces, dots and dashes folded above.
    case "oza": // UN/ECE Rec 20 `OZA`, US fluid ounce.
    case "fluidounce":
    case "fluidounces":
      return "floz";
    default:
      return null;
  }
}

/**
 * Bottle-equivalent for a quantity expressed in some other unit.
 *
 * This exists because the single most common beverage receiving discrepancy is
 * not a real discrepancy: order 2 cases, the vendor invoices 24 bottles, the
 * receiver counts 2 cases. Comparing the bare numbers reports an overage of 22
 * and fires a critical alert. Every quantity comparison in the match runs on
 * bottle-equivalents; the original unit is kept alongside so the UI can still
 * say "2 cases" to the person who counted cases.
 *
 * `liter`, `keg` and the weights `kg` and `g` deliberately do NOT convert. A keg is not a number of
 * bottles in any way a receiver would accept, and inventing a conversion factor
 * would produce confident, wrong cost math. They compare only against the same
 * unit.
 */
export function toBottles(qty: number, uom: Uom, packSize = 1): number {
  const n = Number.isFinite(qty) ? qty : 0;
  const pack = packSize >= 1 ? packSize : 1;
  switch (uom) {
    case "case":
    case "pack":
    case "split_case":
      return n * pack;
    case "bottle":
    case "each":
      return n;
    case "keg":
    case "liter":
    case "kg":
    case "g":
    case "lb":
    case "oz":
    case "gal":
    case "floz":
      return n;
  }
}

/** True when two quantities are in units that can be meaningfully compared. */
export function comparableUnits(a: Uom, b: Uom): boolean {
  const opaque = (u: Uom) => u === "keg" || isVolumeLineUnit(u) || isMass(u);
  if (opaque(a) || opaque(b)) return a === b;
  return true;
}
