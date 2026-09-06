import { applyTieOut, CurrencySeen, ParsedDocument } from "./parsed-document";

export type { CurrencySeen };

/**
 * What money an invoice's figures are in, and how that is KNOWN.
 *
 * ---------------------------------------------------------------------------
 * THE FOUNDER'S CALL, 2026-09-06 (batch 63), VERBATIM
 * ---------------------------------------------------------------------------
 *   *"take the houses own currency, but AI needs to or otherwise house
 *   delibaretly chnage it to other currency if the invoice is other than their
 *   default"*
 *
 * Asked about `x12-invoice.ts`'s `currency: el(CUR, 2) ?? "USD"` — an 810 with
 * no `CUR` segment filed its totals as DOLLARS, silently, whoever sent it. Read
 * as three rules, and this module is rules 1 and 2:
 *
 *   1. No `CUR` -> the HOUSE'S OWN currency (`restaurants.currency`). A house
 *      that has stated none, on a file that states none, has its MONEY REFUSED
 *      with a sentence naming both absences. Never `USD`.
 *   2. The model states the currency it SEES on the page, with the location it
 *      saw it. A seen currency that disagrees with the one the invoice would be
 *      filed under HOLDS the money instead of filing it.
 *   3. (Not here — `documents.controller.ts`.) A manager may deliberately
 *      change it, audited.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO DEFAULT ANYWHERE IN THIS FILE
 * ---------------------------------------------------------------------------
 * `?? "USD"` is not a fallback, it is a WRITER. Measured 2026-09-05 against
 * production: all fourteen houses carried `restaurants.currency = 'USD'` and
 * nobody had typed it, because the column carried `DEFAULT 'USD'` and the
 * sign-up insert named no currency key — two of those houses are in Turkiye and
 * one is in London (ADR 0117 Q25;
 * `20260905120000_a_house_names_its_money.sql`). `parse810` carried the same
 * shape one layer up, and it is worse there: the house's own row can at least
 * be corrected by a person, while a document's `currency` column is a claim
 * about a VENDOR that no vendor made.
 *
 * The 832 catalogue parser answered the identical question on 2026-09-06 in
 * `distributor-feed/parse-edi832.ts:379-388` — no currency, no admission, no
 * `USD` default. This module is that rule applied to the 810, with the one
 * difference the founder named: an 810 has a house behind it, and a house's own
 * stated currency IS an answer where a distributor's connection default is not.
 *
 * ---------------------------------------------------------------------------
 * WHAT "REFUSE THE MONEY" MEANS, EXACTLY
 * ---------------------------------------------------------------------------
 * The quantities stay. What shipped is real evidence, and a delivery note is
 * useful without a price. What goes is every MONEY field — the header charges,
 * the total, and each line's `unitPrice` / `lineTotal` / `allowance` /
 * `deposit` — plus the three tie-out fields, because `computedLinesTotal: 0`
 * on a document whose lines were never priced is a claim nobody made.
 *
 * The full parse is NOT lost: `document-intake.service.ts` writes it whole into
 * `procurement_documents.extracted`, which is the paper's own reading rather
 * than a filed figure. That is what makes rule 3 able to re-file the money
 * under a currency a person names, instead of asking for the document again.
 */

/** ISO 4217 alpha-3, as published by SIX Financial Information for ISO. */
const ISO_4217_ALPHA3 = /^[A-Z]{3}$/;

/**
 * `CurrencySeen` is declared in `parsed-document.ts` (the two files would
 * otherwise be circular) and re-exported above. NOTHING in it is authority:
 * rule 2's whole shape is that the model FLAGS and a person DECIDES, so a
 * sighting can hold the money but can never set `ParsedDocument.currency`.
 */

/**
 * Which codes a printed glyph or word CAN be.
 *
 * A SET, never a single code, and that is the point: `$` is the symbol of the
 * United States dollar AND of the Canadian, Australian, New Zealand, Singapore,
 * Hong Kong and Mexican ones. Resolving it to `USD` is the exact move this whole
 * pass exists to delete. A glyph is only ever used to REFUTE a filing currency
 * — "the page shows `€` and this would be filed as TRY" — never to choose one.
 *
 * Compiled 2026-09-06 from the currency names already in `apps/web/src/lib/
 * currency.ts` (ISO 4217 list A1) restricted to the symbols and words that
 * actually appear on beverage paperwork this product has read. A glyph NOT in
 * this table resolves to no set at all, which is recorded as evidence and is
 * deliberately NOT a disagreement: a symbol we cannot read cannot refute
 * anything, and pretending otherwise would hold invoices for being unfamiliar.
 */
