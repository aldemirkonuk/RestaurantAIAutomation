import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * What an order actually writes down.
 *
 * Three defects, one commit, verified against production on 2026-09-01
 * (2 orders, 1 order line, 0 documents, 0 price_history rows):
 *
 *  1. NOTHING wrote `procurement_order_items`, so `matchDocumentLines` returned
 *     early forever (`document-intake.service.ts:449`) and no order carried a
 *     wine identity an invoice could be matched against.
 *  2. `bottles_total = dto.quantity` ignored `unit_type`, so five CASES booked
 *     five bottles — and because the receiving door back-derives pack size from
 *     `bottles_total / quantity`, it also taught the door that a case holds one.
 *  3. Manual, Ask-AI and recurring orders were byte-identical rows.
 *
 * `price_history` had zero writers anywhere in the repository.
 */

type Row = Record<string, any>;

interface Calls {
  orderInserts: Row[];
  orderUpdates: Row[];
  lineInserts: Row[];
  lineDeletes: number;
  priceHistoryInserts: Row[];
}

/**
 * Supabase stub that records what the service tries to write.
 *
 * Distinguishes a terminal `await` (a list) from `.single()`/`.maybeSingle()`
 * (one row), because the service relies on that difference and a stub that
 * blurred it would let a broken query pass.
 */
function makeDb(opts: {
  providerCount?: number;
  existingOpenOrders?: Row[];
  insertedOrder?: Row;
  orderRow?: Row | null;
  inventory?: Row | null;
}) {
  const calls: Calls = {
    orderInserts: [],
    orderUpdates: [],
    lineInserts: [],
    lineDeletes: 0,
    priceHistoryInserts: [],
  };

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" | "delete" = "select";

      const settle = (shape: "one" | "many") => {
        if (table === "providers")
          return { data: null, count: opts.providerCount ?? 1, error: null };
        if (table === "restaurant_inventory")
          return { data: opts.inventory ?? null, error: null };
        if (table === "procurement_orders") {
          if (op === "insert")
            return { data: opts.insertedOrder ?? null, error: null };
          if (shape === "one")
            return { data: opts.orderRow ?? null, error: null };
          return { data: opts.existingOpenOrders ?? [], error: null };
        }
        return { data: shape === "many" ? [] : null, error: null };
      };

      const q: any = {
        select: () => q,
        eq: () => q,
        neq: () => q,
        not: () => q,
        in: () => q,
        is: () => q,
        gt: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        insert(payload: Row) {
          op = "insert";
          if (table === "procurement_order_items")
            calls.lineInserts.push(payload);
          if (table === "procurement_orders") calls.orderInserts.push(payload);
          if (table === "price_history")
            calls.priceHistoryInserts.push(payload);
          return q;
        },
        update(payload: Row) {
          op = "update";
          if (table === "procurement_orders") calls.orderUpdates.push(payload);
          return q;
        },
        delete() {
          op = "delete";
          if (table === "procurement_order_items") calls.lineDeletes++;
          return q;
        },
        single: async () => settle("one"),
        maybeSingle: async () => settle("one"),
        then: (res: any, rej: any) =>
          Promise.resolve(settle("many")).then(res, rej),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({}) },
  };

  const db = {
    supabase,
    getClient: () => supabase,
    client: supabase,
  } as unknown as DatabaseService;

  return { db, calls };
}

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledger = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;

const MASTER_WINE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SCHEDULE = "33333333-3333-4333-8333-333333333333";

const inventoryRow = {
  master_wine_id: MASTER_WINE,
  wine_name: "Barolo Riserva",
  sku: "INT-9001",
  master_wine_library: {
    name: "Barolo Riserva",
    producer: "Giacomo Conterno",
    vintage: 2016,
  },
};

const insertedOrder = {
  id: "44444444-4444-4444-8444-444444444444",
  order_number: "ORD-2026-00001",
  restaurant_id: "rest-1",
  inventory_id: "inv-1",
  provider_id: "prov-1",
  quantity: 5,
  unit_type: "case",
  bottles_total: 60,
  final_price: 40,
  total_cost: 2400,
  status: "PENDING",
  inventory: { wine_name: "Barolo Riserva" },
};

function service(db: DatabaseService) {
  return new ProcurementService(db, events, ledger);
}

const caseOrder = {
  inventoryId: "inv-1",
  providerId: "prov-1",
  quantity: 5,
  unitType: "cases",
  bottlesPerUnit: 12,
  finalPrice: 40,
} as any;

