import { ForbiddenException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import {
  parseDeliveredQuantity,
  readDeliveredQuantity,
} from "./procurement.controller";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * The receiving WRITE path — what verifyReceipt and markDelivered actually put
 * in the database.
 *
 * Three defects, verified against production on 2026-09-01 (56 columns on
 * `procurement_orders`; `notes` and `location_id` are not among them):
 *
 *  D1  verifyReceipt wrote `notes`, a column that does not exist. Because the
 *      key was `body.note ?? undefined` it was dropped from the JSON body
 *      whenever no note was typed — so the update failed ONLY when a manager
 *      documented a discrepancy, after the ledger correction and the credit
 *      claim had already been written. Every subsequent column (status,
 *      match_status, accepted_quantity, invoice_*) never landed, and the retry
 *      failed identically.
 *  D2  `adjustments[]` was declared @IsArray @IsOptional @Type() with no
 *      @ValidateNested, so the nested DTO was never validated at all, and
 *      `inventoryId` went straight into apply_stock_movement — which derives
 *      restaurant_id from the target row. A foreign UUID wrote stock into
 *      another tenant.
 *  D3  markDelivered booked `order.quantity` into the ledger while writing
 *      `quantity_received: null`. The door's anti-double-book guard reads that
 *      column (`receiving.service.ts:194`), so NULL read as 0 and the door
 *      booked the whole delivery a second time.
 *
 * Before this file there was no test of verifyReceipt anywhere in the repo;
 * `invoice-match.spec.ts` covers only the pure computeMatch function.
 */

type Row = Record<string, any>;

/**
 * The real column set of `procurement_orders`, read from production
 * information_schema on 2026-09-01 and identical to what
 * `supabase/migrations/` replays (baseline 53 + created_by, source,
 * recurring_order_id from 20260901150000).
 *
 * Duplicated here deliberately: a test that derived the list from the same
 * migrations the code is wrong about could only ever prove the two agree.
 * `scripts/check_orders_column_writes.py` is the arm that derives it and so
 * catches drift; this list catches the write.
 */
const PROCUREMENT_ORDER_COLUMNS = new Set([
  "accepted_quantity",
  "ai_autonomy_paused",
  "approved_at",
  "approved_by",
  "backorder_quantity",
  "bottles_total",
  "completed_at",
  "confirmed_at",
  "created_at",
  "created_by",
  "cron_schedule",
  "delivered_at",
  "delivery_notes",
  "discrepancy_notes",
  "expected_delivery_date",
  "final_confirmed_cost",
  "final_price",
  "id",
  "inventory_id",
  "invoice_image_url",
  "invoice_quantity",
  "invoice_unit_price",
  "is_emergency",
  "is_offline_sync",
  "is_recurring",
  "last_negotiation_at",
  "manager_notes",
  "match_status",
  "match_verified_at",
  "match_verified_by",
  "negotiated_price",
  "negotiation_attempts",
  "order_number",
  "price_override_reason",
  "price_verified",
  "priority_level",
  "provider_id",
  "quantity",
  "quantity_received",
  "quoted_price",
  "received_by",
  "recurring_order_id",
  "rejected_quantity",
  "rejected_reason",
  "rejection_reason",
  "requested_at",
  "restaurant_id",
  "shipped_at",
  "source",
  "state_machine_state",
  "status",
  "total_cost",
  "total_estimated_cost",
  "tracking_number",
  "unit_type",
  "updated_at",
]);

const REST = "rest-1";
const ORDER = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";
const OWN_INVENTORY = "11111111-1111-4111-8111-111111111111";
const FOREIGN_INVENTORY = "99999999-9999-4999-8999-999999999999";

interface Calls {
  orderUpdates: Row[];
  rpc: { name: string; args: Row }[];
  creditInserts: Row[];
  inventoryUpdates: Row[];
  eventInserts: Row[];
  priceHistoryInserts: Row[];
}

/**
 * Supabase stub that records what the service tries to write.
 *
 * `ownedInventoryIds` is the tenancy fixture: `restaurant_inventory` answers a
 * row only for ids this restaurant owns, which is exactly what the real
 * `.eq("restaurant_id", …).eq("id", …)` does.
 */
function makeDb(opts: {
  orderRow?: Row | null;
  /**
   * The order LINE. `procurement_orders` carries unit_type but NOT
   * bottles_per_unit — only `procurement_order_items` does — so this is where a
   * pack size comes from when one is stated. Absent exercises the
   * bottles_total/quantity fallback instead.
   */
  orderLineRow?: Row | null;
  ownedInventoryIds?: string[];
  updatedRow?: Row;
  updateError?: { code: string; message: string } | null;
}) {
  const calls: Calls = {
    orderUpdates: [],
    rpc: [],
    creditInserts: [],
    inventoryUpdates: [],
    eventInserts: [],
    priceHistoryInserts: [],
  };
  const owned = new Set(opts.ownedInventoryIds ?? [OWN_INVENTORY]);

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" | "delete" = "select";
      let selectedColumns = "";
      const filters: Record<string, any> = {};

      const settle = (shape: "one" | "many"): Row => {
        if (table === "procurement_orders") {
          if (op === "update") {
            if (opts.updateError)
              return { data: null, error: opts.updateError };
            return {
              data: {
                ...(opts.orderRow ?? {}),
                ...(opts.updatedRow ?? {}),
                ...calls.orderUpdates[calls.orderUpdates.length - 1],
                inventory: { wine_name: "Barolo Riserva" },
              },
              error: null,
            };
          }
          return { data: opts.orderRow ?? null, error: null };
        }

        if (table === "procurement_order_items")
          return { data: opts.orderLineRow ?? null, error: null };

        if (table === "restaurant_inventory") {
          // The ownership probe: select("id") filtered by restaurant_id + id.
          if (selectedColumns.trim() === "id")
            return {
              data: owned.has(filters.id) ? { id: filters.id } : null,
              error: null,
            };
          return {
            data: {
              master_wine_id: "55555555-5555-4555-8555-555555555555",
              shadow_stock: 0,
              in_transit_quantity: 0,
            },
            error: null,
          };
        }

        // inventory_events: no prior event, so markDelivered proceeds to book.
        return { data: shape === "many" ? [] : null, error: null };
      };

      const q: any = {
        select(cols?: string) {
          if (op === "select" && typeof cols === "string")
            selectedColumns = cols;
          return q;
        },
        eq(col: string, value: any) {
          filters[col] = value;
          return q;
        },
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
          if (table === "procurement_credits")
            calls.creditInserts.push(payload);
          if (table === "inventory_events") calls.eventInserts.push(payload);
          if (table === "price_history") calls.priceHistoryInserts.push(payload);
          return q;
        },
        update(payload: Row) {
          op = "update";
          if (table === "procurement_orders") calls.orderUpdates.push(payload);
          if (table === "restaurant_inventory")
            calls.inventoryUpdates.push(payload);
          return q;
        },
        delete: () => {
          op = "delete";
          return q;
        },
        single: async () => settle("one"),
        maybeSingle: async () => settle("one"),
        then: (res: any, rej: any) =>
          Promise.resolve(settle("many")).then(res, rej),
      };
      return q;
    },
    rpc: async (name: string, args: Row) => {
      calls.rpc.push({ name, args });
      return { data: null, error: null };
    },
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