const GLYPH_CODES: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/^\$|^us\$|^usd?\s*\$/i, ["USD", "CAD", "AUD", "NZD", "SGD", "HKD", "MXN"]],
  [/^€|^eur/i, ["EUR"]],
  [/^£|^gbp/i, ["GBP"]],
  [/^₺|^tl$|^t\.?l\.?$|^try|^türk\s*liras|^turk\s*liras/i, ["TRY"]],
  [/^₽|^rub/i, ["RUB"]],
  [/^¥|^jpy|^cny|^rmb/i, ["JPY", "CNY"]],
  [/^₴|^uah/i, ["UAH"]],
  [/^chf|^fr\.?$/i, ["CHF"]],
];

/**
 * The codes a `CurrencySeen` can be, or `null` for "this cannot be read".
 *
 * The model's own `code` wins when it is a well-formed alpha-3 — it read the
 * page and we did not. Otherwise the printed literal is matched against
 * `GLYPH_CODES`. `null` means the sighting is evidence and nothing more.
 */
export function seenCodes(seen: CurrencySeen): readonly string[] | null {
  const stated = (seen.code ?? "").trim().toUpperCase();
  if (ISO_4217_ALPHA3.test(stated)) return [stated];
  const printed = (seen.asPrinted ?? "").trim();
  if (!printed) return null;
  for (const [pattern, codes] of GLYPH_CODES)
    if (pattern.test(printed)) return codes;
  return null;
}

/**
 * Where the currency an invoice would be FILED under came from.
 *
 * `none` is a first-class outcome and carries the sentence, rather than a
 * caller having to compose one from an absent value — the same shape
 * `PriceCurrencyClaim` uses in `procurement/price-currency.ts`, and for the
 * same reason: the caller that knows nothing has to SAY so.
 */
export type FilingCurrency =
  | { kind: "file"; code: string; from: string }
  | { kind: "order"; code: string; from: string }
  | { kind: "house"; code: string; from: string }
  | { kind: "none"; because: string };

/**
 * Rule 1, as the founder revised it on 2026-09-06 (batch 65).
 *
 * The chain is FOUR rungs and the second one is new:
 *
 *   1. the file's own statement — `CUR02` on an 810, the header on a PDF;
 *   2. **the currency of the ORDER this invoice is matched to**;
 *   3. the house's own `restaurants.currency`, and ONLY when the invoice has no
 *      matched order — the reason travels in the sentence;
 *   4. nothing, and a refusal naming every absence.
 *
 * WHY THE ORDER OUTRANKS THE HOUSE, in the founder's own words: *"we will use
 * the currency from where we order it"*. The house's `restaurants.currency` is
 * what it REPORTS in; the order is what somebody actually agreed with this
 * vendor, for these goods, on a day. When the two differ — a Turkish house that
 * reports in TRY buying a French allocation priced in EUR — the order is right
 * and the house is a coincidence.
 *
 * WHY THE FILE STILL OUTRANKS THE ORDER. A distributor billing in EUR has said
 * so on the paper, and no purchase order restates a vendor's bill. But a file
 * that DISAGREES with its order is not filed quietly either: see
 * `orderDisagreement` below, which holds it exactly as a model sighting does.
 *
 * A file-stated value that is not an alpha-3 is refused rather than stored:
 * `"$"`, `"usd "` and `"US Dollars"` are three ways of nearly saying a currency,
 * and a `varchar(3)` column that accepts all of them holds three currencies
 * where there is one (the argument `priceCurrency` already makes).
 */
