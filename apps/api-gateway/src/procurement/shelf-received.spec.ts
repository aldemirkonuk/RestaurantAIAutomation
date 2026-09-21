/**
 * ADR 0192 — "received" is the stock ledger's count, shown as cases + loose
 * bottles, never rounded, with the door's rejections and anything counted but
 * not booked beside it.
 *
 * Every fixture is a CASE OF 12, because a bottle order (pack 1) makes cases
 * and bottles the same number and a test there cannot fail — the reason the
 * door's 33-bottle defect hid (`memory/verify-receipt-unit-safety.md`).
 *
 * The reader is driven through a fake that APPLIES the filters it is given
 * (`eq`, `in`), so a query that forgot its tenant, its order or its
 * `stock_type` returns rows it should not, and the assertion sees them.
 */
import {
  composeShelfReceived,
  orderPack,
  packsAndLoose,
  readShelfReceived,
  shelfWords,
  type ShelfOrderLine,
  type ShelfOrderRow,
} from "./shelf-received";

type Row = Record<string, any>;

const REST = "rest-1";

function fakeDb(
  tables: Record<string, Row[]>,
  errors: Record<string, { message: string }> = {},
) {
  const reads: Array<{ table: string; filters: string[] }> = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const named: string[] = [];
    let from_ = 0;
    let to_ = Infinity;
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        named.push(`${c}=${String(v)}`);
        filters.push((r) => r[c] === v);
        return q;
      },
      in: (c: string, vs: unknown[]) => {
        named.push(`${c} in ${vs.length}`);
        filters.push((r) => vs.includes(r[c]));
        return q;
      },
      order: () => q,
      range: (a: number, b: number) => {
        from_ = a;
        to_ = b;
        return q;
      },
      then: (resolve: (v: any) => void) => {
        reads.push({ table, filters: named });
        if (errors[table]) return resolve({ data: null, error: errors[table] });
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return resolve({ data: rows.slice(from_, to_ + 1), error: null });
      },
    };
    return q;
  };
  return { db: { from }, reads };
}

const caseOrder = (over: Row = {}): ShelfOrderRow => ({
  id: "ord-1",
  inventory_id: "inv-1",
  unit_type: "case",
  quantity: 5,
  bottles_total: 60,
  ...over,
});
const line = (over: Row = {}): ShelfOrderLine & Row => ({
  id: "line-1",
  restaurant_id: REST,
  order_id: "ord-1",
  unit_type: "case",
  bottles_per_unit: 12,
  ...over,
});
const item = (over: Row = {}): Row => ({
  id: "inv-1",
  restaurant_id: REST,
  uom: "bottle",
  ...over,
});
const tx = (change: number, key: string, over: Row = {}): Row => ({
  id: `tx-${key}`,
  restaurant_id: REST,
  order_id: "ord-1",
  inventory_id: "inv-1",
  stock_type: "live",
  quantity_change: change,
  idempotency_key: key,
  ...over,
});
const door = (counted: number, rejected: number, over: Row = {}): Row => ({
  id: `ev-${counted}-${rejected}`,
  restaurant_id: REST,
  order_id: "ord-1",
  stage: "case_count",
  counted_qty_bottles: counted,
  rejected_qty_bottles: rejected,
  ...over,
});

describe("cases + loose bottles, never rounded", () => {
  it("splits 65 bottles at 12 a case into 5 and 5", () => {
    expect(packsAndLoose(65, 12)).toEqual({ packs: 5, loose: 5 });
    // The door used to print Math.round(65 / 12) = 5 and Math.round(67 / 12) = 6.
    expect(packsAndLoose(67, 12)).toEqual({ packs: 5, loose: 7 });
    expect(packsAndLoose(59, 12)).toEqual({ packs: 4, loose: 11 });
  });

  it("words the split the way a rep says it", () => {
    const w = (quantity: number, packs: number | null, loose: number | null) =>
      shelfWords({ quantity, stockUom: "bottle", packUnit: "case", packs, loose });
    expect(w(65, 5, 5)).toBe("5 cases + 5 bottles");
    expect(w(60, 5, 0)).toBe("5 cases");
    expect(w(13, 1, 1)).toBe("1 case + 1 bottle");
    expect(w(7, 0, 7)).toBe("7 bottles");
    expect(
      shelfWords({ quantity: 65, stockUom: "bottle", packUnit: null, packs: null, loose: null }),
    ).toBe("65 bottles");
  });

  it("takes the pack from the ONE line that states it, else an exact bottles_total / quantity, else none", () => {
    expect(orderPack(caseOrder(), [line()])).toEqual({ unit: "case", size: 12 });
    expect(orderPack(caseOrder(), [])).toEqual({ unit: "case", size: 12 });
    // 65 bottles over 6 cases is not a pack size; it is refused, not rounded to 11.
    expect(orderPack(caseOrder({ quantity: 6, bottles_total: 65 }), [])).toEqual({
      unit: "case",
      size: null,
    });
    // Two lines stating two packs name no single pack for the order.
    expect(
      orderPack(caseOrder({ quantity: 6, bottles_total: 65 }), [
        line(),
        line({ id: "line-2", bottles_per_unit: 6 }),
      ]).size,
    ).toBeNull();
  });
});

