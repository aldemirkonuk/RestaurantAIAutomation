/**
 * A check's margin compares like with like (r110 invoices-g5). The revenue a
 * line's cost is set against is what the house took for it: its share of the
 * check's subtotal after discounts and, in a house whose prices include tax,
 * net of a tax the till stated. Never a guessed rate.
 *
 * Its own file, not sale-cost.spec.ts: #2410 adds that file, and two new files
 * at one path would meet as an add/add conflict.
 */
import {
  allocateCents,
  checkMarginFromRows,
  type CheckFacts,
  type ConsumptionCostRow,
  DISCOUNT_NOT_STATED,
  TAX_NOT_KNOWN,
  COST_TAX_BASIS_NOT_STATED,
} from "./sale-cost";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const row = (o: Partial<ConsumptionCostRow> = {}): ConsumptionCostRow => ({
  wine_name: "w",
  quantity: 1,
  volume_ml: 750,
  total_revenue: 100,
  cost_at_sale: 30,
  cost_basis: "invoice_lot_wac",
  cost_tax_basis: "net_of_tax",
  ...o,
});
const facts = (o: Partial<CheckFacts> = {}): CheckFacts => ({
  subtotal: null,
  rungTotal: null,
  statedTax: null,
  taxBasis: null,
  ...o,
});
const cents = (n: number | null) => Math.round((n ?? 0) * 100);

describe("allocateCents — largest remainder", () => {
  it("splits 100 cents over three equal lines as 34/33/33, ties to the earlier line", () => {
    expect(allocateCents([1, 1, 1], 100)).toEqual([34, 33, 33]);
  });

  it("gives the left-over cent to the largest remainder, not the first line", () => {
    // 10 x 1/6 = 1.67 (rem 4), 10 x 5/6 = 8.33 (rem 2): the 1/6 line takes it
    expect(allocateCents([1, 5], 10)).toEqual([2, 8]);
  });

  it("a zero weight divides nothing", () => {
    expect(allocateCents([0, 0], 500)).toEqual([0, 0]);
  });

  it("P1 the shares sum to the target to the cent over random lines", () => {
    const r = rng(110);
    for (let t = 0; t < 500; t++) {
      const n = 1 + Math.floor(r() * 9);
      const w = Array.from({ length: n }, () => Math.floor(r() * 50000));
      const W = w.reduce((a, b) => a + b, 0);
      const target = Math.floor(r() * (W + 1));
      const s = allocateCents(w, target);
      expect(s.reduce((a, b) => a + b, 0)).toBe(W === 0 ? 0 : target);
      // each share is within one cent of its exact proportion
      if (W > 0)
        s.forEach((x, i) =>
          expect(Math.abs(x - (target * w[i]) / W)).toBeLessThan(1),
        );
    }
  });
});

