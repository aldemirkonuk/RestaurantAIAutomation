/**
 * What money an agreement line is in, and where that default came from.
 *
 * ADR 0117 Q31, founder 2026-09-05: *"A currency column on the agreement line,
 * defaulted from the vendor's terms or the house, stated on the sheet"*.
 *
 * THE CHAIN, AND WHY IT IS NOT WHAT THE SENTENCE LITERALLY SAYS
 * -------------------------------------------------------------
 * "The vendor's terms" has no field to read. Measured 2026-09-05,
 * `restaurant_vendor_terms` (`20260903140000`) carries `delivery_weekdays`,
 * `order_cutoff_time`, `order_cutoff_offset_days`, `minimum_order_amount`,
 * `lead_time_days`, `payment_terms` and `notes` — seven columns, no currency,
 * and the table does not exist in production at all yet.
 *
 * So the vendor rung reads the vendor's own PAPER instead of a typed opinion
 * about it: the currency on the most recent `procurement_documents` row for this
 * provider. That is strictly better evidence — production already holds two
 * `TRY` invoices against a house whose own row says `USD` — and it is a fact
 * somebody's vendor stated on a document rather than a preference somebody
 * typed. Whether a typed term-currency should exist as well is filed as a
 * question, not decided here.
 *
 * THE RUNGS
 *   1. `vendor_paper`  — what this vendor last billed this house in.
 *   2. `house`         — `restaurants.currency`, the house's reporting currency.
 *   3. none            — and a sentence saying so.
 *
 * EVERY RUNG IS LABELLED. The sheet prints WHERE the default came from, because
 * "we suggest TRY" and "your last invoice from this vendor was in TRY" are
 * different claims and only the second one a person can check. ADR 0083: the
 * page says what it will record, and why.
 *
 * NOTHING HERE CONVERTS. There is no rate in this system. A default is a
 * suggestion about which currency the NEXT agreement is in, never an assertion
 * that two figures in different currencies are comparable.
 */

/** ISO 4217 alpha-3. The same shape the database CHECK enforces. */
const ISO_4217_ALPHA3 = /^[A-Z]{3}$/;

export type AgreementCurrencyBasis = "vendor_paper" | "house";

export interface AgreementCurrencyDefault {
  /** The code to offer, or `null` when nothing can be offered. */
  code: string | null;
  /** Which rung produced it, or `null` when none did. */
  basis: AgreementCurrencyBasis | null;
  /**
   * What the sheet says under the field. Always present — a null default gets a
   * sentence too, because a silent empty box is the one thing this must not be.
   */
  sentence: string;
}

export interface AgreementCurrencyInputs {
  /**
   * The currency on the most recent `procurement_documents` row for this
   * provider and house, or null. The DATE is not needed here — the caller reads
   * the latest and passes its code — but the caller must order by the
   * document's own date, never by insertion, or "last billed" means "last
   * uploaded".
   */
  vendorPaperCurrency: string | null | undefined;
  /** The vendor's name, for the sentence. Never load-bearing. */
  vendorName?: string | null;
  /** `restaurants.currency`, which is NULL for a house nobody has asked. */
  houseCurrency: string | null | undefined;
}

function normalise(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const upper = code.trim().toUpperCase();
  return ISO_4217_ALPHA3.test(upper) ? upper : null;
}

/**
 * The default this sheet will OFFER, with the reason a person can check.
 *
 * Note the deliberate asymmetry with `restaurants.currency`: an unreadable or
 * unrecorded house does NOT fall through to USD, or to anything. It falls
 * through to nothing, and the sheet says the field is unanswered. After ADR
 * 0117 Q30 cleared every unattributable `USD` to NULL, houses in that state are
 * live, and a fallback here would quietly refill exactly what that pass emptied.
 */
export function agreementCurrencyDefault(
  inputs: AgreementCurrencyInputs,
): AgreementCurrencyDefault {
  const fromPaper = normalise(inputs.vendorPaperCurrency);
  if (fromPaper) {
    const who = inputs.vendorName?.trim() || "this vendor";
    return {
      code: fromPaper,
      basis: "vendor_paper",
      sentence:
        `Defaulted to ${fromPaper}: that is what ${who} last billed this house ` +
        `in. Change it if this order is priced differently.`,
    };
  }

  const fromHouse = normalise(inputs.houseCurrency);
  if (fromHouse) {
    return {
      code: fromHouse,
      basis: "house",
      sentence:
        `Defaulted to ${fromHouse}, the currency this house reports in — no ` +
        `invoice from this vendor states one yet. Change it if they price in ` +
        `something else.`,
    };
  }

  return {
    code: null,
    basis: null,
    sentence:
      "No currency can be worked out: no invoice from this vendor states one " +
      "and this house has not recorded the money it reports in. Choose one, or " +
      "leave it and every amount on this line will read as “currency not " +
      "recorded”.",
  };
}

/**
 * What to WRITE to `procurement_order_items.currency`, given what the person
 * left in the field.
 *
 * Three states, the same three the sign-up currency step uses, for the same
 * reason: `null` is untouched (take the default), `''` is an explicit "not now"
 * that records nothing, and a code is an answer. Collapsing "untouched" into
 * "empty" is what lets a default be written as though somebody chose it.
 */
export function agreementCurrencyToRecord(
  chosen: string | null | undefined,
  offered: string | null,
): string | null {
  if (chosen === null || chosen === undefined) return offered;
  return normalise(chosen);
}