function service(db: DatabaseService) {
  return new ProcurementService(db, events, ledger);
}

const deliveredOrder = {
  id: ORDER,
  order_number: "ORD-2026-00001",
  restaurant_id: REST,
  inventory_id: OWN_INVENTORY,
  provider_id: "prov-1",
  quantity: 10,
  bottles_total: 10,
  unit_type: "bottle",
  final_price: 40,
  quantity_received: 10,
  status: "DELIVERED",
  delivery_notes: null,
};

// ---------------------------------------------------------------------------
// D1
// ---------------------------------------------------------------------------
describe("verifyReceipt — writes only columns that exist", () => {
  it("never sends a key that is not a real procurement_orders column", async () => {
    // This is the assertion that fails against the pre-fix tree: the payload
    // carried `notes`, which PostgREST answers with PGRST204 ("column
    // procurement_orders.notes does not exist").
    const { db, calls } = makeDb({ orderRow: deliveredOrder });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      note: "Two bottles arrived cracked.",
      invoiceQuantity: 10,
      invoiceUnitPrice: 40,
      acceptedQuantity: 8,
      rejectedQuantity: 2,
    } as any);

    expect(calls.orderUpdates).toHaveLength(1);
    const unknown = Object.keys(calls.orderUpdates[0]).filter(
      (k) => !PROCUREMENT_ORDER_COLUMNS.has(k),
    );
    expect(unknown).toEqual([]);
  });

  it("puts the manager's note in delivery_notes", async () => {
    const { db, calls } = makeDb({ orderRow: deliveredOrder });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      note: "Two bottles arrived cracked.",
      invoiceQuantity: 10,
      invoiceUnitPrice: 40,
      acceptedQuantity: 8,
      rejectedQuantity: 2,
    } as any);

    expect(calls.orderUpdates[0].delivery_notes).toBe(
      "Two bottles arrived cracked.",
    );
    expect(calls.orderUpdates[0]).not.toHaveProperty("notes");
  });

  it("appends to an existing delivery note rather than erasing it", async () => {
    // A note left at the door and a note left at verification are two
    // observations of the same delivery. Clobbering loses the first silently.
    const { db, calls } = makeDb({
      orderRow: { ...deliveredOrder, delivery_notes: "Driver left at 06:40." },
    });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      note: "Two bottles arrived cracked.",
      invoiceQuantity: 10,
      invoiceUnitPrice: 40,
      acceptedQuantity: 8,
      rejectedQuantity: 2,
    } as any);

    expect(calls.orderUpdates[0].delivery_notes).toBe(
      "Driver left at 06:40.\nTwo bottles arrived cracked.",
    );
  });

  it("omits delivery_notes entirely when no note was typed", async () => {
    // The absent case is the one that used to pass, and it has to keep passing:
    // `?? undefined` dropped the key, which is why this defect only ever fired
    // on discrepancy runs.
    const { db, calls } = makeDb({ orderRow: deliveredOrder });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 10,
      invoiceUnitPrice: 40,
      acceptedQuantity: 10,
    } as any);

    expect(calls.orderUpdates[0]).not.toHaveProperty("delivery_notes");
  });
});

