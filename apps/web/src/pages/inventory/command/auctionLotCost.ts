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

import { parseDecimal, twoReadingsProblem, type GroupMark } from '@/lib/parseDecimal';

const cents = (n: number) => Math.round(n * 100) / 100;

/** '' is null; typed text the way the house writes it ("1,35"); anything else NaN. */
function numberOrNull(v: string, group: GroupMark | null): number | null {
  if (v.trim() === '') return null;
  return parseDecimal(v, group) ?? Number.NaN;
}

/**
 * The stated exchange rate as typed, read WITHOUT the house's thousands mark
 * (F-778). A rate is never written in thousands-grouped form, but it often
 * carries three or four decimals: in a Turkish house "44.125" grouped would be
 * 44,125 and book every bottle 1000x too high. A lone mark in a rate is always
 * the decimal mark.
 */
export function readExchangeRate(v: string): number | null {
  return numberOrNull(v, null);
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
  /** The house's thousands mark, for a typed cost "1.250" (see `lib/parseDecimal`). Never applied to the rate. */
  group?: GroupMark | null;
  /** The mark this screen groups thousands with: a typed cost that reads two ways is asked (F-832). */
  display?: GroupMark | null;
}): BookedCost {
  const rate = readExchangeRate(input.exchangeRate);
  const typed = numberOrNull(input.houseCost, input.group ?? null);
  if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
    return { ok: false, why: 'An exchange rate must be a number above zero.' };
  }
  if (typed !== null && (!Number.isFinite(typed) || typed < 0)) {
    return { ok: false, why: 'A per-bottle cost must be an amount of zero or more.' };
  }
  const asked = twoReadingsProblem(input.houseCost, input.group ?? null, input.display ?? null);
  if (asked) return { ok: false, why: `The per-bottle cost: ${asked}` };
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
