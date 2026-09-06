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
  | { kind: "house"; code: string; from: string }
  | { kind: "none"; because: string };

/**
 * Rule 1. What this invoice's money is in, given what the file says and what
 * the house says.
 *
 * ORDER MATTERS AND IT IS THE FOUNDER'S. The file's own statement wins: a
 * distributor billing a Turkish house in EUR has said so on the paper, and
 * overriding that with the house's reporting currency would restate a vendor's
 * bill. The house's currency answers only the case the founder was asked about
 * — the file states NOTHING.
 *
 * A file-stated value that is not an alpha-3 is refused rather than stored:
 * `"$"`, `"usd "` and `"US Dollars"` are three ways of nearly saying a currency,
 * and a `varchar(3)` column that accepts all of them holds three currencies
 * where there is one (the argument `priceCurrency` already makes).
 */
export function filingCurrency(args: {
  /** What the document itself stated — `CUR02` on an 810, the header on a PDF. */
  fileStated: string | null | undefined;
  /** `restaurants.currency`. NULL when the house has never answered. */
  houseStated: string | null | undefined;
  /** The field the file would have stated it in, named for the sentence. */
  fileField: string;
}): FilingCurrency {
  const file = (args.fileStated ?? "").trim().toUpperCase();
  const house = (args.houseStated ?? "").trim().toUpperCase();

  if (file !== "" && ISO_4217_ALPHA3.test(file))
    return { kind: "file", code: file, from: `the document's own ${args.fileField}` };

  if (ISO_4217_ALPHA3.test(house))
    return {
      kind: "house",
      code: house,
      from: "this house's own stated currency (restaurants.currency)",
    };

  const fileSaid =
    file === ""
      ? `The document states no ${args.fileField}`
      : `The document's ${args.fileField} is ${JSON.stringify(args.fileStated)}, which is not an ISO 4217 alpha-3 code`;
  const houseSaid =
    house === ""
      ? "this house has never stated its own currency (restaurants.currency is not recorded)"
      : `this house's own currency is ${JSON.stringify(args.houseStated)}, which is not an ISO 4217 alpha-3 code`;

  return {
    kind: "none",
    because:
      `${fileSaid}, and ${houseSaid}. The money on this document was REFUSED ` +
      `rather than filed: a figure with no currency is not a price, and there ` +
      `is deliberately no USD default here. The quantities were kept. State ` +
      `this house's currency, or send the document again with its currency on ` +
      `it, and the money can be filed.`,
  };
}

/** The sentence recorded on a document filed under the house's own currency. */
export function houseCurrencyNote(code: string, fileField: string): string {
  return (
    `The document states no ${fileField}, so its money is filed under this ` +
    `house's own stated currency, ${code}. That is this house's REPORTING ` +
    `currency and not a claim the vendor made — if this invoice is in another ` +
    `currency, change it on the document and the money is re-filed under the ` +
    `one you name.`
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
  return {
    ...doc,
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
 * Rules 1 and 2 null the money COLUMNS and leave the parse whole in
 * `procurement_documents.extracted`. This reads that snapshot and produces the
 * figures to write, denominated in the code a person named. Nothing is
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

  const rebuilt = applyTieOut({
    ...(s as ParsedDocument),
    // The tie-out is derived from the figures below, never carried over.
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    warnings: [],
  });

  return {
    document: {
      subtotal: n(s.subtotal),
      freight: n(s.freight),
      fuel_surcharge: n(s.fuelSurcharge),
      split_case_fee: n(s.splitCaseFee),
      delivery_fee: n(s.deliveryFee),
      deposit_total: n(s.depositTotal),
      tax: n(s.tax),
      other_charges: n(s.otherCharges),
      discount_total: n(s.discountTotal),
      total: n(s.total),
      computed_lines_total: rebuilt.computedLinesTotal,
      tie_out_delta: rebuilt.tieOutDelta,
      ties_out: rebuilt.tiesOut,
    },
    lines: s.lines.map((l, i) => ({
      line_no: typeof l?.lineNo === "number" ? l.lineNo : i + 1,
      unit_price: n(l?.unitPrice),
      line_total: n(l?.lineTotal),
      allowance: n(l?.allowance),
      deposit: n(l?.deposit),
    })),
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
 * Rule 1 + rule 2 in one call, for the caller that has a parse, a house and
 * (maybe) a sighting.
 *
 * Kept here rather than in `document-intake.service.ts` so that the EDI path
 * and the model path cannot answer the same question two ways — the failure
 * mode `ParsedDocument`'s own header names: *"the moment a verdict depends on
 * the channel, 'we photographed it' and 'they sent it electronically' start
 * producing different answers about the same delivery"*.
 */
export function applyCurrencyRules(args: {
  doc: ParsedDocument;
  houseCurrency: string | null | undefined;
  /** The field the document would have stated its currency in. */
  fileField: string;
}): ParsedDocument {
  const { doc, houseCurrency, fileField } = args;

  const filed = filingCurrency({
    fileStated: doc.currency,
    houseStated: houseCurrency,
    fileField,
  });

  if (filed.kind === "none") return withholdMoney(doc, filed.because);

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
      ? houseCurrencyNote(filed.code, fileField)
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
