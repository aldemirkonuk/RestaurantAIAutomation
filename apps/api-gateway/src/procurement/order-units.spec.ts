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

  it("refuses quantities that are not whole and positive", () => {
    for (const quantity of [0, -3, 1.5, NaN, Infinity]) {
      const r = resolveOrderUnits({ quantity, unitType: "bottle" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("bad_quantity");
    }
  });

  it("only ever emits units the database CHECK constraint accepts", () => {
    // ORDER_UNIT_TYPES is the code half of a pair whose other half is a CHECK in
    // supabase/migrations. If normalizeUom grew an eighth output, this fails
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
    ]) {
      const u = normalizeUom(spelling);
      if (u) emitted.add(u);
    }
    for (const u of emitted) expect(ORDER_UNIT_TYPES).toContain(u as any);
    expect(emitted.size).toBe(ORDER_UNIT_TYPES.length);
  });
});
