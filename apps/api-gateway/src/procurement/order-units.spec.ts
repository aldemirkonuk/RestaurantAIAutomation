import {
  ORDER_UNIT_TYPES,
  resolveOrderUnits,
  ResolvedOrderUnits,
} from "./order-units";
import { normalizeUom } from "./documents/document-types";

const ok = (r: ReturnType<typeof resolveOrderUnits>): ResolvedOrderUnits => {
  if (!r.ok)
    throw new Error(`expected a resolution, got ${r.reason}: ${r.message}`);
  return r;
};

describe("resolveOrderUnits", () => {
  it("multiplies a case order by its pack size", () => {
    // The defect this exists for: createOrder set bottles_total = quantity with
    // no reference to unit_type, so five CASES booked five bottles.
    const r = ok(
      resolveOrderUnits({ quantity: 5, unitType: "cases", bottlesPerUnit: 12 }),
    );
    expect(r.bottlesTotal).toBe(60);
    expect(r.bottlesPerUnit).toBe(12);
    expect(r.unitType).toBe("case");
  });

  it("refuses a case order that does not state its pack size", () => {
    // Guessing 12 books twelvefold; guessing 1 books a twelfth. ADR 0011: a
    // wrong number nobody can see is worse than a missing number everybody can.
    const r = resolveOrderUnits({ quantity: 5, unitType: "case" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("pack_size_required");
  });

  it("refuses a unit it cannot read rather than falling through to one that multiplies", () => {
    const r = resolveOrderUnits({ quantity: 24, unitType: "bxs" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("unknown_unit");
      // The message must name the accepted vocabulary — a refusal a caller
      // cannot act on just moves the guessing to them.
      expect(r.message).toContain("split_case");
    }
  });

  it("treats an absent unit as bottles, which is the identity and cannot multiply", () => {
    // Deliberately NOT a refusal: 'nothing was said' and 'something unreadable
    // was said' are different facts, and only the first is safe to fill in.
    for (const unitType of [undefined, null, "", "   "]) {
      const r = ok(resolveOrderUnits({ quantity: 7, unitType }));
      expect(r.unitType).toBe("bottle");
      expect(r.bottlesPerUnit).toBe(1);
      expect(r.bottlesTotal).toBe(7);
    }
  });

  it("never returns a bottle count larger than the quantity without an explicit pack size", () => {
    // The property that actually matters: no input short of an explicit pack
    // size may produce multiplication. Sweeps every spelling normalizeUom knows.
    const spellings = [
      undefined,
      null,
      "",
      "case",
      "cases",
      "CS",
      "ca",
      "pack",
      "packs",
      "pk",
      "split case",
      "split-case",
      "splitcases",
      "bottle",
      "bottles",
      "BTL",
      "bt",
      "each",
      "EA",
      "unit",
      "units",
      "keg",
      "kegs",
      "liter",
      "litres",
      "l",
      "bxs",
      "pallet",
      "🍾",
    ];
    for (const unitType of spellings) {
      const r = resolveOrderUnits({ quantity: 24, unitType });
      if (r.ok) expect(r.bottlesTotal).toBeLessThanOrEqual(24);
    }
  });

  it("leaves kegs and litres unconverted, and says so", () => {
    // Inventing a bottles-per-keg factor produces confident, wrong cost maths.
    const keg = ok(resolveOrderUnits({ quantity: 3, unitType: "keg" }));
    expect(keg.bottlesTotal).toBe(3);
    expect(keg.opaque).toBe(true);

    const bottles = ok(resolveOrderUnits({ quantity: 3, unitType: "bottle" }));
    expect(bottles.opaque).toBe(false);
  });

  it("refuses a pack size that contradicts a non-multiplying unit", () => {
    const r = resolveOrderUnits({
      quantity: 24,
      unitType: "bottle",
      bottlesPerUnit: 12,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("pack_size_conflict");
  });

  it("refuses quantities that are not whole and positive, IN A COUNT UNIT", () => {
    for (const quantity of [0, -3, 1.5, NaN, Infinity]) {
      const r = resolveOrderUnits({ quantity, unitType: "bottle" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("bad_quantity");
    }
  });

  it("only ever emits units the database CHECK constraint accepts", () => {
    // ORDER_UNIT_TYPES is the code half of a pair whose other half is a CHECK in
    // supabase/migrations. If normalizeUom grew an eleventh output, this fails
    // here rather than as a 23514 in production.
    const emitted = new Set<string>();
    for (const spelling of [
      "bottles",
      "cases",
      "kegs",
      "packs",
      "split case",
      "each",
      "liters",
      "ml",
      "grams",
      "kg",
    ]) {
      const u = normalizeUom(spelling);
      if (u) emitted.add(u);
    }
    for (const u of emitted) expect(ORDER_UNIT_TYPES).toContain(u as any);
    expect(emitted.size).toBe(ORDER_UNIT_TYPES.length);
  });

  // ---------------------------------------------------------------------------
  // ADR 0071 — the receiving door accepts mass.
  //
  // Every test below fails against the pre-fix tree, which is the point: the
  // defect was that a fraction was refused before anything looked at what it was
  // a fraction OF.
  // ---------------------------------------------------------------------------

  it("accepts a fractional quantity in a mass unit — the defect this repairs", () => {
    const r = ok(resolveOrderUnits({ quantity: 4.5, unitType: "kg" }));
    expect(r.unitType).toBe("kg");
    expect(r.bottlesTotal).toBe(4.5);
    // 4.5 kg is not 4.5 bottles, and nothing downstream may price it per bottle.
    expect(r.opaque).toBe(true);
  });

  it("accepts the 25 kg sack of flour that had no expressible unit at all", () => {
    const r = ok(resolveOrderUnits({ quantity: 25, unitType: "kg" }));
    expect(r.bottlesTotal).toBe(25);
    expect(r.opaque).toBe(true);
  });

  it("still refuses a fraction of a count unit", () => {
    for (const unitType of ["bottle", "case", "each", "keg"]) {
      const r = resolveOrderUnits({
        quantity: 4.5,
        unitType,
        ...(unitType === "case" ? { bottlesPerUnit: 12 } : {}),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("bad_quantity");
    }
  });

  it("refuses a mass quantity finer than numeric(12,3), rather than letting it round", () => {
    // 0.5 g of saffron stated in kg. numeric(12,3) would store 0.001 — DOUBLE
    // the real quantity, with no error anywhere. The refusal names the fix.
    const r = resolveOrderUnits({ quantity: 0.0005, unitType: "kg" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("bad_quantity");
      expect(r.message).toContain("decimal places");
      expect(r.message).toContain("0.5 g");
    }
  });

  it("accepts that same saffron dose stated in the finer unit", () => {
    const r = ok(resolveOrderUnits({ quantity: 0.5, unitType: "g" }));
    expect(r.bottlesTotal).toBe(0.5);
  });

  it("accepts exactly three decimal places, the column's full precision", () => {
    const r = ok(resolveOrderUnits({ quantity: 12.345, unitType: "kg" }));
    expect(r.bottlesTotal).toBe(12.345);
  });

  it("refuses a pack size on a mass unit — a kilogram does not come in twelves", () => {
    const r = resolveOrderUnits({
      quantity: 4.5,
      unitType: "kg",
      bottlesPerUnit: 12,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("pack_size_conflict");
  });
});
