import { MatchMethod } from "./document-types";

/**
 * line-matcher — pair the lines on a vendor document with the lines we ordered.
 *
 * The rule that shapes everything here: A WRONG LINK IS WORSE THAN NO LINK.
 *
 * An unmatched line surfaces as a question a receiver answers with one tap. A
 * wrongly matched line silently writes one wine's invoice price onto another
 * wine's cost lot, and nothing looks broken — the delivery closes, the books
 * balance, and the error only becomes visible months later as an unexplained
 * margin drift on two products at once. So candidates below the auto threshold
 * are returned as suggestions and never applied.
 *
 * Ranked, not fuzzy-guessed:
 *   1. vendor SKU — the distributor's own identifier, exact and unambiguous
 *   2. description similarity — trigram overlap on normalised text
 *   3. quantity + price proximity — the weakest signal, suggestion only
 *
 * SUBSTITUTION IS A MATCH, NOT A MISS. Ordering a 2022 Sancerre and receiving
 * the 2023 at the same price is routine, and it is the single clearest thing
 * that separates beverage from generic food-cost software. Treated as a
 * non-match it looks like a phantom short-ship plus a mystery extra line.
 * Treated as an identical match it silently books a different wine into the same
 * lot. It is neither: it is the same product line, a different item, and it
 * needs a human to accept the swap — so it matches with `substitution` set.
 */

export interface MatchableLine {
  id: string;
  vendorSku?: string | null;
  description?: string | null;
  vintage?: number | null;
  formatMl?: number | null;
  qtyBottles: number;
  unitPrice?: number | null;
}

export interface LineMatch {
  documentLineId: string;
  orderLineId: string;
  confidence: number;
  method: MatchMethod;
  /** Same wine, different vintage or format — a swap a human must accept. */
  substitution: boolean;
  /** Plain-language reason, shown to whoever confirms the pairing. */
  reason: string;
}

export interface MatchLinesResult {
  /** Confident enough to write. */
  applied: LineMatch[];
  /** Plausible but not certain — shown for one-tap confirmation, never written. */
  suggested: LineMatch[];
  unmatchedDocumentLineIds: string[];
  unmatchedOrderLineIds: string[];
}

/**
 * Above this a pairing is written automatically; below it a human confirms.
 * Set where it is because the cost of a wrong link is months of quiet cost-basis
 * corruption, while the cost of an unnecessary confirmation is one tap.
 */
export const AUTO_MATCH_THRESHOLD = 0.9;
/** Below this a pairing is not even worth showing — it is noise in the queue. */
export const SUGGEST_THRESHOLD = 0.45;

/** Words that carry no distinguishing signal on a wine description. */
const STOPWORDS = new Set([
  "wine",
  "red",
  "white",
  "rose",
  "rosé",
  "bottle",
  "bottles",
  "case",
  "cases",
  "the",
  "and",
  "of",
  "de",
  "di",
  "du",
  "des",
  "la",
  "le",
  "les",
  "el",
  "ml",
  "cl",
  "ltr",
  "l",
  "nv",
  "vintage",
  "assorted",
  "mixed",
]);

/**
 * Reduce a description to its distinguishing words.
 *
 * Vintage and format are pulled out rather than left in the text, because they
 * are the two things that should NOT drive textual similarity — leaving "2022"
 * in the string makes a 2022 and a 2023 of the same wine look less alike than
 * two unrelated 2022s, which is exactly backwards for substitution detection.
 */
export function normalizeDescription(raw?: string | null): {
  tokens: string[];
  normalized: string;
  vintage: number | null;
  formatMl: number | null;
} {
  const text = (raw || "").toLowerCase();

  // Vintage: a plausible wine year, not any four digits (SKUs are full of them).
  const yearMatch = text.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  const vintage = yearMatch ? Number(yearMatch[1]) : null;

  let formatMl: number | null = null;
  const ml = text.match(/(\d{3,4})\s*ml\b/);
  const litres = text.match(/(\d(?:[.,]\d)?)\s*(?:l|ltr|liter|litre)\b/);
  if (ml) formatMl = Number(ml[1]);
  else if (litres)
    formatMl = Math.round(Number(litres[1].replace(",", ".")) * 1000);

  const tokens = text
    // Keep letters and digits; everything else is punctuation noise that varies
    // between a distributor's system and ours for the same wine.
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .filter((t) => !STOPWORDS.has(t))
    .filter((t) => !(yearMatch && t === yearMatch[1]))
    .filter((t) => !/^\d{3,4}$/.test(t));

  return { tokens, normalized: tokens.join(" "), vintage, formatMl };
}

/** Dice coefficient over character trigrams. 0..1, symmetric. */
export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s: string) => {
    const padded = `  ${s} `;
    const out = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return (2 * shared) / (ga.size + gb.size);
}

interface Candidate extends LineMatch {
  score: number;
}