export function filingCurrency(args: {
  /** What the document itself stated — `CUR02` on an 810, the header on a PDF. */
  fileStated: string | null | undefined;
  /**
   * `procurement_orders.currency` for the order this document is matched to
   * through `procurement_document_links`. NULL when the order named no currency
   * — an order composed before that column existed, or one whose vendor had
   * stated no usual currency and whose desk chose none.
   */
  orderStated?: string | null | undefined;
  /**
   * Whether this document is matched to an order AT ALL. Distinct from
   * `orderStated` being null, and the distinction is the whole reason the house
   * rung can name its own precondition: "no order names one" and "there is no
   * order" are different sentences and a manager acts on them differently.
   */
  hasMatchedOrder?: boolean;
  /** `restaurants.currency`. NULL when the house has never answered. */
  houseStated: string | null | undefined;
  /** The field the file would have stated it in, named for the sentence. */
  fileField: string;
}): FilingCurrency {
  const file = (args.fileStated ?? "").trim().toUpperCase();
  const order = (args.orderStated ?? "").trim().toUpperCase();
  const house = (args.houseStated ?? "").trim().toUpperCase();
  const matched = args.hasMatchedOrder === true || order !== "";

  if (file !== "" && ISO_4217_ALPHA3.test(file))
    return { kind: "file", code: file, from: `the document's own ${args.fileField}` };

  if (ISO_4217_ALPHA3.test(order))
    return {
      kind: "order",
      code: order,
      from: `the currency the matched order was placed in (procurement_orders.currency)`,
    };

  if (ISO_4217_ALPHA3.test(house))
    return {
      kind: "house",
      code: house,
      from: matched
        ? "this house's own stated currency (restaurants.currency) — the order this document is matched to names none"
        : "this house's own stated currency (restaurants.currency) — this document is matched to no order",
    };

  const fileSaid =
    file === ""
      ? `The document states no ${args.fileField}`
      : `The document's ${args.fileField} is ${JSON.stringify(args.fileStated)}, which is not an ISO 4217 alpha-3 code`;
  const orderSaid = matched
    ? order === ""
      ? ", the order it is matched to names no currency"
      : `, the order it is matched to names ${JSON.stringify(args.orderStated)}, which is not an ISO 4217 alpha-3 code`
    : ", it is matched to no order";
  const houseSaid =
    house === ""
      ? "and this house has never stated its own currency (restaurants.currency is not recorded)"
      : `and this house's own currency is ${JSON.stringify(args.houseStated)}, which is not an ISO 4217 alpha-3 code`;

  return {
    kind: "none",
    because:
      `${fileSaid}${orderSaid}, ${houseSaid}. The money on this document was ` +
      `REFUSED rather than filed: a figure with no currency is not a price, and ` +
      `there is deliberately no USD default here. The quantities were kept. ` +
      `State this house's currency, match this document to an order that names ` +
      `one, or send the document again with its currency on it, and the money ` +
      `can be filed.`,
  };
}

/** The sentence recorded on a document filed under the matched order's currency. */
export function orderCurrencyNote(code: string, fileField: string): string {
  return (
    `The document states no ${fileField}, so its money is filed under the ` +
    `currency the order it is matched to was PLACED in, ${code}. That is what ` +
    `somebody agreed with this vendor for these goods — not this house's ` +
    `reporting currency, and not a claim the vendor made on this paper. If the ` +
    `invoice is in another currency, restate it and the money is re-filed under ` +
    `the one you name.`
  );
}

/** The sentence recorded on a document filed under the house's own currency. */
export function houseCurrencyNote(
  code: string,
  fileField: string,
  hasMatchedOrder = false,
): string {
  return (
    `The document states no ${fileField}, and ` +
    (hasMatchedOrder
      ? `the order it is matched to names no currency either, `
      : `it is matched to no order, `) +
    `so its money is filed under this house's own stated currency, ${code}. ` +
    `That is this house's REPORTING currency and not a claim the vendor made — ` +
    `if this invoice is in another currency, change it on the document and the ` +
    `money is re-filed under the one you name.`
  );
}

/**
 * B3's second half. Does the currency the FILE states contradict the currency
 * the ORDER was placed in?
 *
 * This is deliberately the same verdict as rule 2's model disagreement, and it
 * withholds the money the same way, for a reason that is not symmetry: an
 * invoice denominated differently from its own purchase order is either a
 * vendor billing the wrong desk, a currency typed wrong on the order, or a real
 * re-pricing somebody agreed to. All three are worth a person's minute, and the
 * one thing none of them is worth is a silent price in `price_history` that the
 * four-way match then compares against a number in another money.
 *
 * `null` when there is nothing to contradict: no order, an order with no
 * currency, a file with no currency (rule 1's chain already answers that), or
 * agreement.
 */
