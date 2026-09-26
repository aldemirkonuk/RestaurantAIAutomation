/**
 * The founder's answer (10), 2026-09-21: *"record the exchange rate the person
 * states AND let them type the per-bottle cost in the house currency (people
 * round); a typed house cost wins, both are recorded, nothing inferred."*
 * The rule is pure, so nothing here is mocked; each clause has a case that
 * fails when the clause is removed.
 */
import { lotBookedCost } from "./auction-lot-cost";

const LOT = { hammer: 1000, premium: 250, bottles: 6, currency: "GBP" };

describe("lotBookedCost", () => {
  it("a lot in the house's own currency books its own per-bottle cost", () => {
    expect(lotBookedCost({ ...LOT, houseCurrency: "GBP" })).toEqual({
      ok: true,
      booked: 208.33,
      basis: "same_currency",
      lotPerBottle: 208.33,
    });
  });

  it("a foreign lot with a stated rate books the per-bottle cost times the rate, rounded to cents once", () => {
    expect(lotBookedCost({ ...LOT, houseCurrency: "EUR", exchangeRate: 1.17 })).toMatchObject({
      ok: true,
      booked: 243.75,
      basis: "stated_rate",
    });
  });

  it("a typed house cost wins over a stated rate — people round", () => {
    expect(lotBookedCost({ ...LOT, houseCurrency: "EUR", exchangeRate: 1.17, houseUnitCost: 245 })).toMatchObject({
      ok: true,
      booked: 245,
      basis: "typed_house_cost",
    });
  });

  it("a typed house cost wins over the lot's own figure, even in the same currency", () => {
    expect(lotBookedCost({ ...LOT, houseCurrency: "GBP", houseUnitCost: 210 })).toMatchObject({ booked: 210 });
  });

  it("a foreign lot with neither is refused, and the refusal says what to state", () => {
    const out = lotBookedCost({ ...LOT, houseCurrency: "EUR" });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.why).toMatch(/state the exchange rate you used, or type what each bottle cost in EUR/);
  });

  it("nothing is inferred when the house has not stated its currency", () => {
    const out = lotBookedCost({ ...LOT, houseCurrency: null, exchangeRate: 1.2 });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.why).toMatch(/has not stated the currency/);
  });

  it("a rate on a same-currency lot is refused rather than silently applied", () => {
    expect(lotBookedCost({ ...LOT, houseCurrency: "GBP", exchangeRate: 1.1 }).ok).toBe(false);
  });

  it.each([0, -1, Number.NaN])("a rate of %p is refused", (rate) => {
    expect(lotBookedCost({ ...LOT, houseCurrency: "EUR", exchangeRate: rate }).ok).toBe(false);
  });

  it("the currency comparison is case-blind", () => {
    expect(lotBookedCost({ ...LOT, currency: "gbp", houseCurrency: "GBP" })).toMatchObject({ ok: true, basis: "same_currency" });
  });
});
