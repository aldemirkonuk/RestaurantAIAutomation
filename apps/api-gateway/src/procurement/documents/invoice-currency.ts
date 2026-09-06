import { isIso4217, notACurrencyBecause } from "../../common/iso-4217";
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
 * The stripped figures are NOT lost: `withholdMoney` keeps them on
 * `ParsedDocument.moneyWithheld`, which `document-intake.service.ts` writes
 * into `procurement_documents.extracted`. That is what makes rule 3 able to
 * re-file a HELD document's money under a currency a person names, instead of
 * asking for the document again.
 *
 * TWO EARLIER VERSIONS OF THIS PARAGRAPH WERE FALSE, and both cost a defect.
 * The first said the whole parse survived in `extracted`; it did not, because
 * intake writes `extracted` from the same object it had just nulled, so a held
 * document's figures were gone from both places (p4br, 2026-09-06 —
 * `moneyWithheld` is that fix). The second implied `extracted` was where a
 * restatement should read from at all; it is not, because it is written only at
 * intake and `editLine` never updates it, so re-filing from it reverted every
 * hand correction (`planRefile`, 2026-09-06). A restatement now reads the
 * document's CURRENT rows and falls back to `moneyWithheld` only when there is
 * no money on them.
 */

/**
 * IS THIS A CURRENCY? Membership, not shape, and the distinction was a live
 * defect: this file used to ask `/^[A-Z]{3}$/`, so `filingCurrency({ fileStated:
 * "ZZZ", … })` filed a whole invoice's money under `ZZZ` — measured against
 * commit `356ffdfa` on 2026-09-06. Three capitals is not a currency; the list
 * of currencies lives in `common/iso-4217.ts` and is mirrored against the web's
 * own picker by a spec that fails on any drift.
 */
const isCurrency = isIso4217;

/**
 * The middle of a refusal sentence, naming WHICH way a value failed.
 *
 * `"TL"` and `"ZZZ"` fail differently and a person acts on them differently:
 * the first is the wrong shape and the second is a well-formed code that names
 * no money. A single "not an ISO 4217 alpha-3 code" for both told the second
 * kind of sender that their three letters were not three letters.
 */
function notACurrencyClause(raw: string | null | undefined): string {
  const code = (raw ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code)
    ? "which is three letters but names no currency — no money is published under that code"
    : "which is not an ISO 4217 alpha-3 code";
}

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
 * The model's own `code` wins when it NAMES A CURRENCY — it read the page and
 * we did not. A model that answers `ZZZ` has not named one, and used to be
 * believed: `seenCodes({ code: "ZZZ", … })` returned `["ZZZ"]`, which then
 * DISAGREED with every real filing currency and held the money over a code that
 * does not exist. It now falls through to the printed literal, where an
 * unrecognised glyph is recorded as evidence and holds nothing.
 *
 * Otherwise the printed literal is matched against `GLYPH_CODES`. `null` means
 * the sighting is evidence and nothing more.
 */