// ---------------------------------------------------------------------------
// D2
// ---------------------------------------------------------------------------
describe("verifyReceipt — adjustments cannot reach another tenant", () => {
  it("refuses an adjustment naming another restaurant's inventory, and issues no RPC", async () => {
    const { db, calls } = makeDb({
      orderRow: deliveredOrder,
      ownedInventoryIds: [OWN_INVENTORY], // FOREIGN_INVENTORY belongs elsewhere
    });

    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, {
        adjustments: [
          { inventoryId: FOREIGN_INVENTORY, delta: 500, reason: "extras" },
        ],
      } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // The point is not that it threw; it is that nothing moved. A check that
    // runs after the RPC would still have written the stock.
    const movements = calls.rpc.filter(
      (c) => c.name === "apply_stock_movement",
    );
    expect(movements).toEqual([]);
  });

  it("names the problem in the refusal instead of failing silently", async () => {
    const { db } = makeDb({
      orderRow: deliveredOrder,
      ownedInventoryIds: [OWN_INVENTORY],
    });

    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, {
        adjustments: [{ inventoryId: FOREIGN_INVENTORY, delta: 1 }],
      } as any),
    ).rejects.toThrow(/does not belong to this restaurant/i);
  });

  it("still applies an adjustment on the restaurant's own inventory", async () => {
    // The guard must not close the door on the legitimate path.
    const { db, calls } = makeDb({
      orderRow: { ...deliveredOrder, inventory_id: "other-own-id" },
      ownedInventoryIds: [OWN_INVENTORY, "other-own-id"],
    });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      adjustments: [
        { inventoryId: OWN_INVENTORY, delta: 3, reason: "unlisted extras" },
      ],
    } as any);

    const movements = calls.rpc.filter(
      (c) => c.name === "apply_stock_movement",
    );
    expect(movements).toHaveLength(1);
    expect(movements[0].args.p_inventory_id).toBe(OWN_INVENTORY);
    expect(movements[0].args.p_delta).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// D3
