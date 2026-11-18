// r56 deep math audit: a scanned line -> per-bottle cost -> booked lot value must
// add back to what the paper charges, for real-looking lines. Seeded, no deps.
import { perBottleLotCost } from "./lot-unit-cost";
import { landDelivery, paidBottles, PaperHeaderRow, PaperLine, PaperLineRow } from "./paper-landed-cost";

let seed = 20261118;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const cents = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
const r2 = (n: number) => Math.round(n * 100) / 100;

function mk(over: Partial<PaperLineRow>): PaperLine {
  const r: PaperLineRow = { document_id: "d", line_no: 1, inventory_id: "a", qty_bottles: 0, free_goods_qty: 0, unit_price: 0, uom: "bottle", pack_size: 1, line_total: null, allowance: null, deposit: null, ...over };
  return { row: r, cost: perBottleLotCost({ unit_price: r.unit_price, uom: r.uom, pack_size: r.pack_size, price_base_qty: null, price_base_uom: null, qty_bottles: paidBottles(r), line_total: r.line_total }) };
}
const head = (o: Partial<PaperHeaderRow> = {}): PaperHeaderRow => ({ id: "d", doc_number: "X", currency: "USD", ...o });
const land = (h: Partial<PaperHeaderRow>, lines: PaperLine[], booked: Record<string, number>) =>
  landDelivery({ papers: [head(h)], lines, booked: new Map(Object.entries(booked)), houseCurrency: "USD" });
const valueOf = (res: ReturnType<typeof land>, booked: Record<string, number>) =>
  Object.entries(booked).reduce((s, [id, n]) => s + (res.byItem.get(id)?.unitCost ?? NaN) * n, 0);

describe("invoice -> lot cost: what is booked adds back to what the paper charges", () => {
  it("cases of N bottles: value booked == line total, to the rounding of one lot", () => {
    for (let i = 0; i < 300; i++) {
      const pack = pick([6, 12, 24, 4, 3]);
      const cases = 1 + Math.floor(rnd() * 40);
      const casePrice = cents(20, 900);
      const total = r2(cases * casePrice);
      const bottles = cases * pack;
      const res = land({}, [mk({ qty_bottles: bottles, uom: "case", pack_size: pack, unit_price: casePrice, line_total: total })], { a: bottles });
      const got = valueOf(res, { a: bottles });
      expect({ i, pack, cases, casePrice, diff: Math.abs(got - total) <= bottles * 5e-7 + 1e-9 }).toEqual({ i, pack, cases, casePrice, diff: true });
    }
  });

  it("freight, fuel and a header discount are shared so the lots add back to total + charges - discount", () => {
    for (let i = 0; i < 300; i++) {
      const n = 2 + Math.floor(rnd() * 4);
      const lines: PaperLine[] = [];
      const booked: Record<string, number> = {};
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const q = 1 + Math.floor(rnd() * 60);
        const p = cents(0.5, 80);
        const t = r2(q * p);
        sum += t;
        booked[`i${k}`] = q;
        lines.push(mk({ line_no: k + 1, inventory_id: `i${k}`, qty_bottles: q, unit_price: p, line_total: t }));
      }
      const freight = rnd() < 0.7 ? cents(1, 60) : null;
      const fuel = rnd() < 0.3 ? cents(0.5, 9) : null;
      const discount = rnd() < 0.5 ? cents(0.5, Math.min(30, sum / 3)) : null;
      const res = land({ freight, fuel_surcharge: fuel, discount_total: discount }, lines, booked);
      const want = sum + (freight ?? 0) + (fuel ?? 0) - (discount ?? 0);
      const got = valueOf(res, booked);
      const tol = Object.values(booked).reduce((s, q) => s + q, 0) * 5e-7 + 0.005;
      expect({ i, ok: Math.abs(got - want) <= tol, got, want }).toEqual({ i, ok: true, got, want });
    }
  });

  it("a partial delivery (door booked fewer on one line) keeps the unit cost, and the missing bottles carry no cost", () => {
    for (let i = 0; i < 200; i++) {
      const q = 6 + Math.floor(rnd() * 60);
      const short = 1 + Math.floor(rnd() * (q - 1));
      const p = cents(1, 70);
      const res = land({}, [mk({ qty_bottles: q, unit_price: p, line_total: r2(q * p) })], { a: q - short });
      expect(res.byItem.get("a")?.unitCost).toBeCloseTo(p, 5);
    }
  });

  it("free goods: 12 listed, 1 free, billed 11: the lot costs what was paid over the bottles that came", () => {
    for (let i = 0; i < 200; i++) {
      const q = 6 + Math.floor(rnd() * 60);
      const free = 1 + Math.floor(rnd() * 3);
      const p = cents(1, 70);
      const total = r2((q - free) * p);
      const res = land({}, [mk({ qty_bottles: q, free_goods_qty: free, unit_price: p, line_total: total })], { a: q });
      const got = valueOf(res, { a: q });
      expect({ i, q, free, p, ok: Math.abs(got - total) <= q * 5e-7 + 1e-9, got, total }).toEqual({ i, q, free, p, ok: true, got, total });
    }
  });
});

