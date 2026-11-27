/**
 * Property tests over the table-side money math (r56 audit): what a till line
 * takes off the shelf, what a pour costs, and what margin a price carries.
 * Seeded, so a failure is the same failure on every run.
 *
 *  P1 A resolved sale volume never exceeds the container it pours from, and a
 *     volume equal to the container is a whole-bottle sale.
 *  P2 An explicit volume outranks the label; a bottle label never reads sizes.
 *  P3 A bottle's worth of pours costs the bottle: glassCostFrom x (bottle/pour)
 *     is the bottle cost, for any positive pour and bottle size.
 *  P4 A glass costs less than the bottle whenever the pour is smaller.
 *  P6 (D2) A line's key does not move when other lines are removed or
 *     reordered; identical lines get distinct keys; a provider line id wins.
 *  P7 (D3) A fractional quantity keeps its fraction: whole + fraction = qty,
 *     and the fraction draws that share of the unit's volume.
 *  P8 (D5) An absent price reads null from every adapter, never 0; a rung
 *     zero stays zero; only an absent price falls back to the menu price.
 *  P9 (D4) A sale's cost is a share of the bottle's cost (a bottle's worth of
 *     pours costs the bottle), unknown stays null and is never 0, the source
 *     is the oldest live costed lot, and a check's margin sums only the cost
 *     each row kept: a row with none is counted, never costed afresh.
 *  P10 (D1) Whatever a check draws off the shelf, its void gives back in ml:
 *     the ml returned equal the ml drawn for any mix of glasses, bottles and
 *     fractions, a void of a pour never moves whole bottles, and a replayed
 *     void returns nothing twice.
 *  P5 The advised price carries the target margin to the cent, and the advice
 *     says raise only when the advised price is above today's.
 */
import {
  PosHubService,
  resolveSaleVolume,
  inventoryVolumesFromRow,
} from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";
import { saleLineKeys, splitQty, fractionMl } from "./sale-line";
import {
  genericAdapter,
  squareAdapter,
  cloverAdapter,
  toastAdapter,
} from "./pos-adapters";
import {
  snapshotLineCost,
  pickSaleCostSource,
  checkMarginFromRows,
} from "./sale-cost";
import { consumptionUnitPrice } from "./pos-hub.service";
import {
  glassCostFrom,
  adviseToTarget,
  toCents,
} from "../pricing/margin-to-target";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const BOTTLES = [187, 375, 500, 700, 750, 1000, 1500, 3000];

describe("resolveSaleVolume (P1, P2)", () => {
  it("never resolves past the container, and a full container is a whole bottle", () => {
    const r = rng(11);
    for (let i = 0; i < 2000; i++) {
      const bottle = BOTTLES[Math.floor(r() * BOTTLES.length)];
      const inv = inventoryVolumesFromRow({
        bottle_size_ml: bottle,
        pour_size_ml: 100 + Math.floor(r() * 100),
        menu_price_current: 50,
      });
      const ml = Math.floor(r() * (bottle * 1.5));
      const out = resolveSaleVolume(ml, "glass", inv);
      if (out.mode === "volume") expect(out.ml).toBeLessThanOrEqual(bottle);
      if (out.mode === "whole_bottle") expect(ml).toBe(bottle);
      if (ml > bottle) expect(out.mode).toBe("unresolved");
    }
  });

  it("an explicit volume outranks the label; a bottle label needs no size", () => {
    const inv = inventoryVolumesFromRow({
      bottle_size_ml: 750,
      pour_size_ml: 150,
      menu_price_current: 60,
    });
    expect(resolveSaleVolume(60, "glass", inv)).toEqual({
      mode: "volume",
      ml: 60,
    });
    expect(resolveSaleVolume(null, "glass", inv)).toEqual({
      mode: "volume",
      ml: 150,
    });
    expect(resolveSaleVolume(null, "bottle", null)).toEqual({
      mode: "whole_bottle",
    });
    expect(resolveSaleVolume(null, "glass", null).mode).toBe("unresolved");
  });
});

describe("glassCostFrom (P3, P4)", () => {
  it("a bottle's worth of pours costs the bottle", () => {
    const r = rng(23);
    for (let i = 0; i < 2000; i++) {
      const cost = Math.round(r() * 50000) / 100 + 1;
      const bottle = BOTTLES[Math.floor(r() * BOTTLES.length)];
      const pour = 30 + Math.floor(r() * (bottle - 30));
      const glass = glassCostFrom(cost, pour, bottle) as number;
      expect(glass * (bottle / pour)).toBeCloseTo(cost, 6);
      if (pour < bottle) expect(glass).toBeLessThan(cost);
    }
  });
  it("a size that is not known has no cost", () => {
    expect(glassCostFrom(40, null, 750)).toBeNull();
    expect(glassCostFrom(40, 150, 0)).toBeNull();
    expect(glassCostFrom(null, 150, 750)).toBeNull();
  });
});

