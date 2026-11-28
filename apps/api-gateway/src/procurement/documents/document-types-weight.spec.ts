import { resolveStatedPriceUnit } from "../agreed-price";
import { resolveOrderUnits } from "../order-units";
import {
  comparableUnits,
  isMass,
  massFactor,
  normalizeUom,
  toBottles,
} from "./document-types";

/**
 * R8 (mail-receipts lane, 2026-11-11): a cheese invoiced `3 KGM @ 450` was
 * filed as `3 each`. A line may now be weighed; an order, the order door and
 * an agreed price may not, and refuse a weight by name.
 */
describe("a line may be weighed (R8)", () => {
  it.each([
    ["KGM", "kg"],
    ["kg", "kg"],
    ["Kg.", "kg"],
    ["KGS", "kg"],
    ["kilo", "kg"],
    ["Kilogram", "kg"],
    ["GRM", "g"],
    ["gr", "g"],
    ["g", "g"],
    ["grams", "g"],
  ])("%s reads as %s", (raw, want) => {
    expect(normalizeUom(raw)).toBe(want);
  });

  it("a liter still reads as a liter, not a weight", () => {
    expect(normalizeUom("L")).toBe("liter");
    expect(normalizeUom("LTR")).toBe("liter");
  });

  it("a weight is never a number of bottles, and compares only with itself", () => {
    expect(toBottles(3, "kg", 12)).toBe(3);
    expect(comparableUnits("kg", "bottle")).toBe(false);
    expect(comparableUnits("each", "g")).toBe(false);
    expect(comparableUnits("kg", "g")).toBe(false);
    expect(comparableUnits("kg", "kg")).toBe(true);
  });

  it("converts weight to weight only", () => {
    expect(massFactor("kg", "g")).toBe(1000);
    expect(massFactor("kg", "mg")).toBe(1_000_000);
    expect(massFactor("g", "kg")).toBe(0.001);
    expect(massFactor("kg", "bottle")).toBeNull();
    expect(isMass("kg")).toBe(true);
    expect(isMass("liter")).toBe(false);
  });

  it("an order in kg is refused by name, not written into a CHECK that fails", () => {
    const r = resolveOrderUnits({ quantity: 3, unitType: "kg" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("unknown_unit");
      expect(r.message).toContain('Unit "kg"');
    }
  });

  it("a price agreed per kg is refused by name", () => {
    const r = resolveStatedPriceUnit({ priceUom: "kg", pricePackSize: 1 } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_price_unit");
  });
});