export function orderDisagreement(args: {
  fileStated: string | null | undefined;
  orderStated: string | null | undefined;
  fileField: string;
  /** The order's own number, for the sentence. Never load-bearing. */
  orderLabel?: string | null;
}): string | null {
  const file = (args.fileStated ?? "").trim().toUpperCase();
  const order = (args.orderStated ?? "").trim().toUpperCase();
  if (!ISO_4217_ALPHA3.test(file) || !ISO_4217_ALPHA3.test(order)) return null;
  if (file === order) return null;

  const which = args.orderLabel?.trim()
    ? `order ${args.orderLabel.trim()}`
    : "the order it is matched to";
  return (
    `MONEY HELD, NOT FILED. ${which} was placed in ${order}, and this ` +
    `document's ${args.fileField} states ${file}. Nothing has been priced: the ` +
    `money is withheld under BOTH currencies until a person says which one is ` +
    `right, because an invoice in one money checked against an order in another ` +
    `produces a confident wrong verdict rather than no verdict. Nothing was ` +
    `converted — there is no exchange rate in this system. The quantities were ` +
    `kept, and the reading is stored whole, so restating or confirming the ` +
    `currency re-files the money without asking for the document again.`
  );
}

/**
 * Rule 2. Does what the model saw refute what the invoice would be filed under?
 *
 * Three outcomes, and the middle one is why this returns a discriminated union
 * rather than a boolean:
 *
 *   * `agrees`   — the filing code is one of the codes the sighting can be.
 *   * `unreadable` — the model saw SOMETHING and we cannot resolve it to any
 *     code. Evidence, recorded; not a hold. Holding an invoice because a glyph
 *     is unfamiliar would punish the house for our table being short.
 *   * `disagrees` — the filing code is NOT among the codes the sighting can be.
 *     The money is HELD.
 *
 * `seen === null` (the model saw no currency at all) is not passed here; the
 * caller files under rule 1 and records that the model saw none, which is the
 * founder's own wording: *"or state that it saw none"*.
 */
export type CurrencyAgreement =
  | { kind: "agrees" }
  | { kind: "unreadable"; note: string }
  | { kind: "disagrees"; sentence: string };

export function currencyAgreement(
  filed: string,
  seen: CurrencySeen,
): CurrencyAgreement {
  const codes = seenCodes(seen);
  const where = seen.where?.trim() || "an unstated place on the page";
  if (!codes)
    return {
      kind: "unreadable",
      note:
        `The model read ${JSON.stringify(seen.asPrinted)} at ${where} as this ` +
        `document's currency and this gateway cannot resolve that to an ISO ` +
        `4217 code, so it neither confirms nor contradicts the ${filed} this ` +
        `document is filed under. Evidence, not a verdict.`,
    };
  if (codes.includes(filed)) return { kind: "agrees" };

  const couldBe =
    codes.length === 1
      ? codes[0]
      : `one of ${codes.join(", ")}`;
  return {
    kind: "disagrees",
    sentence:
      `MONEY HELD, NOT FILED. This document would be filed under ${filed}, ` +
      `and the model read ${JSON.stringify(seen.asPrinted)} at ${where}, ` +
      `which is ${couldBe} and not ${filed}. Nothing has been priced: the ` +
      `money is withheld from this document under BOTH currencies until a ` +
      `person says which one is right. The quantities were kept, and the ` +
      `reading is stored whole, so naming the currency re-files the money ` +
      `without asking for the document again.`,
  };
}

/**
 * Strip every money figure off a parse, and say why.
 *
 * WHY THE TIE-OUT FIELDS GO TOO. `applyTieOut` on a document whose lines carry
 * no price returns `computedLinesTotal: 0` — a confident claim that the lines
 * sum to nothing, which is the [[absence-reported-as-health]] shape wearing an
 * arithmetic check's badge. `null` on all three says the check could not run,
 * which is the truth.
 *
 * WHY QUANTITIES STAY. What was shipped is the document's other half and it is
 * unaffected by a currency question. A delivery still has to be received.
 */
