import { Extracted, FieldEnvelope } from "./canonical-types";
import {
  ParsedDocument,
  ParsedLine,
  applyTieOut,
} from "../documents/parsed-document";
import { normalizeUom, toBottles, Uom } from "../documents/document-types";

/**
 * correctable-paths — the CLOSED LIST of layer-1 fields a human may correct,
 * and the two places each one has to land (ADR 0104 D5, slice 3).
 *
 * WHY A REGISTRY AND NOT A DOTTED-PATH WALKER. A generic `set(obj, path, value)`
 * over a request body is a prototype-pollution door (`__proto__.x`), and it
 * cannot answer the two questions this feature actually needs answered:
 *
 *   1. WHAT TYPE is this field? "value typed by the envelope" is not usable at
 *      runtime — a field whose current value is null carries no type at all, so
 *      the type has to be declared per field, once, here.
 *   2. DOES THIS FIELD MOVE ANY ARITHMETIC? Correcting a line quantity from 12
 *      to 10 must change the tie-out, the bottle-equivalent and every invariant
 *      that reads them. Correcting the seller's e-mail address must change
 *      nothing at all. `toParsed` is where that difference is written down.
 *
 * THE SECOND WRITER IS THE WHOLE POINT. `CanonicalDocumentService` derives the
 * canonical object from `procurement_documents` + `procurement_document_lines`
 * through ONE mapping (`parsedFromDocumentRows` → `canonicalFromParsedDocument`).
 * A correction that only rewrote the layer-1 envelope would leave layer 3 —
 * billed quantities, tie-out, every EN 16931 invariant — grading the numbers the
 * page NO LONGER SHOWS. That is this repository's absence-as-health fault with
 * arithmetic attached: a corrected invoice would still report "ties out" against
 * the uncorrected figures. So a correction is replayed onto the ParsedDocument
 * as well, and the object is rebuilt by the same mapper. A field with no
 * `toParsed` is a field with no arithmetic consequence, and that is a claim this
 * file makes explicitly rather than by omission.
 *
 * WHAT IS DELIBERATELY NOT CORRECTABLE:
 *   * `as_printed` — the literal glyphs the paper carried. Correcting them would
 *     let the provenance trail be rewritten to agree with our conclusion, which
 *     is the one thing ADR 0104 D1 exists to prevent.
 *   * layer 2 and layer 3 — resolved identity and adjudication are recomputed,
 *     never hand-edited (ADR 0104 D1).
 *   * `totals.taxExclusiveAmount` (BT-109) and the two grouped totals BT-107 /
 *     BT-108 — they are COMPUTED from BT-106 and the allowance/charge groups
 *     (BR-CO-13), so a human-entered value would be overwritten by the next
 *     read and the screen would silently disagree with the log.
 *
 * THE MAPPING MEMORY OF SLICE 4 IS NOT HERE. `learnableKey` below is the named
 * seam: it says which corrections are candidates to be remembered per vendor
 * (vendor item → our item, vendor unit → canonical unit) and nothing reads it
 * yet. It exists so slice 4 has a declared input instead of a new opinion about
 * which corrections are learnable.
 */

/** What a correction's `value` must be, per field. Declared, never inferred. */
export type CorrectableType = "string" | "number";

export interface CorrectablePath {
  /** The field in words, for the log and the screen. `{n}` = 1-based line no. */
  label: string;
  type: CorrectableType;
  /** The EN 16931 BT/BG identifier, where the field has one. */
  bt: string | null;
  /**
   * Slice-4 seam (ADR 0104 D5 / S8). `null` = this correction teaches nothing
   * transferable. Nothing reads this yet; it is a declaration, not a feature.
   */
  learnableKey: "item_identity" | "unit" | "price" | null;
  read: (l1: Extracted, line: number | null) => FieldEnvelope<unknown> | null;
  write: (
    l1: Extracted,
    line: number | null,
    env: FieldEnvelope<unknown>,
  ) => void;
  /**
   * Replay onto the ParsedDocument so layer 2, layer 3 and the tie-out follow.
   * ABSENT means this field moves no arithmetic — stated, not omitted.
   */
  toParsed?: (p: ParsedDocument, line: number | null, value: unknown) => void;
}

/** `lines[3].netPrice` → { template: "lines[].netPrice", line: 3 }. */
export function splitPath(path: string): {
  template: string;
  line: number | null;
} | null {
  const m = /^lines\[(\d+)\]\.(.+)$/.exec(path);
  if (m) {
    const line = Number(m[1]);
    if (!Number.isInteger(line) || line < 0) return null;
    return { template: `lines[].${m[2]}`, line };
  }
  // A header path may not contain brackets or indices at all — that is what
  // keeps `lines.0.quantity` and `constructor.prototype` from being read as
  // header fields with unusual names.
  if (!/^[A-Za-z]+(\.[A-Za-z]+)?$/.test(path)) return null;
  return { template: path, line: null };
}

