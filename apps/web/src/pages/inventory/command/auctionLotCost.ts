/**
 * What an auction lot books per bottle, in the HOUSE's money — the founder's
 * answer (10) of 2026-09-21: *"record the exchange rate the person states AND
 * let them type the per-bottle cost in the house currency (people round); a
 * typed house cost wins, both are recorded, nothing inferred."*
 *
 * The same rule as the gateway's `inventory/auction-lot-cost.ts`, which
 * refuses a lot record whose booked cost is not the one this gives: the sheet
 * works it out BEFORE carrying, so the stock is never carried at a cost the
 * record will not accept. Rounded to cents once, at the end.
 *
 *   1. a per-bottle cost typed in the house's currency is booked;
 *   2. otherwise a lot in the house's own currency books its own per-bottle cost;
 *   3. otherwise a foreign lot books its per-bottle cost times the STATED rate;
 *   4. otherwise nothing is booked, and the sheet says what to state.
 */

export type BookedCost =
  | { ok: true; booked: number; basis: 'typed_house_cost' | 'same_currency' | 'stated_rate'; lotPerBottle: number }
  | { ok: false; why: string };

const cents = (n: number) => Math.round(n * 100) / 100;

function numberOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function lotBookedCost(input: {
  lotPerBottle: number;
  /** The lot's ISO-4217 code. */
  currency: string;
  /** The house's code; null when the house has not stated one (or it could not be read). */
  houseCurrency: string | null;
  /** As typed: '' is "not stated". */
  exchangeRate: string;
  /** As typed: '' is "not typed". */
  houseCost: string;
}): BookedCost {
  const rate = numberOrNull(input.exchangeRate);
  const typed = numberOrNull(input.houseCost);
  if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
    return { ok: false, why: 'An exchange rate must be a number above zero.' };
  }
  if (typed !== null && (!Number.isFinite(typed) || typed < 0)) {
    return { ok: false, why: 'A per-bottle cost must be an amount of zero or more.' };
  }
  const house = (input.houseCurrency ?? '').trim().toUpperCase() || null;
  const lot = input.currency.trim().toUpperCase();
  if (!house) {
    return {
      ok: false,
      why: 'This house has not stated the currency it keeps its books in (Settings, Currency), so a lot’s cost cannot be booked in it. Nothing is inferred.',
    };
  }
  if (typed !== null) return { ok: true, booked: cents(typed), basis: 'typed_house_cost', lotPerBottle: input.lotPerBottle };
  if (lot === house) {
    if (rate !== null) {
      return { ok: false, why: `The lot is already in ${house}, the house’s own currency, so there is no exchange rate to state.` };
    }
    return { ok: true, booked: input.lotPerBottle, basis: 'same_currency', lotPerBottle: input.lotPerBottle };
  }
  if (rate !== null) {
    return { ok: true, booked: cents(input.lotPerBottle * rate), basis: 'stated_rate', lotPerBottle: input.lotPerBottle };
  }
  return {
    ok: false,
    why: `The lot is in ${lot} and this house keeps its books in ${house}: state the exchange rate you used, or type what each bottle cost in ${house}. Nothing is inferred.`,
  };
}
