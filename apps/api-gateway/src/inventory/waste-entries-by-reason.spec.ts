import { FakeDb } from "../notifications/producers/testing/fake-db";
import { ItemFiguresService } from "./item-figures.service";

/**
 * r110 inventory g3: the Waste card opens what was written off. The totals by
 * reason are summed over every paged row, the list is the 20 newest, staff get
 * no cost, and another house's rows never count.
 */
const H = "house-1";
const OTHER = "house-2";
const I = "item-1";
const NOW = new Date("2026-11-27T12:00:00Z");
const ago = (days: number, mins = 0) => new Date(NOW.getTime() - days * 86_400_000 - mins * 60_000).toISOString();

function seed() {
  const db = new FakeDb();
  db.tables.restaurant_inventory = [{ id: I, restaurant_id: H, kind: "food", display_name: "Flour", uom: "g" }];
  db.tables.inventory_lot_rollup = [{ inventory_id: I, restaurant_id: H, wac: 0.01 }];
  (db.tables as any).users = [
    { user_id: "u-1", name: "Ayşe" },
    { user_id: "u-2", name: "Mert" },
  ];
  db.tables.inventory_transactions = [];
  db.tables.stock_counts = [];
  // Which columns each read asked for, so a staff read can be shown never to ask for a cost.
  const selects: Array<{ table: string; cols: string }> = [];
  const from = db.from.bind(db);
  (db as any).from = (table: string) => {
    const q = from(table);
    const select = q.select.bind(q);
    (q as any).select = (cols?: string, opts?: any) => {
      selects.push({ table, cols: cols ?? "*" });
      return select(cols, opts);
    };
    return q;
  };
  return { db, selects, svc: new ItemFiguresService({ supabase: db } as any) };
}

let n = 0;
const tx = (over: Record<string, unknown>) => ({
  id: `tx-${String(++n).padStart(6, "0")}`,
  inventory_id: I,
  restaurant_id: H,
  stock_type: "live",
  transaction_type: "waste",
  quantity_change: -1,
  unit_cost: 0.02,
  reason: "Spoiled",
  performed_by: "u-1",
  notes: "the walk-in door was left open by Deniz",
  transaction_date: ago(1),
  ...over,
});

describe("the Waste card's write-offs, by reason (r110 inventory g3)", () => {
  it("totals by reason are summed over every row past a 1000-row page edge, and equal qty30d and given30d", async () => {
    const { db, svc } = seed();
    db.maxRows = 1000;
    const rows: ReturnType<typeof tx>[] = [];
    for (let i = 0; i < 1500; i++) rows.push(tx({ reason: "Spoiled", quantity_change: -2, transaction_date: ago(2, i) }));
    for (let i = 0; i < 700; i++) rows.push(tx({ reason: "Breakage", quantity_change: -1, transaction_date: ago(3, i) }));
    for (let i = 0; i < 300; i++) rows.push(tx({ transaction_type: "comp", reason: "Given to staff", quantity_change: -3, transaction_date: ago(4, i) }));
    db.tables.inventory_transactions = rows;
    const { waste } = await svc.figures(H, I, "shown", NOW);
    expect(waste.readable).toBe(true);
    expect(waste.total).toBe(2500);
    expect(waste.qty30d).toBe(3700);
    expect(waste.given30d).toBe(900);
    expect(waste.byReason).toEqual([
      { reason: "Spoiled", type: "waste", qty: 3000 },
      { reason: "Breakage", type: "waste", qty: 700 },
      { reason: "Given to staff", type: "comp", qty: 900 },
    ]);
    const sumOf = (type: string) =>
      waste.byReason!.filter((r) => r.type === type).reduce((s, r) => s + r.qty, 0);
    expect(sumOf("waste")).toBe(waste.qty30d);
    expect(sumOf("comp")).toBe(waste.given30d);
  });

  it("lists the 20 newest, newest first, with who wrote each off and what it was worth to a manager", async () => {
    const { db, svc } = seed();
    const rows: ReturnType<typeof tx>[] = [];
    for (let i = 0; i < 25; i++) rows.push(tx({ quantity_change: -(i + 1), transaction_date: ago(1 + i), performed_by: i === 0 ? "u-2" : "u-1" }));
    rows.push(tx({ reason: null, performed_by: null, unit_cost: null, quantity_change: -400, transaction_date: ago(0, 5) }));
    db.tables.inventory_transactions = rows.reverse();
    const { waste } = await svc.figures(H, I, "shown", NOW);
    expect(waste.entries).toHaveLength(20);
    expect(waste.total).toBe(26);
    expect(waste.entries![0]).toEqual({ at: ago(0, 5), type: "waste", qty: 400, reason: null, by: null, value: 4 });
    expect(waste.entries![1]).toEqual({ at: ago(1), type: "waste", qty: 1, reason: "Spoiled", by: "Mert", value: 0.02 });
    expect(waste.entries!.map((e) => e.at)).toEqual([...waste.entries!.map((e) => e.at)].sort().reverse());
    // The free-text note is never sent.
    expect(JSON.stringify(waste)).not.toContain("walk-in door");
  });

  it("staff get no unit cost read and no value on any entry", async () => {
    const { db, selects, svc } = seed();
    db.tables.inventory_transactions = [tx({}), tx({ transaction_type: "comp", reason: "Given away" })];
    const { waste } = await svc.figures(H, I, "staff", NOW);
    expect(waste.entries).toHaveLength(2);
    for (const e of waste.entries!) expect("value" in e).toBe(false);
    const txReads = selects.filter((s) => s.table === "inventory_transactions");
    expect(txReads.length).toBeGreaterThan(0);
    for (const s of txReads) expect(s.cols).not.toContain("unit_cost");
    for (const s of txReads) expect(s.cols).not.toContain("notes");
    expect(selects.some((s) => s.table === "inventory_lot_rollup")).toBe(false);
  });

  it("another house's rows never count, and another house's good is refused", async () => {
    const { db, svc } = seed();
    db.tables.inventory_transactions = [
      tx({ quantity_change: -5 }),
      tx({ restaurant_id: OTHER, quantity_change: -900, reason: "Theirs" }),
    ];
    const { waste } = await svc.figures(H, I, "shown", NOW);
    expect(waste.qty30d).toBe(5);
    expect(waste.byReason).toEqual([{ reason: "Spoiled", type: "waste", qty: 5 }]);
    expect(waste.entries!.map((e) => e.qty)).toEqual([5]);
    await expect(svc.figures(OTHER, I, "shown", NOW)).rejects.toThrow();
  });

  it("a failed read gives no entries and no totals, never an empty list", async () => {
    const { db, svc } = seed();
    db.failures.inventory_transactions = "timeout";
    const { waste } = await svc.figures(H, I, "shown", NOW);
    expect(waste).toMatchObject({ readable: false, entries: null, byReason: null, total: null });
  });
});