describe("weighed lines into a gram item", () => {
  const item = { uom: "g" };
  const w = (o: object) => perBottleLotCost({ unit_price: 0, ...o } as never, item);
  it("kg, g and lb prices of the same goods book the same money", () => {
    for (let i = 0; i < 200; i++) {
      const kg = 0.25 + Math.floor(rnd() * 400) / 4;
      const pk = cents(2, 90);
      const total = r2(kg * pk);
      const a = w({ unit_price: pk, uom: "kg", qty_bottles: kg, line_total: total });
      const b = w({ unit_price: pk / 1000, uom: "g", qty_bottles: kg * 1000, line_total: total });
      if (!a.ok || !b.ok) throw new Error(JSON.stringify({ a, b, kg, pk }));
      expect(a.unitCost * kg * 1000).toBeCloseTo(total, 1);
      expect(Math.abs(a.unitCost - b.unitCost)).toBeLessThanOrEqual(1e-6);
    }
  });
});

describe("allowance, deposit, price base and a free line", () => {
  it("an allowance comes off once, a deposit never enters the cost, a price per 100 is read per bottle", () => {
    for (let i = 0; i < 300; i++) {
      const q = 6 + Math.floor(rnd() * 90);
      const p = cents(1, 40);
      const allowance = rnd() < 0.5 ? cents(0.5, Math.min(20, q * p * 0.2)) : null;
      const deposit = rnd() < 0.4 ? r2(q * 0.05) : null;
      const gross = r2(q * p);
      // the paper prints the gross as the line total, allowance and deposit beside it
      const res = land({}, [mk({ qty_bottles: q, unit_price: p, line_total: gross, allowance, deposit })], { a: q });
      const want = gross - (allowance ?? 0);
      const got = valueOf(res, { a: q });
      expect({ i, q, p, allowance, deposit, ok: Math.abs(got - want) <= q * 5e-7 + 0.005, got, want }).toEqual({ i, q, p, allowance, deposit, ok: true, got, want });
    }
  });

  it("a free line (price 0) beside a paid line of the same item pools: cost per bottle = paid money / all bottles", () => {
    for (let i = 0; i < 100; i++) {
      const q = 6 + Math.floor(rnd() * 50);
      const f = 1 + Math.floor(rnd() * 5);
      const p = cents(2, 50);
      const lines = [
        mk({ line_no: 1, qty_bottles: q, unit_price: p, line_total: r2(q * p) }),
        mk({ line_no: 2, qty_bottles: f, unit_price: 0, line_total: 0 }),
      ];
      const res = land({}, lines, { a: q + f });
      const got = valueOf(res, { a: q + f });
      expect({ i, ok: Math.abs(got - r2(q * p)) <= (q + f) * 5e-7 + 0.005, got, want: r2(q * p) }).toEqual({ i, ok: true, got, want: r2(q * p) });
    }
  });

  it("the door booked MORE than listed: the extra bottles take the same cost", () => {
    const res = land({}, [mk({ qty_bottles: 12, unit_price: 5, line_total: 60 })], { a: 14 });
    expect(res.byItem.get("a")?.unitCost).toBeCloseTo(5, 6);
  });
});

describe("US pounds and ounces into a gram item", () => {
  const item = { uom: "g" };
  it("lb price x grams booked adds back to the line total (what the door books is the rounded gram count)", () => {
    for (let i = 0; i < 200; i++) {
      const lb = 1 + Math.floor(rnd() * 80);
      const p = cents(1, 30);
      const total = r2(lb * p);
      const r = perBottleLotCost({ unit_price: p, uom: "lb", qty_bottles: lb, line_total: total } as never, item);
      if (!r.ok) throw new Error(JSON.stringify(r));
      const grams = Math.round(lb * 453.59237);
      expect({ i, lb, p, ok: Math.abs(r.unitCost * grams - total) <= grams * 5e-7 + 0.02 + total * 0.0005, v: r.unitCost * grams, total }).toEqual({ i, lb, p, ok: true, v: r.unitCost * grams, total });
    }
  });
});
