import { NotFoundException } from "@nestjs/common";
import { FakeDb } from "../notifications/producers/testing/fake-db";
import { ItemFiguresService } from "./item-figures.service";

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
  return { db, svc: new ItemFiguresService({ supabase: db } as any) };
}

describe("ItemFiguresService (proposal K1-K10)", () => {
  it("(c) waste and given are counted apart, over 30 days, with a manager's value", async () => {
    const { svc } = seed();
    const { waste, countGap, costTrend } = await svc.figures(H, I, "shown", NOW);
    expect(waste).toMatchObject({ readable: true, qty30d: 2, given30d: 1, value30d: 22 });
    expect(countGap.last![0]).toMatchObject({ expected: 10, counted: 8, variance: -2, by: "Ayşe", money: -20 });
    expect(costTrend).toMatchObject({ readable: true, points: null, changePct: null });
  });

  it("(d) a staff caller gets no money figure", async () => {
    const { svc } = seed();
    const { waste, countGap, costTrend } = await svc.figures(H, I, "staff", NOW);
    expect(waste).toMatchObject({ qty30d: 2, given30d: 1, value30d: null });
    expect(countGap.last!.every((c) => c.money === null)).toBe(true);
    expect(costTrend).toMatchObject({ readable: true, points: null, changePct: null });
  });

  it("(e) the cost trend is not built from surviving lots: a moved lot and a used-up delivery change nothing", async () => {
    const { db, svc } = seed();
    // transfer_stock re-inserts a moved lot dated today with the old cost; the
    // 60-day delivery above stands for one that has since sold out and gone.
    db.tables.inventory_lots!.push({ inventory_id: I, restaurant_id: H, received_at: ago(0), unit_cost: 10, cost_provenance: "invoice" });
    db.tables.inventory_lots!.splice(0, 1);
    db.failures.inventory_lots = "the cost trend must not read inventory_lots";
    const { costTrend } = await svc.figures(H, I, "shown", NOW);
    expect(costTrend).toMatchObject({ readable: true, points: null, changePct: null });
    expect(costTrend.source).toMatch(/not shown yet/);
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
      ["inventory_lot_rollup", "inventory_transactions", "restaurant_inventory", "stock_counts"],
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
