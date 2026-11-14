import { NotFoundException } from "@nestjs/common";
import { FakeDb } from "../notifications/producers/testing/fake-db";
import { costTrendFrom, ItemFiguresService } from "./item-figures.service";

const H = "house-1";
const I = "item-1";
const NOW = new Date("2026-11-07T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function seed() {
  const db = new FakeDb();
  db.tables.restaurant_inventory = [{ id: I, restaurant_id: H, kind: "food", display_name: "Un" }];
  db.tables.inventory_lot_rollup = [{ inventory_id: I, restaurant_id: H, wac: 10 }];
  const tx = (type: string, qty: number, days: number, unit_cost: number | null = null) => ({
    inventory_id: I, restaurant_id: H, stock_type: "live", transaction_type: type,
    quantity_change: qty, transaction_date: ago(days), unit_cost,
  });
  db.tables.inventory_transactions = [
    tx("waste", -1, 2, 12),
    tx("waste", -1, 5),
    tx("comp", -1, 3),
    tx("waste", -4, 40),
    tx("sale", -7, 1),
  ];
  db.tables.stock_counts = [
    { inventory_id: I, restaurant_id: H, counted_at: ago(1), expected_qty: 10, counted_qty: 8, variance_qty: -2, counted_by: "u-1" },
    { inventory_id: I, restaurant_id: H, counted_at: ago(9), expected_qty: 5, counted_qty: 5, variance_qty: 0, counted_by: null },
  ];
  (db.tables as any).users = [{ user_id: "u-1", name: "Ayşe" }];
  db.tables.inventory_lots = [
    { inventory_id: I, restaurant_id: H, received_at: ago(60), unit_cost: 10, cost_provenance: "invoice" },
    { inventory_id: I, restaurant_id: H, received_at: ago(30), unit_cost: 1, cost_provenance: "sample" },
    { inventory_id: I, restaurant_id: H, received_at: ago(10), unit_cost: 12, cost_provenance: "invoice" },
  ];
  const rv = (order: string | null, cost: number, days: number, provenance = "invoice", house = H) => ({
    inventory_id: I, restaurant_id: house, source_order_id: order, new_unit_cost: cost,
    new_cost_provenance: provenance, created_at: ago(days),
  });
  db.tables.inventory_lot_revaluations = [
    rv("o-1", 10, 60),
    rv("o-2", 1, 30, "sample"),
    rv("o-2", 9, 31, "estimated"),
    rv("o-3", 12, 10),
    rv("o-9", 99, 5, "invoice", "house-2"),
  ];
  return { db, svc: new ItemFiguresService({ supabase: db } as any), rv };
}