function scorePair(doc: MatchableLine, order: MatchableLine): Candidate | null {
  const skuA = (doc.vendorSku || "").trim().toLowerCase();
  const skuB = (order.vendorSku || "").trim().toLowerCase();

  const nd = normalizeDescription(doc.description);
  const no = normalizeDescription(order.description);
  const docVintage = doc.vintage ?? nd.vintage;
  const orderVintage = order.vintage ?? no.vintage;
  const docFormat = doc.formatMl ?? nd.formatMl;
  const orderFormat = order.formatMl ?? no.formatMl;

  const vintageDiffers =
    docVintage != null && orderVintage != null && docVintage !== orderVintage;
  const formatDiffers =
    docFormat != null && orderFormat != null && docFormat !== orderFormat;
  const substitution = vintageDiffers || formatDiffers;

  const substitutionNote = vintageDiffers
    ? `ordered ${orderVintage}, delivered ${docVintage}`
    : formatDiffers
      ? `ordered ${orderFormat}ml, delivered ${docFormat}ml`
      : "";

  // 1. Vendor SKU — the distributor's own identifier.
  if (skuA && skuB && skuA === skuB) {
    return {
      documentLineId: doc.id,
      orderLineId: order.id,
      // A SKU match with a different vintage is still the strongest evidence we
      // have that these are the same line, but it must not auto-apply: the swap
      // is a different item with its own cost lot and a somm needs to know
      // before tonight's list prints.
      confidence: substitution ? 0.75 : 0.99,
      score: substitution ? 0.75 : 0.99,
      method: "vendor_sku",
      substitution,
      reason: substitution
        ? `Vendor SKU ${skuB} matches, but ${substitutionNote}.`
        : `Vendor SKU ${skuB} matches exactly.`,
    };
  }

  // 2. Description similarity.
  const textScore = trigramSimilarity(nd.normalized, no.normalized);
  if (textScore >= SUGGEST_THRESHOLD) {
    // Cap below the auto threshold. Two wines from the same producer differ by
    // one word ("Bricco Boschis" vs "Bricco Boschis Vigna San Giuseppe") and can
    // be twenty pounds a bottle apart, so text alone never auto-applies.
    const base = Math.min(0.88, textScore);
    const confidence = substitution ? base * 0.85 : base;
    return {
      documentLineId: doc.id,
      orderLineId: order.id,
      confidence,
      score: confidence,
      method: "description",
      substitution,
      reason: substitution
        ? `Description is a ${(textScore * 100).toFixed(0)}% match, but ${substitutionNote}.`
        : `Description is a ${(textScore * 100).toFixed(0)}% match.`,
    };
  }

  // 3. Quantity and price proximity — the weakest signal, and only ever a
  // suggestion. Two different wines ordered in the same quantity at the same
  // price are common on one delivery, so this cannot stand on its own.
  const qtyEqual =
    doc.qtyBottles > 0 && Math.abs(doc.qtyBottles - order.qtyBottles) < 0.001;
  const priceClose =
    doc.unitPrice != null &&
    order.unitPrice != null &&
    order.unitPrice > 0 &&
    Math.abs(doc.unitPrice - order.unitPrice) / order.unitPrice <= 0.02;

  if (qtyEqual && priceClose) {
    return {
      documentLineId: doc.id,
      orderLineId: order.id,
      confidence: 0.5,
      score: 0.5,
      method: "qty_price",
      substitution,
      reason: `Same quantity (${doc.qtyBottles}) and price as the ordered line — no SKU or description match.`,
    };
  }

  return null;
}

/**
 * Pair document lines to order lines.
 *
 * Greedy by descending confidence, one-to-one. Greedy rather than optimal
 * assignment on purpose: it is deterministic and explainable, and a receiver
 * arguing with a distributor needs to be able to say why two lines were paired.
 * A globally optimal solver can reshuffle every pairing because one line
 * changed, which is unexplainable at a loading dock.
 */
export function matchLines(
  documentLines: MatchableLine[],
  orderLines: MatchableLine[],
): MatchLinesResult {
  const candidates: Candidate[] = [];
  for (const d of documentLines)
    for (const o of orderLines) {
      const c = scorePair(d, o);
      if (c) candidates.push(c);
    }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      // Deterministic tie-break so the same inputs always produce the same
      // pairing; without it two equally-scored candidates resolve by array order.
      a.documentLineId.localeCompare(b.documentLineId) ||
      a.orderLineId.localeCompare(b.orderLineId),
  );

  const usedDoc = new Set<string>();
  const usedOrder = new Set<string>();
  const applied: LineMatch[] = [];
  const suggested: LineMatch[] = [];

  for (const c of candidates) {
    if (usedDoc.has(c.documentLineId) || usedOrder.has(c.orderLineId)) continue;
    usedDoc.add(c.documentLineId);
    usedOrder.add(c.orderLineId);
    const { score: _score, ...match } = c;
    if (match.confidence >= AUTO_MATCH_THRESHOLD && !match.substitution)
      applied.push(match);
    else suggested.push(match);
  }

  return {
    applied,
    suggested,
    unmatchedDocumentLineIds: documentLines
      .filter((d) => !usedDoc.has(d.id))
      .map((d) => d.id),
    unmatchedOrderLineIds: orderLines
      .filter((o) => !usedOrder.has(o.id))
      .map((o) => o.id),
  };
}
