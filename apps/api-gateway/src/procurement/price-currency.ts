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
