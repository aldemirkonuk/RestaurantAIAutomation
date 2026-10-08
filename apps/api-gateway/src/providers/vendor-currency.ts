import { isIso4217, notACurrencyBecause } from "../common/iso-4217";
import { houseDayWords } from "./house-day";
import {
  INVOICES_TO_WRITE,
  type UsualCurrencyDecision,
  type UsualCurrencySource,
} from "./usual-currency-from-invoices";

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
 *
 * AMENDED 2026-10-01 (founder, ruling VEN-W13: "write auto ... 3 invoices").
 * The field is still never filled from the house's currency or from ONE
 * invoice. It IS written, with no person on it, once at least three of the
 * vendor's invoices printed the same code and none of the counted ones
 * disagree — and the row then says so (`usual_currency_source = 'invoices'`,
 * with the count), so "they thought about it" and "their paper says so" stay
 * distinguishable. A person's value is never overwritten by that write. The
 * rules live in `usual-currency-from-invoices.ts`.
 */

/**
 * IS THIS A CURRENCY? Membership, not shape.
 *
 * The database CHECK on `providers.usual_currency` is still `^[A-Z]{3}$` and
 * stays that way — see `common/iso-4217.ts` for why the list is not in SQL —
 * so this layer is what makes the two agree in practice. Written the day this
 * file was, it asked the regex alone, which meant a manager could state that a
 * vendor "usually invoices in ZZZ" and have it offered on every order sheet.
 */