export function withholdMoney(
  doc: ParsedDocument,
  reason: string,
): ParsedDocument {
  /*
   * THE FIGURES ARE KEPT BEFORE THEY ARE STRIPPED, and this is a correction of a
   * documented-but-untrue invariant, not a new feature. `moneyHeld`'s comment
   * said the full reading survived in `procurement_documents.extracted`; the
   * intake writes `extracted` from THIS object, so once the fields below were
   * nulled the reading was gone from both places. `refiledMoney` then restored a
   * document of nulls while `refilingSentence` announced that the money "was
   * held and is now filed" — the one failure a restatement must not have, since
   * it is the act a manager performs precisely to get the figures back.
   *
   * `moneyWithheld` is NOT re-withheld when a held document is withheld again
   * (which no path does today): `doc.moneyWithheld ?? …` would keep the first,
   * older reading. The `??` below is deliberate and the comment is here so that
   * a future second withholding does not silently overwrite the figures that
   * were real.
   */
  const kept = doc.moneyWithheld ?? {
    subtotal: doc.subtotal ?? null,
    freight: doc.freight ?? null,
    fuelSurcharge: doc.fuelSurcharge ?? null,
    splitCaseFee: doc.splitCaseFee ?? null,
    deliveryFee: doc.deliveryFee ?? null,
    depositTotal: doc.depositTotal ?? null,
    tax: doc.tax ?? null,
    otherCharges: doc.otherCharges ?? null,
    discountTotal: doc.discountTotal ?? null,
    total: doc.total ?? null,
    lines: doc.lines.map((l, i) => ({
      lineNo: typeof l?.lineNo === "number" ? l.lineNo : i + 1,
      unitPrice: l?.unitPrice ?? null,
      lineTotal: l?.lineTotal ?? null,
      allowance: l?.allowance ?? null,
      deposit: l?.deposit ?? null,
    })),
  };

  return {
    ...doc,
    moneyWithheld: kept,
    currency: "",
    subtotal: null,
    freight: null,
    fuelSurcharge: null,
    splitCaseFee: null,
    deliveryFee: null,
    depositTotal: null,
    tax: null,
    otherCharges: null,
    discountTotal: null,
    total: null,
    taxBreakdown: [],
    lines: doc.lines.map((l) => ({
      ...l,
      unitPrice: null,
      lineTotal: null,
      allowance: null,
      deposit: null,
    })),
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    moneyHeld: reason,
    warnings: [...doc.warnings, reason],
    // A document whose money nobody may read is not a document to leave at the
    // bottom of a review queue. It sorts to the top by being the least certain
    // thing on the screen.
    confidence: Math.min(doc.confidence, 0.3),
  };
}

/** The money columns a document carries, as they are written to the row. */
export interface DocumentMoney {
  subtotal: number | null;
  freight: number | null;
  fuel_surcharge: number | null;
  split_case_fee: number | null;
  delivery_fee: number | null;
  deposit_total: number | null;
  tax: number | null;
  other_charges: number | null;
  discount_total: number | null;
  total: number | null;
  computed_lines_total: number | null;
  tie_out_delta: number | null;
  ties_out: boolean | null;
}

/** One line's money, as it is written back to `procurement_document_lines`. */
export interface LineMoney {
  line_no: number;
  unit_price: number | null;
  line_total: number | null;
  allowance: number | null;
  deposit: number | null;
}

/**
 * Rule 3's arithmetic half: what a deliberate currency change puts BACK.
 *
 * Rules 1, 2 and B3 null the money COLUMNS and keep the figures they stripped on
 * the parse, in `moneyWithheld`. This reads the stored snapshot — preferring
 * `moneyWithheld` when it is there, since for a held document the top-level
 * fields are exactly the nulls the hold wrote — and produces the figures to
 * write, denominated in the code a person named. Nothing is
 * converted — there is no exchange rate anywhere in this system and inventing
 * one would be inventing the answer (the `20260905120000` migration's rule 3).
 * The figures are the vendor's own; only what they are DENOMINATED IN changes.
 *
 * The tie-out is recomputed rather than restored, because the snapshot's own
 * tie-out fields were nulled at the same moment the money was: running the
 * document's arithmetic again over the restored figures is the only way the
 * "off by" claim on the screen is about the figures now on the row.
 *
 * `null` when the snapshot is not a parse this can read — a document stored
 * before this shape existed, or a corrupted `extracted`. The caller then says
 * so instead of writing zeroes: a re-filing that quietly restores nothing is
 * the absence-reported-as-health shape aimed at a manager who has just been
 * told their invoice is priced again.
 */