// ---------------------------------------------------------------------------
describe("markDelivered — the column records what was booked", () => {
  const pendingOrder = {
    id: ORDER,
    order_number: "ORD-2026-00002",
    restaurant_id: REST,
    inventory_id: OWN_INVENTORY,
    provider_id: "prov-1",
    quantity: 12,
    bottles_total: 12,
    unit_type: "bottle",
    final_price: 40,
    status: "APPROVED",
  };

  it("writes quantity_received equal to what it booked when the caller sends no quantity", async () => {
    // The web client sends none (useOrdersData.ts:68). Pre-fix, the ledger got
    // order.quantity and the column got NULL, so the door's `alreadyBooked`
    // read 0 and booked all 12 again.
    const { db, calls } = makeDb({ orderRow: pendingOrder });

    await service(db).markDelivered(REST, ORDER, USER);

    const live = calls.rpc.find(
      (c) =>
        c.name === "apply_stock_movement" && c.args.p_stock_state === "live",
    );
    expect(live).toBeDefined();
    expect(live!.args.p_delta).toBe(12);

    expect(calls.orderUpdates).toHaveLength(1);
    expect(calls.orderUpdates[0].quantity_received).toBe(12);
    expect(calls.orderUpdates[0].quantity_received).toBe(live!.args.p_delta);
  });

  it("records an explicit short count as the short count, not the ordered count", async () => {
    const { db, calls } = makeDb({ orderRow: pendingOrder });

    await service(db).markDelivered(REST, ORDER, USER, 9);

    const live = calls.rpc.find(
      (c) =>
        c.name === "apply_stock_movement" && c.args.p_stock_state === "live",
    );
    expect(live!.args.p_delta).toBe(9);
    expect(calls.orderUpdates[0].quantity_received).toBe(9);
  });

  it("never leaves quantity_received NULL after booking stock", async () => {
    const { db, calls } = makeDb({ orderRow: pendingOrder });
    await service(db).markDelivered(REST, ORDER, USER);
    expect(calls.orderUpdates[0].quantity_received).not.toBeNull();
  });
});