describe("createOrder — the line table finally gets written", () => {
  it("writes exactly one line row carrying the wine's identity", async () => {
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await service(db).createOrder("rest-1", USER, caseOrder);

    expect(calls.lineInserts).toHaveLength(1);
    const line = calls.lineInserts[0];
    // master_wine_id is the whole point: procurement_orders names an
    // inventory_id, which is this restaurant's shelf slot. Only master_wine_id
    // identifies the WINE, which is what a vendor's invoice has to agree about.
    expect(line.master_wine_id).toBe(MASTER_WINE);
    expect(line.order_id).toBe(insertedOrder.id);
    expect(line.restaurant_id).toBe("rest-1");
    expect(line.wine_name).toBe("Barolo Riserva");
    expect(line.producer).toBe("Giacomo Conterno");
    expect(line.vintage).toBe(2016);
    expect(line.sku).toBe("INT-9001");
  });

  it("never writes total_bottles, which the database generates", async () => {
    // `total_bottles integer GENERATED ALWAYS AS (quantity * bottles_per_unit)
    // STORED` (baseline:4488). Writing it raises 428C9 and takes the order down.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await service(db).createOrder("rest-1", USER, caseOrder);
    expect(calls.lineInserts[0]).not.toHaveProperty("total_bottles");
  });

  it("clears any previous line before writing, so a merged order has one truth", async () => {
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await service(db).createOrder("rest-1", USER, caseOrder);
    expect(calls.lineDeletes).toBe(1);
  });

  it("writes a line even when the wine identity cannot be resolved", async () => {
    // wine_name is NOT NULL. A failed lookup must not strand the order, but it
    // must still leave a line — an order with no line is invisible to the
    // matcher, which is the state this whole change exists to end.
    const { db, calls } = makeDb({ insertedOrder, inventory: null });
    await service(db).createOrder("rest-1", USER, caseOrder);
    expect(calls.lineInserts).toHaveLength(1);
    expect(calls.lineInserts[0].master_wine_id).toBeNull();
    expect(calls.lineInserts[0].wine_name).toContain(insertedOrder.id);
  });
});

describe("createOrder — unit arithmetic", () => {
  it("books five cases of twelve as sixty bottles, not five", async () => {
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await service(db).createOrder("rest-1", USER, caseOrder);

    const header = calls.orderInserts[0];
    expect(header.quantity).toBe(5);
    expect(header.bottles_total).toBe(60);
    // Canonical singular, so the CHECK constraint accepts it and
    // `mobile.service.ts:296`'s `unitType === "case"` can finally be true.
    expect(header.unit_type).toBe("case");

    const line = calls.lineInserts[0];
    expect(line.bottles_per_unit).toBe(12);
    expect(line.quantity).toBe(5);
  });

  it("stops the header from teaching the receiving door that a case holds one bottle", async () => {
    // `resolvePackSize` derives bottles_total / quantity. Pre-fix that was
    // 5/5 = 1, so a door count of 5 cases booked 5 bottles.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await service(db).createOrder("rest-1", USER, caseOrder);
    const h = calls.orderInserts[0];
    expect(Math.round(h.bottles_total / h.quantity)).toBe(12);
  });

  it("prices a case order against bottles, not against cases", async () => {
    // final_price is per BOTTLE — confirmDeal emails "$X per bottle" from the
    // same column — so total_cost = final_price * quantity understated a case
    // order by the pack size.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await service(db).createOrder("rest-1", USER, caseOrder);
    expect(calls.orderInserts[0].total_cost).toBe(40 * 60);
    expect(calls.lineInserts[0].line_total).toBe(40 * 60);
  });

  it("refuses a case order that does not state its pack size, and writes nothing", async () => {
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await expect(
      service(db).createOrder("rest-1", USER, {
        ...caseOrder,
        bottlesPerUnit: undefined,
      }),
    ).rejects.toThrow(/needs bottlesPerUnit/);

    expect(calls.orderInserts).toHaveLength(0);
    expect(calls.lineInserts).toHaveLength(0);
  });

  it("refuses a unit it cannot read rather than falling back to bottles", async () => {
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await expect(
      service(db).createOrder("rest-1", USER, {
        ...caseOrder,
        unitType: "pallets",
        bottlesPerUnit: undefined,
      }),
    ).rejects.toThrow(/not one we can convert to bottles/);
    expect(calls.orderInserts).toHaveLength(0);
  });

  it("leaves a bottles order arithmetically unchanged", async () => {
    // The fix must not move any number for the shape every existing order used.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await service(db).createOrder("rest-1", USER, {
      inventoryId: "inv-1",
      providerId: "prov-1",
      quantity: 6,
      finalPrice: 25,
    } as any);
    const h = calls.orderInserts[0];
    expect(h.bottles_total).toBe(6);
    expect(h.total_cost).toBe(150);
    expect(h.unit_type).toBe("bottle");
  });
});

