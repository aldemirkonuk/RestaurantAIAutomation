import {
  comparableUnits,
  normalizeUom,
  toBottles,
  Uom,
} from "./document-types";

describe("normalizeUom", () => {
  it("reconciles the schema's own inconsistency", () => {
    // Historically: procurement_order_items.unit_type defaulted to the PLURAL
    // 'bottles' with no CHECK, procurement_orders had no CHECK either, and only
    // document lines CHECKed for singulars. One migration later all four columns
    // share the singular vocabulary — but the INPUTS still arrive in every
    // spelling, so all of them must land on the same unit.
    expect(normalizeUom("bottles")).toBe("bottle");
    expect(normalizeUom("bottle")).toBe("bottle");
    expect(normalizeUom("BOTTLES")).toBe("bottle");
  });

  it("accepts the common X12 unit codes", () => {
    expect(normalizeUom("CS")).toBe("case");
    expect(normalizeUom("BT")).toBe("bottle");
    expect(normalizeUom("EA")).toBe("each");
  });

  it("tolerates spacing and punctuation from extracted documents", () => {
    expect(normalizeUom(" Split Case ")).toBe("split_case");
    expect(normalizeUom("split-case")).toBe("split_case");
  });

  it("returns null rather than guessing on an unknown unit", () => {
    // Guessing 'bottle' here would produce confident, wrong quantity maths.
    expect(normalizeUom("magnum")).toBeNull();
    expect(normalizeUom("")).toBeNull();
    expect(normalizeUom(null)).toBeNull();
  });
});

/**
 * Unit-of-measure normalisation.
 *
 * This exists because of one specific false alarm: the single most common
 * beverage receiving "discrepancy" is not a discrepancy. You order 2 cases, the
 * vendor invoices 24 bottles, the receiver counts 2 cases. Comparing the bare
 * numbers reports an overage of 22 and fires a critical alert on a perfectly
 * clean delivery.
 */
describe("toBottles", () => {
  it("expands cases by pack size", () => {
    expect(toBottles(2, "case", 12)).toBe(24);
  });

  it("makes the classic false alarm compare equal", () => {
    // Ordered 2 cases; invoiced 24 bottles. Same delivery.
    const ordered = toBottles(2, "case", 12);
    const invoiced = toBottles(24, "bottle");
    expect(ordered).toBe(invoiced);
  });

  it("treats packs and split cases as pack-sized too", () => {
    expect(toBottles(3, "pack", 6)).toBe(18);
    expect(toBottles(1, "split_case", 6)).toBe(6);
  });

  it("passes bottles and eaches through untouched", () => {
    expect(toBottles(24, "bottle")).toBe(24);
    expect(toBottles(5, "each")).toBe(5);
  });

  it("defaults a missing pack size to 1 rather than guessing", () => {
    // A case with no known pack size must not silently become 12 bottles —
    // inventing a factor produces confident, wrong cost math.
    expect(toBottles(2, "case")).toBe(2);
  });

  it("refuses to invent a conversion for kegs and litres", () => {
    // A keg is not a number of bottles in any way a receiver would accept.
    expect(toBottles(2, "keg", 12)).toBe(2);
    expect(toBottles(750, "liter", 12)).toBe(750);
  });

  it("clamps nonsense input instead of propagating NaN into cost math", () => {
    expect(toBottles(NaN, "case", 12)).toBe(0);
    expect(toBottles(2, "case", 0)).toBe(2);
  });
});

describe("comparableUnits", () => {
  it("allows bottle-equivalent units to be compared with each other", () => {
    const bottleish: Uom[] = ["bottle", "case", "pack", "split_case", "each"];
    for (const a of bottleish)
      for (const b of bottleish) expect(comparableUnits(a, b)).toBe(true);
  });

  it("only compares kegs to kegs and litres to litres", () => {
    expect(comparableUnits("keg", "keg")).toBe(true);
    expect(comparableUnits("keg", "bottle")).toBe(false);
    expect(comparableUnits("liter", "case")).toBe(false);
  });
});
