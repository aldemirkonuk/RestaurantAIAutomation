import { normalizeUom, Uom } from "../documents/document-types";
import { ParsedDocument, ParsedLine } from "../documents/parsed-document";
import { reconciliationVerdict } from "../documents/reconciliation-verdict";
import { runInvariants } from "./canonical-invariants";
import {
  Adjudicated,
  AdjudicatedLine,
  AllowanceCharge,
  CanonicalDocument,
  Direction,
  Extracted,
  ExtractedLine,
  ExtractedParty,
  FieldEnvelope,
  Jurisdiction,
  ReceivedQuantity,
  Resolved,
  ResolvedLine,
  Source,
  envelope,
} from "./canonical-types";

/**
 * from-parsed-document — lift a `ParsedDocument` into the canonical object.
 *
 * `ParsedDocument` IS NOT MODIFIED. It stays the single thing every intake
 * channel produces (its own doc comment is emphatic about why), and this is a
 * pure function on top of it. Nothing here reaches a database.
 *
 * WHAT IS AND IS NOT PRESERVED, stated because the gaps are the honest part:
 *
 *   * `source` is `"extracted"` for everything a parse produced — including for
 *     an X12 810, whose real source is `"edi"`. The caller passes the true
 *     source; the default is the pessimistic one, since claiming `edi` for an
 *     OCR read would be the exact `learned_from_vendor` masquerade ADR 0104 D1
 *     names.
 *   * `confidence` is NULL on every field, and that is the honest answer rather
 *     than a missing one. The extractor's number is `0.8 − 0.1 × warnings` — a
 *     DOCUMENT-level heuristic counting how many things looked odd overall, not
 *     a probability about any one field. ADR 0104 D1 makes the envelope's
 *     `confidence` null when the source has no per-field notion of one, and
 *     stamping the document heuristic onto forty fields would render as though
 *     the model had graded each number individually. The heuristic still exists
 *     where it always did (`ParsedDocument.confidence`, and
 *     `procurement_documents.extraction_confidence`) and still decides what a
 *     human sees first. Until the extractor returns a real per-field signal,
 *     null is what the envelope says.
 *   * `as_printed` carries the literal glyphs for every field the parse KEPT one
 *     for: descriptions, document numbers, dates and units keep their strings,
 *     and money and quantity fields now carry `ParsedLine.printed` /
 *     `ParsedDocument.printed` when the extractor read them. Nothing here is
 *     reformatted — `1.704,00` reaches the envelope as `1.704,00`. A null
 *     `as_printed` still means "we did not keep it", never "the paper was
 *     blank"; the `as_printed_not_mutated` invariant reports exactly that.
 *   * `page` and `bbox` are NULL throughout: the extractor returns no geometry.
 *
 * Layer 2 is filled only from what the caller already resolved (match rows);
 * this function does not go looking. Layer 3 is computed: the invariants plus
 * the existing `reconciliationVerdict` grader, whose `_v1` basis proves
 * ARITHMETIC CONSISTENCY and not correctness.
 */

export interface MapOptions {
  documentId: string;
  restaurantId: string;
  /** Where the values came from. Defaults to `extracted` — the pessimistic one. */
  source?: Source;
  /** Which revision this becomes. Defaults to 1. */
  revision?: number;
  direction?: Direction;
  jurisdiction?: Jurisdiction | null;
  providerId?: string | null;
  /** Per-line resolution from the match tables, when the caller has read them. */
  resolvedLines?: ResolvedLine[];
  /** Ordered / shipped / received per line index, when a delivery is known. */
  spine?: Record<
    number,
    {
      ordered?: number | null;
      shipped?: number | null;
      received?: ReceivedQuantity;
    }
  >;
}

const env = <T>(
  value: T | null,
  source: Source,
  revision: number,
  confidence: number | null,
  asPrinted?: string | null,
): FieldEnvelope<T> =>
  envelope(value, source, {
    confidence,
    revision,
    page: null,
    bbox: null,
    as_printed: asPrinted ?? null,
  });

function party(
  name: string | null | undefined,
  identifier: string | null | undefined,
  source: Source,
  revision: number,
  confidence: number | null,
): ExtractedParty {
  return {
    name: env(name ?? null, source, revision, confidence, name ?? null),
    vatIdentifier: env<string>(null, source, revision, confidence),
    identifier: env(
      identifier ?? null,
      source,
      revision,
      confidence,
      identifier ?? null,
    ),
    address: env<string>(null, source, revision, confidence),
    electronicAddress: env<string>(null, source, revision, confidence),
  };
}

