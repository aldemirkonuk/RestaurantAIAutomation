import { readFileSync } from "fs";
import { join } from "path";
import { BaseUnit, MICRO, planRecipeDraw, route, settle, unsettle } from "./recipe-draw";

/**
 * Inventory r28 gap 1, slice 3a. The gateway plans a recipe draw and the
 * database books it, so route, settle and unsettle must agree across the two
 * languages. One case table serves both: the migration's SQL test asserts the
 * SQL functions against it, and this spec asserts recipe-draw.ts against the
 * same rows. A row changed on one side only fails here or there.
 */

const SQL_TEST = join(
  __dirname,
  "../../../../supabase/tests/20271020100000_a_recipe_draw_keeps_its_remainder_test.sql",
);
const sql = readFileSync(SQL_TEST, "utf8");

function block(name: string): string[][] {
  const begin = sql.indexOf(`-- parity:${name}:begin`);
  const end = sql.indexOf(`-- parity:${name}:end`);
  if (begin < 0 || end < begin) throw new Error(`no parity:${name} block in ${SQL_TEST}`);
  return sql
    .slice(begin, end)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("("))
    .map((l) => {
      const inner = l.replace(/^\(/, "").replace(/\)[,;]?$/, "");
      return inner.split(",").map((c) => c.trim());
    });
}

const text = (c: string): string | null => (c === "null" ? null : c.replace(/^'|'$/g, ""));
const int = (c: string): number | null => (c === "null" ? null : Number(c));

describe("route matches recipe_draw_route row for row", () => {
  const rows = block("route");
  it("reads every route case from the SQL test", () => {
    expect(rows.length).toBe(23);
  });
  it.each(rows.map((r) => [r[0], r] as const))("%s", (_id, r) => {
    const [, base, uom, bottle, via, bpu, wait] = r;
    const got = route(text(base) as BaseUnit, { uom: text(uom), bottleSizeMl: int(bottle) });
    if (text(wait) !== null) {
      expect(got).toEqual({ wait: text(wait) });
    } else {
      expect(got).toEqual({ via: text(via), basePerUnit: BigInt(bpu) });
    }
  });
});

describe("settle matches recipe_draw_settle row for row", () => {
  const rows = block("settle");
  it("reads every settle case from the SQL test", () => {
    expect(rows.length).toBe(10);
  });
  it.each(rows.map((r) => [r[0], r] as const))("%s", (_id, r) => {
    const [, exact, bpu, carryIn, units, carryOut] = r;
    expect(settle(BigInt(exact), BigInt(bpu), BigInt(carryIn))).toEqual({
      units: Number(units),
      carryOut: BigInt(carryOut),
    });
  });
});

describe("unsettle matches recipe_draw_unsettle row for row", () => {
  const rows = block("unsettle");
  it("reads every unsettle case from the SQL test", () => {
    expect(rows.length).toBe(9);
  });
  it.each(rows.map((r) => [r[0], r] as const))("%s", (_id, r) => {
    const [, exact, bpu, carryIn, units, carryOut] = r;
    expect(unsettle(BigInt(exact), BigInt(bpu), BigInt(carryIn))).toEqual({
      units: Number(units),
      carryOut: BigInt(carryOut),
    });
  });
});

describe("unsettle (W7)", () => {
  const U = 1000n; // a gram, in mg
  it("gives back exactly what settle booked when nothing came between", () => {
    for (const carry of [0n, 1n, 499_999_999n, 999_999_999n]) {
      for (const exact of [0n, 1n, 7_500_000_000n, 400_000_000n, 12_345_678_901n]) {
        const sale = settle(exact, U, carry);
        expect(unsettle(exact, U, sale.carryOut)).toEqual({ units: sale.units, carryOut: carry });
      }
    }
  });

  it("keeps booked plus carried equal to the standing draws when a void comes late (seeded)", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 200; run++) {
      const sales: Array<{ exact: bigint; units: number; voided: boolean }> = [];
      let carry = 0n;
      let booked = 0n;
      for (let step = 0; step < 40; step++) {
        const open = sales.filter((s) => !s.voided);
        if (open.length > 0 && rand() < 0.3) {
          const s = open[Math.floor(rand() * open.length)];
          const back = unsettle(s.exact, U, carry);
          // Within one unit of what the sale booked.
          expect(Math.abs(back.units - s.units)).toBeLessThanOrEqual(1);
          booked -= BigInt(back.units);
          carry = back.carryOut;
          s.voided = true;
        } else {
          const exact = BigInt(Math.floor(rand() * 20_000_000_000));
          const r = settle(exact, U, carry);
          booked += BigInt(r.units);
          carry = r.carryOut;
          sales.push({ exact, units: r.units, voided: false });
        }
        expect(carry >= 0n && carry < U * MICRO).toBe(true);
        const standing = sales.filter((s) => !s.voided).reduce((t, s) => t + s.exact, 0n);
        expect(booked * U * MICRO + carry).toBe(standing);
        expect(booked >= 0n).toBe(true);
      }
    }
  });

  it("refuses a negative draw, carry or unit", () => {
    expect(() => unsettle(-1n, U, 0n)).toThrow(RangeError);
    expect(() => unsettle(1n, U, -1n)).toThrow(RangeError);
    expect(() => unsettle(1n, 0n, 0n)).toThrow(RangeError);
  });
});

describe("a planned draw names the measure its carry is kept in", () => {
  it("gives each draw its line's base unit, which the carry is keyed by", () => {
    const plan = planRecipeDraw(
      {
        id: "v-1",
        yieldServes: 1,
        lines: [
          { position: 1, role: "stocked", inventoryId: "gin", label: "gin", qtyBase: 450, baseUnit: "ml10" },
          { position: 2, role: "stocked", inventoryId: "salt", label: "salt", qtyBase: 7_500, baseUnit: "mg" },
          { position: 3, role: "stocked", inventoryId: "lemon", label: "lemon", qtyBase: 500, baseUnit: "each_milli" },
        ],
      },
      1,
      new Map([
        ["gin", { uom: "bottle", bottleSizeMl: 700 }],
        ["salt", { uom: "g", bottleSizeMl: null }],
        ["lemon", { uom: "each", bottleSizeMl: null }],
      ]),
    );
    if (plan.kind !== "draw") throw new Error("expected a draw");
    expect(plan.draws.map((d) => [d.inventoryId, d.via, d.baseUnit])).toEqual([
      ["gin", "pour", "ml10"],
      ["salt", "book", "mg"],
      ["lemon", "book", "each_milli"],
    ]);
  });
});