describe("adviseToTarget (P5)", () => {
  it("the advised price carries the target margin to the cent", () => {
    const r = rng(37);
    for (let i = 0; i < 2000; i++) {
      const cost = Math.round((1 + r() * 400) * 100) / 100;
      const targetPct = 20 + Math.floor(r() * 70);
      const price = Math.round((1 + r() * 900) * 100) / 100;
      const a = adviseToTarget({
        kind: "bottle",
        price,
        unitCost: cost,
        targetPct,
        bandPct: 0,
      });
      if (a.state === "raise" || a.state === "lower") {
        const advised = a.advisedPrice as number;
        const margin = ((advised - cost) / advised) * 100;
        // a cent of rounding moves the margin by at most 0.01 / advised
        expect(Math.abs(margin - targetPct)).toBeLessThanOrEqual(
          (0.005 / advised) * 100 + 1e-9,
        );
        expect(a.state === "raise").toBe(advised > price);
        expect(advised).toBe(toCents(cost / (1 - targetPct / 100)));
      }
    }
  });
});

describe("saleLineKeys (P6, D2)", () => {
  const mk = (r: () => number) => {
    const names = ["Rose", "Malbec", "Syrah"];
    const n = 2 + Math.floor(r() * 7);
    return Array.from({ length: n }, () => ({
      name: names[Math.floor(r() * 3)],
      external_item_id: r() < 0.5 ? `sku-${Math.floor(r() * 3)}` : null,
      modifiers: r() < 0.3 ? "ice" : null,
      price: r() < 0.2 ? null : 10 + Math.floor(r() * 3),
    }));
  };

  it("keys are unique within a check, and identical lines are told apart", () => {
    const r = rng(61);
    for (let i = 0; i < 500; i++) {
      const keys = saleLineKeys("toast", "c1", mk(r));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("removing an earlier line leaves the later lines' keys as they were", () => {
    const r = rng(67);
    for (let i = 0; i < 500; i++) {
      const items = mk(r);
      const before = saleLineKeys("toast", "c1", items);
      const drop = Math.floor(r() * items.length);
      const after = saleLineKeys(
        "toast",
        "c1",
        items.filter((_, k) => k !== drop),
      );
      // a re-sent check with a line gone books no key it has not booked before
      for (const key of after) expect(before).toContain(key);
    }
  });

  it("a provider line id is the key, whatever the position", () => {
    const a = saleLineKeys("square", "c1", [
      { name: "x", line_id: "L1" },
      { name: "x", line_id: "L2" },
    ]);
    const b = saleLineKeys("square", "c1", [{ name: "x", line_id: "L2" }]);
    expect(b[0]).toBe(a[1]);
    expect(a[0]).not.toBe(a[1]);
  });

  it("a different price or modifier is a different line", () => {
    const k = saleLineKeys("toast", "c1", [
      { name: "x", price: 10 },
      { name: "x", price: 11 },
      { name: "x", price: 10, modifiers: "ice" },
    ]);
    expect(new Set(k).size).toBe(3);
  });
});

describe("splitQty and fractionMl (P7, D3)", () => {
  it("whole plus fraction is the quantity, to the thousandth", () => {
    const r = rng(71);
    for (let i = 0; i < 3000; i++) {
      const q = Math.round(r() * 20000) / 1000;
      const { whole, frac } = splitQty(q);
      expect(Number.isInteger(whole)).toBe(true);
      expect(frac).toBeGreaterThanOrEqual(0);
      expect(frac).toBeLessThan(1);
      expect(Math.abs(whole + frac - q)).toBeLessThan(1e-9);
    }
    expect(splitQty(0.5)).toEqual({ whole: 0, frac: 0.5 });
    expect(splitQty(2)).toEqual({ whole: 2, frac: 0 });
    expect(splitQty(0.4)).toEqual({ whole: 0, frac: 0.4 });
    expect(splitQty(0)).toEqual({ whole: 0, frac: 0 });
    expect(splitQty(-1)).toEqual({ whole: 0, frac: 0 });
    expect(splitQty(NaN)).toEqual({ whole: 0, frac: 0 });
  });

  it("a fraction draws that share of the unit, never zero, never the whole unit", () => {
    const r = rng(73);
    for (let i = 0; i < 3000; i++) {
      const unit = BOTTLES[Math.floor(r() * BOTTLES.length)];
      const frac = Math.round((0.001 + r() * 0.998) * 1000) / 1000;
      const ml = fractionMl(unit, frac);
      expect(ml).toBeGreaterThanOrEqual(1);
      expect(ml).toBeLessThanOrEqual(unit);
      expect(Math.abs(ml - unit * frac)).toBeLessThanOrEqual(1);
    }
    expect(fractionMl(150, 0.5)).toBe(75);
    expect(fractionMl(150, 0)).toBe(0);
  });
});

describe("absent price (P8, D5)", () => {
  const generic = (it: any) =>
    genericAdapter.normalize({ externalCheckId: "c", items: [it] })[0].items[0];

  it("every adapter reads an absent price as null, not 0", () => {
    expect(generic({ name: "Glass" }).price).toBeNull();
    expect(generic({ name: "Glass", price: null }).price).toBeNull();
    expect(generic({ name: "Glass", price: "" }).price).toBeNull();
    const sq = squareAdapter.normalize({
      id: "o1",
      line_items: [{ name: "Glass", quantity: "1" }],
    })[0].items[0];
    expect(sq.price).toBeNull();
    const cl = cloverAdapter.normalize({
      id: "o1",
      lineItems: { elements: [{ name: "Glass" }] },
    })[0].items[0];
    expect(cl.price).toBeNull();
    const ts = toastAdapter.normalize({
      guid: "g1",
      selections: [{ displayName: "Glass", quantity: 1 }],
    })[0].items[0];
    expect(ts.price).toBeNull();
  });

  it("a rung zero stays zero; a comp flag is read, never inferred", () => {
    expect(generic({ name: "Glass", price: 0 }).price).toBe(0);
    expect(generic({ name: "Glass", price: 0 }).comped).toBeFalsy();
    expect(generic({ name: "Glass", price: 12, comped: true }).comped).toBe(
      true,
    );
    expect(generic({ name: "Glass", price: 12, is_comp: true }).comped).toBe(
      true,
    );
  });

  it("adapters carry the provider's line id and modifiers", () => {
    const sq = squareAdapter.normalize({
      id: "o1",
      line_items: [
        {
          uid: "u-9",
          name: "Glass",
          quantity: "1",
          modifiers: [{ name: "ice" }, { name: "a-lemon" }],
        },
      ],
    })[0].items[0];
    expect(sq.lineId).toBe("u-9");
    expect(sq.modifiers).toBe("a-lemon,ice");
    const cl = cloverAdapter.normalize({
      id: "o1",
      lineItems: { elements: [{ id: "cl-1", name: "Glass", unitQty: 500 }] },
    })[0].items[0];
    expect(cl.lineId).toBe("cl-1");
    expect(cl.qty).toBe(0.5);
    const ts = toastAdapter.normalize({
      guid: "g1",
      selections: [
        { guid: "s-3", displayName: "Glass", quantity: 1, price: 9 },
      ],
    })[0].items[0];
    expect(ts.lineId).toBe("s-3");
  });

  it("only an absent price falls back to the menu price, and only for a bottle", () => {
    expect(consumptionUnitPrice(null, "whole_bottle", 60)).toBe(60);
    expect(consumptionUnitPrice(undefined, "whole_bottle", 60)).toBe(60);
    expect(consumptionUnitPrice(null, "volume", 60)).toBeNull();
    expect(consumptionUnitPrice(0, "whole_bottle", 60)).toBe(0);
    expect(consumptionUnitPrice(12, "whole_bottle", 60, true)).toBe(0);
    expect(consumptionUnitPrice(null, "whole_bottle", 60, true)).toBe(0);
  });
});

describe("cost at sale (P9, D4)", () => {
  const src = (unitCost: number) => ({
    unitCost,
    basis: "invoice_lot_wac" as const,
    lotId: "lot-1",
    orderId: "ord-1",
  });

  it("a bottle's worth of pours costs the bottle, and a whole bottle costs one per unit", () => {
    const r = rng(94);
    for (let i = 0; i < 1000; i++) {
      const bottle = BOTTLES[Math.floor(r() * BOTTLES.length)];
      const cost = Math.round(r() * 20000) / 100;
      const pours = 1 + Math.floor(r() * 10);
      const pourMl = bottle / pours;
      let sum = 0;
      for (let k = 0; k < pours; k++) {
        sum += snapshotLineCost(src(cost), "volume", pourMl, bottle, 1)
          .cost_at_sale as number;
      }
      expect(Math.abs(sum - cost)).toBeLessThanOrEqual(pours * 0.00005 + 1e-9);
      const q = 1 + Math.floor(r() * 5);
      expect(
        snapshotLineCost(src(cost), "whole_bottle", bottle * q, bottle, q)
          .cost_at_sale,
      ).toBeCloseTo(cost * q, 3);
    }
  });

  it("an unknown cost or an unknown bottle size keeps no cost, never 0", () => {
    expect(snapshotLineCost(null, "volume", 150, 750, 1)).toMatchObject({
      cost_at_sale: null,
      cost_basis: null,
    });
    expect(
      snapshotLineCost(src(30), "volume", 150, null, 1).cost_at_sale,
    ).toBeNull();
    expect(snapshotLineCost(src(0), "volume", 150, 750, 1).cost_at_sale).toBe(
      0,
    );
    const k = snapshotLineCost(src(30), "volume", 150, 750, 1);
    expect(k).toMatchObject({
      cost_basis: "invoice_lot_wac",
      cost_source_lot_id: "lot-1",
      cost_source_order_id: "ord-1",
    });
  });

  it("the cost source is the invoiced WAC, else the last price; the lot is the oldest costed live one", () => {
    const lots = [
      {
        id: "new",
        qty: 3,
        unit_cost: 40,
        cost_provenance: "invoice",
        source_order_id: "o2",
        received_at: "2026-09-02",
        stock_state: "live",
      },
      {
        id: "sample",
        qty: 1,
        unit_cost: 0,
        cost_provenance: "sample",
        source_order_id: null,
        received_at: "2026-01-01",
        stock_state: "live",
      },
      {
        id: "old",
        qty: 2,
        unit_cost: 30,
        cost_provenance: "invoice",
        source_order_id: "o1",
        received_at: "2026-08-01",
        stock_state: "live",
      },
      {
        id: "spent",
        qty: 0,
        unit_cost: 10,
        cost_provenance: "invoice",
        source_order_id: "o0",
        received_at: "2026-02-01",
        stock_state: "live",
      },
    ];
    const rollup = { has_invoice_cost: true, wac: 36, wac_qty: 5, live_qty: 5 };
    expect(
      pickSaleCostSource({ last_purchase_price: 99 }, rollup, lots),
    ).toEqual({
      unitCost: 36,
      basis: "invoice_lot_wac",
      lotId: "old",
      orderId: "o1",
      // r109 g1: the shelf the WAC was read over, oldest first; the sample
      // and the spent lot are not on it.
      parts: [
        { order_id: "o1", lot_id: "old", qty: 2, unit_cost: 30, invoiced: true },
        { order_id: "o2", lot_id: "new", qty: 3, unit_cost: 40, invoiced: true },
      ],
      partsCapped: false,
    });
    expect(
      pickSaleCostSource({ last_purchase_price: 99 }, null, lots),
    ).toMatchObject({
      unitCost: 99,
      basis: "last_purchase_price",
      // r102: the lot a pour draws from first is named under this basis too,
      // so the invoice that verifies its delivery can restate the line.
      lotId: "old",
      orderId: "o1",
    });
    expect(
      pickSaleCostSource({ last_purchase_price: 0 }, null, lots),
    ).toBeNull();
    expect(pickSaleCostSource(null, null, null)).toBeNull();
  });

  it("a check's margin sums the kept costs; a row with none is counted and left out", () => {
    const r = rng(95);
    for (let i = 0; i < 300; i++) {
      const rows: any[] = [];
      let rev = 0;
      let cost = 0;
      let missing = 0;
      const n = 1 + Math.floor(r() * 8);
      for (let k = 0; k < n; k++) {
        const revenue = Math.round(r() * 20000) / 100;
        const kept = r() < 0.7;
        const c = Math.round(r() * 8000) / 100;
        rows.push({
          wine_name: `w${k}`,
          quantity: 1,
          volume_ml: 150,
          total_revenue: revenue,
          cost_at_sale: kept ? c : null,
          cost_basis: kept ? "invoice_lot_wac" : null,
        });
        if (kept) {
          rev += revenue;
          cost += c;
        } else missing++;
      }
      const m = checkMarginFromRows(rows);
      expect(m.linesWithoutCost).toBe(missing);
      expect(m.cost).toBeCloseTo(cost, 3);
      expect(m.revenue).toBeCloseTo(rev, 3);
      if (missing < n) expect(m.margin).toBeCloseTo(rev - cost, 3);
      else expect(m.margin).toBeNull();
      if (missing > 0) expect(m.sentence).toMatch(/not kept/);
      expect(
        m.lines.filter((l) => l.costNote === "cost not kept"),
      ).toHaveLength(missing);
    }
  });

  it("a voided row is no line and no cost", () => {
    const m = checkMarginFromRows([
      {
        wine_name: "a",
        quantity: 0,
        volume_ml: 0,
        total_revenue: 0,
        cost_at_sale: 0,
        cost_basis: "invoice_lot_wac",
      },
      {
        wine_name: "b",
        quantity: 1,
        volume_ml: 150,
        total_revenue: 12,
        cost_at_sale: 4,
        cost_basis: "invoice_lot_wac",
      },
    ]);
    expect(m.voidedLines).toBe(1);
    expect(m.lines).toHaveLength(1);
    expect(m.margin).toBe(8);
    expect(m.marginPct).toBe(66.7);
  });
});

describe("a void gives the poured ml back (P10, D1)", () => {
  type Rpc = { fn: string; args: Record<string, any> };
  function makeDb(unit: string) {
    const rpcs: Rpc[] = [];
    const seen = new Set<string>();
    const client: any = {
      from(table: string) {
        const q: any = {
          select: () => q,
          eq: () => q,
          upsert: async () => ({ error: null }),
          update: () => q,
          insert: async () => ({ error: null }),
          then: (res: any, rej: any) =>
            Promise.resolve({ error: null }).then(res, rej),
        };
        if (table === "pos_item_mappings")
          q.in = async () => ({
            data: [
              {
                external_item_id: "w",
                item_name: "House Red",
                is_wine: true,
                inventory_id: "inv-1",
                sale_unit: unit,
              },
            ],
            error: null,
          });
        else if (table === "restaurant_inventory")
          q.in = async () => ({
            data: [
              {
                id: "inv-1",
                bottle_size_ml: 750,
                pour_size_ml: 150,
                menu_price_current: 90,
              },
            ],
            error: null,
          });
        else q.in = () => q;
        if (table === "restaurant_tables")
          q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
        return q;
      },
      rpc: async (fn: string, args: Record<string, any>) => {
        const k = `${fn}:${args.p_idempotency_key}`;
        if (!seen.has(k)) {
          seen.add(k);
          rpcs.push({ fn, args });
        }
        return { data: "tx", error: null };
      },
    };
    return {
      db: { getClient: () => client } as unknown as DatabaseService,
      rpcs,
    };
  }
  const ml = (rpcs: Rpc[], sign: 1 | -1) =>
    rpcs.reduce((sum, r) => {
      if (r.fn === "record_glass_pour" && sign === -1)
        return sum + r.args.p_pours * r.args.p_pour_ml;
      if (r.fn === "return_glass_pour" && sign === 1)
        return sum + r.args.p_pours * r.args.p_pour_ml;
      if (r.fn === "apply_stock_movement")
        return (
          sum + (r.args.p_delta * sign < 0 ? 0 : Math.abs(r.args.p_delta) * 750)
        );
      return sum;
    }, 0);
  const QTYS = [1, 2, 3, 5, 0.25, 0.5, 1.5, 2.75];
  const check = (qty: number, voided: boolean) => ({
    externalCheckId: "chk",
    openedAt: "2026-09-02T18:00:00Z",
    closedAt: "2026-09-02T19:00:00Z",
    voided,
    items: [{ name: "House Red", externalItemId: "w", qty, price: 40 }],
  });

  it("ml returned equal ml drawn, for any quantity and either sale size", async () => {
    const r = rng(77);
    for (let i = 0; i < 60; i++) {
      const unit = r() < 0.5 ? "glass" : "bottle";
      const qty = QTYS[Math.floor(r() * QTYS.length)];
      const sale = makeDb(unit);
      await new PosHubService(sale.db).ingest("r1", "generic_webhook", [
        check(qty, false),
      ]);
      const back = makeDb(unit);
      const svc = new PosHubService(back.db);
      await svc.ingest("r1", "generic_webhook", [check(qty, true)]);
      await svc.ingest("r1", "generic_webhook", [check(qty, true)]);
      const drawn = ml(sale.rpcs, -1);
      const returned = ml(back.rpcs, 1);
      expect({ unit, qty, returned }).toEqual({ unit, qty, returned: drawn });
      // A void of a pour never puts whole bottles back through the unit move
      // unless the sale drew whole bottles the same way.
      if (unit === "glass") {
        expect(
          back.rpcs.filter((x) => x.fn === "apply_stock_movement"),
        ).toHaveLength(0);
      }
    }
  });
});
