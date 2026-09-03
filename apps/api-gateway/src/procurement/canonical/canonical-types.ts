import { Uom } from "../documents/document-types";

/**
 * canonical-types — the one document object every incoming paper renders into
 * (ADR 0104 D1).
 *
 * THREE LAYERS, ONE OBJECT:
 *
 *   layer1 EXTRACTED    what the document SAYS. Immutable once extraction
 *                       completes — a correction is a NEW revision, never an
 *                       edit (D5, enforced by a trigger on document_revisions).
 *   layer2 RESOLVED     what it MEANS here: item identity, canonical unit,
 *                       vintage and lot (ADR 0103 A9), vendor id.
 *   layer3 ADJUDICATED  what WE assert: the four-way spine, verdicts, money at
 *                       risk. Recomputed, never hand-edited.
 *
 * WHY EVERY LAYER-1 FIELD IS AN OBJECT AND NOT A SCALAR. A number on a screen
 * that came from a model, from a signed XML, from a purchase order carried
 * forward, and from a human typing it are four different facts with four
 * different consequences when they are wrong. Collapsed into `qty: 12` they are
 * indistinguishable, and the product's whole claim — that Mudavym holds the one
 * document both sides accepted — rests on being able to say where each number
 * came from and what the paper actually printed.
 *
 * FIELD NAMES ARE EN 16931 BT/BG IDENTIFIERS. Not because we are filing Peppol
 * documents, but because a Turkish e-Fatura (UBL-TR) and a Californian
 * distributor invoice both map onto them, and the standard's ~180 business rules
 * only mean anything against a canonical object. The BT/BG id is in the property
 * comment, so `canonical-invariants.ts` can cite the rule it is enforcing.
 */

/**
 * Where a value came from (ADR 0104 D1).
 *
 * `learned_from_vendor` is the load-bearing one: a value recalled from
 * correction history must never masquerade as one read off the page, or the
 * mapping memory of slice 4 becomes an untraceable source of confident wrong
 * numbers.
 */
export const SOURCES = [
  "extracted",
  "embedded_xml",
  "edi",
  "portal",
  "learned_from_vendor",
  "carried_from_po",
  "human_entered",
  "human_corrected",
  "computed",
] as const;
export type Source = (typeof SOURCES)[number];

