import { ForbiddenException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { parseDeliveredQuantity } from "./procurement.controller";
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