/**
 * Document-level charges, one group per stated fee.
 *
 * `ParsedDocument` flattens them into named scalars (freight, fuelSurcharge,
 * splitCaseFee, deliveryFee, depositTotal, otherCharges, discountTotal), so the
 * reason code has to be reconstructed from the field's NAME. That is honest —
 * the name is the only reason the parser recorded — and `reasonCode` is left
 * NULL where no standard code is certain, which makes the
 * `deposits_coded_and_excluded` invariant able to say so instead of us inventing
 * a UNCL7161 value.
 */
function documentCharges(
  doc: ParsedDocument,
  source: Source,
  revision: number,
  confidence: number | null,
): AllowanceCharge[] {
  const rows: {
    amount: number | null | undefined;
    reason: string;
    code: string | null;
    isCharge: boolean;
    printed?: string | null;
  }[] = [
    {
      amount: doc.freight,
      reason: "Freight",
      code: "FC",
      isCharge: true,
      printed: doc.printed?.freight ?? null,
    },
    {
      amount: doc.fuelSurcharge,
      reason: "Fuel surcharge",
      code: null,
      isCharge: true,
    },
    {
      amount: doc.splitCaseFee,
      reason: "Split case fee",
      code: null,
      isCharge: true,
    },
    {
      amount: doc.deliveryFee,
      reason: "Delivery fee",
      code: null,
      isCharge: true,
    },
    {
      amount: doc.depositTotal,
      reason: "Deposit",
      code: null,
      isCharge: true,
    },
    {
      amount: doc.otherCharges,
      reason: "Other charges",
      code: null,
      isCharge: true,
    },
    {
      amount: doc.discountTotal,
      reason: "Discount",
      code: null,
      isCharge: false,
    },
  ];

  return rows
    .filter((r) => typeof r.amount === "number" && r.amount !== 0)
    .map((r) => ({
      isCharge: env(r.isCharge, source, revision, confidence),
      amount: env(
        r.amount as number,
        source,
        revision,
        confidence,
        r.printed ?? null,
      ),
      reasonCode: env(r.code, source, revision, confidence),
      reason: env(r.reason, source, revision, confidence, r.reason),
    }));
}

function mapLine(
  l: ParsedLine,
  source: Source,
  revision: number,
  confidence: number | null,
): ExtractedLine {
  const lineAllowances: AllowanceCharge[] = [];
  if (typeof l.allowance === "number" && l.allowance !== 0) {
    lineAllowances.push({
      isCharge: env(false, source, revision, confidence),
      amount: env(
        l.allowance,
        source,
        revision,
        confidence,
        l.printed?.allowance ?? null,
      ),
      reasonCode: env<string>(null, source, revision, confidence),
      reason: env(
        "Line allowance",
        source,
        revision,
        confidence,
        "Line allowance",
      ),
    });
  }
  if (typeof l.deposit === "number" && l.deposit !== 0) {
    lineAllowances.push({
      isCharge: env(true, source, revision, confidence),
      amount: env(
        l.deposit,
        source,
        revision,
        confidence,
        l.printed?.deposit ?? null,
      ),
      reasonCode: env<string>(null, source, revision, confidence),
      reason: env("Deposit", source, revision, confidence, "Deposit"),
    });
  }

  return {
    lineId: env(
      String(l.lineNo),
      source,
      revision,
      confidence,
      String(l.lineNo),
    ),
    description: env(
      l.description ?? null,
      source,
      revision,
      confidence,
      l.description ?? null,
    ),
    sellerItemId: env(
      l.vendorSku ?? null,
      source,
      revision,
      confidence,
      l.vendorSku ?? null,
    ),
    quantity: env(l.qty, source, revision, confidence, l.printed?.qty ?? null),
    unit: env(l.uom, source, revision, confidence, l.uom),
    netPrice: env(
      l.unitPrice ?? null,
      source,
      revision,
      confidence,
      l.printed?.unitPrice ?? null,
    ),
    // BT-149/BT-150 — WHAT THE PAPER PRINTED, or one invoiced unit when it
    // printed nothing.
    //
    // `packSize` is still NOT this: it is bottles-per-case, a CONVERSION, and it
    // lands in layer 2 where it belongs. The price base is a different fact —
    // the quantity the price is stated FOR — and `142,00 / KS(12)` states it
    // explicitly. It now round-trips through `ParsedLine.priceBaseQty` /
    // `priceBaseUom`, so a line whose quantity is in cases and whose price is
    // per twelve bottles arrives here intact instead of being normalised away.
    //
    // The fallback of `1` in the invoiced unit is the pre-existing assumption,
    // now stated rather than implied: with no printed basis, `unitPrice` is per
    // one `uom`. It is a claim about OUR reading, not about the page, which is
    // why the envelope's `as_printed` stays null on both fields unless the
    // extractor kept the literal.
    priceBaseQuantity: env(
      l.priceBaseQty ?? 1,
      source,
      revision,
      confidence,
      l.printed?.priceBaseQty ?? null,
    ),
    priceBaseUnit: env(l.priceBaseUom ?? l.uom, source, revision, confidence),
    netAmount: env(
      l.lineTotal ?? null,
      source,
      revision,
      confidence,
      l.printed?.lineTotal ?? null,
    ),
    allowancesCharges: lineAllowances,
    vatCategory: env<string>(null, source, revision, confidence),
    vatRate: env<number>(null, source, revision, confidence),
    vintage: env(l.vintage ?? null, source, revision, confidence),
    lot: env<string>(null, source, revision, confidence),
    formatMl: env(l.formatMl ?? null, source, revision, confidence),
    freeGoodsQty: env(l.freeGoodsQty ?? 0, source, revision, confidence),
  };
}