export function refiledMoney(snapshot: unknown): {
  document: DocumentMoney;
  lines: LineMoney[];
} | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return null;
  const s = snapshot as Partial<ParsedDocument>;
  if (!Array.isArray(s.lines)) return null;

  const n = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  /*
   * WHICH FIGURES. For a document whose money was HELD or REFUSED, the
   * top-level fields ARE the nulls the hold wrote, and reading them back is how
   * a restatement came to report a re-filing of nothing. `moneyWithheld` holds
   * what was stripped; when it is present it is the reading, and when it is not
   * (a document that was never held, or one stored before the field existed) the
   * top-level fields are.
   */
  const kept = s.moneyWithheld ?? null;
  const keptLine = (lineNo: number) =>
    kept?.lines?.find((l) => l?.lineNo === lineNo) ?? null;

  const lines = s.lines.map((l, i) => {
    const lineNo = typeof l?.lineNo === "number" ? l.lineNo : i + 1;
    const k = kept ? keptLine(lineNo) : null;
    const src = k ?? l;
    return {
      line_no: lineNo,
      unit_price: n(src?.unitPrice),
      line_total: n(src?.lineTotal),
      allowance: n(src?.allowance),
      deposit: n(src?.deposit),
    };
  });

  const header = {
    subtotal: n(kept ? kept.subtotal : s.subtotal),
    freight: n(kept ? kept.freight : s.freight),
    fuel_surcharge: n(kept ? kept.fuelSurcharge : s.fuelSurcharge),
    split_case_fee: n(kept ? kept.splitCaseFee : s.splitCaseFee),
    delivery_fee: n(kept ? kept.deliveryFee : s.deliveryFee),
    deposit_total: n(kept ? kept.depositTotal : s.depositTotal),
    tax: n(kept ? kept.tax : s.tax),
    other_charges: n(kept ? kept.otherCharges : s.otherCharges),
    discount_total: n(kept ? kept.discountTotal : s.discountTotal),
    total: n(kept ? kept.total : s.total),
  };

  // The tie-out runs over the figures that are actually going onto the row, not
  // over the snapshot as stored — otherwise a restored document's arithmetic
  // would describe the nulls it replaced.
  const rebuilt = applyTieOut({
    ...(s as ParsedDocument),
    subtotal: header.subtotal,
    freight: header.freight,
    fuelSurcharge: header.fuel_surcharge,
    splitCaseFee: header.split_case_fee,
    deliveryFee: header.delivery_fee,
    depositTotal: header.deposit_total,
    tax: header.tax,
    otherCharges: header.other_charges,
    discountTotal: header.discount_total,
    total: header.total,
    lines: s.lines.map((l, i) => {
      const lineNo = typeof l?.lineNo === "number" ? l.lineNo : i + 1;
      const k = kept ? keptLine(lineNo) : null;
      return k ? { ...l, ...k, lineNo } : l;
    }),
    // The tie-out is derived from the figures above, never carried over.
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    warnings: [],
  });

  return {
    document: {
      ...header,
      computed_lines_total: rebuilt.computedLinesTotal,
      tie_out_delta: rebuilt.tieOutDelta,
      ties_out: rebuilt.tiesOut,
    },
    lines,
  };
}

/**
 * What a restatement MOVED, in one sentence, for the response and the page.
 *
 * The founder's rule 3 ends *"and says what moved"*. A number that changes
 * denomination without changing value still moves in the only sense that
 * matters here — it stops being one kind of money and starts being another —
 * and the sentence has to be able to say both that and "nothing was priced
 * before, and now these figures are".
 */
export function refilingSentence(args: {
  previous: string | null;
  next: string;
  wasHeld: boolean;
  documentTotal: number | null;
  lineCount: number;
  pricedLines: number;
}): string {
  const from = args.previous
    ? `from ${args.previous}`
    : "from NOT RECORDED (its money was withheld)";
  const total =
    args.documentTotal == null
      ? "The document states no total"
      : `Its stated total of ${args.documentTotal.toFixed(2)} is now ${args.next}`;
  const lines =
    args.lineCount === 0
      ? "It carries no lines"
      : `${args.pricedLines} of ${args.lineCount} line${args.lineCount === 1 ? "" : "s"} ${args.pricedLines === 1 ? "carries" : "carry"} a price, and ${args.pricedLines === 1 ? "it is" : "they are"} now ${args.next}`;
  const restored = args.wasHeld
    ? ` The money was held and is now filed: nothing was converted, because there is no exchange rate in this system — the vendor's own figures were put back and denominated in ${args.next}.`
    : ` Nothing was converted: the figures are unchanged and only the currency they are stated in has moved.`;
  return `Currency restated ${from} to ${args.next}. ${total}. ${lines}.${restored}`;
}

