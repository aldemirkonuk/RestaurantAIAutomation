import { minimumOf } from "./promotions.service";

describe("minimumOf — the offer's stated minimum, read from conditions", () => {
  it("reads the number the extractor writes, with no unit (every stored row today)", () => {
    expect(minimumOf({ min_qty: 12 })).toEqual({ quantity: 12, unit: null });
  });

  it("reads a unit when a writer supplies one", () => {
    expect(minimumOf({ min_qty: "6", min_qty_unit: "case" })).toEqual({ quantity: 6, unit: "case" });
  });

  it("states no minimum when none is stored, or the stored one is not a positive number", () => {
    expect(minimumOf(null)).toBeNull();
    expect(minimumOf({})).toBeNull();
    expect(minimumOf({ min_qty: 0 })).toBeNull();
    expect(minimumOf({ min_qty: -3 })).toBeNull();
    expect(minimumOf({ min_qty: "many" })).toBeNull();
  });

  it("ignores a blank unit rather than reading it as one", () => {
    expect(minimumOf({ min_qty: 12, min_qty_unit: "" })).toEqual({ quantity: 12, unit: null });
  });
});