describe("markDelivered — ?quantityReceived is validated, not coerced", () => {
  it("rejects a non-numeric value with a 400 that says what is wrong", () => {
    // Pre-fix: Number("abc") is NaN, `NaN ?? x` does NOT fall through, the
    // `> 0` test failed, and the order was marked DELIVERED with no stock
    // booked — answered 200 OK.
    expect(() => parseDeliveredQuantity("abc")).toThrow(/must be a number/i);
    try {
      parseDeliveredQuantity("abc");
    } catch (e: any) {
      expect(e.getStatus()).toBe(400);
    }
  });

  it("rejects a negative value", () => {
    expect(() => parseDeliveredQuantity("-4")).toThrow(/cannot be negative/i);
  });

  it("rejects a fractional value", () => {
    expect(() => parseDeliveredQuantity("2.5")).toThrow(/whole number/i);
  });

  it("passes a valid count through", () => {
    expect(parseDeliveredQuantity("7")).toBe(7);
    expect(parseDeliveredQuantity("0")).toBe(0);
  });

  it("keeps 'the caller did not say' distinct from 'unparseable'", () => {
    // The web client sends nothing at all; that is a real answer, not an error.
    expect(parseDeliveredQuantity(undefined)).toBeUndefined();
    expect(parseDeliveredQuantity("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// D4 — the unitless quantity
// ---------------------------------------------------------------------------
/**
 * `verifyReceipt` handed `computeMatch` seven bare numbers. The order row it
 * already had in hand carried `unit_type`, and nothing read it. An order placed
 * in CASES and invoiced in BOTTLES therefore produced a confident wrong verdict
 * rather than an error — and the wrong number was stamped into
 * `effectiveUnitCost` and into `price_history`, whose `unit` column says
 * 'BOTTLE' unconditionally.
 *
 * EVERY FIXTURE HERE IS A REAL CONVERSION. `unit_type: "bottle"` with a pack
 * size of 1 makes the conversion the identity, which is exactly how the
 * precedent bug in the door path stayed hidden: its one test used
 * `countedUom: "bottle"`, so a missing conversion could not change the answer.
 * These use cases of 12.
 */
describe("verifyReceipt — cross-unit quantities are converted, not compared raw", () => {
  /** 2 cases of 12. `bottles_total` is 24; the header has no pack size column. */
  const caseOrder = {
    id: ORDER,
    order_number: "ORD-2026-00003",
    restaurant_id: REST,
    inventory_id: OWN_INVENTORY,
    provider_id: "prov-1",
    quantity: 2,
    bottles_total: 24,
    unit_type: "case",
    final_price: 22,
    quantity_received: 2,
    status: "DELIVERED",
    delivery_notes: null,
  };

  it("matches an order placed in cases against an invoice billed in bottles", async () => {
    // THE DEFECT, exactly. Pre-fix this compared ordered 2 against invoice 24
    // and reported `qty_short` — a critical alert, a credit claim against the
    // vendor, and a delivery held open, all for a delivery that was correct.
    const { db, calls } = makeDb({ orderRow: caseOrder });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 24,
      invoiceUom: "bottle",
      invoiceUnitPrice: 22,
      acceptedQuantity: 2,
      countedUom: "case",
    } as any);

    expect(calls.orderUpdates[0].match_status).toBe("matched");
    expect(calls.orderUpdates[0].backorder_quantity).toBe(0);
    expect(calls.orderUpdates[0].discrepancy_notes).toBeNull();
  });

  it("raises no credit claim on a correct cases-vs-bottles delivery", async () => {
    // The verdict is not the only casualty: `qty_short` opens a claim, which
    // puts a restaurant in front of its distributor asking for money back over
    // an arithmetic error of our own.
    const { db, calls } = makeDb({ orderRow: caseOrder });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 24,
      invoiceUom: "bottle",
      invoiceUnitPrice: 22,
      acceptedQuantity: 2,
      countedUom: "case",
    } as any);

    expect(calls.creditInserts).toEqual([]);
  });

  it("writes a per-bottle landed cost, so the price series means what its unit column says", async () => {
    // Pre-fix: effectiveUnitCost = 24 * $22 / 2 accepted = $264, written into a
    // row whose `unit` is hardcoded 'BOTTLE'. A twelvefold-wrong price, labelled
    // confidently, in the one series that exists to answer "are we paying more
    // than we were".
    const { db, calls } = makeDb({ orderRow: caseOrder });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 24,
      invoiceUom: "bottle",
      invoiceUnitPrice: 22,
      acceptedQuantity: 2,
      countedUom: "case",
    } as any);

    expect(calls.priceHistoryInserts).toHaveLength(1);
    const row = calls.priceHistoryInserts[0];
    expect(row.unit).toBe("BOTTLE");
    expect(row.price).toBe(22);
    // 24 BOTTLES, not the raw 24 that happened to be typed, and not 2 cases.
    expect(row.quantity).toBe(24);
  });

  it("converts the rejected count with the accepted one, never only the first", async () => {
    // The precedent bug, ported: `countedQty` was converted and `rejectedQty`
    // was not, so `accepted = counted - rejected` subtracted boxes from bottles
    // and booked 33 bottles of stock for a delivery refused at the door. Both
    // operands are in `countedUom` and both must move.
    const { db, calls } = makeDb({ orderRow: caseOrder });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 24,
      invoiceUom: "bottle",
      invoiceUnitPrice: 22,
      acceptedQuantity: 1,
      rejectedQuantity: 1,
      rejectedReason: "case crushed",
      countedUom: "case",
    } as any);

    // 1 case accepted = 12 bottles; 1 case rejected = 12 bottles. Billed 24
    // bottles, 12 usable -> the vendor owes 12 bottles back at $22 = $264.
    //
    // Convert only the accepted side and this is 1 bottle rejected out of 24
    // billed: a $22 claim, and 11 bottles of stock the books say are on the
    // shelf and the shelf does not have. That subtraction across two units is
    // the precedent bug verbatim.
    expect(calls.orderUpdates[0].match_status).toBe("rejected");
    expect(calls.creditInserts).toHaveLength(1);
    expect(calls.creditInserts[0].claimed_amount).toBe(264);
  });

  it("prefers the order LINE's stated pack size over deriving one", async () => {
    // `bottles_total / quantity` is a back-derivation, and back-deriving pack
    // size is what let a legacy order booking 5 bottles for 5 cases teach the
    // door that a case holds one bottle. The line states it outright.
    const { db, calls } = makeDb({
      // A header whose bottles_total would derive 1, contradicted by a line
      // that says 12. The line wins.
      orderRow: { ...caseOrder, bottles_total: 2 },
      orderLineRow: { unit_type: "case", bottles_per_unit: 12 },
    });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 24,
      invoiceUom: "bottle",
      invoiceUnitPrice: 22,
      acceptedQuantity: 2,
      countedUom: "case",
    } as any);

    expect(calls.orderUpdates[0].match_status).toBe("matched");
  });
});