describe("checkMarginFromRows — the check's discount (S/G)", () => {
  it("P2 every line on the check nets to S exactly, over random line sets", () => {
    const r = rng(7);
    for (let t = 0; t < 300; t++) {
      const n = 1 + Math.floor(r() * 6);
      const rows = Array.from({ length: n }, () =>
        row({ total_revenue: Math.round(r() * 20000) / 100, cost_at_sale: 1 }),
      );
      const wine = rows.reduce((a, x) => a + cents(x.total_revenue as number), 0);
      const food = Math.floor(r() * 30000);
      const G = (wine + food) / 100;
      const S = Math.floor(r() * (wine + food + 1)) / 100;
      const m = checkMarginFromRows(rows, facts({ subtotal: S, rungTotal: G }));
      const wineNet = m.lines.reduce((a, l) => a + cents(l.revenue), 0);
      // what the wine lines took plus the rest of the check's share is S
      const restShare = allocateCents(
        [...rows.map((x) => cents(x.total_revenue as number)), food],
        cents(S),
      ).pop() as number;
      expect(wineNet + restShare).toBe(cents(S));
      expect(cents(m.revenue)).toBe(wineNet);
      m.lines.forEach((l) => expect(l.revenue as number).toBeLessThanOrEqual(l.rungRevenue as number));
    }
  });

  it("a 10% discount on a wine-only check takes 10% off each line's revenue", () => {
    const m = checkMarginFromRows(
      [row({ total_revenue: 60 }), row({ total_revenue: 40 })],
      facts({ subtotal: 90, rungTotal: 100 }),
    );
    expect(m.lines.map((l) => l.revenue)).toEqual([54, 36]);
    expect(m.revenue).toBe(90);
    expect(m.margin).toBe(30);
    expect(m.sentence).not.toMatch(/discount/);
  });

  it("food on the check carries its share of the discount, not the wine alone", () => {
    // wine 50 + food 50 rung, subtotal 80: wine takes 40, not 30
    const m = checkMarginFromRows(
      [row({ total_revenue: 50, cost_at_sale: 20 })],
      facts({ subtotal: 80, rungTotal: 100 }),
    );
    expect(m.revenue).toBe(40);
    expect(m.margin).toBe(20);
  });

  it("no subtotal keeps the price rung and says the discount was not stated", () => {
    const m = checkMarginFromRows([row()], facts({ rungTotal: 100 }));
    expect(m.revenue).toBe(100);
    expect(m.sentence).toContain("The check's discount was not stated");
    expect(DISCOUNT_NOT_STATED).toBe("discount not stated");
  });

  it("S above G does no allocation and says so", () => {
    const m = checkMarginFromRows([row()], facts({ subtotal: 120, rungTotal: 100 }));
    expect(m.revenue).toBe(100);
    expect(m.sentence).toContain("The check's subtotal is above the lines");
  });

  it("a comped line stays 0 and a check of voided lines divides nothing", () => {
    const comp = checkMarginFromRows(
      [row({ total_revenue: 0, cost_at_sale: 12 }), row({ total_revenue: 50, cost_at_sale: 10 })],
      facts({ subtotal: 45, rungTotal: 50 }),
    );
    expect(comp.lines.map((l) => l.revenue)).toEqual([0, 45]);
    const voided = checkMarginFromRows(
      [row({ quantity: 0, volume_ml: 0, total_revenue: 0 })],
      facts({ subtotal: 0, rungTotal: 0 }),
    );
    expect(voided.voidedLines).toBe(1);
    expect(voided.lines).toHaveLength(0);
    expect(voided.margin).toBeNull();
  });

  it("without facts an older caller reads the rung price as before", () => {
    const m = checkMarginFromRows([row()]);
    expect(m.revenue).toBe(100);
    expect(m.sentence).toBe("Every line's cost was kept when it sold.");
  });
});

describe("checkMarginFromRows — tax inside the price", () => {
  it("a prices_include_tax check with stated tax gives the exact pre-tax margin", () => {
    // rung 120 (100 + 20% KDV), no discount, till stated 20 tax
    const m = checkMarginFromRows(
      [row({ total_revenue: 120, cost_at_sale: 40 })],
      facts({ subtotal: 120, rungTotal: 120, statedTax: 20, taxBasis: "prices_include_tax" }),
    );
    expect(m.revenue).toBe(100);
    expect(m.margin).toBe(60);
    expect(m.marginPct).toBe(60);
    expect(m.sentence).toContain("The tax the till stated is taken out");
  });

  it("a rate the till printed on the line takes the tax out of that line", () => {
    const m = checkMarginFromRows(
      [row({ total_revenue: 118, cost_at_sale: 50, tax_rate_percent: 18 })],
      facts({ subtotal: 118, rungTotal: 118, taxBasis: "prices_include_tax" }),
    );
    expect(m.revenue).toBe(100);
    expect(m.margin).toBe(50);
  });

  it("no stated tax withholds the line's margin in words, never a guessed rate", () => {
    const m = checkMarginFromRows(
      [row({ total_revenue: 120, cost_at_sale: 40 })],
      facts({ subtotal: 120, rungTotal: 120, taxBasis: "prices_include_tax" }),
    );
    expect(m.lines[0].taxWithheld).toBe(true);
    expect(m.lines[0].costNote).toBe(TAX_NOT_KNOWN);
    expect(m.margin).toBeNull();
    expect(m.revenue).toBe(0);
    expect(m.sentence).toContain("The tax inside the price is not known for 1 line");
    expect(m.sentence).not.toMatch(/Every line/);
  });

  it("a US (prices_exclude_tax) and an unset house are unchanged apart from the discount", () => {
    for (const taxBasis of ["prices_exclude_tax", null] as const) {
      const m = checkMarginFromRows(
        [row({ total_revenue: 120, cost_at_sale: 40 })],
        facts({ subtotal: 120, rungTotal: 120, statedTax: 20, taxBasis }),
      );
      expect(m.revenue).toBe(120);
      expect(m.margin).toBe(80);
      expect(m.lines[0].taxWithheld).toBe(false);
    }
  });

  it("a lot that never said its cost tax basis is named in a house that stated one", () => {
    const m = checkMarginFromRows(
      [row({ cost_tax_basis: null, tax_rate_percent: 20, total_revenue: 120 })],
      facts({ subtotal: 120, rungTotal: 120, taxBasis: "prices_include_tax" }),
    );
    expect(m.lines[0].costNote).toBe(COST_TAX_BASIS_NOT_STATED);
    expect(m.sentence).toContain("The cost tax basis was not stated for 1 line.");
    const unset = checkMarginFromRows([row({ cost_tax_basis: null })], facts());
    expect(unset.sentence).not.toContain("cost tax basis");
  });
});

