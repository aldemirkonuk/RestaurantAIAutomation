import { convertMoney, filedAtSentence, rateProblem, apportionCents } from "./fx-convert";
import { planRefile, type DocumentMoney, type LineMoney } from "./invoice-currency";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const c = (n: number) => Math.round(n * 100);

function paper(rand: () => number) {
  const n = 1 + Math.floor(rand() * 12);
  const lines: LineMoney[] = Array.from({ length: n }, (_, i) => ({
    line_no: i + 1,
    unit_price: Math.round(rand() * 5000) / 100,
    line_total: Math.round(rand() * 200000) / 100,
    allowance: null,
    deposit: null,
  }));
  const charge = () => (rand() < 0.5 ? null : Math.round(rand() * 8000) / 100);
  const discount = rand() < 0.4 ? Math.round(rand() * 3000) / 100 : null;
  const h = {
    freight: charge(), fuel_surcharge: charge(), split_case_fee: charge(),
    delivery_fee: charge(), deposit_total: charge(), tax: charge(), other_charges: charge(),
  };
  const sumC =
    lines.reduce((a, l) => a + c(l.line_total!), 0) +
    Object.values(h).reduce((a, v) => a + (v == null ? 0 : c(v)), 0) -
    (discount == null ? 0 : c(discount));
  const header: DocumentMoney = {
    subtotal: lines.reduce((a, l) => a + c(l.line_total!), 0) / 100,
    ...h,
    discount_total: discount,
    total: sumC / 100,
    computed_lines_total: null, tie_out_delta: null, ties_out: null,
  };
  return { header, lines };
}

describe("convertMoney — a converted paper still ties to its converted total", () => {
  it("random rates and line sets: converted lines + charges - discount == converted total, to the cent", () => {
    const rand = rng(20261120);
    for (let k = 0; k < 2000; k++) {
      const { header, lines } = paper(rand);
      const rate = Math.round((0.05 + rand() * 40) * 1e4) / 1e4;
      const r = convertMoney(header, lines, rate);
      expect(r.forcedToTie).toBe(true);
      const h = r.header;
      expect(h.discount_total == null || h.discount_total >= 0).toBe(true);
      const expectedTotal = Math.round(header.total! * rate * 100);
      expect(h.total).toBe(expectedTotal / 100);
      const check =
        r.lines.reduce((a, l) => a + c(l.line_total!), 0) +
        [h.freight, h.fuel_surcharge, h.split_case_fee, h.delivery_fee, h.deposit_total, h.tax, h.other_charges]
          .reduce<number>((a, v) => a + (v == null ? 0 : c(v)), 0) -
        (h.discount_total == null ? 0 : c(h.discount_total));
      expect(check).toBe(expectedTotal);
    }
  });

  it("does not force a paper that does not tie out", () => {
    const { header, lines } = paper(rng(3));
    header.total = header.total! + 5;
    const r = convertMoney(header, lines, 1.1);
    expect(r.forcedToTie).toBe(false);
  });

  it("dropping the rate is refused, never treated as 1", () => {
    const { header, lines } = paper(rng(4));
    expect(() => convertMoney(header, lines, undefined as unknown as number)).toThrow(/BAD_RATE/);
    expect(() => convertMoney(header, lines, 0)).toThrow(/BAD_RATE/);
    expect(rateProblem(-2)).not.toBeNull();
    expect(rateProblem(1.084)).toBeNull();
  });

  it("a rate of 2 actually doubles the figures (a dropped rate would not)", () => {
    const { header, lines } = paper(rng(5));
    const r = convertMoney(header, lines, 2);
    expect(r.header.total).toBe(Math.round(header.total! * 200) / 100);
  });
});

describe("apportionCents / filedAtSentence", () => {
  it("shares the missing cents by largest remainder", () => {
    expect(apportionCents([33.4, 33.3, 33.3], 100)).toEqual([34, 33, 33]);
  });
  it("says what was filed at", () => {
    expect(filedAtSentence("EUR", "USD", 1.084, "2026-11-20")).toBe("filed at 1 EUR = 1.0840 USD on 20 Nov");
  });
});

describe("planRefile with a rate", () => {
  const row = { subtotal: 100.1, freight: 10, total: 110.1, tax: null };
  const lines = [
    { line_no: 1, qty: 1, uom: "bottle", pack_size: 1, unit_price: 33.37, line_total: 33.37, allowance: null, deposit: null },
    { line_no: 2, qty: 2, uom: "bottle", pack_size: 1, unit_price: 33.365, line_total: 66.73, allowance: null, deposit: null },
  ];
  it("files the converted figures and they still tie out", () => {
    const plan = planRefile({ row, lines, extracted: null, fx: { rate: 1.084 } })!;
    expect(plan.document.total).toBe(119.35);
    expect(plan.document.ties_out).toBe(true);
    expect(plan.lines[0].unit_price).toBe(36.17308);
  });
});
