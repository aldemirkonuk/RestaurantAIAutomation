import { normalizeUom, Uom } from "../documents/document-types";
import {
  isDepositLine,
  lineNetFromPrice,
  ParsedDocument,
  ParsedLine,
} from "../documents/parsed-document";
import { reconciliationVerdict } from "../documents/reconciliation-verdict";
import { runInvariants } from "./canonical-invariants";
import {
  Adjudicated,
  AdjudicatedLine,
  AllowanceCharge,
  CanonicalDocument,
  DEPOSIT_REASON,
  DEPOSIT_REASON_CODE,
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
  VatBreakdownEntry,
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
  /**
   * BG-4 — the seller, when the CALLER resolved one from our own records.
   *
   * `procurement_documents` has no vendor-name column, so before this existed
   * layer 1's seller could only come from `ParsedDocument.vendorName` — which a
   * rebuild-from-columns never has. Every one of the three documents read on
   * 2026-09-04 therefore rendered "The seller is not named on this document"
   * while its extraction had supplied a name.
   *
   * `source` is the caller's to state and MUST NOT be `extracted` for a name
   * that came from a provider row: that name is our record of this vendor, not
   * glyphs on this page, and ADR 0104 D1 exists to keep those apart.
   */
  seller?: { name: string | null; source: Source } | null;
  /** BG-7 — the buyer (this restaurant), from the restaurant row. Same rule. */
  buyer?: { name: string | null; source: Source } | null;
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

/**
 * A party (BG-4 seller / BG-7 buyer).
 *
 * `nameSource` is separate from `source` because the two can differ: a seller
 * name read off the page is `extracted` and keeps its glyphs in `as_printed`,
 * while one taken from a resolved provider row came from OUR RECORDS and gets
 * no `as_printed` at all — it was never printed on this document. Collapsing
 * them is precisely the `learned_from_vendor` masquerade ADR 0104 D1 names.
 *
 * BT-31/BT-48 (the VAT identifier — the Turkish VKN) stays NULL throughout, and
 * that is measured rather than assumed: `providers` and `restaurants` were both
 * read on 2026-09-05 and NEITHER has a tax-id column. Until one exists there is
 * nothing to fill it from, and a blank is the honest answer.
 */
function party(
  name: string | null | undefined,
  identifier: string | null | undefined,
  source: Source,
  revision: number,
  confidence: number | null,
  nameSource: Source = source,
): ExtractedParty {
  const printedName = nameSource === "extracted" ? (name ?? null) : null;
  return {
    name: env(name ?? null, nameSource, revision, confidence, printedName),
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

/** Cents, so a sum of floats does not print 1234.5600000000002. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * BG-23 from `ParsedDocument.taxBreakdown`.
 *
 * The rows are the paper's, one per printed rate. A document that prints a
 * SINGLE tax line with a rate and a base ("KDV %20 (matrah 9.172,00) 1.834,40",
 * "Sales tax 8.625% on 2,940.00") yields ONE row — one row is a breakdown, and
 * BR-CO-18 is satisfied by it. `taxableAmount` and `taxAmount` stay NULL where
 * the page printed only one of them; the invariants report untestable on the
 * half that is missing rather than deriving it.
 */
function vatBreakdown(
  doc: ParsedDocument,
  source: Source,
  revision: number,
  confidence: number | null,
): VatBreakdownEntry[] {
  if (!Array.isArray(doc.taxBreakdown)) return [];
  return doc.taxBreakdown.map((row) => ({
    category: env(row.category ?? null, source, revision, confidence),
    rate: env(row.rate, source, revision, confidence),
    taxableAmount: env(row.taxableBase, source, revision, confidence),
    taxAmount: env(row.amount, source, revision, confidence),
  }));
}

/** What a line contributes, from its stated total or its price basis. */
function lineNet(l: ParsedLine): number {
  if (typeof l.lineTotal === "number" && Number.isFinite(l.lineTotal))
    return l.lineTotal;
  const { net } = lineNetFromPrice(l);
  return typeof net === "number" && Number.isFinite(net) ? net : 0;
}

/**
 * The deposit, counted ONCE, coded, and always at document level (BG-21).
 *
 * Three arrangements reach us and all three must produce one charge:
 *
 *   depositTotal only          a Californian CRV subtotal row.
 *   deposit LINES only         a Turkish depozito billed as a goods line.
 *   BOTH, stating the same     the Turkish invoice read 2026-09-04, which
 *                              printed ₺180 as line 4 AND as a subtotal.
 *
 * The stated subtotal wins when there is one, because it is the paper's own
 * number and carries a printed literal; the lines' sum is used only when the
 * paper stated no subtotal, and it is then marked `computed` and given no
 * `as_printed` — a sum of ours must never borrow the paper's authority.
 *
 * A DISAGREEMENT IS NOT RECONCILED HERE. When both are stated and differ, this
 * still emits one charge (the stated subtotal) and
 * `deposits_coded_and_excluded` reports the disagreement, which is the right
 * place for it: the mapper's job is to carry what the paper said, and a
 * silently-averaged deposit would be a number nobody printed.
 */
function depositCharge(
  doc: ParsedDocument,
  source: Source,
  revision: number,
  confidence: number | null,
): AllowanceCharge | null {
  const fromLines = doc.lines
    .filter(isDepositLine)
    .reduce((acc, l) => acc + lineNet(l), 0);
  const stated =
    typeof doc.depositTotal === "number" && doc.depositTotal !== 0
      ? doc.depositTotal
      : null;
  const amount = stated ?? (fromLines !== 0 ? round2(fromLines) : null);
  if (amount === null) return null;

  const amountSource: Source = stated !== null ? source : "computed";
  return {
    isCharge: env(true, source, revision, confidence),
    amount: env(
      amount,
      amountSource,
      revision,
      confidence,
      stated !== null ? (doc.printed?.depositTotal ?? null) : null,
    ),
    reasonCode: env(DEPOSIT_REASON_CODE, source, revision, confidence),
    reason: env(DEPOSIT_REASON, source, revision, confidence, DEPOSIT_REASON),
  };
}

/** Two money amounts agree to the cent. */
const centsEqual = (a: number, b: number) =>
  Math.abs(Math.round((a - b) * 100)) <= 1;

/**
 * BT-106 — THE GOODS TOTAL, WITH A DEPOSIT LINE LIFTED OUT OF IT.
 *
 * MEASURED 2026-09-05 on the Turkish invoice `b1e02edf`, whose paper prints the
 * ₺180 depozito BOTH as line 4 AND as a "Depozito (KDV %0) 180,00" subtotal
 * row, and whose stated `subtotal` of ₺9.352,00 is the goods (₺9.172,00) PLUS
 * that deposit. `linesNet` was `parsed.subtotal ?? parsed.computedLinesTotal`,
 * so the stated subtotal won unconditionally and carried the deposit into
 * BT-106 — while `depositCharge` correctly emitted the SAME ₺180 again as a
 * BG-21 charge. The sheet then rendered Lines ₺9.352,00 + Charges ₺180,00 =
 * Before tax ₺9.532,00, and printed the stated total ₺11.186,40 underneath a
 * ladder that came to ₺11.366,40. The deposit was counted twice and nothing
 * said so.
 *
 * `computedLinesTotal` (from `applyTieOut`) already excludes a
 * `lineKind: "deposit"` line, so the two numbers differing BY EXACTLY THE
 * DEPOSIT is the evidence that the stated subtotal contains it. That test is a
 * MEASUREMENT, not an assumption:
 *
 *   stated − depositLines === goods   the subtotal INCLUDES the deposit lines,
 *                                     so BT-106 is the goods sum and is marked
 *                                     `computed` with no `as_printed` — a
 *                                     number we derived must never borrow the
 *                                     paper's authority.
 *   stated === goods                  the subtotal already excludes them; it
 *                                     stands, as printed. (The Californian CRV
 *                                     shape, and every invoice with no deposit
 *                                     line at all.)
 *   neither                           WE CANNOT TELL. The stated subtotal
 *                                     stands untouched and the tie-out and
 *                                     `document_lines_total` name the
 *                                     disagreement. Silently subtracting here
 *                                     would invent a BT-106 nobody printed and
 *                                     make BR-CO-10 unfalsifiable.
 */
function linesNetTotal(doc: ParsedDocument): {
  value: number | null;
  fromStatedSubtotal: boolean;
} {
  const goods =
    typeof doc.computedLinesTotal === "number" &&
    Number.isFinite(doc.computedLinesTotal)
      ? doc.computedLinesTotal
      : null;
  const stated =
    typeof doc.subtotal === "number" && Number.isFinite(doc.subtotal)
      ? doc.subtotal
      : null;

  if (stated === null) return { value: goods, fromStatedSubtotal: false };
  if (goods === null) return { value: stated, fromStatedSubtotal: true };

  const depositLines = round2(
    doc.lines.filter(isDepositLine).reduce((acc, l) => acc + lineNet(l), 0),
  );
  if (depositLines === 0) return { value: stated, fromStatedSubtotal: true };

  return centsEqual(round2(stated - depositLines), goods)
    ? { value: goods, fromStatedSubtotal: false }
    : { value: stated, fromStatedSubtotal: true };
}

/**
 * Document-level charges, one group per stated fee.
 *
 * `ParsedDocument` flattens them into named scalars (freight, fuelSurcharge,
 * splitCaseFee, deliveryFee, depositTotal, otherCharges, discountTotal), so the
 * reason code has to be reconstructed from the field's NAME. That is honest —
 * the name is the only reason the parser recorded — and `reasonCode` is left
 * NULL where no standard code is certain rather than inventing one.
 *
 * THE DEPOSIT IS THE EXCEPTION, and deliberately so. It is the one charge whose
 * code is load-bearing rather than decorative: without it nothing downstream
 * can tell refundable money from cost of goods, and every month it recurs the
 * beverage-cost percentage is wrong (ADR 0103 D7). It is built by
 * `depositCharge`, which also folds in a deposit billed as a LINE.
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

  const named: AllowanceCharge[] = rows
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

  const deposit = depositCharge(doc, source, revision, confidence);
  return deposit ? [...named, deposit] : named;
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
  /**
   * A LINE-LEVEL DEPOSIT IS A CHARGE ON THE LINE — BUT ONLY WHEN THE LINE IS
   * NOT ITSELF THE DEPOSIT.
   *
   * `12 bottles @ ₺142 + ₺5/bottle crate` adds ₺60 to that line's net, and
   * BT-131 = BT-129 × BT-146 ÷ BT-149 + line charges is correct.
   *
   * `2 × ₺90 depozito` with `deposit: 180` is the SAME ₺180 written twice: the
   * transcription of 2026-09-04 produced exactly this and `line_net_amount`
   * expected 360 against a stated 180. A line that IS the deposit carries its
   * deposit in its own total, so nothing is added on top of it — and the
   * extractor prompt now says so in the contract rather than leaving it to be
   * discovered again.
   */
  if (typeof l.deposit === "number" && l.deposit !== 0 && !isDepositLine(l)) {
    lineAllowances.push({
      isCharge: env(true, source, revision, confidence),
      amount: env(
        l.deposit,
        source,
        revision,
        confidence,
        l.printed?.deposit ?? null,
      ),
      reasonCode: env(DEPOSIT_REASON_CODE, source, revision, confidence),
      reason: env(DEPOSIT_REASON, source, revision, confidence, DEPOSIT_REASON),
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
    lineKind: env(l.lineKind ?? "goods", source, revision, confidence),
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

  /**
   * BG-20 / BG-21 built ONCE, because BT-107 and BT-108 are their sums.
   *
   * Before this, `chargesTotal` and `taxExclusiveAmount` were hard NULL and the
   * sheet rendered "Charges —" and "Before tax —" directly beneath a listed
   * "Freight + $45.00" — the document contradicting itself in two adjacent
   * rows (found on screen 2026-09-04). The ladder is arithmetic over what is
   * already on the object, so there is nothing to read and nothing to guess.
   */
  const allowancesCharges = documentCharges(
    parsed,
    source,
    revision,
    confidence,
  );
  const groupedAllowances = round2(
    allowancesCharges
      .filter((ac) => ac.isCharge.value === false)
      .reduce((a, ac) => a + (ac.amount.value ?? 0), 0),
  );
  const groupedCharges = round2(
    allowancesCharges
      .filter((ac) => ac.isCharge.value === true)
      .reduce((a, ac) => a + (ac.amount.value ?? 0), 0),
  );

  // BT-106. The stated subtotal is preferred, EXCEPT where it demonstrably
  // contains a deposit line that BG-21 is already carrying — see linesNetTotal.
  const { value: linesNet, fromStatedSubtotal } = linesNetTotal(parsed);
  // BT-109 = BT-106 − BT-107 + BT-108 (BR-CO-13). Untestable stays untestable:
  // with no BT-106 there is nothing to build the ladder on, and a 0 here would
  // be a total nobody stated.
  const taxExclusive =
    linesNet === null
      ? null
      : round2(linesNet - groupedAllowances + groupedCharges);

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
    // BG-4. The resolved provider wins over the transcription — it is the
    // vendor we actually trade with, and a document that misprints the trading
    // name should still reconcile against that provider's orders. When nothing
    // resolved, the name the extraction read is used AS EXTRACTED.
    seller: party(
      opts.seller?.name ?? parsed.vendorName ?? null,
      parsed.vendorAccount,
      source,
      revision,
      confidence,
      opts.seller?.name ? opts.seller.source : source,
    ),
    // BG-7. The buyer is this restaurant. It is never printed by us and never
    // read off the page, so the caller states where it came from.
    buyer: party(
      opts.buyer?.name ?? null,
      null,
      source,
      revision,
      confidence,
      opts.buyer?.name ? opts.buyer.source : source,
    ),
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
    // BG-13 / BT-72. Only what the paper printed as a DELIVERY date — never
    // `docDate`, which on a Turkish fatura can be a week after the despatch it
    // bills and would make every ADR 0103 A8 clock start late.
    actualDeliveryDate: env(
      parsed.deliveredDate ?? null,
      source,
      revision,
      confidence,
      parsed.deliveredDate ?? null,
    ),
    deliveryLocation: env<string>(null, source, revision, confidence),
    lines: parsed.lines.map((l) => mapLine(l, source, revision, confidence)),
    allowancesCharges,
    totals: {
      linesNetTotal: env(
        linesNet,
        fromStatedSubtotal ? source : "computed",
        revision,
        confidence,
        // Only the SUBTOTAL was printed, and only when it is the number we are
        // carrying. A goods total we derived by taking a deposit line back out
        // of the stated subtotal is OURS, so it gets no `as_printed` — a
        // computed number must never borrow the paper's authority.
        fromStatedSubtotal ? (parsed.printed?.subtotal ?? null) : null,
      ),
      // BT-107 / BT-108 — the SUMS of BG-20 and BG-21, marked `computed`
      // because that is what they are. `discountTotal` alone was never BT-107:
      // it is one allowance among several, and using it as the total made
      // BR-CO-13 unfalsifiable on any document carrying two.
      allowancesTotal: env(groupedAllowances, "computed", revision, confidence),
      chargesTotal: env(groupedCharges, "computed", revision, confidence),
      taxExclusiveAmount: env(taxExclusive, "computed", revision, confidence),
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
    // BG-23, from what the page printed. An EMPTY breakdown is still the
    // honest answer for a document that prints no rate, and it still makes
    // BR-CO-14 / BR-S-08 report UNTESTABLE — which is what they should say.
    // Nothing here derives a rate by dividing the tax by a subtotal: that row
    // would reproduce the total by construction and make every VAT rule pass.
    vatBreakdown: vatBreakdown(parsed, source, revision, confidence),
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