describe("GET pos-hub/check-margin reads the check's own facts", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PosHubService } = require("./pos-hub.service");
  function svcWith(t: Record<string, { data?: any; error?: any }>) {
    const seen: Record<string, Record<string, unknown>> = {};
    const client = {
      from(table: string) {
        seen[table] = {};
        const q: any = {
          select: () => q,
          eq: (k: string, v: unknown) => ((seen[table][k] = v), q),
          like: () => q,
          in: () => q,
          then: (res: any, rej: any) =>
            Promise.resolve(t[table] ?? { data: [], error: null }).then(res, rej),
        };
        return q;
      },
    };
    return { svc: new PosHubService({ getClient: () => client }), seen };
  }
  const LOG = {
    data: [
      { ...row({ total_revenue: 50, cost_at_sale: 20 }), notes: "pos:square:chk-9:a|1:#0", cost_source_lot_id: "lot-1" },
    ],
    error: null,
  };

  it("uses the subtotal and every line of this house's check", async () => {
    const { svc, seen } = svcWith({
      wine_consumption_log: LOG,
      pos_checks: {
        data: [{ subtotal: 80, voided: false, items: [{ qty: 1, price: 50 }, { qty: 2, price: 25 }, { qty: 1, price: 9, comped: true }] }],
        error: null,
      },
      restaurants: { data: [{ tax_basis: null }], error: null },
    });
    const m = await svc.getCheckMargin("house-a", "chk-9");
    expect(m.revenue).toBe(40);
    expect(m.margin).toBe(20);
    expect(seen.pos_checks).toEqual({ restaurant_id: "house-a", external_check_id: "chk-9" });
    expect(seen.restaurants).toEqual({ id: "house-a" });
  });

  it("a schema without restaurants.tax_basis reads as unset; any other failure throws", async () => {
    const ok = svcWith({
      wine_consumption_log: LOG,
      pos_checks: { data: [], error: null },
      restaurants: { data: null, error: { code: "42703", message: "no column" } },
    });
    const m = await ok.svc.getCheckMargin("house-a", "chk-9");
    expect(m.sentence).toContain("The check's discount was not stated");
    const bad = svcWith({
      wine_consumption_log: LOG,
      pos_checks: { data: null, error: { code: "XX000", message: "down" } },
    });
    await expect(bad.svc.getCheckMargin("house-a", "chk-9")).rejects.toThrow(/check could not be read/);
  });

  it("a Turkish house with no tax stated is withheld, and a lot with no basis is named", async () => {
    const { svc, seen } = svcWith({
      wine_consumption_log: LOG,
      pos_checks: { data: [{ subtotal: 50, voided: false, items: [{ qty: 1, price: 50 }] }], error: null },
      restaurants: { data: [{ tax_basis: "prices_include_tax" }], error: null },
      inventory_lots: { data: [{ id: "lot-1", cost_tax_basis: null }], error: null },
    });
    const m = await svc.getCheckMargin("house-a", "chk-9");
    expect(m.margin).toBeNull();
    expect(m.lines[0].costNote).toBe(`${TAX_NOT_KNOWN}; ${COST_TAX_BASIS_NOT_STATED}`);
    expect(seen.inventory_lots).toEqual({ restaurant_id: "house-a" });
  });
});