const isCurrency = isIso4217;

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
  if (!isCurrency(code))
    return {
      ok: false,
      because:
        `${notACurrencyBecause(typed)} Nothing was changed. ` +
        `The order sheet, price_history and vendor_price_observations all inherit what this column holds, so a value that is not money must not reach it.`,
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
  /**
   * VEN-W13 (founder, 2026-10-01). Where the code came from, how many invoices
   * it was written from, and what the vendor's invoices say now. Absent, the
   * sentence is the person-only one this function always gave.
   */
  source?: UsualCurrencySource | null;
  invoiceCount?: number | null;
  decision?: UsualCurrencyDecision | null;
  /**
   * VEN-W23 (founder, 2026-10-01). The house's IANA zone, so "stated on" is
   * the house's own calendar day in words. Null or absent: the day is read in
   * UTC and the sentence says "(UTC)".
   */
  houseZone?: string | null;
}): string {
  const who = args.vendorName?.trim() || "This vendor";
  const code = (args.code ?? "").trim().toUpperCase();
  const fromInvoices = invoiceSentence({ ...args, who, code });
  if (fromInvoices) return fromInvoices;
  // A STORED VALUE THAT IS NOT A CURRENCY IS NAMED, not reported as an absence.
  // `ZZZ` was writable here until 2026-09-06, so rows can hold one, and telling
  // a manager the field is empty when it is not is the fault this whole pass is
  // about pointed at a screen.
  if (code !== "" && !isCurrency(code))
    return (
      `${who}'s usual currency is recorded as ${code}, which does not name a ` +
      `currency. ${notACurrencyBecause(code)} Nothing is offered on an order ` +
      `to them until this is corrected — type the code they actually invoice ` +
      `in and it replaces this one.`
    );
  if (!isCurrency(code))
    return (
      `${who} has no usual currency on file, so an order to them starts with no ` +
      `currency. Choose the one they invoice in and orders to them will start in it.`
    );

  const name = args.setByName?.trim();
  // The HOUSE's calendar day, in words (VEN-W23) — never the UTC date sliced
  // off the timestamp, which an evening in Chicago turned into tomorrow.
  const when = houseDayWords(args.setAt, args.houseZone);
  const attribution =
    name && when
      ? ` Stated by ${name} on ${when}.`
      : name
        ? ` Stated by ${name}.`
        : "";
  return (
    `${who} usually invoices in ${code}.${attribution} This is offered as the ` +
    `starting currency when an order is placed with them, and it can be changed ` +
    `there. It never sets an invoice's currency: an invoice takes the currency printed on ` +
    `it, then the currency of the order it is matched to.`
  );
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The five sheet states of ruling VEN-W13, in the words of the approved
 * sketch. Returns null when the ordinary person-stated (or empty, or
 * not-a-currency) sentence applies instead.
 */
function invoiceSentence(args: {
  who: string;
  code: string;
  source?: UsualCurrencySource | null;
  invoiceCount?: number | null;
  decision?: UsualCurrencyDecision | null;
}): string | null {
  const d = args.decision;
  if (!d) return null;
  const { who, code } = args;
  const valid = code !== "" && isCurrency(code);

  switch (d.state) {
    case "A": {
      const n = d.counted || args.invoiceCount || 0;
      return (
        `All ${plural(n, "invoice", "invoices")} from ${who} ${n === 1 ? "was" : "were"} printed in ${code}, ` +
        `so orders to them start in ${code}. You can change it on the order.`
      );
    }
    case "B": {
      const [first, ...rest] = d.counts;
      const parts = [
        `${first.invoices} printed in ${first.code}`,
        ...rest.map((c) => `${c.invoices} in ${c.code}`),
      ];
      return (
        `Their invoices disagree: ${parts.join(", ")}. ` +
        `Choose the one they usually invoice in; your name goes on it.`
      );
    }
    case "C": {
      if (!d.clash || !valid) return null;
      const n = d.clash.lastInvoices;
      return (
        `${n === 1 ? "Their last invoice was" : `Their last ${n} invoices were`} printed in ${d.clash.code}. ` +
        `${code} stays until someone switches it.`
      );
    }
    case "D": {
      const others = d.counts.filter((c) => c.code !== code);
      const later = others.reduce((sum, c) => sum + c.invoices, 0);
      const codes = others.map((c) => c.code);
      const named =
        codes.length <= 1
          ? codes.join("")
          : `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
      return (
        `${later === 1 ? "A later invoice was" : `${later} later invoices were`} printed in ${named}. ` +
        `Orders still start in ${code}; choose which one they usually invoice in.`
      );
    }
    case "E": {
      const only = d.counts[0];
      if (!only)
        return (
          `No invoice from ${who} has printed a currency yet. ` +
          `After ${INVOICES_TO_WRITE} in the same currency it is filled in for you — or choose it now.`
        );
      const n = only.invoices;
      const printed =
        n === 1
          ? `printed in ${only.code}`
          : `${n === 2 ? "both" : "all"} printed in ${only.code}`;
      if (n >= INVOICES_TO_WRITE)
        return (
          `${plural(n, "invoice", "invoices")} so far, ${printed}. ` +
          `It is filled in for you when their next invoice is read — or choose it now.`
        );
      const more = INVOICES_TO_WRITE - n;
      return (
        `${plural(n, "invoice", "invoices")} so far, ${printed}. ` +
        `After ${more} more in the same currency it is filled in for you — or choose it now.`
      );
    }
    default:
      return null;
  }
}

/**
 * HOW MANY VENDORS HAVE BEEN ASKED — the prompt that keeps the chain alive.
 *
 * THE FOUNDER, 2026-09-06, batch 66, verbatim:
 *   *"Add the prompt panel"* — "One panel on the providers page (and the orders
 *    sheet's empty field) saying how many vendors have stated a usual currency
 *    and linking to the ones that have not. No provenance lie."
 *
 * The fault this answers was named in batch 65's own report: with nothing
 * pre-filled and no vendor profile filled in, every new order records no
 * currency, `procurement_orders.currency` stays NULL, the order rung of
 * `filingCurrency` is inert, and the whole chain falls back to the house
 * exactly as before — a feature that degrades to nothing while the product
 * asks nobody to keep it alive. The rejected repair was restoring a
 * house-derived pre-fill, which would record `currency_source = 'typed'` over a
 * value no person typed: a provenance lie in the one column built to tell a
 * decision from a default.
 *
 * THIS COUNT PRE-FILLS NOTHING. It is a count and a list of names. Reading it
 * changes no order sheet and no vendor row.
 */
export function usualCurrencyCoverageSentence(args: {
  stated: number;
  total: number;
  /**
   * VEN-W13: how many of the `stated` were written from the vendor's own
   * invoices rather than by a person. Optional; zero says nothing extra.
   */
  fromInvoices?: number;
}): string {
  const base = coverageBase(args);
  const n = args.fromInvoices ?? 0;
  if (n <= 0 || args.stated <= 0) return base;
  return (
    `${base} ` +
    (n === args.stated
      ? args.stated === 1
        ? "It was filled in from their invoices."
        : "All of them were filled in from their invoices."
      : `${n} of them ${n === 1 ? "was" : "were"} filled in from their invoices.`)
  );
}

function coverageBase(args: { stated: number; total: number }): string {
  const { stated, total } = args;
  const vendors = total === 1 ? "vendor" : "vendors";
  // NEVER AN EMPTY PANEL. Every branch below is a sentence, including the two
  // that have no list under them, because a panel that renders nothing when the
  // answer is "none of them" is the absence-reported-as-health fault with a
  // heading on it: a reader cannot tell it from a panel that failed to load.
  if (total === 0)
    return (
      "No vendors yet. Once one is in the book, the currency they invoice in can be noted on it."
    );
  if (total === 1)
    return stated === 1
      ? "Your one vendor has a usual currency on file. Orders to them start in it, and it can be changed on the order."
      : "Your one vendor has no usual currency on file. Once one is noted, orders to them start in it; until then an order starts with no currency.";
  if (stated === 0)
    return (
      `None of your ${total} ${vendors} has a usual currency on file. ` +
      `Once one is noted, orders to that vendor start in it; until then an order starts with no currency.`
    );
  if (stated === total)
    return (
      `All ${total} of your ${vendors} ${total === 1 ? "has" : "have"} a usual currency on file. ` +
      `Orders to them start in it, and it can be changed on the order.`
    );
  return (
    `${stated} of your ${total} ${vendors} ${stated === 1 ? "has" : "have"} a usual currency on file. ` +
    `Orders to the other ${total - stated} start with no currency until one is noted.`
  );
}
