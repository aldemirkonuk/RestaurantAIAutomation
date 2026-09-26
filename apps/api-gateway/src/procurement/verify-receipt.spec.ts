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
 *      booked the whole delivery a second time. [ADR 0192, 2026-09-21: the
 *      door now reconciles against the ledger and no path writes the column.]
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
  // 20260905235800_an_order_that_repeats_says_so_on_itself.sql (2026-09-05):
  // nine additive recurrence columns; createOrder writes the last two on a
  // generated child (ADR 0125 recurrence addendum).
  "recurrence_frequency",
  "recurrence_anchor_day",
  "recurrence_anchored_on",
  "recurrence_next_due_on",
  "recurrence_status",
  "recurrence_status_by",
  "recurrence_status_at",
  "recurrence_parent_order_id",
  "recurrence_occurrence_on",
  // 20260906170000_a_vendor_states_its_usual_currency_and_an_order_carries_one.sql
  // (2026-09-06): the ORDER carries the currency it was placed in and says where
  // that came from. `createOrder` writes both, always together -- the CHECK
  // `procurement_orders_currency_states_its_source` refuses either half alone.
  "currency",
  "currency_source",
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
  /** `procurement_receipt_events` rows: the verification's own `reconciled` event (ADR 0192 amendment). */
  receiptEvents: Row[];
  /** `house_item_research` inserts: research queued for a wine the library lacks (ADR 0192, third amendment). */
  researchInserts: Row[];
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
  bookedBottles?: number;
  ledgerReadError?: boolean;
  ownedInventoryIds?: string[];
  updatedRow?: Row;
  updateError?: { code: string; message: string } | null;
  /** The verification's event insert fails with this. */
  receiptEventError?: { message: string } | null;
  /** The item's wine-library id; null = a wine the library lacks. Default: a library wine. */
  libraryWineId?: string | null;
}) {
  const calls: Calls = {
    orderUpdates: [],
    rpc: [],
    creditInserts: [],
    inventoryUpdates: [],
    eventInserts: [],
    priceHistoryInserts: [],
    receiptEvents: [],
    researchInserts: [],
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

        if (table === "inventory_transactions")
          return opts.ledgerReadError
            ? { data: null, error: { message: "offline" } }
            : {
                data: [
                  {
                    id: "movement-1",
                    quantity_change: opts.bookedBottles ?? 10,
                  },
                ],
                error: null,
              };

        if (table === "procurement_order_items")
          return { data: opts.orderLineRow ?? null, error: null };

        if (table === "procurement_receipt_events" && op === "insert" && opts.receiptEventError)
          return { data: null, error: opts.receiptEventError };

        if (table === "restaurant_inventory") {
          // The ownership probe: select("id") filtered by restaurant_id + id.
          if (selectedColumns.trim() === "id")
            return {
              data: owned.has(filters.id) ? { id: filters.id } : null,
              error: null,
            };
          return {
            data: {
              master_wine_id:
                opts.libraryWineId === undefined
                  ? "55555555-5555-4555-8555-555555555555"
                  : opts.libraryWineId,
              wine_name: "Barolo Riserva",
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
          if (table === "price_history")
            calls.priceHistoryInserts.push(payload);
          if (table === "procurement_receipt_events")
            calls.receiptEvents.push(payload);
          if (table === "house_item_research")
            calls.researchInserts.push(payload);
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

/*
 * `invoiceCurrency: "USD"` appears beside every `invoiceUnitPrice` below since
 * 2026-09-06 (founder batch 67): `verifyReceipt` refuses a unit price with no
 * currency before it reads anything, so a payload that carries a figure and no
 * code no longer reaches any of the behaviour these tests are about. The value
 * is incidental here — what each test asserts is unchanged.
 */

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
      invoiceCurrency: "USD",
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
      invoiceCurrency: "USD",
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
      invoiceCurrency: "USD",
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
      invoiceCurrency: "USD",
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

describe("verifyReceipt — a correction that books a wine the library lacks queues research (ADR 0192, third amendment)", () => {
  // Founder, 2026-09-22, verbatim pick: "Yes, same rule (Recommended)" — every
  // path that books stock for a wine the library lacks queues research once
  // per item id. [Last call, 2026-09-22: verification was the path missed.]
  it("queues the item by its id when a correction booked bottles in", async () => {
    const { db, calls } = makeDb({
      orderRow: { ...deliveredOrder, inventory_id: "other-own-id" },
      ownedInventoryIds: [OWN_INVENTORY, "other-own-id"],
      libraryWineId: null,
    });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      adjustments: [{ inventoryId: OWN_INVENTORY, delta: 3, reason: "unlisted extras" }],
    } as any);

    expect(calls.researchInserts).toHaveLength(1);
    expect(calls.researchInserts[0]).toMatchObject({
      restaurant_id: REST,
      inventory_id: OWN_INVENTORY,
      status: "queued",
      queued_from: "receiving",
      source_order_id: ORDER,
      queued_by: USER,
      classified_name: "Barolo Riserva",
    });
  });

  it("queues nothing for a correction that took bottles out", async () => {
    const { db, calls } = makeDb({
      orderRow: { ...deliveredOrder, inventory_id: "other-own-id" },
      ownedInventoryIds: [OWN_INVENTORY, "other-own-id"],
      libraryWineId: null,
    });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      adjustments: [{ inventoryId: OWN_INVENTORY, delta: -2, reason: "breakage" }],
    } as any);

    expect(calls.rpc.filter((c) => c.name === "apply_stock_movement")).toHaveLength(1);
    expect(calls.researchInserts).toEqual([]);
  });

  it("queues nothing for a wine the library holds", async () => {
    const { db, calls } = makeDb({
      orderRow: { ...deliveredOrder, inventory_id: "other-own-id" },
      ownedInventoryIds: [OWN_INVENTORY, "other-own-id"],
    });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      adjustments: [{ inventoryId: OWN_INVENTORY, delta: 3, reason: "unlisted extras" }],
    } as any);

    expect(calls.rpc.filter((c) => c.name === "apply_stock_movement")).toHaveLength(1);
    expect(calls.researchInserts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D3
// ---------------------------------------------------------------------------
describe("markDelivered — books what arrived, and writes no received column (ADR 0192)", () => {
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

  it("books the order's quantity when the caller sends none, and writes no received column", async () => {
    // The web client sends none (useOrdersData.ts:68). The door reconciles
    // against the LEDGER (`readBookedOrderBottles`), not a column, so what was
    // booked is what the order received — there is no second copy to keep in
    // step, and ADR 0192 forbids writing one.
    const { db, calls } = makeDb({ orderRow: pendingOrder });

    await service(db).markDelivered(REST, ORDER, USER);

    const live = calls.rpc.find(
      (c) =>
        c.name === "apply_stock_movement" && c.args.p_stock_state === "live",
    );
    expect(live).toBeDefined();
    expect(live!.args.p_delta).toBe(12);

    expect(calls.orderUpdates).toHaveLength(1);
    expect("quantity_received" in calls.orderUpdates[0]).toBe(false);
  });

  it("books an explicit short count as the short count, not the ordered count", async () => {
    const { db, calls } = makeDb({ orderRow: pendingOrder });

    await service(db).markDelivered(REST, ORDER, USER, 9);

    const live = calls.rpc.find(
      (c) =>
        c.name === "apply_stock_movement" && c.args.p_stock_state === "live",
    );
    expect(live!.args.p_delta).toBe(9);
    expect("quantity_received" in calls.orderUpdates[0]).toBe(false);
  });

  it("books five cases as sixty bottles and converts an explicitly case-priced agreement once", async () => {
    const { db, calls } = makeDb({
      orderRow: { ...pendingOrder, quantity: 5, bottles_total: 60, unit_type: "case", final_price: 360 },
      orderLineRow: { id: "line", unit_type: "case", bottles_per_unit: 12, price_uom: "case", price_pack_size: 12, final_unit_price: 360 },
    });
    await service(db).markDelivered(REST, ORDER, USER);
    const live = calls.rpc.find(c => c.name === "apply_stock_movement" && c.args.p_stock_state === "live");
    expect(live?.args).toMatchObject({ p_delta: 60, p_unit_cost: 30, p_cost_provenance: "estimated" });
    // Five cases book SIXTY bottles, and no order-unit "5" is written anywhere.
    expect("quantity_received" in calls.orderUpdates[0]).toBe(false);
  });

  it("writes no received column on ANY of its updates", async () => {
    const { db, calls } = makeDb({ orderRow: pendingOrder });
    await service(db).markDelivered(REST, ORDER, USER);
    expect(calls.orderUpdates.length).toBeGreaterThan(0);
    for (const update of calls.orderUpdates)
      expect(Object.keys(update)).not.toContain("quantity_received");
  });

  it("D6 (ADR 0190, filed as 0168) — the verify-receipt notice names how many BOTTLES were booked, not the order's own unit count", async () => {
    // Neither `service()` nor `makeDb` wires a notificationsService, so every
    // test above this one skips the `if (this.notificationsService)` block
    // entirely and could not have caught this — the notice is only
    // constructed when a real (or mocked) NotificationsService is present.
    const notifications = {
      persistForRestaurant: jest.fn().mockResolvedValue({ inserted: 1 }),
    };
    const { db } = makeDb({
      orderRow: {
        ...pendingOrder,
        quantity: 5,
        bottles_total: 60,
        unit_type: "case",
        final_price: 360,
      },
    });

    await new ProcurementService(
      db,
      events,
      ledger,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      notifications as any,
    ).markDelivered(REST, ORDER, USER);

    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    const [, payload] = notifications.persistForRestaurant.mock.calls[0];
    // Pre-fix this read "5 bottles stocked in" (resolvedQuantity — 5 cases,
    // the order's own unit), while the ledger booked receivedBottles (60, the
    // ledger call above asserts p_delta: 60 for this exact fixture shape).
    expect(payload.message).toBe(
      "60 bottles stocked in. Confirm the physical count against the vendor invoice.",
    );
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
      invoiceCurrency: "USD",
      acceptedQuantity: 2,
      countedUom: "case",
    } as any);

    expect(calls.orderUpdates[0].match_status).toBe("matched");
    // ADR 0192 amendment: the verification is a `reconciled` event in BOTTLES,
    // and the order row no longer carries the four sibling quantities.
    expect(calls.receiptEvents).toEqual([
      expect.objectContaining({
        stage: "reconciled",
        counted_uom: "bottle",
        counted_qty_bottles: 24,
        rejected_qty_bottles: 0,
        invoice_qty_bottles: 24,
      }),
    ]);
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
      invoiceCurrency: "USD",
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
      invoiceCurrency: "USD",
      acceptedQuantity: 2,
      countedUom: "case",
    } as any);

    expect(calls.priceHistoryInserts).toHaveLength(1);
    const row = calls.priceHistoryInserts[0];
    // Lowercase since ADR 0119 Q4 (2026-09-05): `price_history.unit` joined the
    // house's one seven-word vocabulary, NOT NULL with no default, and the
    // migration case-folded the one legacy spelling. The receipt path's claim is
    // `bottle_equivalent` — not the agreement's unit, but a measured property of
    // `computeMatch`, which converts all four documents to bottle-equivalents
    // before producing this cost.
    expect(row.unit).toBe("bottle");
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
      invoiceCurrency: "USD",
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
      invoiceCurrency: "USD",
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
        invoiceCurrency: "USD",
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
        invoiceCurrency: "USD",
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
        invoiceCurrency: "USD",
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
        invoiceCurrency: "USD",
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
        invoiceCurrency: "USD",
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
      invoiceCurrency: "USD",
    } as any);

    expect(calls.orderUpdates[0].match_status).toBe("matched");
    expect(calls.receiptEvents[0]).toMatchObject({ counted_qty_bottles: 24, invoice_qty_bottles: 24 });
  });

  it("still honours a payload that carries only the old unitless names", async () => {
    // The whole reason this was an alias and not a rename: a phone holding a
    // queued receipt from an older build must still book its delivery.
    const { db, calls } = makeDb({ orderRow: bottleOrder });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 24,
      invoiceUnitPrice: 22,
      invoiceCurrency: "USD",
      acceptedQuantity: 22,
      rejectedQuantity: 2,
    } as any);

    expect(calls.receiptEvents[0]).toMatchObject({ counted_qty_bottles: 22, rejected_qty_bottles: 2 });
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

