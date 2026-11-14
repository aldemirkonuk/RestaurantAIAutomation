import { readMenuPrice } from "./menu-price";

describe("readMenuPrice: an amount only when the string has one reading (ADR 0020)", () => {
  it.each([
    ["45,50", 45.5],
    ["1.250,00", 1250],
    ["1,250.00", 1250],
    ["45.5", 45.5],
    ["45", 45],
    ["0,250", 0.25],
    ["12.345.678", 12345678],
    ["1.234.567,89", 1234567.89],
    ["₺450", 450],
    ["450 TL", 450],
    ["$45.00", 45],
    ["€ 12,5", 12.5],
  ])("%s reads %s", (raw, amount) => {
    expect(readMenuPrice(raw)).toEqual({ amount, raw, reason: null });
  });

  it.each([
    "1.250",
    "1,250",
    "12.500",
    "12 / 45",
    "12-15",
    "12 450",
    "1 250,50",
  ])("%s has two readings: no amount, the raw string kept", (raw) => {
    expect(readMenuPrice(raw)).toEqual({
      amount: null,
      raw,
      reason: "two_readings",
    });
  });

  it.each(["1.25.0", "12,3456.7", "1,2,3"])("%s fits no reading", (raw) => {
    expect(readMenuPrice(raw)).toEqual({
      amount: null,
      raw,
      reason: "unreadable",
    });
  });

  it("says what is missing when there is no number at all", () => {
    expect(readMenuPrice("  ")).toEqual({
      amount: null,
      raw: "",
      reason: "empty",
    });
    expect(readMenuPrice("—")).toEqual({
      amount: null,
      raw: "—",
      reason: "no_number",
    });
  });
});
