import { isIso4217, notACurrencyBecause } from "../common/iso-4217";

/**
 * What money a recorded price is in, and how that is KNOWN.
 *
 * ADR 0117 Q25, founder 2026-09-05: *"correct three rows now, ask each house in
 * onboarding, but set a default based on location, edge case: there maybe
 * several diff currencies, so act accordingly to that"*. The last clause is this
 * file. A house has ONE reporting currency (`restaurants.currency`) and its
 * paper arrives in whatever its vendors billed — measured on production the same
 * day, one house carries `currency = 'USD'` and holds two `TRY` invoices
 * (`procurement_documents`, 5 rows, 2 of them TRY).
 *
 * So a price's currency is a property of the PAPER, never of the house. This
 * module is the one place that says so, and it exists for the same reason
 * `priceSeriesUnit` does: the caller has to state where the knowledge came from,
 * and a caller that knows nothing has to say THAT rather than inherit a default.
 *
 * THE SHAPE, AND WHY THERE IS NO DEFAULT ARGUMENT
 * -----------------------------------------------
 * `PriceCurrencyClaim` has no optional form. A default parameter is exactly what
 * `(input.currency ?? "USD")` was in `own-paper-sighting.ts` and what
 * `DEFAULT 'USD'` still was on `restaurants.currency` until
 * `20260905120000_a_house_names_its_money.sql`: a caller that never thought
 * about currency inheriting a confident answer. Making the argument required
 * makes the thinking required.
 *
 * WHAT "UNSTATED" PRODUCES
 * ------------------------
 * `null`, plus a sentence naming what would have admitted a code. NOT the
 * house's currency, not USD, not the currency of the row beside it.
 * `price_history.currency` is nullable precisely so this answer can be recorded
 * rather than guessed (the migration argues that at length). The register
 * (`vendor_price_observations.currency`, NOT NULL) cannot record it, so there
 * the same claim becomes a refusal — two tables, one rule, two honest outcomes.
 */

/**
 * IS THIS A CURRENCY? Membership, not shape. Until 2026-09-06 this file asked
 * `/^[A-Z]{3}$/` and called the answer ISO 4217, so `"ZZZ"` was written to
 * `price_history.currency` as real money. The list is in
 * `common/iso-4217.ts`, mirrored against the web's own picker by a spec.
 */
const isCurrency = isIso4217;

export type PriceCurrencyClaim =
  | {
      kind: "stated";
      /** The code as the document printed it. Case is folded; nothing else is. */
      code: string;
      /** Which document, in the words a person would use. */
      from: string;
    }
  | {
      kind: "unstated";
      /** What is missing, and what would admit a code. A sentence, not a token. */
      because: string;
    };

export interface PriceCurrencyResolution {
  /** The code to write, or `null` for "not recorded". */
  code: string | null;
  /**
   * A sentence for the log when nothing was recorded, or when a stated claim was
   * refused for not being a code. `null` when a code was recorded cleanly.
   */
  reason: string | null;
  /** A note for `price_history.notes`, or `null`. */
  note: string | null;
}

/**
 * Turn a claim into the value written to `price_history.currency`.
 *
 * A `stated` claim whose code does not NAME A CURRENCY is NOT written as-is and
 * NOT silently dropped: it comes back as `null` with a sentence naming the
 * value it refused. `"$"`, `"usd "`, `"US Dollars"` and `"TL"` are four ways of
 * nearly saying a currency, and a column that accepts all four holds four
 * currencies where there is one.
 *
 * `"ZZZ"` is the fifth way, and it used to be admitted: the check here was
 * `/^[A-Z]{3}$/`, which is a shape and not a list, so a well-formed code naming
 * no money reached `price_history.currency`, the price ladder and the four-way
 * match as a real denomination (measured against `356ffdfa`, 2026-09-06).
 */
export function priceCurrency(claim: PriceCurrencyClaim): PriceCurrencyResolution {
  if (claim.kind === "unstated") {
    return {
      code: null,
      reason:
        `Currency not recorded: ${claim.because} The figure is kept — it is a ` +
        `real observation of what this vendor charged — but nothing may read ` +
        `it as dollars, and no comparison may put it beside a figure in ` +
        `another currency.`,
      note: "Currency not recorded.",
    };
  }

  const code = claim.code.trim().toUpperCase();
  if (!isCurrency(code)) {
    return {
      code: null,
      reason:
        `Currency not recorded: ${claim.from} states ` +
        `${JSON.stringify(claim.code)}. ${notACurrencyBecause(claim.code)} ` +
        `Refused rather than stored: the figure is kept as an observation, but ` +
        `nothing may read it as money until a currency names it.`,
      note: `Currency as printed was ${JSON.stringify(claim.code)}, not a currency.`,
    };
  }

  return { code, reason: null, note: null };
}

/**
 * THE SHARED HALF OF THE REFUSAL: what a price with no currency costs, the four
 * rungs that state one, and what still records without it.
 *
 * ONE STRING, THREE SURFACES, since 2026-09-11 (audit of b6d2e4b4, 3 of 3
 * verifiers). `VerifyReceiptDto` and `verifyReceipt` compose their refusal from
 * it below, and the receiving workspace IMPORTS it
 * (`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx`) rather than
 * restating it. b6d2e4b4's message said all three shared "one shared sentence
 * naming the three rungs"; the screen had in fact printed its own wording and
 * named no rung at all.
 *
 * It is worded to be true BEFORE anything is sent, because the screen shows it
 * while the desk is still typing. The parts that describe a submission that has
 * already happened ("was submitted", "nothing was recorded", "send it again")
 * stay in `receivingPriceNeedsACurrency`, which only a refusal says.
 */