describe("verifyReceipt — a unit it cannot read is refused, never assumed", () => {
  const caseOrder = {
    id: ORDER,
    order_number: "ORD-2026-00004",
    restaurant_id: REST,
    inventory_id: OWN_INVENTORY,
    provider_id: "prov-1",
    quantity: 2,
    bottles_total: 24,
    unit_type: "case",
    final_price: 22,
    quantity_received: 2,
    status: "DELIVERED",
    delivery_notes: null,
  };

  it("refuses an unrecognised unit with a 400 rather than guessing one", async () => {
    const { db } = makeDb({ orderRow: caseOrder });

    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, {
        invoiceQuantity: 24,
        invoiceUom: "bxs",
        invoiceUnitPrice: 22,
        acceptedQuantity: 2,
      } as any),
    ).rejects.toThrow(/not a unit this match can convert/i);
  });

  it("writes nothing at all when a unit cannot be read", async () => {
    // The refusal has to come before the ledger correction and the claim. A
    // guard that ran afterwards would already have moved the stock.
    const { db, calls } = makeDb({ orderRow: caseOrder });

    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, {
        invoiceQuantity: 24,
        invoiceUom: "bxs",
        invoiceUnitPrice: 22,
        acceptedQuantity: 2,
      } as any),
    ).rejects.toThrow();

    expect(calls.orderUpdates).toEqual([]);
    expect(calls.rpc.filter((c) => c.name === "apply_stock_movement")).toEqual(
      [],
    );
    expect(calls.creditInserts).toEqual([]);
    expect(calls.priceHistoryInserts).toEqual([]);
  });

  it("refuses a multiplying unit whose pack size is nowhere stated", async () => {
    // An order row that cannot say how big a case is: no line, and a
    // bottles_total that does not divide into the quantity. Guessing 12
    // multiplies the delivery twelvefold; guessing 1 divides it by twelve.
    const { db } = makeDb({
      orderRow: { ...caseOrder, quantity: 5, bottles_total: 7 },
    });

    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, {
        invoiceQuantity: 24,
        invoiceUnitPrice: 22,
        acceptedQuantity: 5,
      } as any),
    ).rejects.toThrow(/how many bottles are in one/i);
  });

  it("refuses to compare kegs against bottles", async () => {
    const { db } = makeDb({
      orderRow: {
        ...caseOrder,
        quantity: 2,
        bottles_total: 2,
        unit_type: "keg",
      },
    });

    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, {
        invoiceQuantity: 24,
        invoiceUom: "bottle",
        invoiceUnitPrice: 22,
        acceptedQuantity: 2,
      } as any),
    ).rejects.toThrow(/cannot be compared/i);
  });
});