describe("composeShelfReceived", () => {
  const compose = (over: Partial<Parameters<typeof composeShelfReceived>[0]> = {}) =>
    composeShelfReceived({
      order: caseOrder(),
      stockUom: "bottle",
      ledger: [],
      doorEvents: [],
      lines: [line()],
      ...over,
    } as any);

  it("sums every live booking for the order's item: one-tap, door and desk", () => {
    const r = compose({
      ledger: [
        tx(60, "order-delivered-live:ord-1"),
        tx(7, "door-receipt:ev-2"),
        tx(-2, "receipt-verify:ord-1:inv-1"),
      ] as any,
    });
    expect(r).toMatchObject({
      readable: true,
      quantityInStockUom: 65,
      packs: 5,
      looseInStockUom: 5,
      words: "5 cases + 5 bottles",
    });
  });

  it("ignores another item's rows on the same order (an unlisted bottle the desk added)", () => {
    const r = compose({
      ledger: [tx(60, "a"), tx(3, "receipt-verify:ord-1:inv-9", { inventory_id: "inv-9" })] as any,
    });
    expect(r.quantityInStockUom).toBe(60);
  });

  it("states the door's rejections beside the count, never subtracted from it", () => {
    const r = compose({
      ledger: [tx(59, "door-receipt:ev-1")] as any,
      doorEvents: [door(60, 1)] as any,
    });
    expect(r.quantityInStockUom).toBe(59);
    expect(r.rejectedAtDoorBottles).toBe(1);
    expect(r.countedNotBookedBottles).toBe(0);
  });

  it("names door-counted bottles the ledger does not hold as counted-not-booked", () => {
    // A door count whose stock movement failed: the event is durable, the
    // ledger is not. The ledger alone would read 0 and look like nothing came.
    const r = compose({ ledger: [] as any, doorEvents: [door(24, 0)] as any });
    expect(r.quantityInStockUom).toBe(0);
    expect(r.countedNotBookedBottles).toBe(24);
  });

  it("does not call a desk correction counted-not-booked", () => {
    // The desk counted two fewer than the door; its correction is the desk's
    // truth, already in the received sum, and nothing is pending.
    const r = compose({
      ledger: [tx(60, "door-receipt:ev-1"), tx(-2, "receipt-verify:ord-1:inv-1")] as any,
      doorEvents: [door(60, 0)] as any,
    });
    expect(r.quantityInStockUom).toBe(58);
    expect(r.countedNotBookedBottles).toBe(0);
  });

  it("shows bottles alone when the pack is unknown", () => {
    const r = compose({
      order: caseOrder({ quantity: 6, bottles_total: 65 }),
      lines: [],
      ledger: [tx(65, "a")] as any,
    });
    expect(r).toMatchObject({ packSize: null, packs: null, words: "65 bottles" });
  });

  it("is unreadable, never zero, on a non-integer or negative ledger", () => {
    expect(compose({ ledger: [tx(1.5 as any, "a")] as any }).readable).toBe(false);
    const negative = compose({ ledger: [tx(-3, "a")] as any });
    expect(negative.readable).toBe(false);
    expect(negative.quantityInStockUom).toBeNull();
  });
});

describe("readShelfReceived — batched, tenant-scoped, loud on failure", () => {
  const tables = () => ({
    inventory_transactions: [
      tx(60, "order-delivered-live:ord-1"),
      tx(5, "door-receipt:ev-2"),
      tx(12, "order-delivered-live:ord-2", { order_id: "ord-2" }),
      // Must not count: shadow stock, another house, a different order.
      tx(60, "order-delivered-shadow:ord-1", { stock_type: "shadow" }),
      tx(99, "x", { restaurant_id: "rest-2" }),
      tx(7, "y", { order_id: "ord-9" }),
    ],
    procurement_receipt_events: [door(5, 1, { id: "ev-2" })],
    restaurant_inventory: [item(), item({ id: "inv-2", uom: "bottle" })],
    procurement_order_items: [line()],
  });

  it("reads four tables once for a page of orders, filtered by the house", async () => {
    const { db, reads } = fakeDb(tables());
    const out = await readShelfReceived(db, REST, [
      caseOrder(),
      caseOrder({ id: "ord-2", unit_type: "bottle", quantity: 12, bottles_total: 12 }),
    ]);
    expect(reads.map((r) => r.table).sort()).toEqual(
      [
        "inventory_transactions",
        "procurement_order_items",
        "procurement_receipt_events",
        "restaurant_inventory",
      ].sort(),
    );
    for (const r of reads) expect(r.filters).toContain(`restaurant_id=${REST}`);
    expect(out.get("ord-1")).toMatchObject({
      quantityInStockUom: 65,
      words: "5 cases + 5 bottles",
      rejectedAtDoorBottles: 1,
    });
    expect(out.get("ord-2")).toMatchObject({ quantityInStockUom: 12, words: "12 bottles" });
  });

  it("marks every order unreadable when the ledger read fails — never a zero", async () => {
    const { db } = fakeDb(tables(), {
      inventory_transactions: { message: "connection reset" },
    });
    const out = await readShelfReceived(db, REST, [caseOrder(), caseOrder({ id: "ord-2" })]);
    for (const id of ["ord-1", "ord-2"]) {
      expect(out.get(id)?.readable).toBe(false);
      expect(out.get(id)?.quantityInStockUom).toBeNull();
      expect(out.get(id)?.why).toContain("connection reset");
    }
  });

  it("an item with no stock unit is unreadable rather than assumed to be bottles", async () => {
    const t = tables();
    t.restaurant_inventory = [];
    const { db } = fakeDb(t);
    const out = await readShelfReceived(db, REST, [caseOrder()]);
    expect(out.get("ord-1")?.readable).toBe(false);
  });
});