/**
 * The UNCL1001 type code our doc_type implies.
 *
 * Returned only for the two types where the mapping is unambiguous. Everything
 * else is NULL rather than a guess: the code is a regulated field, and §D7 of
 * the earlier research (never fabricate a regulated field) applies to it.
 */
function typeCodeFor(docType: string): string | null {
  if (docType === "invoice") return "380";
  if (docType === "credit_memo") return "381";
  return null;
}

export function canonicalFromParsedDocument(
  parsed: ParsedDocument,
  opts: MapOptions,
): CanonicalDocument {
  const source: Source = opts.source ?? "extracted";
  const revision = opts.revision ?? 1;
  // ADR 0104 D1: NULL, not the document heuristic. `parsed.confidence` is
  // `0.8 − 0.1 × warnings` about the whole document; copying it per field would
  // present a count of warnings as a per-number probability.
  const confidence: number | null = null;

  const layer1: Extracted = {
    documentNumber: env(
      parsed.docNumber ?? null,
      source,
      revision,
      confidence,
      parsed.docNumber ?? null,
    ),
    issueDate: env(
      parsed.docDate ?? null,
      source,
      revision,
      confidence,
      parsed.docDate ?? null,
    ),
    typeCode: env(typeCodeFor(parsed.docType), source, revision, confidence),
    currency: env(
      parsed.currency ?? null,
      source,
      revision,
      confidence,
      parsed.currency ?? null,
    ),
    paymentDueDate: env<string>(null, source, revision, confidence),
    paymentTerms: env<string>(null, source, revision, confidence),
    seller: party(
      parsed.vendorName,
      parsed.vendorAccount,
      source,
      revision,
      confidence,
    ),
    buyer: party(null, null, source, revision, confidence),
    purchaseOrderReference: env(
      parsed.poNumber ?? null,
      source,
      revision,
      confidence,
      parsed.poNumber ?? null,
    ),
    // An 810 cites the 856 it bills for. `referencesDocNumber` is that citation
    // and, on a credit memo, the invoice being credited — so it lands in BOTH
    // BT-16 and BT-25 rather than being dropped into whichever one fit first.
    despatchAdviceReference: env(
      parsed.docType === "credit_memo"
        ? null
        : (parsed.referencesDocNumber ?? null),
      source,
      revision,
      confidence,
      parsed.referencesDocNumber ?? null,
    ),
    precedingInvoiceReference: env(
      parsed.docType === "credit_memo"
        ? (parsed.referencesDocNumber ?? null)
        : null,
      source,
      revision,
      confidence,
      parsed.referencesDocNumber ?? null,
    ),
    actualDeliveryDate: env<string>(null, source, revision, confidence),
    deliveryLocation: env<string>(null, source, revision, confidence),
    lines: parsed.lines.map((l) => mapLine(l, source, revision, confidence)),
    allowancesCharges: documentCharges(parsed, source, revision, confidence),
    totals: {
      linesNetTotal: env(
        parsed.subtotal ?? parsed.computedLinesTotal ?? null,
        parsed.subtotal != null ? source : "computed",
        revision,
        confidence,
        // Only the SUBTOTAL was printed. `computedLinesTotal` is ours, so it
        // gets no `as_printed` — a computed number must never borrow the paper's
        // authority.
        parsed.subtotal != null ? (parsed.printed?.subtotal ?? null) : null,
      ),
      allowancesTotal: env(
        parsed.discountTotal ?? null,
        source,
        revision,
        confidence,
      ),
      chargesTotal: env<number>(null, source, revision, confidence),
      taxExclusiveAmount: env<number>(null, source, revision, confidence),
      taxAmount: env(
        parsed.tax ?? null,
        source,
        revision,
        confidence,
        parsed.printed?.tax ?? null,
      ),
      taxInclusiveAmount: env(
        parsed.total ?? null,
        source,
        revision,
        confidence,
        parsed.printed?.total ?? null,
      ),
      paidAmount: env<number>(null, source, revision, confidence),
      roundingAmount: env<number>(null, source, revision, confidence),
      amountDue: env(
        parsed.total ?? null,
        source,
        revision,
        confidence,
        parsed.printed?.total ?? null,
      ),
    },
    // A parse produces no VAT breakdown: `ParsedDocument` has one `tax` scalar.
    // An EMPTY breakdown is the honest answer and makes BR-CO-14 / BR-S-08
    // report UNTESTABLE, which is what they should say. Fabricating a single
    // "S at whatever rate reproduces the total" row would make them pass.
    vatBreakdown: [],
  };

  const layer2: Resolved = {
    providerId: opts.providerId ?? null,
    lines:
      opts.resolvedLines ??
      parsed.lines.map((l, i): ResolvedLine => {
        const canonicalUom: Uom | null = normalizeUom(l.uom);
        return {
          lineIndex: i,
          inventoryId: null,
          masterWineId: null,
          canonicalUom,
          packSize: l.packSize ?? null,
          qtyBottles: l.qtyBottles ?? null,
          matchMethod: null,
          matchConfidence: null,
          vintage: l.vintage ?? null,
          lot: null,
        };
      }),
  };

  // Layer 3. `received` is "not_counted" unless the caller supplies a door
  // count — ADR 0103 A6, and the reason the invariant exists.
  const adjudicatedLines: AdjudicatedLine[] = parsed.lines.map(
    (l, i): AdjudicatedLine => {
      const s = opts.spine?.[i];
      return {
        lineIndex: i,
        ordered: s?.ordered ?? null,
        shipped: s?.shipped ?? null,
        received: s?.received ?? "not_counted",
        billed: l.qtyBottles ?? null,
        verdict: "not_adjudicated",
        reason: null,
        moneyAtRisk: null,
      };
    },
  );

  const draft: CanonicalDocument = {
    documentId: opts.documentId,
    restaurantId: opts.restaurantId,
    docType: parsed.docType,
    direction: opts.direction ?? "issued_by_vendor",
    jurisdiction: opts.jurisdiction ?? null,
    revision,
    layer1,
    layer2,
    layer3: {
      lines: adjudicatedLines,
      tiesOut: parsed.tiesOut ?? null,
      tieOutDeltaCents:
        parsed.tieOutDelta == null
          ? null
          : Math.round(parsed.tieOutDelta * 100),
      verdicts: [],
    },
  };

  // Invariants run against the assembled object, so they see exactly what a
  // reader would. The reconciliation grader is folded in as one more verdict so
  // the object carries a single list, not two competing ones.
  const verdicts = runInvariants(draft);
  const recon = reconciliationVerdict(parsed);
  if (recon) {
    verdicts.push({
      id: "reconciliation_v1",
      rule: null,
      path: null,
      holds: recon.outcome === null ? null : recon.outcome === "success",
      expected: parsed.computedLinesTotal,
      found: parsed.total,
      explanation:
        recon.outcome === null
          ? "Not testable: the document states no total, so the tie-out is untestable rather than failing."
          : recon.outcome === "success"
            ? "The stated total ties out to the lines plus charges."
            : `The stated total is off by ${parsed.tieOutDelta?.toFixed(2) ?? "?"} against the lines plus charges.`,
    });
  }

  const layer3: Adjudicated = { ...draft.layer3, verdicts };
  return { ...draft, layer3 };
}
