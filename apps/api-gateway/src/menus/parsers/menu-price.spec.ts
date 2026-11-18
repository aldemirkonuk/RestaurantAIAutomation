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

describe("readMenuPrice: a minus in front is not a price (a discount row is not a line)", () => {
  it.each(["-45", "-10,50", "- 12", "\u221245", "-$45", "-\u20ba450"])(
    "%s has no amount and says it is below zero",
    (raw) => {
      expect(readMenuPrice(raw)).toEqual({
        amount: null,
        raw,
        reason: "negative",
      });
    },
  );

  it.each([
    ["45,-", 45],
    ["45-", 45],
    ["12.50 -", 12.5],
  ])("%s keeps its trailing mark and reads %s", (raw, amount) => {
    expect(readMenuPrice(raw)).toEqual({ amount, raw, reason: null });
  });

  it("still reads a dash between two numbers as two readings", () => {
    expect(readMenuPrice("12-15").reason).toBe("two_readings");
  });
});

describe("readMenuPrice: a price the price column cannot hold gets no amount (r55)", () => {
  it.each(["100000000", "99999999999", "1.000.000.000,00"])(
    "%s is more than the column holds, so it says too large",
    (raw) => {
      expect(readMenuPrice(raw)).toEqual({ amount: null, raw, reason: "too_large" });
    },
  );

  it.each(["45.5555", "12,3456", "0,0049"])(
    "%s has more than two decimal places, so it says too precise rather than rounding",
    (raw) => {
      expect(readMenuPrice(raw)).toEqual({ amount: null, raw, reason: "too_precise" });
    },
  );

  it.each([
    ["99999999.99", 99999999.99],
    ["45.5000", 45.5],
    ["0,25", 0.25],
  ])("%s still reads as %s", (raw, amount) => {
    expect(readMenuPrice(raw)).toEqual({ amount, raw, reason: null });
  });
});