export const RECEIVING_PRICE_CURRENCY_RUNGS =
  `A price without a currency is not a price: it cannot be compared with the ` +
  `agreed price, cannot join the price ladder, and prints on every screen as a ` +
  `number with a caveat. The receiving screen offers four ways to state it: the ` +
  `code the matched invoice is filed in, the currency this order was placed in, ` +
  `this house's own reporting currency, or a code typed on the spot. Everything ` +
  `else on this receipt still stands: submit it without a price and the count, ` +
  `the rejection and the stock movement all record exactly as they would have.`;

/**
 * A TYPED RECEIVING PRICE STATES ITS CURRENCY OR IS REFUSED.
 *
 * Founder, 2026-09-06 batch 67: *"Refuse a typed price with no currency — a
 * price without money is not a price: the receiving screen requires a code (the
 * order's, the house's, or one typed) before a unit price is accepted;
 * price_history never gains a currency-null row from that door again."*
 *
 * WHAT THIS REPLACES. `verifyReceipt` accepted `invoiceUnitPrice` with
 * `invoiceCurrency` absent and wrote a `price_history` row with `currency:
 * null` — measured 2026-09-06 on an order with no linked document (audit
 * 6c0933d3 finding 2, then pinned by three tests). The row was honest about
 * itself and useless to every reader: a price ladder cannot compare it, the
 * four-way match cannot denominate it, and nothing on any screen can print it
 * as money. `price_history.currency` stays NULLABLE — rows written before today
 * are real observations and are not being rewritten — but this DOOR stops
 * producing more of them.
 *
 * WHY A REFUSAL AND NOT A DEFAULT. Every rung that could have filled it in is a
 * claim about a piece of paper, and they are not equally close to the figure
 * being typed: the matched INVOICE's filed code is the vendor's own statement
 * about this very price, the ORDER's currency is what this house agreed to pay
 * in, and the HOUSE's is what it reports in. So the screen puts a code beside
 * the field and the person confirms it (`ReceivingWorkspace.tsx`); the gateway
 * takes the answer and never derives one. That is ADR 0083's shape: the offer is
 * visible before it is recorded.
 *
 * THE SENTENCE NAMES FOUR RUNGS, and said three until 2026-09-11. The invoice's
 * filed code has been offered on that screen as a labelled chip since batch 67
 * and PRE-FILLS the field ahead of the order's since batch 69 (founder:
 * *"Invoice's filed code first, then the order's"*), so a refusal naming three
 * was undercounting what the desk can actually reach in one tap.
 *
 * The count is deliberately untouched. A delivery that physically happened is
 * not made un-happened by a bookkeeping doubt, and the sentence says so.
 */
export function receivingPriceNeedsACurrency(unitPrice: number): string {
  return (
    `A unit price of ${unitPrice} was submitted with no currency, so nothing ` +
    `was recorded. ${RECEIVING_PRICE_CURRENCY_RUNGS} State the code and send ` +
    `it again.`
  );
}

/**
 * The claim for a figure whose paper is an invoice the manager keyed in.
 *
 * The invoice header is the one place in this system that already carries a real
 * non-USD currency (`procurement_documents.currency`), so when the caller passes
 * one it is stated; when it does not, the sentence names the field that would
 * fix it rather than the symptom.
 */
export function invoiceCurrencyClaim(
  code: string | null | undefined,
  where: string,
): PriceCurrencyClaim {
  if (typeof code === "string" && code.trim() !== "") {
    return { kind: "stated", code, from: `the invoice for ${where}` };
  }
  // UNREACHABLE FROM THE RECEIVING DOOR SINCE 2026-09-06, and kept anyway.
  // `verifyReceipt` refuses a price with no code before it gets here, so this
  // branch can no longer produce a `price_history` row — but the claim type is
  // the shared vocabulary every price writer speaks, and a caller that DOES have
  // an unstated currency (a future importer, a backfill) needs a sentence rather
  // than a crash. Deleting it would leave the next caller to invent one.
  return {
    kind: "unstated",
    because:
      `the invoice for ${where} was keyed in without its currency ` +
      `(verifyReceipt's \`invoiceCurrency\`), and the document header that ` +
      `would carry one — procurement_documents.currency — is not read by this ` +
      `path.`,
  };
}

/**
 * The claim for a figure that comes from an AGREEMENT rather than a bill.
 *
 * Always unstated today, and that is a fact about the schema rather than a
 * shortcut: measured 2026-09-05, neither `procurement_orders` nor
 * `procurement_order_items` has a currency column, in production or on this
 * branch. `20260905073000_the_agreement_names_the_money_outside_the_price.sql`
 * writes three amounts "in the agreement's currency" while nothing states what
 * that is. The sentence names the missing column so the gap is legible in the
 * log instead of being discovered later as a hole in the data.
 */
export function agreementCurrencyClaim(where: string): PriceCurrencyClaim {
  return {
    kind: "unstated",
    because:
      `the agreement for ${where} states no currency — neither ` +
      `procurement_orders nor procurement_order_items has a currency column ` +
      `(measured 2026-09-05), so there is nothing on the order to read. ` +
      `Inheriting the house's reporting currency would be a claim about the ` +
      `vendor that no paper makes.`,
  };
}