const headerEnv =
  <K extends keyof Extracted>(key: K) =>
  (l1: Extracted): FieldEnvelope<unknown> | null =>
    (l1[key] as FieldEnvelope<unknown> | undefined) ?? null;

const headerSet =
  <K extends keyof Extracted>(key: K) =>
  (l1: Extracted, _line: number | null, env: FieldEnvelope<unknown>): void => {
    (l1 as unknown as Record<string, unknown>)[key as string] = env;
  };

const partyEnv =
  (party: "seller" | "buyer", field: string) =>
  (l1: Extracted): FieldEnvelope<unknown> | null =>
    ((l1[party] as unknown as Record<string, FieldEnvelope<unknown>>)[field] ??
      null) as FieldEnvelope<unknown> | null;

const partySet =
  (party: "seller" | "buyer", field: string) =>
  (l1: Extracted, _line: number | null, env: FieldEnvelope<unknown>): void => {
    (l1[party] as unknown as Record<string, unknown>)[field] = env;
  };

const totalEnv =
  (field: string) =>
  (l1: Extracted): FieldEnvelope<unknown> | null =>
    ((l1.totals as unknown as Record<string, FieldEnvelope<unknown>>)[field] ??
      null) as FieldEnvelope<unknown> | null;

const totalSet =
  (field: string) =>
  (l1: Extracted, _line: number | null, env: FieldEnvelope<unknown>): void => {
    (l1.totals as unknown as Record<string, unknown>)[field] = env;
  };

const lineEnv =
  (field: string) =>
  (l1: Extracted, line: number | null): FieldEnvelope<unknown> | null => {
    if (line == null) return null;
    const row = l1.lines[line];
    if (!row) return null;
    return ((row as unknown as Record<string, FieldEnvelope<unknown>>)[field] ??
      null) as FieldEnvelope<unknown> | null;
  };

const lineSet =
  (field: string) =>
  (l1: Extracted, line: number | null, env: FieldEnvelope<unknown>): void => {
    if (line == null) return;
    const row = l1.lines[line];
    if (!row) return;
    (row as unknown as Record<string, unknown>)[field] = env;
  };

/**
 * Bottle-equivalent, recomputed the way the rest of the gateway computes it.
 *
 * A corrected quantity that left `qtyBottles` alone would show 10 on the sheet
 * and reconcile 12 against the order — the worst of the two failures, because
 * the screen would look corrected.
 */
function recomputeBottles(l: ParsedLine): void {
  l.qtyBottles = toBottles(l.qty, l.uom, l.packSize);
}

const parsedLine =
  (fn: (l: ParsedLine, value: unknown) => void) =>
  (p: ParsedDocument, line: number | null, value: unknown): void => {
    if (line == null) return;
    const row = p.lines[line];
    if (!row) return;
    fn(row, value);
  };

const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const asString = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

