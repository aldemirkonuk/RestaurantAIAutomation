import { minimumOf, saysMixed } from "./promotions.service";

describe("minimumOf — the offer's stated minimum, read from conditions", () => {
  it("reads the number the extractor writes, with no unit (every stored row today)", () => {
    expect(minimumOf({ min_qty: 12 })).toEqual({ quantity: 12, unit: null, mixed: false });
  });

  it("reads a unit when a writer supplies one", () => {
    expect(minimumOf({ min_qty: "6", min_qty_unit: "case" })).toEqual({ quantity: 6, unit: "case", mixed: false });
  });

  it("states no minimum when none is stored, or the stored one is not a positive number", () => {
    expect(minimumOf(null)).toBeNull();
    expect(minimumOf({})).toBeNull();
    expect(minimumOf({ min_qty: 0 })).toBeNull();
    expect(minimumOf({ min_qty: -3 })).toBeNull();
    expect(minimumOf({ min_qty: "many" })).toBeNull();
  });

  it("ignores a blank unit rather than reading it as one", () => {
    expect(minimumOf({ min_qty: 12, min_qty_unit: "" })).toEqual({ quantity: 12, unit: null, mixed: false });
  });
});

describe("saysMixed — does the OFFER say its minimum may be mixed (ADR 0165 open item 3)", () => {
  it("reads a stated flag first", () => {
    expect(saysMixed({ mixed: true }, null)).toBe(true);
    expect(saysMixed({ mixed_case: true }, null)).toBe(true);
    expect(saysMixed({ mixed: false }, "any mixed case")).toBe(false);
  });

  it("reads the offer's own words for a mixed-case phrase", () => {
    expect(saysMixed({}, "10% off any mixed case of 12")).toBe(true);
    expect(saysMixed({}, "Mix-and-match 6 bottles")).toBe(true);
    expect(saysMixed({}, "Mix & match across the range")).toBe(true);
    expect(saysMixed({}, "Bottles can be mixed")).toBe(true);
    expect(saysMixed({ valid_text: "mixed cases welcome" }, null)).toBe(true);
  });

  it("reads a negation as NOT mixed — the stricter, per-wine reading", () => {
    expect(saysMixed({}, "No mixed cases")).toBe(false);
    expect(saysMixed({}, "Cases cannot be mixed")).toBe(false);
    expect(saysMixed({}, "not mixable")).toBe(false);
  });

  it("with nothing said, the minimum is per wine", () => {
    expect(saysMixed({}, "12 bottles minimum")).toBe(false);
    expect(saysMixed(null, null)).toBe(false);
    expect(minimumOf({ min_qty: 12, min_qty_unit: "bottle" }, "any mixed case")).toEqual({ quantity: 12, unit: "bottle", mixed: true });
  });
});