export function seenCodes(seen: CurrencySeen): readonly string[] | null {
  const stated = (seen.code ?? "").trim().toUpperCase();
  if (isCurrency(stated)) return [stated];
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
 *   3. the house's own `restaurants.currency`, whenever the two rungs above
 *      supply no currency — which is BOTH "this document is matched to no
 *      order" AND "the order it is matched to names no currency". The two are
 *      different facts and the sentence names which one held (the `matched`
 *      ternary below), because a manager acts on them differently: the first
 *      wants a link, the second wants the order's currency filled in. This
 *      comment said "ONLY when the invoice has no matched order" until
 *      2026-09-06, which was narrower than the code it summarised;
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

  if (file !== "" && isCurrency(file))
    return { kind: "file", code: file, from: `the document's own ${args.fileField}` };

  if (isCurrency(order))
    return {
      kind: "order",
      code: order,
      from: `the currency the matched order was placed in (procurement_orders.currency)`,
    };

  if (isCurrency(house))
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
      : `The document's ${args.fileField} is ${JSON.stringify(args.fileStated)}, ${notACurrencyClause(args.fileStated)}`;
  const orderSaid = matched
    ? order === ""
      ? ", the order it is matched to names no currency"
      : `, the order it is matched to names ${JSON.stringify(args.orderStated)}, ${notACurrencyClause(args.orderStated)}`
    : ", it is matched to no order";
  const houseSaid =
    house === ""
      ? "and this house has never stated its own currency (restaurants.currency is not recorded)"
      : `and this house's own currency is ${JSON.stringify(args.houseStated)}, ${notACurrencyClause(args.houseStated)}`;

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
  // Membership on BOTH sides. A file or an order carrying a well-formed
  // non-currency has already been refused by `filingCurrency`; treating it as
  // one half of a disagreement here would hold a document under a code that
  // does not exist and name it in the sentence as though it did.
  if (!isCurrency(file) || !isCurrency(order)) return null;
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
 * Rule 3's arithmetic half: what a deliberate currency change puts BACK, and
 * WHERE those figures come from.
 *
 * ---------------------------------------------------------------------------
 * THIS REPLACES `refiledMoney`, WHICH RE-FILED FROM A STALE SNAPSHOT
 * ---------------------------------------------------------------------------
 * `refiledMoney` read `procurement_documents.extracted` — the parse as it was
 * at INTAKE. `extracted` is written by exactly three statements, all of them in
 * `DocumentIntakeService`'s intake path, and `editLine` never touches it. So
 * the sequence
 *
 *     intake reads 14.90 -> a manager corrects the line to 19.40 -> a manager
 *     restates the currency
 *
 * put 14.90 back, silently, with no failure and no warning, and told the person
 * their money had been re-filed. A restatement is the act a manager performs to
 * make a document's money right; reverting their own correction is the one
 * thing it must never do. Proved against `6c0933d3` on 2026-09-06 with a probe
 * on `git show HEAD:`.
 *
 * ---------------------------------------------------------------------------
 * TWO SOURCES, AND THE ORDER IS NOT A PREFERENCE
 * ---------------------------------------------------------------------------
 *   * `current_rows` — the document's money columns and its CURRENT
 *     `procurement_document_lines`. This is the truth about what the document
 *     says today, corrections included, and it is used whenever there is any
 *     money on the row at all. Every amount is carried across EXACTLY as it
 *     stands: a restatement changes what the figures are DENOMINATED IN and
 *     nothing else, because there is no exchange rate anywhere in this system
 *     (`20260905120000`, rule 3).
 *   * `withheld_snapshot` — `extracted.moneyWithheld`, and only for a document
 *     whose money is entirely absent from the row, which is exactly the state
 *     `withholdMoney` leaves: header, lines and tie-out all null. There is
 *     nothing on the row to preserve, and the snapshot is the vendor's own
 *     reading kept for this one purpose.
 *
 * They cannot both apply. A held document has no money on its rows (that is
 * what the hold IS) and an unheld one has no `moneyWithheld` to recover. The
 * check is therefore on the ROW, never on a flag: if a figure survives
 * anywhere on the document or its lines, it wins.
 *
 * `null` when neither source has anything — a document that was never priced
 * and never held, or one held before `moneyWithheld` existed, whose figures are
 * genuinely gone. The caller then says so rather than writing zeroes: a
 * re-filing that quietly restores nothing is the absence-reported-as-health
 * shape aimed at a manager who has just been told their invoice is priced.
 *
 * THE TIE-OUT IS RECOMPUTED, never carried. It runs over the figures that are
 * actually going onto the row, through the same `applyTieOut` that intake and
 * `editLine` use, so a restated document's arithmetic cannot disagree with an
 * edited one's. Like `editLine`'s own recompute it sees only what the LINE
 * TABLE holds — qty, uom, pack size, price, line total, allowance — because
 * `priceBaseQty` and `lineKind` have no columns; the two paths are therefore
 * identical by construction rather than by coincidence.
 */

/** The money columns of a `procurement_documents` row, AS THEY STAND NOW. */
export interface DocumentMoneyRow {
  subtotal?: unknown;
  freight?: unknown;
  fuel_surcharge?: unknown;
  split_case_fee?: unknown;
  delivery_fee?: unknown;
  deposit_total?: unknown;
  tax?: unknown;
  other_charges?: unknown;
  discount_total?: unknown;
  total?: unknown;
}

/** One `procurement_document_lines` row, AS IT STANDS NOW. */
export interface DocumentLineRow {
  line_no?: unknown;
  qty?: unknown;
  uom?: unknown;
  pack_size?: unknown;
  unit_price?: unknown;
  line_total?: unknown;
  allowance?: unknown;
  deposit?: unknown;
}

/** Which of the two readings a re-filing used. Recorded, never inferred. */
export type RefileSource = "current_rows" | "withheld_snapshot";

export interface RefilePlan {
  source: RefileSource;
  /**
   * Where the figures came from, in words, for the audit row and the sentence.
   * A manager reading the log a month later has to be able to tell "we put your
   * corrections back" from "we recovered the reading we had withheld".
   */
  sourceSaid: string;
  document: DocumentMoney;
  lines: LineMoney[];
}

/**
 * A figure, or nothing. Postgres `numeric` reaches this gateway as a number or
 * as a string depending on the driver path, and a string silently becoming
 * `null` here would erase a real price on a restatement — which is the whole
 * defect this function exists to fix, arriving through the back door.
 */
function money(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A count that must exist for the arithmetic, defaulting to 0 rather than NaN. */
function count(v: unknown): number {
  return money(v) ?? 0;
}

export function planRefile(args: {
  /** The document's money columns as they stand. */
  row: DocumentMoneyRow | null | undefined;
  /** Its lines as they stand, in `procurement_document_lines`. */
  lines: ReadonlyArray<DocumentLineRow> | null | undefined;
  /** `procurement_documents.extracted`, read ONLY for `moneyWithheld`. */
  extracted: unknown;
}): RefilePlan | null {
  const row = args.row ?? {};
  const rows = (args.lines ?? []).map((l, i) => ({
    line_no: money(l?.line_no) ?? i + 1,
    qty: count(l?.qty),
    uom: typeof l?.uom === "string" ? l.uom : "bottle",
    pack_size: money(l?.pack_size) ?? 1,
    unit_price: money(l?.unit_price),
    line_total: money(l?.line_total),
    allowance: money(l?.allowance),
    deposit: money(l?.deposit),
  }));

  const currentHeader = {
    subtotal: money(row.subtotal),
    freight: money(row.freight),
    fuel_surcharge: money(row.fuel_surcharge),
    split_case_fee: money(row.split_case_fee),
    delivery_fee: money(row.delivery_fee),
    deposit_total: money(row.deposit_total),
    tax: money(row.tax),
    other_charges: money(row.other_charges),
    discount_total: money(row.discount_total),
    total: money(row.total),
  };

  const headerHasMoney = Object.values(currentHeader).some((v) => v !== null);
  const linesHaveMoney = rows.some(
    (l) =>
      l.unit_price !== null ||
      l.line_total !== null ||
      l.allowance !== null ||
      l.deposit !== null,
  );

  let source: RefileSource;
  let header: DocumentMoney;
  let lineMoney: LineMoney[];

  if (headerHasMoney || linesHaveMoney) {
    source = "current_rows";
    header = { ...currentHeader, computed_lines_total: null, tie_out_delta: null, ties_out: null };
    lineMoney = rows.map((l) => ({
      line_no: l.line_no,
      unit_price: l.unit_price,
      line_total: l.line_total,
      allowance: l.allowance,
      deposit: l.deposit,
    }));
  } else {
    const kept = withheldSnapshot(args.extracted);
    if (!kept) return null;
    source = "withheld_snapshot";
    header = {
      subtotal: money(kept.subtotal),
      freight: money(kept.freight),
      fuel_surcharge: money(kept.fuelSurcharge),
      split_case_fee: money(kept.splitCaseFee),
      delivery_fee: money(kept.deliveryFee),
      deposit_total: money(kept.depositTotal),
      tax: money(kept.tax),
      other_charges: money(kept.otherCharges),
      discount_total: money(kept.discountTotal),
      total: money(kept.total),
      computed_lines_total: null,
      tie_out_delta: null,
      ties_out: null,
    };
    /*
     * MATCHED BY `line_no`, AND ONLY THE LINES THAT ARE STILL THERE. The
     * snapshot is what the paper said at intake; the line ROWS are what the
     * document has now. Writing the snapshot's own line list would resurrect a
     * line somebody deleted, and there would be no row to write it to anyway.
     */
    const byNo = new Map<number, (typeof kept.lines)[number]>();
    for (const l of kept.lines ?? [])
      if (typeof l?.lineNo === "number") byNo.set(l.lineNo, l);
    lineMoney = rows.map((l) => {
      const k = byNo.get(l.line_no) ?? null;
      return {
        line_no: l.line_no,
        unit_price: money(k?.unitPrice),
        line_total: money(k?.lineTotal),
        allowance: money(k?.allowance),
        deposit: money(k?.deposit),
      };
    });
    // A held document with no lines left and no header figures recovered is
    // nothing to write. Saying "re-filed" over that is the absence this whole
    // module is against.
    if (
      !Object.values(header).some((v) => v !== null) &&
      !lineMoney.some(
        (l) =>
          l.unit_price !== null ||
          l.line_total !== null ||
          l.allowance !== null ||
          l.deposit !== null,
      )
    )
      return null;
  }

  const rebuilt = applyTieOut({
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
    lines: rows.map((l, i) => {
      const m = lineMoney[i];
      return {
        qty: l.qty,
        uom: l.uom,
        packSize: l.pack_size,
        unitPrice: m.unit_price,
        lineTotal: m.line_total,
        allowance: m.allowance,
        deposit: m.deposit,
      };
    }),
    // Derived here, never carried over: the row's stored tie-out describes the
    // figures BEFORE this call, and one of the two sources has none at all.
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    // `applyTieOut` spreads `warnings` on the does-not-tie-out branch; omitting
    // it threw the moment a re-filing broke the tie-out (the same defect
    // `editLine`'s own recompute carries a comment about).
    warnings: [],
  } as unknown as ParsedDocument);

  return {
    source,
    sourceSaid:
      source === "current_rows"
        ? "the figures on the document as it stands now, corrections included"
        : "the reading this document's money was withheld from at intake (extracted.moneyWithheld)",
    document: {
      ...header,
      computed_lines_total: rebuilt.computedLinesTotal,
      tie_out_delta: rebuilt.tieOutDelta,
      ties_out: rebuilt.tiesOut,
    },
    lines: lineMoney,
  };
}

/**
 * `extracted.moneyWithheld`, when it is one — the figures a hold stripped.
 *
 * Shape-checked rather than trusted: `extracted` is a JSON column written over
 * many months by several shapes of this parser, and a document stored before
 * `moneyWithheld` existed simply has none.
 */
function withheldSnapshot(
  extracted: unknown,
): NonNullable<ParsedDocument["moneyWithheld"]> | null {
  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted))
    return null;
  const kept = (extracted as { moneyWithheld?: unknown }).moneyWithheld;
  if (!kept || typeof kept !== "object" || Array.isArray(kept)) return null;
  const lines = (kept as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return null;
  return kept as NonNullable<ParsedDocument["moneyWithheld"]>;
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
 *
 * A CODE THAT IS RECORDED BUT NAMES NO CURRENCY GETS ITS OWN SENTENCE. Rows
 * written before the membership check existed can carry one (`ZZZ` was
 * admitted by every gate in this module until 2026-09-06), and telling a
 * manager that "the currency is not recorded" about a row that plainly holds
 * `ZZZ` would send them looking for an empty field. The row is refused — the
 * money is not readable — but the refusal says what is actually there.
 */
export function documentMoneyState(row: {
  currency?: string | null;
  extracted?: unknown;
}): DocumentMoneyState {
  const code = (row?.currency ?? "").trim().toUpperCase();
  if (isCurrency(code)) return { priced: true };

  if (code !== "")
    return {
      priced: false,
      reason:
        `This document's money is filed under ${JSON.stringify(code)}, ` +
        `${notACurrencyClause(code)}. Nothing may be read as a price out of a ` +
        `denomination that does not exist. Restate the currency on the ` +
        `document and its figures are re-filed under the one you name.`,
    };

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