export const CORRECTABLE_PATHS: Record<string, CorrectablePath> = {
  // ---- header ------------------------------------------------------------
  documentNumber: {
    label: "Document number",
    type: "string",
    bt: "BT-1",
    learnableKey: null,
    read: headerEnv("documentNumber"),
    write: headerSet("documentNumber"),
    toParsed: (p, _l, v) => {
      p.docNumber = asString(v);
    },
  },
  issueDate: {
    label: "Issue date",
    type: "string",
    bt: "BT-2",
    learnableKey: null,
    read: headerEnv("issueDate"),
    write: headerSet("issueDate"),
    toParsed: (p, _l, v) => {
      p.docDate = asString(v);
    },
  },
  currency: {
    label: "Currency",
    type: "string",
    bt: "BT-5",
    learnableKey: null,
    read: headerEnv("currency"),
    write: headerSet("currency"),
    toParsed: (p, _l, v) => {
      p.currency = asString(v) ?? p.currency;
    },
  },
  paymentDueDate: {
    label: "Payment due date",
    type: "string",
    bt: "BT-9",
    learnableKey: null,
    read: headerEnv("paymentDueDate"),
    write: headerSet("paymentDueDate"),
  },
  paymentTerms: {
    label: "Payment terms",
    type: "string",
    bt: "BT-20",
    learnableKey: null,
    read: headerEnv("paymentTerms"),
    write: headerSet("paymentTerms"),
  },
  purchaseOrderReference: {
    label: "Purchase order reference",
    type: "string",
    bt: "BT-13",
    learnableKey: null,
    read: headerEnv("purchaseOrderReference"),
    write: headerSet("purchaseOrderReference"),
    toParsed: (p, _l, v) => {
      p.poNumber = asString(v);
    },
  },
  despatchAdviceReference: {
    label: "Delivery note reference",
    type: "string",
    bt: "BT-16",
    learnableKey: null,
    read: headerEnv("despatchAdviceReference"),
    write: headerSet("despatchAdviceReference"),
  },
  precedingInvoiceReference: {
    label: "Credited invoice reference",
    type: "string",
    bt: "BT-25",
    learnableKey: null,
    read: headerEnv("precedingInvoiceReference"),
    write: headerSet("precedingInvoiceReference"),
    toParsed: (p, _l, v) => {
      p.referencesDocNumber = asString(v);
    },
  },
  actualDeliveryDate: {
    label: "Delivery date",
    type: "string",
    bt: "BT-72",
    learnableKey: null,
    read: headerEnv("actualDeliveryDate"),
    write: headerSet("actualDeliveryDate"),
    toParsed: (p, _l, v) => {
      p.deliveredDate = asString(v);
    },
  },
  deliveryLocation: {
    label: "Deliver-to location",
    type: "string",
    bt: "BT-71",
    learnableKey: null,
    read: headerEnv("deliveryLocation"),
    write: headerSet("deliveryLocation"),
  },

  // ---- parties -----------------------------------------------------------
  "seller.name": {
    label: "Seller",
    type: "string",
    bt: "BT-27",
    learnableKey: null,
    read: partyEnv("seller", "name"),
    write: partySet("seller", "name"),
    toParsed: (p, _l, v) => {
      p.vendorName = asString(v);
    },
  },
  "seller.vatIdentifier": {
    label: "Seller VAT identifier",
    type: "string",
    bt: "BT-31",
    learnableKey: null,
    read: partyEnv("seller", "vatIdentifier"),
    write: partySet("seller", "vatIdentifier"),
  },
  "seller.identifier": {
    label: "Seller account identifier",
    type: "string",
    bt: "BT-29",
    learnableKey: null,
    read: partyEnv("seller", "identifier"),
    write: partySet("seller", "identifier"),
    toParsed: (p, _l, v) => {
      p.vendorAccount = asString(v);
    },
  },
  "seller.address": {
    label: "Seller address",
    type: "string",
    bt: "BG-5",
    learnableKey: null,
    read: partyEnv("seller", "address"),
    write: partySet("seller", "address"),
  },
  "buyer.name": {
    label: "Buyer",
    type: "string",
    bt: "BT-44",
    learnableKey: null,
    read: partyEnv("buyer", "name"),
    write: partySet("buyer", "name"),
  },
  "buyer.vatIdentifier": {
    label: "Buyer VAT identifier",
    type: "string",
    bt: "BT-48",
    learnableKey: null,
    read: partyEnv("buyer", "vatIdentifier"),
    write: partySet("buyer", "vatIdentifier"),
  },

  // ---- totals ------------------------------------------------------------
  // BT-107, BT-108 and BT-109 are absent on purpose: they are sums of the
  // allowance/charge groups and of BT-106 (BR-CO-13), so a hand-entered value
  // would be overwritten on the next read.
  "totals.linesNetTotal": {
    label: "Lines subtotal",
    type: "number",
    bt: "BT-106",
    learnableKey: null,
    read: totalEnv("linesNetTotal"),
    write: totalSet("linesNetTotal"),
    toParsed: (p, _l, v) => {
      p.subtotal = asNumber(v);
    },
  },
  "totals.taxAmount": {
    label: "Tax total",
    type: "number",
    bt: "BT-110",
    learnableKey: null,
    read: totalEnv("taxAmount"),
    write: totalSet("taxAmount"),
    toParsed: (p, _l, v) => {
      p.tax = asNumber(v);
    },
  },
  "totals.taxInclusiveAmount": {
    label: "Document total",
    type: "number",
    bt: "BT-112",
    learnableKey: null,
    read: totalEnv("taxInclusiveAmount"),
    write: totalSet("taxInclusiveAmount"),
    toParsed: (p, _l, v) => {
      p.total = asNumber(v);
    },
  },

  // ---- lines -------------------------------------------------------------
  "lines[].description": {
    label: "Item, line {n}",
    type: "string",
    bt: "BT-153",
    learnableKey: "item_identity",
    read: lineEnv("description"),
    write: lineSet("description"),
    toParsed: parsedLine((l, v) => {
      l.description = asString(v);
    }),
  },
  "lines[].sellerItemId": {
    label: "Vendor SKU, line {n}",
    type: "string",
    bt: "BT-155",
    learnableKey: "item_identity",
    read: lineEnv("sellerItemId"),
    write: lineSet("sellerItemId"),
    toParsed: parsedLine((l, v) => {
      l.vendorSku = asString(v);
    }),
  },
  "lines[].quantity": {
    label: "Quantity, line {n}",
    type: "number",
    bt: "BT-129",
    learnableKey: null,
    read: lineEnv("quantity"),
    write: lineSet("quantity"),
    toParsed: parsedLine((l, v) => {
      l.qty = asNumber(v) ?? 0;
      recomputeBottles(l);
    }),
  },
  "lines[].unit": {
    label: "Unit, line {n}",
    type: "string",
    bt: "BT-130",
    learnableKey: "unit",
    read: lineEnv("unit"),
    write: lineSet("unit"),
    toParsed: parsedLine((l, v) => {
      // A unit we cannot read is NOT silently kept as the old one: the
      // correction was an assertion about this line, and pretending it did not
      // land would make the screen and the log disagree. `normalizeUom` returns
      // null for an unreadable unit and the caller has already refused the
      // request in that case (see DocumentCorrectionService).
      const u = normalizeUom(asString(v));
      if (u) l.uom = u as Uom;
      recomputeBottles(l);
    }),
  },
  "lines[].netPrice": {
    label: "Unit price, line {n}",
    type: "number",
    bt: "BT-146",
    learnableKey: "price",
    read: lineEnv("netPrice"),
    write: lineSet("netPrice"),
    toParsed: parsedLine((l, v) => {
      l.unitPrice = asNumber(v);
    }),
  },
  "lines[].priceBaseQuantity": {
    label: "Price base quantity, line {n}",
    type: "number",
    bt: "BT-149",
    learnableKey: "unit",
    read: lineEnv("priceBaseQuantity"),
    write: lineSet("priceBaseQuantity"),
    toParsed: parsedLine((l, v) => {
      l.priceBaseQty = asNumber(v);
    }),
  },
  "lines[].priceBaseUnit": {
    label: "Price base unit, line {n}",
    type: "string",
    bt: "BT-150",
    learnableKey: "unit",
    read: lineEnv("priceBaseUnit"),
    write: lineSet("priceBaseUnit"),
    toParsed: parsedLine((l, v) => {
      l.priceBaseUom = normalizeUom(asString(v));
    }),
  },
  "lines[].netAmount": {
    label: "Line total, line {n}",
    type: "number",
    bt: "BT-131",
    learnableKey: null,
    read: lineEnv("netAmount"),
    write: lineSet("netAmount"),
    toParsed: parsedLine((l, v) => {
      l.lineTotal = asNumber(v);
    }),
  },
  "lines[].vintage": {
    label: "Vintage, line {n}",
    type: "number",
    bt: null,
    learnableKey: "item_identity",
    read: lineEnv("vintage"),
    write: lineSet("vintage"),
    toParsed: parsedLine((l, v) => {
      l.vintage = asNumber(v);
    }),
  },
  "lines[].formatMl": {
    label: "Format (ml), line {n}",
    type: "number",
    bt: null,
    learnableKey: "item_identity",
    read: lineEnv("formatMl"),
    write: lineSet("formatMl"),
    toParsed: parsedLine((l, v) => {
      l.formatMl = asNumber(v);
    }),
  },
  "lines[].freeGoodsQty": {
    label: "Free goods, line {n}",
    type: "number",
    bt: null,
    learnableKey: null,
    read: lineEnv("freeGoodsQty"),
    write: lineSet("freeGoodsQty"),
    toParsed: parsedLine((l, v) => {
      l.freeGoodsQty = asNumber(v) ?? 0;
    }),
  },
  "lines[].lineKind": {
    label: "What line {n} is",
    type: "string",
    bt: null,
    learnableKey: "item_identity",
    read: lineEnv("lineKind"),
    write: lineSet("lineKind"),
    toParsed: parsedLine((l, v) => {
      const s = asString(v);
      l.lineKind =
        s === "goods" || s === "deposit" || s === "fee" ? s : l.lineKind;
    }),
  },
  "lines[].lot": {
    label: "Lot, line {n}",
    type: "string",
    bt: null,
    learnableKey: null,
    read: lineEnv("lot"),
    write: lineSet("lot"),
  },
};

/** `Quantity, line {n}` → `Quantity, line 4`. */
export function labelFor(template: string, line: number | null): string {
  const spec = CORRECTABLE_PATHS[template];
  if (!spec) return template;
  return spec.label.replace("{n}", line == null ? "" : String(line + 1));
}

/**
 * Replay one correction onto a ParsedDocument, in place, and re-run the tie-out.
 *
 * Returns the NEW document, because `applyTieOut` is pure and returns one.
 * A path with no `toParsed` returns the document unchanged, which is the honest
 * answer for a field that moves no arithmetic.
 */
export function replayOnParsed(
  parsed: ParsedDocument,
  template: string,
  line: number | null,
  value: unknown,
): ParsedDocument {
  const spec = CORRECTABLE_PATHS[template];
  if (!spec?.toParsed) return parsed;
  spec.toParsed(parsed, line, value);
  return applyTieOut(parsed);
}