describe("ItemFiguresService (proposal K1-K10)", () => {
  it("(c) waste and given are counted apart, over 30 days, with a manager's value", async () => {
    const { svc } = seed();
    const { waste, countGap, costTrend } = await svc.figures(H, I, "shown", NOW);
    expect(waste).toMatchObject({ readable: true, qty30d: 2, given30d: 1, value30d: 22 });
    expect(countGap.last![0]).toMatchObject({ expected: 10, counted: 8, variance: -2, by: "Ayşe", money: -20 });
    // Settled deliveries only, in date order: o-1 at 10, o-3 at 12. The sample
    // and estimated prices are not settled, and another house's row is not read.
    expect(costTrend).toMatchObject({
      readable: true,
      points: [
        { receivedAt: ago(60), unitCost: 10 },
        { receivedAt: ago(10), unitCost: 12 },
      ],
      changePct: 20,
    });
    expect(costTrend.source).toMatch(/one delivery's settled price/);
    expect(costTrend.source).toMatch(/booked final at the door/);
  });

  it("(d) a staff caller gets no money figure", async () => {
    const { svc } = seed();
    const { waste, countGap, costTrend } = await svc.figures(H, I, "staff", NOW);
    expect(waste).toMatchObject({ qty30d: 2, given30d: 1, value30d: null });
    expect(countGap.last!.every((c) => c.money === null)).toBe(true);
    expect(costTrend).toEqual({
      readable: true,
      points: null,
      changePct: null,
      source: "Money is shown to owners and managers.",
    });
  });

  it("(e) the cost trend is not built from surviving lots: a moved lot and a used-up delivery change nothing", async () => {
    const { db, svc } = seed();
    // transfer_stock re-inserts a moved lot dated today with the old cost, and
    // the 60-day delivery's lots are gone; its settled row outlives them.
    db.tables.inventory_lots!.push({ inventory_id: I, restaurant_id: H, received_at: ago(0), unit_cost: 10, cost_provenance: "invoice" });
    db.tables.inventory_lots!.splice(0, 1);
    db.failures.inventory_lots = "the cost trend must not read inventory_lots";
    const { costTrend } = await svc.figures(H, I, "shown", NOW);
    expect(costTrend.points!.map((p) => p.unitCost)).toEqual([10, 12]);
    expect(costTrend.changePct).toBe(20);
  });

  it("(e2) a corrected delivery moves its price, not its date; lots settled in one go are one point", async () => {
    const { db, svc, rv } = seed();
    db.tables.inventory_lot_revaluations = [
      rv("o-1", 10, 60),
      rv("o-1", 11, 50, "manual"),
      // Two lots of one door delivery with no order, settled by one call.
      rv(null, 14, 20),
      rv(null, 14, 20),
      rv(null, 15, 8),
    ];
    const { costTrend } = await svc.figures(H, I, "shown", NOW);
    expect(costTrend.points).toEqual([
      { receivedAt: ago(60), unitCost: 11 },
      { receivedAt: ago(20), unitCost: 14 },
      { receivedAt: ago(8), unitCost: 15 },
    ]);
    expect(costTrend.changePct).toBe(36.4);
  });

  it("(e3) nothing settled yet says so; a failed read is unread, never an empty trend", async () => {
    const { db, svc } = seed();
    db.tables.inventory_lot_revaluations = [];
    let { costTrend } = await svc.figures(H, I, "shown", NOW);
    expect(costTrend).toMatchObject({ readable: true, points: [], changePct: null });
    expect(costTrend.source).toMatch(/No delivery of this item has a settled price yet/);
    db.failures.inventory_lot_revaluations = "timeout";
    ({ costTrend } = await svc.figures(H, I, "shown", NOW));
    expect(costTrend).toMatchObject({ readable: false, points: null, changePct: null });
    expect(costTrend.source).toBe("What each delivery cost could not be read (timeout).");
  });

  it("(e4) the trend is the newest deliveries, at most 24, and says when the read was capped", async () => {
    const { db, svc, rv } = seed();
    db.tables.inventory_lot_revaluations = Array.from({ length: 200 }, (_, i) => rv(`o-${i}`, 100 + i, 300 - i));
    const { costTrend } = await svc.figures(H, I, "shown", NOW);
    expect(costTrend.points).toHaveLength(24);
    expect(costTrend.points![23]).toEqual({ receivedAt: ago(101), unitCost: 299 });
    expect(costTrend.points![0]).toEqual({ receivedAt: ago(124), unitCost: 276 });
    expect(costTrend.source).toMatch(/Only the newest 200 settled lots were read/);
  });

  it("costTrendFrom: an estimate, a sample, a missing cost or a free first delivery make no change figure", () => {
    const row = (order: string, cost: unknown, iso: string, provenance = "invoice") => ({
      source_order_id: order, new_unit_cost: cost, new_cost_provenance: provenance, created_at: iso,
    });
    expect(
      costTrendFrom([
        row("a", 5, "2026-01-01T00:00:00Z", "estimated"),
        row("b", 7, "2026-02-01T00:00:00Z", "sample"),
        row("c", null, "2026-03-01T00:00:00Z"),
        row("d", "8.5", "2026-04-01T00:00:00Z"),
      ]),
    ).toEqual({ points: [{ receivedAt: "2026-04-01T00:00:00Z", unitCost: 8.5 }], changePct: null });
    expect(
      costTrendFrom([row("a", 0, "2026-01-01T00:00:00Z", "manual"), row("b", 4, "2026-02-01T00:00:00Z")]).changePct,
    ).toBeNull();
    expect(
      costTrendFrom([row("b", 9, "2026-02-01T00:00:00Z"), row("a", 12, "2026-01-01T00:00:00Z")]),
    ).toEqual({
      points: [
        { receivedAt: "2026-01-01T00:00:00Z", unitCost: 12 },
        { receivedAt: "2026-02-01T00:00:00Z", unitCost: 9 },
      ],
      changePct: -25,
    });
  });

  it("a failed ledger read is null, never 0; no counts says never counted", async () => {
    const { db, svc } = seed();
    db.failures.inventory_transactions = "timeout";
    db.tables.stock_counts = [];
    const { waste, countGap } = await svc.figures(H, I, "shown", NOW);
    expect(waste).toMatchObject({ readable: false, qty30d: null, given30d: null, value30d: null });
    expect(countGap).toMatchObject({ readable: true, last: [], source: "Never counted." });
  });

  it("no value when a wasted line has no cost and no average cost is known", async () => {
    const { db, svc } = seed();
    db.tables.inventory_lot_rollup = [];
    const { waste } = await svc.figures(H, I, "shown", NOW);
    expect(waste.value30d).toBeNull();
    expect(waste.source).toContain("no received lot of this item has a cost yet");
  });
  // Every read is held at a gate; the reads that started before any answered
  // are the ones the drawer waits for together.
  function gated(db: FakeDb) {
    const started: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const from = db.from.bind(db);
    (db as any).from = (table: string) => {
      started.push(table);
      const q: any = from(table);
      const run = q.run.bind(q);
      q.run = async (single: boolean) => {
        await gate;
        return run(single);
      };
      return q;
    };
    const tick = () => new Promise((r) => setImmediate(r));
    return { started, open, tick };
  }

  it("the drawer's reads start together, not one after another", async () => {
    const { db, svc } = seed();
    const { started, open, tick } = gated(db);
    const pending = svc.figures(H, I, "shown", NOW);
    await tick();
    expect([...started].sort()).toEqual(
      ["inventory_lot_revaluations", "inventory_lot_rollup", "inventory_transactions", "restaurant_inventory", "stock_counts"],
    );
    open();
    const { waste, countGap } = await pending;
    expect(waste).toMatchObject({ readable: true, qty30d: 2, given30d: 1, value30d: 22 });
    expect(countGap.last![0]).toMatchObject({ by: "Ayşe", money: -20 });
    expect(started).toContain("users");
  });

  it("a staff caller's drawer does not read the average cost at all", async () => {
    const { db, svc } = seed();
    const { started, open, tick } = gated(db);
    const pending = svc.figures(H, I, "staff", NOW);
    await tick();
    open();
    await pending;
    expect(started).not.toContain("inventory_lot_rollup");
    expect(started).not.toContain("inventory_lot_revaluations");
  });

  it("another house's item is refused, though its other reads ran", async () => {
    const { db, svc } = seed();
    db.tables.restaurant_inventory = [{ id: I, restaurant_id: "house-2", kind: "food", display_name: "Un" }];
    await expect(svc.figures(H, I, "shown", NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("the house refusal wins over another read that broke", async () => {
    const { db, svc } = seed();
    db.tables.restaurant_inventory = [];
    const from = db.from.bind(db);
    (db as any).from = (table: string) => {
      if (table === "inventory_transactions") throw new Error("socket closed");
      return from(table);
    };
    await expect(svc.figures(H, I, "shown", NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a refused house is not left unheard while a slow read is still out", async () => {
    const { db, svc } = seed();
    db.tables.restaurant_inventory = [];
    const unheard: unknown[] = [];
    const listen = (e: unknown) => unheard.push(e);
    process.on("unhandledRejection", listen);
    try {
      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      const from = db.from.bind(db);
      (db as any).from = (table: string) => {
        const q: any = from(table);
        if (table === "stock_counts") {
          const run = q.run.bind(q);
          q.run = async (single: boolean) => {
            await gate;
            return run(single);
          };
        }
        return q;
      };
      const pending = svc.figures(H, I, "shown", NOW);
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      open();
      await expect(pending).rejects.toBeInstanceOf(NotFoundException);
      expect(unheard).toEqual([]);
    } finally {
      process.off("unhandledRejection", listen);
    }
  });

  it("a read that throws is not swallowed", async () => {
    const { db, svc } = seed();
    const from = db.from.bind(db);
    (db as any).from = (table: string) => {
      const q: any = from(table);
      if (table === "stock_counts") q.run = async () => { throw new Error("socket closed"); };
      return q;
    };
    await expect(svc.figures(H, I, "shown", NOW)).rejects.toThrow("socket closed");
  });
});