/**
 * Rule 1 + rule 2 + B3 in one call, for the caller that has a parse, a house,
 * (maybe) a matched order and (maybe) a sighting.
 *
 * Kept here rather than in `document-intake.service.ts` so that the EDI path
 * and the model path cannot answer the same question two ways — the failure
 * mode `ParsedDocument`'s own header names: *"the moment a verdict depends on
 * the channel, 'we photographed it' and 'they sent it electronically' start
 * producing different answers about the same delivery"*.
 *
 * THE TWO HOLDS ARE CHECKED IN A DELIBERATE ORDER. The order disagreement is
 * tested BEFORE the model sighting, because it is the stronger evidence: the
 * order's currency is a fact a person recorded on this house's own system, and
 * the sighting is a model's reading of a photograph. When both would hold the
 * same document, the sentence a manager gets should name the one they can act
 * on without squinting at the paper.
 */
export function applyCurrencyRules(args: {
  doc: ParsedDocument;
  houseCurrency: string | null | undefined;
  /**
   * `procurement_orders.currency` for the order this document is matched to,
   * when there is exactly one. Absent for a document matched to nothing.
   */
  orderCurrency?: string | null | undefined;
  /** Whether the document is matched to an order at all. */
  hasMatchedOrder?: boolean;
  /** The matched order's number, for the sentence. Never load-bearing. */
  orderLabel?: string | null;
  /** The field the document would have stated its currency in. */
  fileField: string;
}): ParsedDocument {
  const { doc, houseCurrency, fileField } = args;

  const filed = filingCurrency({
    fileStated: doc.currency,
    orderStated: args.orderCurrency,
    hasMatchedOrder: args.hasMatchedOrder,
    houseStated: houseCurrency,
    fileField,
  });

  if (filed.kind === "none") return withholdMoney(doc, filed.because);

  // B3. Only reachable when the file itself stated a code — `orderDisagreement`
  // returns null otherwise — so a document filed FROM the order can never
  // disagree with it.
  const versusOrder = orderDisagreement({
    fileStated: doc.currency,
    orderStated: args.orderCurrency,
    fileField,
    orderLabel: args.orderLabel,
  });
  if (versusOrder)
    return withholdMoney(
      { ...doc, currency: filed.code, currencyFiledFrom: filed.from },
      versusOrder,
    );

  /*
   * THE HOUSE-CURRENCY NOTE IS PROVENANCE, NOT A WARNING, AND THAT WAS
   * MEASURED. It sat in `warnings` for one run of `x12.spec.ts`, whose clean
   * two-line 810 then came back with a warning it had never had — and
   * `document-intake.service.ts`'s `needsReview` sends any document with ANY
   * warning to the review queue. Since a domestic 810 routinely carries no
   * `CUR` segment, that would have put essentially every electronic invoice
   * this product receives into review for the entirely ordinary act of being
   * filed in the house's own money. A queue that fills with normal documents
   * is a queue nobody reads, and the genuinely doubtful ones — the refused and
   * the held, which ARE warnings — would be buried under them.
   *
   * So it goes on `currencyFiledFrom`, which is what the screen renders beside
   * the currency. The fact is not lost; it stops being an alarm.
   */
  const warnings = [...doc.warnings];
  const from =
    filed.kind === "house"
      ? houseCurrencyNote(filed.code, fileField, args.hasMatchedOrder === true)
      : filed.kind === "order"
        ? orderCurrencyNote(filed.code, fileField)
        : filed.from;

  const seen = doc.currencySeen ?? null;
  if (!seen) {
    // The founder's *"or state that it saw none"*. Recorded on the document so
    // a reader can tell "the model looked and saw nothing" from "nobody asked
    // the model" — an absence stated is not an absence assumed.
    return {
      ...doc,
      currency: filed.code,
      currencyFiledFrom: from,
      warnings,
    };
  }

  const agreement = currencyAgreement(filed.code, seen);
  if (agreement.kind === "disagrees")
    return withholdMoney(
      { ...doc, currency: filed.code, currencyFiledFrom: from, warnings },
      agreement.sentence,
    );

  return {
    ...doc,
    currency: filed.code,
    currencyFiledFrom: from,
    warnings:
      agreement.kind === "unreadable" ? [...warnings, agreement.note] : warnings,
  };
}