describe("verifyReceipt — a deprecated alias may not disagree with its twin", () => {
  const bottleOrder = {
    id: ORDER,
    order_number: "ORD-2026-00005",
    restaurant_id: REST,
    inventory_id: OWN_INVENTORY,
    provider_id: "prov-1",
    quantity: 24,
    bottles_total: 24,
    unit_type: "bottle",
    final_price: 22,
    quantity_received: 24,
    status: "DELIVERED",
    delivery_notes: null,
  };

  it("refuses a payload carrying both names with different values, naming both", async () => {
    // The failure the alias pattern invites: two numbers for one quantity and a
    // server that quietly prefers one. That is the same defect class as the
    // unitless field itself — a number chosen by a rule nobody can see.
    const { db, calls } = makeDb({ orderRow: bottleOrder });

    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, {
        acceptedQuantityInCountedUom: 24,
        acceptedQuantity: 22,
        invoiceQuantity: 24,
        invoiceUnitPrice: 22,
      } as any),
    ).rejects.toThrow(
      /acceptedQuantityInCountedUom=24 disagrees with its deprecated alias acceptedQuantity=22/,
    );

    expect(calls.orderUpdates).toEqual([]);
  });

  it("accepts both names when they agree — a client mid-migration sends both", async () => {
    const { db, calls } = makeDb({ orderRow: bottleOrder });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      acceptedQuantityInCountedUom: 24,
      acceptedQuantity: 24,
      invoiceQuantityInInvoiceUom: 24,
      invoiceQuantity: 24,
      invoiceUnitPrice: 22,
    } as any);

    expect(calls.orderUpdates[0].match_status).toBe("matched");
    expect(calls.orderUpdates[0].accepted_quantity).toBe(24);
  });

  it("still honours a payload that carries only the old unitless names", async () => {
    // The whole reason this was an alias and not a rename: a phone holding a
    // queued receipt from an older build must still book its delivery.
    const { db, calls } = makeDb({ orderRow: bottleOrder });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 24,
      invoiceUnitPrice: 22,
      acceptedQuantity: 22,
      rejectedQuantity: 2,
    } as any);

    expect(calls.orderUpdates[0].accepted_quantity).toBe(22);
    expect(calls.orderUpdates[0].rejected_quantity).toBe(2);
    expect(calls.orderUpdates[0].match_status).toBe("rejected");
  });
});

describe("markDelivered — ?quantityReceived is a deprecated alias, not a second answer", () => {
  it("reads the canonical unit-declaring parameter", () => {
    expect(readDeliveredQuantity("7", undefined)).toBe(7);
  });

  it("still reads the old unitless parameter on its own", () => {
    expect(readDeliveredQuantity(undefined, "7")).toBe(7);
  });

  it("accepts both when they agree", () => {
    expect(readDeliveredQuantity("7", "7")).toBe(7);
  });

  it("refuses both when they disagree, naming both", () => {
    expect(() => readDeliveredQuantity("7", "9")).toThrow(
      /quantityReceivedInOrderUom=7 disagrees with its deprecated alias quantityReceived=9/,
    );
  });

  it("keeps absence absent", () => {
    expect(readDeliveredQuantity(undefined, undefined)).toBeUndefined();
  });
});
