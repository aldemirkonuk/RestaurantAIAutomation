import { readFileSync } from "fs";
import { join } from "path";
import {
  LEDGER_UOMS,
  LEDGER_UOM_DIMENSION,
  LedgerUom,
  allocateRemainderSafe,
  convertToBase,
  formatLedgerQty,
  isLedgerUom,
  naiveEqualSplitForComparison,
  normalizeLedgerUom,
  sumByUom,
} from "./ledger-units";

const MIGRATION = join(
  __dirname,
  "../../../../supabase/migrations/20260902120000_ledger_unit_typed_quantities.sql",
);

describe("the ledger unit vocabulary", () => {
  it("is the same list the database CHECK constraints accept", () => {
    // The code half and the SQL half of one pair. If either list grows a fifth
    // unit alone, this fails here rather than as a 23514 in production.
    const sql = readFileSync(MIGRATION, "utf8");

    const checks = sql.match(
      /check \(\(?\w+(?:::text)? = any \(array\[[^\]]*\]\)\)?\)/gi,
    );
    expect(checks).not.toBeNull();
    // canonical_uom, inventory_lots.uom, inventory_transactions.uom.
    expect((checks as string[]).length).toBe(3);

    for (const check of checks as string[]) {
      const literals = Array.from(check.matchAll(/'([a-z_]+)'::text/g)).map(
        (m) => m[1],
      );
      expect(literals.sort()).toEqual([...LEDGER_UOMS].sort());
    }
  });

  it("contains only base units — no pack units and no coarse duplicates", () => {
    // A `case` in the ledger would put pack arithmetic inside it, which is the
    // bug `toBottles` exists to prevent at intake. `g` alongside `mg` is the
    // 25-vs-25000 failure ADR 0070 §10.5 names.
    for (const banned of [
      "case",
      "pack",
      "split_case",
      "keg",
      "g",
      "kg",
      "l",
      "liter",
      "oz",
      "shot",
      "glass",
    ]) {
      expect(LEDGER_UOMS as readonly string[]).not.toContain(banned);
    }
  });

  it("gives every unit exactly one dimension", () => {
    for (const u of LEDGER_UOMS) {
      expect(LEDGER_UOM_DIMENSION[u]).toBeDefined();
    }
    expect(Object.keys(LEDGER_UOM_DIMENSION).sort()).toEqual(
      [...LEDGER_UOMS].sort(),
    );
  });
});

describe("normalizeLedgerUom", () => {
  it("refuses an unrecognised unit rather than guessing", () => {
    // Mirrors document-types.ts#normalizeUom. A wrong unit produces confident,
    // wrong quantity maths; silence is worse than a refusal (ADR 0051).
    for (const raw of ["case", "keg", "pack", "oz", "dram", "", null, undefined, "  "]) {
      expect(normalizeLedgerUom(raw)).toBeNull();
    }
  });

  it("folds spellings onto the base unit of their dimension", () => {
    expect(normalizeLedgerUom("Kilograms")).toBe("mg");
    expect(normalizeLedgerUom(" g ")).toBe("mg");
    expect(normalizeLedgerUom("LITRES")).toBe("ml");
    expect(normalizeLedgerUom("btl")).toBe("bottle");
    expect(normalizeLedgerUom("EA")).toBe("each");
  });
});

describe("convertToBase", () => {
  it("scales an operator's coarse unit into base units exactly", () => {
    // The receiving door's flour delivery, which today cannot be expressed at
    // all: intake's uom CHECK has no mass unit and @IsInt() rejects 4.5.
    expect(convertToBase(4.5, "kg")).toEqual({ qty: 4_500_000, uom: "mg" });
    expect(convertToBase(0.5, "g")).toEqual({ qty: 500, uom: "mg" });
    expect(convertToBase(0.75, "l")).toEqual({ qty: 750, uom: "ml" });
    expect(convertToBase(12, "bottles")).toEqual({ qty: 12, uom: "bottle" });
  });

  it("holds the saffron case that killed the gram base unit", () => {
    // 0.1 g of saffron is a real dose. At a gram base it rounds to 0 and the
    // movement is rejected; at milligrams it is 100 atomic units.
    expect(convertToBase(0.1, "g")).toEqual({ qty: 100, uom: "mg" });
    expect(convertToBase(0.6, "g")).toEqual({ qty: 600, uom: "mg" });
  });

  it("refuses a quantity that is not a whole number of base units", () => {
    // 0.4 mg. Storing 0 destroys the movement; storing 1 creates 150% of it
    // from nothing. Neither is acceptable, so neither happens.
    expect(convertToBase(0.0004, "g")).toBeNull();
    expect(convertToBase(0.5, "mg")).toBeNull();
    expect(convertToBase(1.5, "each")).toBeNull();
  });

  it("refuses an unknown unit and a non-finite quantity", () => {
    expect(convertToBase(1, "case")).toBeNull();
    expect(convertToBase(NaN, "kg")).toBeNull();
    expect(convertToBase(Infinity, "kg")).toBeNull();
  });
});