/* ===========================================================================
 * ITEM A — a held invoice refuses a price at the receiving door.
 *
 * THE FOUNDER, 2026-09-06, batch 64, verbatim: *"do option 1 recomemneded,
 * stock proceeds refuse the price at receving, and let them approve if
 * otherwise"*.
 *
 * WHAT IS REFUSED AND WHAT IS NOT. The unit price a person keys into the
 * receiving workspace is refused. The count is not, the stock movement is not,
 * the rejection is not, and the delivery is not. A delivery that physically
 * happened is not made un-happened by a bookkeeping question, and stopping the
 * count would strand goods at the door over one.
 *
 * WHY THE PRICE AND ONLY THE PRICE. `verifyReceipt` puts `invoiceUnitPrice`
 * into `price_history`, into `vendor_price_observations` and into the landed
 * cost of the corrected lot. A figure taken off a document whose currency two
 * parties disagree about reaches the market box, the price ladder and a vendor
 * dispute as real money, denominated by whichever of the two was wrong. That is
 * the exact harm rules 1 to 3 exist to prevent, and it walks straight past them
 * through a text field.
 * ======================================================================== */

/** Whether a document's money may be read, and why not when it may not. */
export type DocumentMoneyState =
  | { priced: true }
  | { priced: false; reason: string };

/**
 * Read a `procurement_documents` row's money state.
 *
 * THE STATE IS THE CURRENCY COLUMN, not a flag, and that is deliberate. Rule 1's
 * refusal and rules 2/B3's holds all end in `withholdMoney`, which blanks
 * `currency` along with every figure — so `currency IS NULL` is precisely "the
 * money on this document was not filed", with no second bookkeeping to drift
 * from it. Restating or confirming the currency writes the code, which is the
 * same act that clears the hold; there is no third place to remember to update.
 *
 * The REASON comes off `extracted.moneyHeld`, which carries the sentence the
 * rule wrote at the time — naming the two disagreeing currencies, or the two
 * absences. Printing that verbatim beats re-deriving a label here, which is how
 * a screen ends up saying "held" about a document that was refused.
 */
export function documentMoneyState(row: {
  currency?: string | null;
  extracted?: unknown;
}): DocumentMoneyState {
  const code = (row?.currency ?? "").trim().toUpperCase();
  if (ISO_4217_ALPHA3.test(code)) return { priced: true };

  const held =
    row?.extracted &&
    typeof row.extracted === "object" &&
    !Array.isArray(row.extracted)
      ? (row.extracted as { moneyHeld?: unknown }).moneyHeld
      : null;
  const reason =
    typeof held === "string" && held.trim() !== ""
      ? held.trim()
      : "This document's money is not filed under any currency: procurement_documents.currency is not recorded, and the reading does not say why. A figure with no currency is not a price.";
  return { priced: false, reason };
}

/**
 * The sentence a person reads when the receiving screen refuses their price.
 *
 * It has to carry three things and the third is the one that is usually missing
 * from a refusal: WHY (the stored reason, verbatim), WHAT STILL WORKS (the
 * count and the stock movement), and THE ACT THAT CLEARS IT (restate or confirm
 * the currency on the document, which is one control on the receipt). A refusal
 * that names no way forward teaches a person to route around it.
 */
export function receivingPriceRefusal(args: {
  reason: string;
  /** The document's own number, when it has one. */
  docNumber?: string | null;
  /** The document id, so the page can link straight to its currency control. */
  documentId?: string | null;
}): string {
  const which = args.docNumber?.trim()
    ? `invoice ${args.docNumber.trim()}`
    : "the invoice attached to this order";
  return (
    `The unit price was NOT accepted, because the money on ${which} is not ` +
    `filed under any currency. ${args.reason} ` +
    `Everything else on this receipt still stands: the count, the rejection and ` +
    `the stock movement are unaffected, and you can submit them now without a ` +
    `price. To accept the price, restate the invoice's currency — or confirm ` +
    `the one it would take — on the receipt's currency control` +
    (args.documentId ? ` (document ${args.documentId})` : "") +
    `. That is a manager's or an owner's decision and it is recorded with their ` +
    `name; once it is made this price is accepted as it stands.`
  );
}