describe("receipt quantity follows the booked ledger", () => {
  it.each([false, true])(
    "does not multiply a door-counted case order twice (invoice=%s)",
    async (withInvoice) => {
      const { db, calls } = makeDb({
        orderRow: {
          ...deliveredOrder,
          quantity: 5,
          unit_type: "case",
          bottles_total: 60,
          quantity_received: 60,
        },
        bookedBottles: 60,
      });
      await service(db).verifyReceipt(REST, ORDER, USER, {
        acceptedQuantity: 5,
        ...(withInvoice
          ? { invoiceQuantity: 5, invoiceUnitPrice: 40, invoiceCurrency: "USD" }
          : {}),
      } as any);
      expect(
        calls.rpc.filter((x) => x.name === "apply_stock_movement"),
      ).toEqual([]);
    },
  );

  it("corrects a short case against booked bottles, independently of the ambiguous display cache", async () => {
    const { db, calls } = makeDb({
      orderRow: {
        ...deliveredOrder,
        quantity: 5,
        unit_type: "case",
        bottles_total: 60,
        quantity_received: 5,
      },
      bookedBottles: 60,
    });
    await service(db).verifyReceipt(REST, ORDER, USER, {
      acceptedQuantity: 58,
      countedUom: "bottle",
    } as any);
    expect(
      calls.rpc.find((x) => x.name === "apply_stock_movement")?.args.p_delta,
    ).toBe(-2);
  });

  it("makes no receipt write when the existing ledger cannot be read", async () => {
    const { db, calls } = makeDb({
      orderRow: deliveredOrder,
      ledgerReadError: true,
    });
    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, {
        acceptedQuantity: 10,
      } as any),
    ).rejects.toThrow(/could not be read/);
    expect(calls.orderUpdates).toEqual([]);
    expect(calls.rpc).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A derived count that is not a whole pack verifies in BASE UNITS (founder,
// 2026-09-25, round 5: "Yes, in base units"). It used to be refused (D5, ADR
// 0168 — then kept "as a follow-up" by ADR 0192's amendment), and a refused
// verification left no history line.
// ---------------------------------------------------------------------------
/**
 * When a caller states no accepted count but does state other match fields,
 * `acceptedQtyInCountedUom` is BACK-DERIVED from the ledger's booked bottles.
 * 59 bottles booked on a 12-pack case order is 4.9167 cases. Since 2026-09-25
 * that reading is re-stated as the whole physical count in bottles (accepted,
 * rejected and free goods together), so every operand is an integer in a
 * stated unit (ADR 0070) and the verification writes its `reconciled` event.
 *
 * Today's web and mobile desks always send an accepted count
 * (`ReceivingWorkspace.tsx` sends a part case as `countedUom: 'bottle'`, the
 * mobile receive screen counts bottles), so only a direct API caller reaches
 * this branch — which is why a mock-level test is the kind that exercises it.
 */
describe("verifyReceipt — a part-pack derived count verifies in bottles", () => {
  const casesOf12 = {
    ...deliveredOrder,
    quantity: 5,
    unit_type: "case",
    bottles_total: 60,
    quantity_received: 5,
  };

  it("verifies 59 booked bottles on a 12-pack order and records them in bottles", async () => {
    const { db, calls } = makeDb({
      orderRow: casesOf12,
      bookedBottles: 59, // 59 / 12 = 4.9166... — not a whole number of cases
    });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 59,
      invoiceUom: "bottle",
      invoiceUnitPrice: 40,
      invoiceCurrency: "USD",
      // No acceptedQuantity: the derivation this covers is the one that
      // only runs when the caller states no count of its own.
    } as any);

    // One history line, every quantity in bottles, nothing rounded.
    expect(calls.receiptEvents).toHaveLength(1);
    expect(calls.receiptEvents[0]).toMatchObject({
      stage: "reconciled",
      counted_uom: "bottle",
      counted_qty: 59,
      counted_qty_bottles: 59,
      rejected_qty_bottles: 0,
      invoice_qty_bottles: 59,
    });
    // The count is the ledger's own: no correction is booked for it.
    expect(
      calls.rpc.filter(
        (c) => c.name === "apply_stock_movement" && c.args?.p_delta !== 0,
      ),
    ).toEqual([]);
  });

  it("converts a stated rejection in packs with the part pack, never only one of the pair", async () => {
    const { db, calls } = makeDb({
      orderRow: casesOf12,
      bookedBottles: 59,
    });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      rejectedQuantity: 1, // one case refused, stated in the order's unit
      rejectedReason: "broken case",
    } as any);

    expect(calls.receiptEvents[0]).toMatchObject({
      counted_uom: "bottle",
      counted_qty_bottles: 59,
      rejected_qty_bottles: 12,
    });
  });

  it("still derives normally when the booked total divides evenly", async () => {
    // The guard must not close the door on the case this derivation exists
    // for: 60 booked bottles on the same 12-pack order is exactly 5 cases.
    const { db, calls } = makeDb({
      orderRow: casesOf12,
      bookedBottles: 60,
    });

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 60,
      invoiceUnitPrice: 40,
      invoiceCurrency: "USD",
    } as any);

    // 5 cases of 12, stated in bottles on the event.
    expect(calls.receiptEvents[0]).toMatchObject({ counted_qty_bottles: 60 });
  });
});