describe("createOrder — provenance", () => {
  it("records who placed the order and which path placed it", async () => {
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await service(db).createOrder("rest-1", USER, caseOrder, {
      source: "recurring",
      recurringOrderId: SCHEDULE,
    });
    const h = calls.orderInserts[0];
    expect(h.created_by).toBe(USER);
    expect(h.source).toBe("recurring");
    expect(h.recurring_order_id).toBe(SCHEDULE);
  });

  it("distinguishes an Ask-AI order from a manual one", async () => {
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await service(db).createOrder("rest-1", USER, caseOrder, {
      source: "ask_ai",
    });
    expect(calls.orderInserts[0].source).toBe("ask_ai");
  });

  it("leaves source NULL rather than claiming an unlabelled order was manual", async () => {
    // A default of 'manual' would label an unlabelled agent path as a human
    // decision — the exact false claim the column exists to prevent.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await service(db).createOrder("rest-1", USER, caseOrder);
    expect(calls.orderInserts[0].source).toBeNull();
  });

  it("does not try to store a non-uuid actor in a uuid column", async () => {
    // executeRecurringOrder passes the literal string "system" when a schedule
    // has no creator. Writing it would fail the insert with 22P02 and take the
    // whole order down over an attribution field.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await service(db).createOrder("rest-1", "system", caseOrder, {
      source: "recurring",
    });
    expect(calls.orderInserts[0].created_by).toBeNull();
  });
});

describe("price_history finally has a writer", () => {
  const orderRow = {
    id: insertedOrder.id,
    provider_id: "prov-1",
    inventory_id: "inv-1",
    quantity: 5,
    bottles_total: 60,
    final_price: 38,
    negotiated_price: 38,
    quoted_price: 40,
    providers: { contact_email: null, name: "Vendor" },
    restaurant_inventory: { wine_name: "Barolo Riserva" },
  };

  it("records the agreed price when a manager confirms a deal", async () => {
    const { db, calls } = makeDb({ orderRow, inventory: inventoryRow });
    await service(db).confirmDeal("rest-1", insertedOrder.id, {
      finalPrice: 36.5,
      sendConfirmation: false,
    });

    expect(calls.priceHistoryInserts).toHaveLength(1);
    const p = calls.priceHistoryInserts[0];
    expect(p.price).toBe(36.5);
    expect(p.master_wine_id).toBe(MASTER_WINE);
    expect(p.provider_id).toBe("prov-1");
    expect(p.order_id).toBe(insertedOrder.id);
    // The two sources are not interchangeable: 'order_confirmed' is what a
    // vendor AGREED to charge, 'receipt_verified' is what they actually DID.
    expect(p.source).toBe("order_confirmed");
    expect(p.effective_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to the order's standing price when the confirm changes nothing", async () => {
    const { db, calls } = makeDb({ orderRow, inventory: inventoryRow });
    await service(db).confirmDeal("rest-1", insertedOrder.id, {
      sendConfirmation: false,
    });
    expect(calls.priceHistoryInserts[0].price).toBe(38);
  });

  it("writes no observation when there is no price to observe", async () => {
    // A fabricated $0 would drag every average in the series through it.
    //
    // Both halves are asserted in one test on purpose: "no row was written" is
    // trivially true of code that never writes any row at all, and a negative
    // test that passes against the pre-fix tree proves nothing.
    const priced = makeDb({ orderRow, inventory: inventoryRow });
    await service(priced.db).confirmDeal("rest-1", insertedOrder.id, {
      sendConfirmation: false,
    });
    expect(priced.calls.priceHistoryInserts).toHaveLength(1);

    const unpriced = makeDb({
      orderRow: {
        ...orderRow,
        final_price: null,
        negotiated_price: null,
        quoted_price: null,
      },
      inventory: inventoryRow,
    });
    await service(unpriced.db).confirmDeal("rest-1", insertedOrder.id, {
      sendConfirmation: false,
    });
    expect(unpriced.calls.priceHistoryInserts).toHaveLength(0);
  });

  it("does not fail the confirmation when the price row cannot be written", async () => {
    // An order a manager has confirmed is a fact. Failing it because an
    // analytics row would not write is the wrong trade.
    const { db, calls } = makeDb({ orderRow, inventory: inventoryRow });
    const original = (db as any).supabase.from;
    (db as any).supabase.from = (table: string) => {
      const q = original(table);
      if (table === "price_history") {
        const failing = q.insert;
        q.insert = (payload: Row) => {
          failing(payload);
          return {
            then: (res: any) =>
              Promise.resolve({
                data: null,
                error: { message: "permission denied" },
              }).then(res),
          };
        };
      }
      return q;
    };
    await expect(
      service(db).confirmDeal("rest-1", insertedOrder.id, {
        sendConfirmation: false,
      }),
    ).resolves.toMatchObject({ confirmed: true });
    // The write must have been ATTEMPTED — otherwise this passes against code
    // that has no price writer at all, which is the state it exists to rule out.
    expect(calls.priceHistoryInserts).toHaveLength(1);
  });
});
