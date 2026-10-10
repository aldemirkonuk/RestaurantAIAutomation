import { houseMoney } from "../houseMoney";

/**
 * F-885: the phone printed "$12,400" for every house. A figure now prints in
 * the house's money, grouped the house's way, as the gateway's houseMoney does.
 */
describe("houseMoney — the phone's money in the house's terms (F-885)", () => {
  it("prints a lira house in lira with '.' grouping", () => {
    expect(houseMoney(12400, { currency: "TRY", locale: "tr-TR" })).toBe("₺12.400");
  });

  it("prints a euro house in Germany with the symbol after the figure", () => {
    expect(houseMoney(12400, { currency: "EUR", locale: "de-DE" })).toBe("12.400\u00a0€");
  });

  it("prints a dollar house as before", () => {
    expect(houseMoney(12400, { currency: "USD", locale: "en-US" })).toBe("$12,400");
  });

  it("prints no symbol, never a dollar, when no currency is recorded", () => {
    expect(houseMoney(12400, { currency: null, locale: null })).toBe("12,400");
    expect(houseMoney(12400, undefined)).toBe("12,400");
  });

  it("keeps cents only when asked, in the house's decimal mark", () => {
    expect(
      houseMoney(18.5, { currency: "TRY", locale: "tr-TR" }, { maxFractionDigits: 2 }),
    ).toBe("₺18,5");
    expect(houseMoney(18.5, { currency: "TRY", locale: "tr-TR" })).toBe("₺19");
  });

  it("prints a code with no symbol of its own as itself", () => {
    expect(houseMoney(1240, { currency: "ZZZ", locale: "en-US" })).toBe("ZZZ\u00a01,240");
  });
});