describe("verifyReceipt — the verification is an event, not four order columns (ADR 0192 amendment)", () => {
  const SIBLINGS = ["accepted_quantity", "rejected_quantity", "backorder_quantity", "invoice_quantity"];
  const bottleOrder = {
    id: ORDER,
    order_number: "ORD-2026-00006",
    restaurant_id: REST,
    inventory_id: OWN_INVENTORY,
    provider_id: "prov-1",
    quantity: 24,
    bottles_total: 24,
    unit_type: "bottle",
    final_price: 22,
    status: "DELIVERED",
    delivery_notes: null,
  };

  it("writes none of the four sibling columns, and records the verification once, in bottles", async () => {
    const { db, calls } = makeDb({ orderRow: bottleOrder });
    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 24,
      invoiceUnitPrice: 22,
      invoiceCurrency: "USD",
      acceptedQuantity: 22,
      rejectedQuantity: 2,
      rejectedReason: "two corked",
    } as any);
    for (const update of calls.orderUpdates)
      for (const col of SIBLINGS) expect(col in update).toBe(false);
    expect(calls.receiptEvents).toEqual([
      expect.objectContaining({
        restaurant_id: REST,
        order_id: ORDER,
        stage: "reconciled",
        counted_qty_bottles: 22,
        rejected_qty_bottles: 2,
        invoice_qty_bottles: 24,
        received_by: USER,
        notes: "two corked",
      }),
    ]);
  });

  it("a verification with no invoice records no invoice quantity, not zero", async () => {
    const { db, calls } = makeDb({ orderRow: bottleOrder });
    await service(db).verifyReceipt(REST, ORDER, USER, { acceptedQuantity: 24 } as any);
    expect(calls.receiptEvents[0]).toMatchObject({ invoice_qty_bottles: null });
  });

  it("if the verification's counts cannot be recorded, nothing is changed: no stock moves, no claim, no order write", async () => {
    const { db, calls } = makeDb({
      orderRow: bottleOrder,
      receiptEventError: { message: "permission denied" },
    });
    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, {
        invoiceQuantity: 24,
        invoiceUnitPrice: 22,
        invoiceCurrency: "USD",
        acceptedQuantity: 20,
      } as any),
    ).rejects.toThrow(/counts could not be recorded .*nothing was changed/);
    expect(calls.rpc.filter((c) => c.name === "apply_stock_movement")).toEqual([]);
    expect(calls.creditInserts).toEqual([]);
    expect(calls.orderUpdates).toEqual([]);
  });
});
