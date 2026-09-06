import { isIso4217, notACurrencyBecause } from "../common/iso-4217";

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

/**
 * IS THIS A CURRENCY? Membership, not shape.
 *
 * The database CHECK is still `^[A-Z]{3}$` and stays that way — SQL holds no
 * currency table and one written into a constraint could not be corrected
 * without a migration. The list lives in `common/iso-4217.ts` and this is the
 * layer that enforces it, so a value this module accepts is BOTH a value the
 * database accepts and a value that names money. Until 2026-09-06 only the
 * first was true, and `"ZZZ"` could be offered as an order's currency.
 */
const isCurrency = isIso4217;

export type AgreementCurrencyBasis =
  | "vendor_usual"
  | "vendor_paper"
  | "house";

/**
 * What is WRITTEN on the order beside the code, from
 * `procurement_orders.currency_source`.
 *
 * Deliberately coarser than `AgreementCurrencyBasis`, and the coarseness is the
 * point (founder, 2026-09-06 batch 65). The sheet may reason about a default
 * three ways; the ORDER records only whether the person accepted the vendor's
 * own stated usual currency or put a code there themselves. There is no third
 * value for "assumed", because nothing assumes: a vendor that has stated no
 * usual currency leaves the field EMPTY and the sheet says so.
 */
export type OrderCurrencySource = "vendor_usual" | "typed";

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
   * `providers.usual_currency` — what a PERSON stated this vendor usually
   * invoices in, on the vendor's own profile. NULL for a vendor nobody has
   * asked, which is the normal state and stays it.
   */
  vendorUsualCurrency?: string | null | undefined;
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
  return isCurrency(upper) ? upper : null;
}

/**
 * A value that was RECORDED but does not name a currency, or `null`.
 *
 * The distinction `normalise` alone cannot carry, and it matters on every
 * sentence below: "this vendor has stated no usual currency" and "this vendor's
 * usual currency is recorded as ZZZ, which is not one" send a person to two
 * different places, and only the second is true when the column holds junk. A
 * refusal that flattens into an absence is the same fault as an absence
 * reported as health, one field over.
 */