describe("allocateRemainderSafe", () => {
  it("allocates 1000 three ways as 333 + 333 + 334", () => {
    // The literal shape ADR 0070 names. One third has no finite representation
    // at any scale, so this is not fixable by more decimal places.
    expect(allocateRemainderSafe(1000, [1, 1, 1])).toEqual([333, 333, 334]);
  });

  it("conserves the total where the naive split does not — the whole point", () => {
    // THIS is the test that fails without remainder-safe allocation. It runs
    // both algorithms over the same inputs and asserts that the naive one is
    // observably lossy while this one is not. If `allocateRemainderSafe` were
    // reimplemented as `Math.round(total / n)`, the first expectation below
    // would fail on the very first case.
    const lossy: number[] = [];

    for (let total = 1; total <= 400; total++) {
      for (let n = 2; n <= 7; n++) {
        const safe = allocateRemainderSafe(
          total,
          Array.from({ length: n }, () => 1),
        );
        expect(safe.reduce((a, b) => a + b, 0)).toBe(total);

        const naive = naiveEqualSplitForComparison(total, n);
        if (naive.reduce((a, b) => a + b, 0) !== total) lossy.push(total);
      }
    }

    // Sanity: the naive algorithm really is broken, so the assertion above is
    // testing something. A guard that has never been shown to fire is not
    // evidence — the same rule the CI guards follow.
    expect(lossy.length).toBeGreaterThan(0);
  });

  it("conserves the total under uneven weights, including zeros", () => {
    for (const weights of [
      [1, 2, 3],
      [7, 1, 1, 1],
      [0, 5, 5],
      [0.5, 0.25, 0.25],
      [1, 1, 1, 1, 1, 1, 1],
      [999, 1],
    ]) {
      for (const total of [1, 2, 7, 100, 1000, 123_457]) {
        const out = allocateRemainderSafe(total, weights);
        expect(out.length).toBe(weights.length);
        expect(out.reduce((a, b) => a + b, 0)).toBe(total);
        for (const n of out) expect(Number.isInteger(n)).toBe(true);
        for (const n of out) expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gives a zero weight nothing", () => {
    expect(allocateRemainderSafe(10, [0, 1, 1])).toEqual([0, 5, 5]);
  });

  it("conserves a negative total too (a depletion is a negative movement)", () => {
    const out = allocateRemainderSafe(-1000, [1, 1, 1]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(-1000);
    expect(out).toEqual([-333, -333, -334]);
  });

  it("is deterministic", () => {
    const a = allocateRemainderSafe(1_000_003, [3, 1, 4, 1, 5, 9, 2, 6]);
    const b = allocateRemainderSafe(1_000_003, [3, 1, 4, 1, 5, 9, 2, 6]);
    expect(a).toEqual(b);
  });

  it("refuses nonsense rather than apportioning it", () => {
    expect(() => allocateRemainderSafe(1.5, [1, 1])).toThrow(RangeError);
    expect(() => allocateRemainderSafe(NaN, [1, 1])).toThrow(RangeError);
    expect(() => allocateRemainderSafe(10, [])).toThrow(RangeError);
    expect(() => allocateRemainderSafe(10, [1, -1])).toThrow(RangeError);
    expect(() => allocateRemainderSafe(10, [1, Infinity])).toThrow(RangeError);
  });

  it("keeps the sum exact when every weight is zero", () => {
    const out = allocateRemainderSafe(7, [0, 0, 0]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(7);
  });
});

describe("sumByUom", () => {
  it("never collapses two dimensions into one number", () => {
    // 25 kg of flour plus 25000 mg of saffron is not 25025 of anything. This
    // function has no overload that returns a scalar, deliberately.
    const { totals, unknownCount } = sumByUom([
      { uom: "mg", quantity: 25_000_000 },
      { uom: "mg", quantity: 500 },
      { uom: "bottle", quantity: 3 },
      { uom: "ml", quantity: 750 },
    ]);
    expect(unknownCount).toBe(0);
    expect(totals).toEqual([
      { uom: "bottle", total: 3 },
      { uom: "mg", total: 25_000_500 },
      { uom: "ml", total: 750 },
    ]);
  });

  it("counts unreadable rows instead of dropping them", () => {
    // A total that quietly omits rows is the absence-reported-as-health fault.
    const { totals, unknownCount } = sumByUom([
      { uom: "bottle", quantity: 2 },
      { uom: "case", quantity: 4 },
      { uom: null, quantity: 4 },
      { uom: "bottle", quantity: NaN },
    ]);
    expect(totals).toEqual([{ uom: "bottle", total: 2 }]);
    expect(unknownCount).toBe(3);
  });

  it("returns an empty list rather than a zero for no rows", () => {
    expect(sumByUom([])).toEqual({ totals: [], unknownCount: 0 });
  });
});

describe("formatLedgerQty", () => {
  it("reads a base quantity back without inventing precision", () => {
    expect(formatLedgerQty(12_500_000, "mg")).toBe("12.5 kg");
    expect(formatLedgerQty(600, "mg")).toBe("600 mg");
    expect(formatLedgerQty(2_500, "mg")).toBe("2.5 g");
    expect(formatLedgerQty(750, "ml")).toBe("750 ml");
    expect(formatLedgerQty(1_500, "ml")).toBe("1.5 L");
    expect(formatLedgerQty(3, "bottle")).toBe("3 bottle");
  });

  it("never renders a small quantity as a zero", () => {
    // ADR 0051: an unknown is an em dash, never a zero — and neither is 1 mg
    // allowed to become "0 kg".
    expect(formatLedgerQty(1, "mg")).toBe("1 mg");
    expect(formatLedgerQty(1, "ml")).toBe("1 ml");
    expect(formatLedgerQty(NaN, "mg")).toBe("—");
  });
});

describe("isLedgerUom", () => {
  it("accepts exactly the four base units", () => {
    for (const u of LEDGER_UOMS) expect(isLedgerUom(u)).toBe(true);
    for (const u of ["case", "kg", "", null, undefined, 3, {}]) {
      expect(isLedgerUom(u as unknown as LedgerUom)).toBe(false);
    }
  });
});