/** Mirrors the CHECK on procurement_documents.direction (ADR 0104 S6). */
export const DIRECTIONS = ["issued_by_vendor", "issued_by_us"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Mirrors the jurisdiction CHECKs. `unknown` blocks; it is never "no rule". */
export const JURISDICTIONS = ["TR", "US-CA", "unknown"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

/**
 * One field, with its provenance.
 *
 * `value: null` means the document did not state it. That is DIFFERENT from the
 * envelope being absent, which means we never looked — the distinction ADR 0067
 * exists to protect.
 */
export interface FieldEnvelope<T> {
  value: T | null;
  unit?: Uom | string | null;
  currency?: string | null;
  source: Source;
  /**
   * 0..1, or null when the source has no notion of confidence (EDI, signed XML,
   * a human typing). NULL IS NOT ZERO. It never renders as a number to a user
   * (D4: named exceptions, never `0.71`); it decides what a human sees first.
   */
  confidence: number | null;
  page?: number | null;
  /** [x0, y0, x1, y1] on `page`, for hover-to-source in slice 2. */
  bbox?: [number, number, number, number] | null;
  verified_by?: string | null;
  verified_at?: string | null;
  /**
   * The literal glyphs the document printed, before any parsing or formatting.
   * `1.234,56` stays `1.234,56` here even when `value` is 1234.56, so the screen
   * can always show what the paper said next to what we concluded. An invariant
   * asserts this is never rewritten by formatting.
   */
  as_printed?: string | null;
  /** Which revision of the document this envelope belongs to. */
  revision: number;
}

/**
 * A document- or line-level allowance (a deduction) or charge (an addition).
 *
 * BG-20/BG-21 at document level, BG-27/BG-28 at line level. The reason CODE is
 * what makes a CRV deposit distinguishable from freight without reading English:
 * allowances use UNCL5189, charges use UNCL7161 (freight is `FC`, a returnable
 * container deposit is coded in the same list).
 */
export interface AllowanceCharge {
  /** true = charge (adds), false = allowance (deducts). */
  isCharge: FieldEnvelope<boolean>;
  /** BT-92 (doc allowance) / BT-99 (doc charge) / BT-136 / BT-141 (line). */
  amount: FieldEnvelope<number>;
  /** BT-93 / BT-100 / BT-137 / BT-142. */
  baseAmount?: FieldEnvelope<number>;
  /** BT-94 / BT-101 / BT-138 / BT-143. */
  percentage?: FieldEnvelope<number>;
  /** BT-98 (UNCL5189, allowance) / BT-105 (UNCL7161, charge). */
  reasonCode: FieldEnvelope<string>;
  /** BT-97 / BT-104 — the human sentence. */
  reason: FieldEnvelope<string>;
  /** BT-95 / BT-102 — VAT category this allowance/charge belongs to. */
  vatCategory?: FieldEnvelope<string>;
  /** BT-96 / BT-103. */
  vatRate?: FieldEnvelope<number>;
}

/** BG-25 — one invoice line, in EN 16931 terms plus four beverage extensions. */
export interface ExtractedLine {
  /** BT-126 — the line's own identifier on the document. */
  lineId: FieldEnvelope<string>;
  /** BT-153 — item name. */
  description: FieldEnvelope<string>;
  /** BT-155 — seller's item identifier (the distributor's SKU). */
  sellerItemId: FieldEnvelope<string>;
  /** BT-129 — invoiced quantity. */
  quantity: FieldEnvelope<number>;
  /** BT-130 — quantity unit of measure. */
  unit: FieldEnvelope<string>;
  /** BT-146 — item net price. */
  netPrice: FieldEnvelope<number>;
  /**
   * BT-149 — item price base quantity. The `1 ks × 12 şişe` problem: a price of
   * 264 can be per case or per bottle, and without this field the arithmetic is
   * off by a factor of twelve with nothing to catch it.
   */
  priceBaseQuantity: FieldEnvelope<number>;
  /** BT-150 — the base quantity's unit. */
  priceBaseUnit: FieldEnvelope<string>;
  /** BT-131 — invoice line net amount. */
  netAmount: FieldEnvelope<number>;
  /** BG-27 / BG-28 — line-level allowances and charges with reason codes. */
  allowancesCharges: AllowanceCharge[];
  /** BG-30 / BT-151 — invoiced item VAT category code (S, Z, E, AE, K, G, O). */
  vatCategory: FieldEnvelope<string>;
  /** BT-152 — invoiced item VAT rate, as a percentage. */
  vatRate: FieldEnvelope<number>;

  // ---- Mudavym extensions (EN 16931 carries these as BG-32 item attributes) --
  /** ADR 0103 A9: a vintage difference is a SUBSTITUTION, never a tolerance. */
  vintage: FieldEnvelope<number>;
  /** Lot / batch, where the document states one (ADR 0104 S7). */
  lot: FieldEnvelope<string>;
  /** Bottle format in millilitres. */
  formatMl: FieldEnvelope<number>;
  /** ADR 0103 D7 FREE_GOODS — out of COGS and price history, kept as a record. */
  freeGoodsQty: FieldEnvelope<number>;
}

/** BG-4 seller / BG-7 buyer. BT-31 is the VAT identifier — the Turkish VKN. */
export interface ExtractedParty {
  /** BT-27 (seller) / BT-44 (buyer). */
  name: FieldEnvelope<string>;
  /** BT-31 (seller VAT id / VKN) / BT-48 (buyer VAT id). */
  vatIdentifier: FieldEnvelope<string>;
  /** BT-29 (seller) / BT-46 (buyer) — the vendor's own account number for us. */
  identifier: FieldEnvelope<string>;
  /** BG-5 / BG-8, flattened to one printable line. */
  address: FieldEnvelope<string>;
  /** BT-34 / BT-49 — electronic address (the e-Fatura alias, where stated). */
  electronicAddress: FieldEnvelope<string>;
}

/** BG-23 — one VAT breakdown row, per (category, rate). */
export interface VatBreakdownEntry {
  /** BT-118 — VAT category code. */
  category: FieldEnvelope<string>;
  /** BT-119 — VAT rate. */
  rate: FieldEnvelope<number>;
  /** BT-116 — VAT category taxable amount. */
  taxableAmount: FieldEnvelope<number>;
  /** BT-117 — VAT category tax amount. */
  taxAmount: FieldEnvelope<number>;
  /** BT-120/121 — exemption reason, where the category is exempt. */
  exemptionReason?: FieldEnvelope<string>;
}

/** BG-22 — document totals. */
export interface ExtractedTotals {
  /** BT-106 — sum of invoice line net amounts. */
  linesNetTotal: FieldEnvelope<number>;
  /** BT-107 — sum of document-level allowances. */
  allowancesTotal: FieldEnvelope<number>;
  /** BT-108 — sum of document-level charges. */
  chargesTotal: FieldEnvelope<number>;
  /** BT-109 — total amount without VAT. */
  taxExclusiveAmount: FieldEnvelope<number>;
  /** BT-110 — total VAT amount (KDV on a Turkish invoice). */
  taxAmount: FieldEnvelope<number>;
  /** BT-112 — total amount with VAT. */
  taxInclusiveAmount: FieldEnvelope<number>;
  /** BT-113 — paid amount. */
  paidAmount: FieldEnvelope<number>;
  /** BT-114 — rounding amount. */
  roundingAmount: FieldEnvelope<number>;
  /** BT-115 — amount due for payment. */
  amountDue: FieldEnvelope<number>;
}

/** Layer 1 — what the document says. */
export interface Extracted {
  /** BT-1 — invoice number. */
  documentNumber: FieldEnvelope<string>;
  /** BT-2 — issue date (ISO). */
  issueDate: FieldEnvelope<string>;
  /**
   * BT-3 — document type code (UNCL1001). 380 invoice, 381 credit note,
   * 389 self-billed. Kept as the CODE, not our `doc_type`, so a document that
   * calls itself a credit note can be checked against how we classified it.
   */
  typeCode: FieldEnvelope<string>;
  /** BT-5 — document currency. */
  currency: FieldEnvelope<string>;
  /** BT-9 — payment due date. */
  paymentDueDate: FieldEnvelope<string>;
  /** BT-20 — payment terms, as printed. */
  paymentTerms: FieldEnvelope<string>;

  seller: ExtractedParty;
  buyer: ExtractedParty;

  /** BT-13 — purchase order reference. */
  purchaseOrderReference: FieldEnvelope<string>;
  /** BT-16 — despatch advice reference (the irsaliye a fatura cites). */
  despatchAdviceReference: FieldEnvelope<string>;
  /** BT-25 — preceding invoice reference (what a credit memo credits). */
  precedingInvoiceReference: FieldEnvelope<string>;

  /** BG-13 / BT-72 — actual delivery date. Not the invoice date (§A11). */
  actualDeliveryDate: FieldEnvelope<string>;
  /** BT-71 — deliver-to location identifier, for the WRONG_VENUE case. */
  deliveryLocation: FieldEnvelope<string>;

  lines: ExtractedLine[];
  /** BG-20 / BG-21 — document-level allowances and charges. */
  allowancesCharges: AllowanceCharge[];
  totals: ExtractedTotals;
  /** BG-23 — VAT breakdown. */
  vatBreakdown: VatBreakdownEntry[];
}

/** Layer 2 — what the document MEANS in this restaurant. */
export interface ResolvedLine {
  /** Index into `layer1.lines`. */
  lineIndex: number;
  inventoryId: string | null;
  masterWineId: string | null;
  /** The canonical unit, via normalizeUom. NULL when the unit was unreadable —
   *  never guessed as `bottle`, because a wrong unit is confident wrong maths. */
  canonicalUom: Uom | null;
  packSize: number | null;
  qtyBottles: number | null;
  /** How the line was paired to ours, or null when nothing matched. */
  matchMethod: string | null;
  matchConfidence: number | null;
  /** ADR 0103 A9 / ADR 0104 S7 — structured, so a vintage swap is machine-visible. */
  vintage: number | null;
  lot: string | null;
}

export interface Resolved {
  providerId: string | null;
  lines: ResolvedLine[];
}

/**
 * ADR 0103 A6 — what the door actually counted.
 *
 * `"not_counted"` is a REAL, REQUIRED value. When nobody counts at the door (the
 * modal case in every tool surveyed), `received` must say so; silently setting
 * it equal to shipped or billed is what degrades this flow into the
 * invoice-centric three-way match ADR 0103 rejected. An invariant asserts it.
 */
export type ReceivedQuantity = number | "not_counted";

/** Layer 3 — what we assert. Recomputed; never hand-edited. */
export interface AdjudicatedLine {
  lineIndex: number;
  /** The four-way spine, in bottle-equivalents. */
  ordered: number | null;
  shipped: number | null;
  received: ReceivedQuantity;
  billed: number | null;
  /** e.g. `ok`, `short_ship`, `over_ship`, `price_variance`, `substitution`. */
  verdict: string;
  /** ADR 0103 D7 reason class, when the verdict is not `ok`. */
  reason: string | null;
  moneyAtRisk: number | null;
}

export interface Adjudicated {
  lines: AdjudicatedLine[];
  /** null = untestable (no stated total), never "passed". */
  tiesOut: boolean | null;
  tieOutDeltaCents: number | null;
  /** Every invariant result, holds and fails alike. */
  verdicts: InvariantResult[];
}

/**
 * One invariant's answer.
 *
 * NEVER A BARE BOOLEAN — the brief's rule, and the reason is the whole repo's
 * absence-as-health fault: `false` on its own cannot be told from "we could not
 * check", and a screen that renders both as a red dot teaches people to ignore
 * red dots.
 *
 * `holds: null` is that third state made explicit: the invariant RAN and found
 * it had nothing to test (no stated total, no VAT breakdown on a delivery note).
 * It is deliberately not `false`, and the corpus runner counts it separately —
 * an untestable document must never inflate a pass rate.
 */
export interface InvariantResult {
  id: string;
  /**
   * The EN 16931 / Peppol business rule this enforces, where one exists
   * (`BR-CO-15`, `PEPPOL-EN16931-R120`), or null for a rule that is ours.
   */
  rule: string | null;
  /** Which line or VAT category this is about; null for document-level. */
  path: string | null;
  holds: boolean | null;
  expected: unknown;
  found: unknown;
  /** A sentence a bookkeeper can act on. Never a bare number. */
  explanation: string;
}

/** The whole object. */
export interface CanonicalDocument {
  documentId: string;
  restaurantId: string;
  /** Our classification (procurement_documents.doc_type). */
  docType: string;
  /** ADR 0104 S6 — an `iade faturası` is ours, the reverse of a credit memo. */
  direction: Direction;
  /** ADR 0104 D8 — drives retention and every clock. `unknown` blocks. */
  jurisdiction: Jurisdiction | null;
  revision: number;
  layer1: Extracted;
  layer2: Resolved;
  layer3: Adjudicated;
}

/** Build an envelope. Explicit `source` — there is no default, on purpose. */
export function envelope<T>(
  value: T | null,
  source: Source,
  extra: Partial<Omit<FieldEnvelope<T>, "value" | "source">> = {},
): FieldEnvelope<T> {
  return {
    value,
    source,
    confidence: extra.confidence ?? null,
    revision: extra.revision ?? 1,
    ...(extra.unit !== undefined ? { unit: extra.unit } : {}),
    ...(extra.currency !== undefined ? { currency: extra.currency } : {}),
    ...(extra.page !== undefined ? { page: extra.page } : {}),
    ...(extra.bbox !== undefined ? { bbox: extra.bbox } : {}),
    ...(extra.as_printed !== undefined ? { as_printed: extra.as_printed } : {}),
    ...(extra.verified_by !== undefined
      ? { verified_by: extra.verified_by }
      : {}),
    ...(extra.verified_at !== undefined
      ? { verified_at: extra.verified_at }
      : {}),
  };
}