function refusedCode(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const upper = code.trim().toUpperCase();
  if (upper === "" || isCurrency(upper)) return null;
  return upper;
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
  /*
   * THE VENDOR'S OWN STATED USUAL CURRENCY IS THE TOP RUNG, from 2026-09-06
   * (batch 65): *"We will show the user the currency the vendor always uses,
   * and they have the ability to change it or not in the orders page."*
   *
   * It outranks their paper for a reason worth stating, because the paper is
   * strictly harder evidence and this looks like a step backwards. A person who
   * typed "this vendor bills in EUR" on the vendor's profile has answered the
   * question the sheet is asking — WHAT WILL THE NEXT ORDER BE IN — while the
   * last invoice answers a different one: what the last order WAS in. Those
   * diverge exactly when a vendor changes how they bill, which is the moment
   * the paper is most confidently wrong. The rung below still catches every
   * vendor nobody has asked, and both are LABELLED, so a person can see which
   * question was answered.
   */
  const fromVendor = normalise(inputs.vendorUsualCurrency);
  if (fromVendor) {
    const who = inputs.vendorName?.trim() || "this vendor";
    return {
      code: fromVendor,
      basis: "vendor_usual",
      sentence:
        `${fromVendor} — the currency this vendor usually uses, as stated on ` +
        `${who}'s profile. Change it if this order is priced differently.`,
    };
  }

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

  /*
   * A REFUSED CODE IS NAMED, NEVER FLATTENED INTO AN ABSENCE. If the vendor's
   * profile, their last invoice or this house's own row holds a value that is
   * not a currency — `ZZZ` was admissible everywhere in this gateway until
   * 2026-09-06 — then "no currency can be worked out" is true, but "nobody has
   * stated one" is not, and a manager sent looking for an empty field will not
   * find one.
   */
  const refused = [
    refusedCode(inputs.vendorUsualCurrency)
      ? `this vendor's profile records ${refusedCode(inputs.vendorUsualCurrency)}`
      : null,
    refusedCode(inputs.vendorPaperCurrency)
      ? `their last invoice records ${refusedCode(inputs.vendorPaperCurrency)}`
      : null,
    refusedCode(inputs.houseCurrency)
      ? `this house records ${refusedCode(inputs.houseCurrency)}`
      : null,
  ].filter(Boolean);

  return {
    code: null,
    basis: null,
    sentence:
      "No currency can be worked out: no invoice from this vendor states one " +
      "and this house has not recorded the money it reports in. " +
      (refused.length
        ? `${refused.join(", and ")} — ${refused.length === 1 ? "which is not a currency this system knows, so it is not offered" : "none of which is a currency this system knows, so none is offered"}. `
        : "") +
      "Choose one, or leave it and every amount on this line will read as " +
      "“currency not recorded”.",
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

/* ===========================================================================
 * B2 — THE ORDER'S OWN CURRENCY (founder, 2026-09-06, batch 65).
 *
 * *"We will show the user the currency the vendor always uses, and they have
 *  the ability to change it or not in the orders page."*
 *
 * ---------------------------------------------------------------------------
 * THIS NARROWS ADR 0117 Q31, AND THE NARROWING IS DELIBERATE
 * ---------------------------------------------------------------------------
 * On 2026-09-05 the founder said the agreement line's currency should be
 * *"defaulted from the vendor's terms or the house"*, and `agreementCurrencyDefault`
 * above implements exactly that: vendor's usual currency, then their last
 * invoice, then `restaurants.currency`. On 2026-09-06 they named ONE source for
 * the order — the currency the vendor always uses — and said the person may
 * change it there.
 *
 * The two are not the same rule, and the difference matters because of what the
 * ORDER now carries. `procurement_orders.currency_source` admits two values,
 * `vendor_usual` and `typed`, and nothing else: every code on an order is either
 * the vendor's own stated one or a person's. A field PRE-FILLED from the house
 * and submitted untouched belongs to neither — it would be recorded as `typed`,
 * which says a person chose it, and nobody did. That is the
 * [[absence-reported-as-health]] shape aimed at a provenance column, and it is
 * worse than an empty field because the invoice-versus-order check in
 * `invoice-currency.ts` then compares a vendor's paper against a number this
 * house invented.
 *
 * So the ORDER's offer is the vendor's stated usual currency or NOTHING. The
 * house's currency and the vendor's last invoice are still SHOWN — as evidence
 * a person can act on, named as what they are — but neither is pre-filled.
 * `agreementCurrencyDefault` is untouched and keeps ADR 0117 Q31's behaviour for
 * the agreement LINE; this is the header's rule. That the two now differ is
 * filed as a founder question rather than smoothed over.
 * ======================================================================== */

export interface OrderCurrencyOffer {
  /** The code to PRE-FILL, or `null` when nothing may be pre-filled. */
  code: string | null;
  /** `vendor_usual` when a code is offered; `null` when none is. */
  basis: "vendor_usual" | null;
  /** What the sheet prints under the field. Always present. */
  sentence: string;
  /**
   * What is known but NOT pre-filled, for the sheet to show as evidence. A
   * manager choosing a currency for a vendor who has stated none should be able
   * to see what that vendor last billed in and what this house reports in --
   * seeing them is different from having one of them already chosen.
   */
  alsoKnown: { vendorPaper: string | null; house: string | null };
}

export function orderCurrencyOffer(
  inputs: AgreementCurrencyInputs,
): OrderCurrencyOffer {
  const alsoKnown = {
    vendorPaper: normalise(inputs.vendorPaperCurrency),
    house: normalise(inputs.houseCurrency),
  };
  const who = inputs.vendorName?.trim() || "This vendor";
  const usual = normalise(inputs.vendorUsualCurrency);

  if (usual)
    return {
      code: usual,
      basis: "vendor_usual",
      sentence:
        `${usual} — the currency this vendor usually uses, stated on ${who}'s ` +
        `profile. Change it if this order is priced differently; the order will ` +
        `record which of the two it was.`,
      alsoKnown,
    };

  const evidence = [
    alsoKnown.vendorPaper
      ? `their last invoice to this house was in ${alsoKnown.vendorPaper}`
      : null,
    alsoKnown.house ? `this house reports in ${alsoKnown.house}` : null,
  ].filter(Boolean);

  // What the profile HOLDS, when it holds something that is not a currency.
  // Saying "has not stated a usual currency" about a profile reading `ZZZ`
  // would send a manager to a field that is already filled in.
  const refused = refusedCode(inputs.vendorUsualCurrency);

  return {
    code: null,
    basis: null,
    sentence:
      (refused
        ? `${who}'s profile records ${refused}, which does not name a currency — ${notACurrencyBecause(refused)} Nothing is pre-filled here. `
        : `${who} has not stated a usual currency, so nothing is pre-filled here — ` +
          `choosing for them is how a currency nobody agreed to ends up on an ` +
          `invoice. `) +
      (evidence.length
        ? `For what it is worth: ${evidence.join(", and ")}. Either is available in the list. `
        : "") +
      `Pick one, or leave it empty and this order records no currency.`,
    alsoKnown,
  };
}

/**
 * Where the code recorded on an ORDER came from.
 *
 * Derived on the SERVER from the vendor's own stated currency rather than taken
 * from the client, for the reason every provenance field in this codebase is
 * derived: a label the writer supplies about itself is a claim, and this one
 * decides whether a manager later reads "we suggested it" or "somebody chose
 * it".
 *
 * The `typed` arm is honest precisely BECAUSE `orderCurrencyOffer` pre-fills
 * nothing but the vendor's usual currency: any other code on the order was put
 * in the field by a person, since nothing else can put one there.
 */
export function orderCurrencySource(args: {
  recorded: string | null;
  vendorUsualCurrency: string | null | undefined;
}): OrderCurrencySource | null {
  const code = normalise(args.recorded);
  if (!code) return null;
  return code === normalise(args.vendorUsualCurrency) ? "vendor_usual" : "typed";
}
