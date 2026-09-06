/**
 * What a vendor USUALLY invoices in, as a person stated it — and the hard limit
 * on what that fact is allowed to do.
 *
 * THE FOUNDER, 2026-09-06, batch 65, verbatim:
 *   *"maybe Every vendor and their profile will show their default currency,
 *    but we won't use that as the invoice... definitely invoice receipt.
 *    However, we will use the currency from where we order it. We will show the
 *    user the currency the vendor always uses, and they have the ability to
 *    change it or not in the orders page."*
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS FILE EXISTS TO HOLD
 * ---------------------------------------------------------------------------
 * `providers.usual_currency` NEVER FILES AN INVOICE. It is printed on the
 * vendor's profile and it is OFFERED as the starting value on an order sheet.
 * Nothing else reads it — and the reason is not caution, it is a measured
 * defect: `restaurants.currency DEFAULT 'USD'` put a currency nobody chose
 * underneath fourteen houses' money (ADR 0117 Q25), and a vendor-level default
 * wired into invoice filing would be the same mistake one table over with a
 * vendor's name on it instead of a house's. An invoice takes its own stated
 * currency, then the currency of the ORDER it is matched to, then the house's
 * (`procurement/documents/invoice-currency.ts` `filingCurrency`).
 *
 * The distinction the founder drew is between a fact about a vendor and a fact
 * about a transaction. "This vendor usually bills in EUR" is the first; "this
 * order was placed in EUR" is the second; only the second can price anything,
 * because only the second happened.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS OFFERED AS A STARTING VALUE
 * ---------------------------------------------------------------------------
 * The profile field starts EMPTY for a vendor nobody has asked. Not the house's
 * currency, not the currency of their last invoice, not USD. A pre-filled field
 * that a person saves without reading is indistinguishable afterwards from one
 * they thought about, and the whole point of `usual_currency_set_by` is to be
 * able to tell those apart.
 */

/** ISO 4217 alpha-3 — the same shape the database CHECK enforces. */
const ISO_4217_ALPHA3 = /^[A-Z]{3}$/;

export type VendorCurrencyRefusal = { ok: false; because: string };
export type VendorCurrencyAccepted = { ok: true; code: string };
export type VendorCurrencyInput = VendorCurrencyAccepted | VendorCurrencyRefusal;

/**
 * What a person typed, accepted or refused in a sentence.
 *
 * BLANK IS REFUSED, NOT TREATED AS "CLEAR IT". Clearing a stated currency is a
 * different act with a different consequence — every order sheet for that vendor
 * loses its offered default — and a route that performs it silently on an empty
 * string would do it by accident every time a form submits an untouched field.
 * If clearing is ever wanted it gets its own verb and its own sentence.
 */
export function readVendorCurrency(
  typed: string | null | undefined,
): VendorCurrencyInput {
  if (typed === null || typed === undefined)
    return {
      ok: false,
      because:
        "No currency was sent, so nothing was changed. State the ISO 4217 code this vendor usually invoices in — three letters, for example TRY or EUR.",
    };
  const code = String(typed).trim().toUpperCase();
  if (code === "")
    return {
      ok: false,
      because:
        "A blank currency was sent, so nothing was changed. This field records what a person knows about a vendor; leaving it empty is what a vendor nobody has asked already looks like, and saving a blank over a stated code would erase somebody's answer without saying so.",
    };
  if (!ISO_4217_ALPHA3.test(code))
    return {
      ok: false,
      because:
        `"${String(typed)}" is not an ISO 4217 alpha-3 currency code, so nothing was changed. ` +
        `A column that accepts "TL", "usd" and "$" holds three spellings of currencies it has one of, and the order sheet, price_history and vendor_price_observations all inherit them. Send the three-letter code.`,
    };
  return { ok: true, code };
}

/**
 * What the vendor profile says under the heading, given what is stored.
 *
 * A vendor that has stated nothing gets a sentence, never an empty box: the
 * absence is the fact, and it is the reason the order sheet will offer nothing.
 */
export function vendorCurrencySentence(args: {
  code: string | null | undefined;
  setByName?: string | null;
  setAt?: string | null;
  vendorName?: string | null;
}): string {
  const who = args.vendorName?.trim() || "This vendor";
  const code = (args.code ?? "").trim().toUpperCase();
  if (!ISO_4217_ALPHA3.test(code))
    return (
      `${who} has not stated a usual currency. Nothing is assumed in its place — ` +
      `not this house's currency and not the currency of their last invoice — so ` +
      `an order to them starts with an empty currency field. Type the code they ` +
      `usually invoice in and it will be offered there.`
    );

  const name = args.setByName?.trim();
  const when = args.setAt?.trim();
  const attribution =
    name && when
      ? ` Stated by ${name} on ${when.slice(0, 10)}.`
      : name
        ? ` Stated by ${name}.`
        : "";
  return (
    `${who} usually invoices in ${code}.${attribution} This is offered as the ` +
    `starting currency when an order is placed with them, and it can be changed ` +
    `there. IT NEVER FILES AN INVOICE: an invoice takes the currency printed on ` +
    `it, then the currency of the order it is matched to.`
  );
}
