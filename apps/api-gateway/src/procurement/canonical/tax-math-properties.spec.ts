// r57 VAT/KDV audit over the tax stack: for real-looking papers whose true basis
// and rates are known, what the paper's own figures let us READ may be "not
// proven" but is never WRONG, and what a house books follows its answers.
// Seeded, no deps. Every paper is SYNTHETIC.
import { perBottleLotCost } from "./lot-unit-cost";
import { landDelivery, paidBottles, PaperHeaderRow, PaperLine, PaperLineRow } from "./paper-landed-cost";
import { paperTaxFacts, PaperTaxLine } from "./paper-tax-facts";
import { HouseTax } from "../landed-cost";

let seed = 20261119;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const cents = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
const r2 = (n: number) => Math.round(n * 100) / 100;
// Say the whole case when a property fails, not "expected true".
const holds = (ok: boolean, ctx: unknown) => expect(ok ? "ok" : JSON.stringify(ctx)).toBe("ok");

const RATES = [0, 1, 8, 10, 18, 20, 7.25, 8.875];

interface Truth {
  basis: "includes_tax" | "excludes_tax";
  rates: number[];
  net: number[]; // per line, before tax
  gross: number[]; // per line, tax inside
  qty: number[];
  printed: number[]; // the line totals as the paper prints them
  tax: number;
  total: number;
  breakdown: { rate: number; taxableBase: number; amount: number }[];
}

function paper(): Truth {
  const n = 1 + Math.floor(rnd() * 6);
  const multi = n > 1 && rnd() < 0.4;
  const first = pick(RATES);
  const second = pick(RATES.filter((r) => r !== first));
  const basis = rnd() < 0.5 ? "includes_tax" : "excludes_tax";
  const rates: number[] = [];
  const net: number[] = [];
  const gross: number[] = [];
  const qty: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = multi && i % 2 === 1 ? second : first;
    const q = 1 + Math.floor(rnd() * 40);
    const t = r2(q * cents(0.5, 90));
    rates.push(r);
    qty.push(q);
    if (basis === "excludes_tax") {
      net.push(t);
      gross.push(r2(t * (1 + r / 100)));
    } else {
      gross.push(t);
      net.push(r2(t / (1 + r / 100)));
    }
  }
  const printed = basis === "excludes_tax" ? net : gross;
  const breakdown = [...new Set(rates)].map((rate) => {
    const idx = rates.map((x, i) => (x === rate ? i : -1)).filter((i) => i >= 0);
    const g = idx.reduce((s, i) => s + gross[i], 0);
    const nn = idx.reduce((s, i) => s + net[i], 0);
    const taxableBase = r2(nn);
    return { rate, taxableBase, amount: r2(g - nn) };
  });
  const tax = r2(breakdown.reduce((s, b) => s + b.amount, 0));
  const sumPrinted = printed.reduce((s, v) => s + v, 0);
  const total = r2(basis === "excludes_tax" ? sumPrinted + tax : sumPrinted);
  return { basis, rates, net, gross, qty, printed, tax, total, breakdown };
}

const factLines = (t: Truth, withRates: boolean): PaperTaxLine[] =>
  t.printed.map((p, i) => ({
    kind: "value",
    printedTotal: p,
    printedRatePercent: withRates ? t.rates[i] : null,
    input: {
      line_no: i + 1,
      allowance: null,
      deposit: null,
      price_tax_basis: null,
      vat_rate_percent: null,
      item_key: `i${i}`,
      qty: t.qty[i],
      uom: "bottle",
      pack_size: 1,
      price_base_qty: 1,
      unit_price: r2(p / t.qty[i]),
      line_total: p,
      listed_bottles: t.qty[i],
      stocked: true,
    },
  }));

const figures = (t: Truth, withBreakdown: boolean) => ({
  tax: t.tax,
  total: t.total,
  tax_breakdown: withBreakdown ? t.breakdown : null,
});

