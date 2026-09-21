/**
 * What an auction lot books per bottle, in the HOUSE's money — the founder's
 * answer (10) of 2026-09-21:
 *
 *   *"auction lots in a foreign currency: record the exchange rate the person
 *   states AND let them type the per-bottle cost in the house currency (people
 *   round); a typed house cost wins, both are recorded, nothing inferred."*
 *
 * `inventory_lots.unit_cost` is read everywhere as the house's own money, and
 * a lot's (hammer + premium) / bottles is in the LOT's currency. So:
 *
 *   1. a per-bottle cost the person TYPED in the house's currency is booked;
 *   2. otherwise, a lot in the house's own currency books its own per-bottle
 *      cost;
 *   3. otherwise, a foreign lot books its per-bottle cost times the exchange
 *      rate the person STATED;
 *   4. otherwise there is no honest number, and the answer is a refusal that
 *      says what to state. No rate is ever looked up, and a house that has not
 *      stated its own currency cannot be told apart from a foreign lot, so it
 *      is refused too (nothing inferred).
 *
 * Money is rounded to cents once, at the end — the same `Math.round(x * 100) /
 * 100` the sheet's own working uses (`AuctionLotStart.tsx` `lotCost`), so the
 * page and the gateway state the same figure. The web mirrors this rule in
 * `apps/web/src/pages/inventory/command/auctionLotCost.ts`; each side has its
 * own tests, and the gateway refuses a record whose booked cost is not the one
 * this rule gives.
 */

export type LotCostAnswer =
  | {
      ok: true;
      /** What the book was (or will be) given, per bottle, in the house's currency. */
      booked: number;
      /** How it was reached, for the record and the sheet. */
      basis: "typed_house_cost" | "same_currency" | "stated_rate";
      lotPerBottle: number;
    }
  | { ok: false; why: string };

const cents = (n: number) => Math.round(n * 100) / 100;

export function lotBookedCost(input: {
  hammer: number;
  premium: number;
  bottles: number;
  /** The lot's ISO-4217 code. */
  currency: string;
  /** The house's ISO-4217 code, or null when the house has not stated one. */
  houseCurrency: string | null;
  exchangeRate?: number | null;
  houseUnitCost?: number | null;
}): LotCostAnswer {
  const { hammer, premium, bottles } = input;
  if (!Number.isFinite(hammer) || hammer < 0 || !Number.isFinite(premium) || premium < 0) {
    return { ok: false, why: "The hammer price and the premium must be stated as amounts of zero or more." };
  }
  if (!Number.isInteger(bottles) || bottles < 1) {
    return { ok: false, why: "Say how many bottles were in the lot, as a whole number." };
  }
  const lotPerBottle = cents((hammer + premium) / bottles);
  const rate = input.exchangeRate ?? null;
  const typed = input.houseUnitCost ?? null;
  if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
    return { ok: false, why: "An exchange rate must be a number above zero." };
  }
  if (typed !== null && (!Number.isFinite(typed) || typed < 0)) {
    return { ok: false, why: "A per-bottle cost must be an amount of zero or more." };
  }
  const house = (input.houseCurrency ?? "").trim().toUpperCase() || null;
  const lot = input.currency.trim().toUpperCase();
  if (!house) {
    return {
      ok: false,
      why:
        "This house has not stated the currency it keeps its books in (Settings, Currency), so a lot's cost cannot be booked in it. Nothing is inferred.",
    };
  }
  if (typed !== null) return { ok: true, booked: cents(typed), basis: "typed_house_cost", lotPerBottle };
  if (lot === house) {
    if (rate !== null) {
      return { ok: false, why: `The lot is already in ${house}, the house's own currency, so there is no exchange rate to state.` };
    }
    return { ok: true, booked: lotPerBottle, basis: "same_currency", lotPerBottle };
  }
  if (rate !== null) return { ok: true, booked: cents(lotPerBottle * rate), basis: "stated_rate", lotPerBottle };
  return {
    ok: false,
    why: `The lot is in ${lot} and this house keeps its books in ${house}: state the exchange rate you used, or type what each bottle cost in ${house}. Nothing is inferred.`,
  };
}
