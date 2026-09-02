import {
  bottleOpaque,
  comparableUnits,
  fitsIntakePrecision,
  normalizeUom,
  toBaseUnits,
  toBottles,
  UOM_BASE_SCALE,
  UOM_DIMENSION,
  UOMS,
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

// =============================================================================
// ADR 0071 — the intake vocabulary admits mass, and the boundary cannot round.
// =============================================================================

describe("the unit vocabulary after ADR 0071", () => {
  const ORIGINAL_SEVEN: Uom[] = [
    "bottle",
    "case",
    "keg",
    "pack",
    "split_case",
    "each",
    "liter",
  ];

  it("has a mass unit at all, which is the whole defect", () => {
    // Before this change the vocabulary was {bottle, case, keg, pack,
    // split_case, each, liter}. A 25 kg sack of flour had NO expressible unit,
    // so a receiver could not record the delivery under any spelling.
    expect(UOMS).toContain("kg");
    expect(UOMS).toContain("g");
    expect(normalizeUom("kilograms")).toBe("kg");
    expect(normalizeUom("25kg".replace("25", ""))).toBe("kg");
  });

  it("gives every unit exactly one dimension", () => {
    // A partial map is how a gram gets weighed against a bottle.
    for (const u of UOMS) expect(UOM_DIMENSION[u]).toBeDefined();
    expect(Object.keys(UOM_DIMENSION).sort()).toEqual([...UOMS].sort());
  });

  it("gives every non-count unit a base scale, and no count unit one", () => {
    for (const u of UOMS) {
      if (UOM_DIMENSION[u] === "count") expect(UOM_BASE_SCALE[u]).toBeUndefined();
      else expect(UOM_BASE_SCALE[u]).toBeGreaterThan(0);
    }
  });

  it("does not change comparability for any pair of the original seven", () => {
    // The pre-fix rule, transcribed: opaque = keg | liter; if either is opaque
    // the units compare only when identical, otherwise they compare.
    const preFix = (a: Uom, b: Uom) => {
      const opaque = (u: Uom) => u === "keg" || u === "liter";
      if (opaque(a) || opaque(b)) return a === b;
      return true;
    };
    for (const a of ORIGINAL_SEVEN) {
      for (const b of ORIGINAL_SEVEN) {
        expect([a, b, comparableUnits(a, b)]).toEqual([a, b, preFix(a, b)]);
      }
    }
  });

  it("compares two units of the same dimension, which kegs and litres never could", () => {
    expect(comparableUnits("g", "kg")).toBe(true);
    expect(comparableUnits("ml", "liter")).toBe(true);
    expect(comparableUnits("g", "ml")).toBe(false);
    expect(comparableUnits("kg", "bottle")).toBe(false);
  });

  it("treats a mass as bottle-opaque, so nothing prices flour per bottle", () => {
    expect(bottleOpaque("kg")).toBe(true);
    expect(bottleOpaque("g")).toBe(true);
    expect(bottleOpaque("ml")).toBe(true);
    expect(bottleOpaque("keg")).toBe(true);
    expect(bottleOpaque("bottle")).toBe(false);
    expect(bottleOpaque("case")).toBe(false);
    // toBottles passes it through rather than inventing a conversion factor.
    expect(toBottles(4.5, "kg", 12)).toBe(4.5);
  });
});

describe("toBaseUnits — the intake -> ledger boundary", () => {
  it("converts every legal intake quantity to an EXACT integer", () => {
    // This is the claim the ADR rests on: intake carries at most 3 decimal
    // places and every non-base scale is >= 1000, so the product is always
    // whole. Swept rather than sampled, because "we checked a few" is how a
    // rounding bug survives.
    for (const uom of UOMS) {
      if (UOM_DIMENSION[uom] === "count") continue;
      for (const qty of [0.001, 0.5, 1, 4.5, 12.345, 25, 999.999]) {
        const r = toBaseUnits(qty, uom);
        expect([uom, qty, r.ok]).toEqual([uom, qty, true]);
        if (r.ok) {
          expect(Number.isInteger(r.value)).toBe(true);
          // And it is the RIGHT integer, not merely an integer.
          expect(r.value).toBe(Math.round(qty * (UOM_BASE_SCALE[uom] as number)));
        }
      }
    }
  });

  it("puts 4.5 kg of flour in the ledger as 4500000 mg, losing nothing", () => {
    const r = toBaseUnits(4.5, "kg");
    expect(r).toEqual({ ok: true, value: 4_500_000, baseUom: "mg" });
  });

  it("survives the float cases a naive multiply gets wrong", () => {
    // 0.029 * 1000 is 28.999999999999996 in IEEE 754. A guard written as
    // `Number.isInteger(qty * scale)` would refuse this legal quantity.
    expect(fitsIntakePrecision(0.029)).toBe(true);
    const r = toBaseUnits(0.029, "g");
    expect(r).toEqual({ ok: true, value: 29, baseUom: "mg" });
  });

  it("refuses a sub-precision quantity rather than rounding it", () => {
    // 0.0005 kg is 0.5 g. numeric(12,3) stores 0.001 — twice the real amount.
    expect(fitsIntakePrecision(0.0005)).toBe(false);
    const r = toBaseUnits(0.0005, "kg");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("finer unit");
  });

  it("refuses a count unit, which has neither mass nor volume", () => {
    for (const uom of UOMS) {
      if (UOM_DIMENSION[uom] !== "count") continue;
      const r = toBaseUnits(3, uom);
      expect([uom, r.ok]).toEqual([uom, false]);
    }
  });

  it("refuses a non-number rather than producing NaN", () => {
    expect(toBaseUnits(NaN, "kg").ok).toBe(false);
    expect(toBaseUnits(Infinity, "g").ok).toBe(false);
  });
});