describe("paperTaxFacts never reads a basis or a rate the paper does not prove", () => {
  it("every reading is the truth or nothing (1,500 papers, single and multi rate, with and without bases and line rates)", () => {
    let read = 0;
    let basisRead = 0;
    let lineRatesRead = 0;
    for (let i = 0; i < 1500; i++) {
      const t = paper();
      const withBreakdown = rnd() < 0.7;
      const withRates = rnd() < 0.5;
      const f = paperTaxFacts(figures(t, withBreakdown), factLines(t, withRates));
      const ctx = { i, truth: t, withBreakdown, withRates, f };
      if (f.basis != null) {
        basisRead++;
        holds(f.basis === t.basis, ctx);
      }
      const distinct = new Set(t.rates);
      if (f.ratePercent != null) {
        read++;
        holds(distinct.size === 1 && f.ratePercent === t.rates[0], ctx);
      }
      if (f.lineRates != null) {
        lineRatesRead++;
        holds(JSON.stringify(f.lineRates) === JSON.stringify(t.rates), ctx);
      }
    }
    // The property is not vacuous: a good share of papers are read.
    expect(basisRead).toBeGreaterThan(300);
    expect(read + lineRatesRead).toBeGreaterThan(300);
  });
});

describe("what a house books follows its tax answers", () => {
  const mk = (t: Truth, i: number, basis: "includes_tax" | "excludes_tax" | null, rate: number | null): PaperLine => {
    const r: PaperLineRow = {
      document_id: "d",
      line_no: i + 1,
      inventory_id: `i${i}`,
      qty_bottles: t.qty[i],
      free_goods_qty: 0,
      unit_price: r2(t.printed[i] / t.qty[i]),
      uom: "bottle",
      pack_size: 1,
      line_total: t.printed[i],
      allowance: null,
      deposit: null,
    };
    void basis;
    void rate;
    return {
      row: r,
      cost: perBottleLotCost({
        unit_price: r.unit_price,
        uom: r.uom,
        pack_size: 1,
        price_base_qty: null,
        price_base_uom: null,
        qty_bottles: paidBottles(r),
        line_total: r.line_total,
      }),
    };
  };

  it("a reclaiming house books the net, any other charging house the gross, an unread paper as printed with no stamp", () => {
    let stamped = 0;
    for (let i = 0; i < 800; i++) {
      const t = paper();
      const lines = t.printed.map((_, k) => mk(t, k, null, null));
      const booked = Object.fromEntries(t.qty.map((q, k) => [`i${k}`, q]));
      const header: PaperHeaderRow = {
        id: "d",
        doc_number: "X",
        currency: "USD",
        tax: t.tax,
        total: t.total,
        tax_breakdown: t.breakdown,
        extracted_lines: t.rates.map((r, k) => ({ lineNo: k + 1, lineKind: "goods", vatRatePercent: r })),
      };
      for (const reclaims of [true, false]) {
        const houseTax: HouseTax = {
          tax_basis: t.basis === "includes_tax" ? "prices_include_tax" : "prices_exclude_tax",
          reclaims_input_tax: reclaims,
        };
        const res = landDelivery({
          papers: [header],
          lines,
          booked: new Map(Object.entries(booked)),
          houseCurrency: "USD",
          houseTax,
        });
        // A lot whose per-bottle cost cannot add back to the cent is HELD with a
        // sentence, never costed wrong; every booked item is costed or held.
        const costed = Object.keys(booked).filter((id) => res.byItem.has(id));
        const silent = Object.keys(booked).filter(
          (id) => !res.byItem.has(id) && !res.held.has(id) && !res.refused.has(id) && !res.foreign.has(id),
        );
        holds(silent.length === 0, { i, silent });
        const idx = costed.map((id) => Number(id.slice(1)));
        const value = costed.reduce((s, id) => s + (res.byItem.get(id)?.unitCost ?? NaN) * booked[id], 0);
        const net = idx.reduce((s, k) => s + t.net[k], 0);
        const gross = idx.reduce((s, k) => s + t.gross[k], 0);
        const printed = idx.reduce((s, k) => s + t.printed[k], 0);
        const stamps = costed.map((id) => res.byItem.get(id)).filter((p): p is NonNullable<typeof p> => !!p).map((p) => p.costTaxBasis);
        const tol = 0.05 + costed.length * 0.01;
        const ctx = { i, reclaims, truth: t, value, net, gross, stamps, held: [...res.held.entries()], refused: [...res.refused.entries()] };
        if (stamps.every((s) => s === "net")) {
          stamped++;
          holds(reclaims && Math.abs(value - net) <= tol, ctx);
        } else if (stamps.every((s) => s === "gross_cost")) {
          stamped++;
          holds(!reclaims && Math.abs(value - gross) <= tol, ctx);
        } else {
          // Not proven for every line: costed as printed, never stamped.
          holds(stamps.every((s) => s === null) && Math.abs(value - printed) <= tol, ctx);
        }
      }
    }
    expect(stamped).toBeGreaterThan(300);
  });
});
