import { ProvidersService } from "./providers.service";
import { ProcurementService } from "../procurement/procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";

/**
 * Recording an off-app invoice as a delivered order.
 *
 * WHAT WAS BROKEN, VERIFIED AGAINST PRODUCTION 2026-09-01
 *
 * `POST /providers/:id/retroactive-order` had never once succeeded. Its insert
 * named `wine_name` and `actual_delivery` — `procurement_orders` has neither —
 * and omitted five NOT NULL columns (`order_number`, `inventory_id`,
 * `bottles_total`, `final_price`, `total_cost`). The statement failed at
 * PostgREST, so the two follow-on inserts never ran, so nobody discovered that
 * they were broken too: `procurement_conversations.message_text` is NOT NULL and
 * unwritten, and `order_interactions` has no `channel` and no `content` column
 * while its `interaction_type` CHECK accepts only VOICE|SMS|EMAIL|WHATSAPP.
 *
 * A second, unrouted copy of the same method sat in
 * `provider-intelligence.service.ts` with zero callers. It is deleted.
 *
 * These tests are written against the SERVICES, not through HTTP, because the
 * defect was in what got written down — and every assertion below is on a
 * payload the pre-fix code either never produced or produced wrongly.
 */

type Row = Record<string, any>;

interface Calls {
  orderInserts: Row[];
  orderUpdates: Row[];
  lineInserts: Row[];
  conversationInserts: Row[];
  interactionInserts: Row[];
  tables: string[];
}

function makeDb(opts: {
  providerCount?: number;
  existingOpenOrders?: Row[];
  insertedOrder?: Row;
  inventory?: Row | null;
}) {
  const calls: Calls = {
    orderInserts: [],
    orderUpdates: [],
    lineInserts: [],
    conversationInserts: [],
    interactionInserts: [],
    tables: [],
  };

  const supabase: any = {
    from(table: string) {
      calls.tables.push(table);
      let op: "select" | "insert" | "update" | "delete" = "select";

      const settle = (shape: "one" | "many") => {
        if (table === "providers")
          return { data: null, count: opts.providerCount ?? 1, error: null };
        if (table === "restaurant_inventory")
          return { data: opts.inventory ?? null, error: null };
        if (table === "procurement_orders") {
          if (op === "insert")
            return { data: opts.insertedOrder ?? null, error: null };
          // The merge path re-selects the row it just updated.
          if (op === "update")
            return {
              data: opts.existingOpenOrders?.[0] ?? opts.insertedOrder ?? null,
              error: null,
            };
          return {
            data: shape === "many" ? (opts.existingOpenOrders ?? []) : null,
            error: null,
          };
        }
        if (table === "procurement_conversations" && op === "insert")
          return { data: { id: "conv-1" }, error: null };
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
        lte: () => q,
        like: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        insert(payload: Row) {
          op = "insert";
          if (table === "procurement_orders") calls.orderInserts.push(payload);
          if (table === "procurement_order_items")
            calls.lineInserts.push(payload);
          if (table === "procurement_conversations")
            calls.conversationInserts.push(payload);
          if (table === "order_interactions")
            calls.interactionInserts.push(payload);
          return q;
        },
        update(payload: Row) {
          op = "update";
          if (table === "procurement_orders") calls.orderUpdates.push(payload);
          return q;
        },
        delete() {
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
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({}) },
  };

  return {
    calls,
    db: {
      supabase,
      getClient: () => supabase,
      client: supabase,
    } as unknown as DatabaseService,
  };
}

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledger = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;

const MASTER_WINE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const INVENTORY = "55555555-5555-4555-8555-555555555555";
const PROVIDER = "66666666-6666-4666-8666-666666666666";

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
  order_number: "ORD-2026-00042",
  restaurant_id: "rest-1",
  inventory_id: INVENTORY,
  provider_id: PROVIDER,
  quantity: 5,
  unit_type: "case",
  bottles_total: 60,
  final_price: 10,
  total_cost: 600,
  status: "DELIVERED",
  inventory: { wine_name: "Barolo Riserva" },
};

/** Five cases of twelve, invoiced at $600 in total. */
const caseInvoice = {
  inventoryId: INVENTORY,
  quantity: 5,
  unitType: "case",
  bottlesPerUnit: 12,
  invoiceTotal: 600,
  invoiceDate: "2026-08-14",
  invoiceNumber: "INV-77",
  rawInvoiceContent: "5 cases Barolo Riserva ......... 600.00",
} as any;

function makeOrchestrator() {
  return {
    triggerDraftHttp: jest.fn().mockResolvedValue({}),
    publishEvent: jest.fn().mockResolvedValue({}),
  } as unknown as OrchestratorService;
}

function services(db: DatabaseService, orchestrator?: OrchestratorService) {
  const procurement = new ProcurementService(db, events, ledger, orchestrator);
  return {
    procurement,
    providers: new ProvidersService(db, events, procurement),
  };
}

/**
 * Every column `procurement_orders` actually has.
 *
 * Written out rather than parsed so this file stays hermetic, and taken from
 * production's information_schema on 2026-09-01 plus the two migrations that
 * followed. `wine_name` and `actual_delivery` are deliberately absent — their
 * absence IS the defect.
 */
const PROCUREMENT_ORDER_COLUMNS = new Set([
  // 20260906170000_a_vendor_states_its_usual_currency_and_an_order_carries_one.sql
  // (2026-09-06): the ORDER carries the currency it was placed in and says where
  // that came from. Both are always written together -- the CHECK
  // `procurement_orders_currency_states_its_source` refuses either half alone --
  // and on a RETROACTIVE order both are normally null: nobody chose a currency
  // for an invoice that had already been paid.
  "currency",
  "currency_source",
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
  "id",
  "order_number",
  "restaurant_id",
  "inventory_id",
  "provider_id",
  "quantity",
  "unit_type",
  "bottles_total",
  "quoted_price",
  "negotiated_price",
  "final_price",
  "total_cost",
  "status",
  "requested_at",
  "approved_at",
  "approved_by",
  "confirmed_at",
  "shipped_at",
  "expected_delivery_date",
  "delivered_at",
  "completed_at",
  "tracking_number",
  "delivery_notes",
  "received_by",
  "quantity_received",
  "price_verified",
  "invoice_image_url",
  "discrepancy_notes",
  "manager_notes",
  "rejection_reason",
  "is_emergency",
  "priority_level",
  "created_at",
  "updated_at",
  "state_machine_state",
  "is_recurring",
  "cron_schedule",
  "total_estimated_cost",
  "final_confirmed_cost",
  "negotiation_attempts",
  "last_negotiation_at",
  "is_offline_sync",
  "ai_autonomy_paused",
  "invoice_quantity",
  "invoice_unit_price",
  "accepted_quantity",
  "rejected_quantity",
  "rejected_reason",
  "backorder_quantity",
  "match_status",
  "price_override_reason",
  "match_verified_at",
  "match_verified_by",
  "created_by",
  "source",
  "recurring_order_id",
]);

/** NOT NULL with no default. An insert missing any of these raises 23502. */
const PROCUREMENT_ORDER_REQUIRED = [
  "order_number",
  "restaurant_id",
  "inventory_id",
  "provider_id",
  "quantity",
  "bottles_total",
  "final_price",
  "total_cost",
];

describe("createRetroactiveOrder — the insert can actually succeed", () => {
  it("names no column procurement_orders does not have", async () => {
    // The pre-fix payload carried `wine_name` and `actual_delivery`. Neither
    // exists; PostgREST answers PGRST204 and the whole endpoint 500s.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await services(db).providers.createRetroactiveOrder(
      PROVIDER,
      "rest-1",
      USER,
      caseInvoice,
    );

    expect(calls.orderInserts).toHaveLength(1);
    const unknown = Object.keys(calls.orderInserts[0]).filter(
      (k) => !PROCUREMENT_ORDER_COLUMNS.has(k),
    );
    expect(unknown).toEqual([]);
    expect(calls.orderInserts[0]).not.toHaveProperty("wine_name");
    expect(calls.orderInserts[0]).not.toHaveProperty("actual_delivery");
  });

  it("supplies every NOT NULL column", async () => {
    // Five were missing: order_number, inventory_id, bottles_total,
    // final_price, total_cost. Any one of them is a 23502.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await services(db).providers.createRetroactiveOrder(
      PROVIDER,
      "rest-1",
      USER,
      caseInvoice,
    );

    const payload = calls.orderInserts[0];
    for (const col of PROCUREMENT_ORDER_REQUIRED) {
      expect(payload[col]).toBeDefined();
      expect(payload[col]).not.toBeNull();
    }
    expect(String(payload.order_number)).toMatch(/\S/);
  });
});

describe("createRetroactiveOrder — the wine is already in the cellar", () => {
  it("opens DELIVERED, not PENDING", async () => {
    // A PENDING order for wine already on the shelf is a request the
    // restaurant will act on twice.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await services(db).providers.createRetroactiveOrder(
      PROVIDER,
      "rest-1",
      USER,
      caseInvoice,
    );
    expect(calls.orderInserts[0].status).toBe("DELIVERED");
    expect(calls.orderInserts[0].source).toBe("retroactive");
  });

  it("dates the delivery and the request from the invoice, not from now", async () => {
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await services(db).providers.createRetroactiveOrder(
      PROVIDER,
      "rest-1",
      USER,
      caseInvoice,
    );
    const p = calls.orderInserts[0];
    expect(p.delivered_at).toBe("2026-08-14");
    // Otherwise the order's delivery precedes its own request, which reads as a
    // data error to every report that sorts on either column.
    expect(p.requested_at).toBe("2026-08-14");
  });

  it("never opens a price negotiation for wine that has been delivered", async () => {
    // `triggerDraftHttp` emails the vendor to negotiate. Doing that for an
    // invoice already paid is the single most damaging thing this path could
    // do, and before `alreadyFulfilled` existed it had no way to say "do not".
    //
    // Both halves in one test: a normal order MUST still trigger, or this
    // assertion would pass against a service that never triggers at all.
    const orchestrator = makeOrchestrator();
    const normal = makeDb({
      insertedOrder: { ...insertedOrder, status: "PENDING" },
      inventory: inventoryRow,
    });
    await services(normal.db, orchestrator).procurement.createOrder(
      "rest-1",
      USER,
      {
        inventoryId: INVENTORY,
        providerId: PROVIDER,
        quantity: 5,
        unitType: "case",
        bottlesPerUnit: 12,
        finalPrice: 10,
      } as any,
    );
    expect(orchestrator.triggerDraftHttp).toHaveBeenCalledTimes(1);

    const retro = makeDb({ insertedOrder, inventory: inventoryRow });
    await services(retro.db, orchestrator).providers.createRetroactiveOrder(
      PROVIDER,
      "rest-1",
      USER,
      caseInvoice,
    );
    expect(orchestrator.triggerDraftHttp).toHaveBeenCalledTimes(1);
  });

  it("does not fold the invoice into an unrelated open order", async () => {
    // The dedup merge exists to fold a re-quote into an open REQUEST. An
    // off-app purchase is a second, separate purchase; merging would replace a
    // live order's quantity and price with the invoice's — one delivery
    // recorded and one real order destroyed, with no trace of either.
    //
    // The positive half first: a normal order with an open match DOES merge.
    const openOrder = {
      id: "existing-1",
      quoted_price: 40,
      negotiated_price: null,
      is_emergency: false,
      priority_level: 5,
      manager_notes: null,
      expected_delivery_date: null,
      inventory: { wine_name: "Barolo Riserva" },
    };

    const normal = makeDb({
      insertedOrder,
      inventory: inventoryRow,
      existingOpenOrders: [openOrder],
    });
    await services(normal.db).procurement.createOrder("rest-1", USER, {
      inventoryId: INVENTORY,
      providerId: PROVIDER,
      quantity: 5,
      unitType: "case",
      bottlesPerUnit: 12,
      finalPrice: 10,
    } as any);
    expect(normal.calls.orderUpdates).toHaveLength(1);
    expect(normal.calls.orderInserts).toHaveLength(0);

    const retro = makeDb({
      insertedOrder,
      inventory: inventoryRow,
      existingOpenOrders: [openOrder],
    });
    await services(retro.db).providers.createRetroactiveOrder(
      PROVIDER,
      "rest-1",
      USER,
      caseInvoice,
    );
    expect(retro.calls.orderUpdates).toHaveLength(0);
    expect(retro.calls.orderInserts).toHaveLength(1);
  });
});

describe("createRetroactiveOrder — the invoice total is a total", () => {
  it("spreads a $600 five-case invoice across sixty bottles, not five", async () => {
    // `final_price` on this table is PER BOTTLE — confirmDeal emails the vendor
    // "$X per bottle" out of the same column. The old DTO's `finalConfirmedCost`
    // was documented as a TOTAL and written straight to it, so a $600 case
    // invoice became $600/bottle: $7,200, a twelvefold error.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await services(db).providers.createRetroactiveOrder(
      PROVIDER,
      "rest-1",
      USER,
      caseInvoice,
    );

    const p = calls.orderInserts[0];
    expect(p.bottles_total).toBe(60);
    expect(p.final_price).toBe(10);
    // The exact number on the invoice, not `unitPrice * bottlesTotal` — a
    // half-cent of rounding must not become the number the books are kept on.
    expect(p.total_cost).toBe(600);
    expect(p.final_confirmed_cost).toBe(600);
  });

  it("refuses an invoice whose units cannot be resolved, and writes nothing", async () => {
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await expect(
      services(db).providers.createRetroactiveOrder(PROVIDER, "rest-1", USER, {
        ...caseInvoice,
        bottlesPerUnit: undefined,
      }),
    ).rejects.toThrow(/needs bottlesPerUnit/);
    expect(calls.orderInserts).toHaveLength(0);
    expect(calls.conversationInserts).toHaveLength(0);
  });
});

describe("createRetroactiveOrder — what else it writes down", () => {
  it("writes the order line an arriving invoice can be matched against", async () => {
    // matchDocumentLines returns early when an order has no lines, so an order
    // with no line is invisible to the entire matching engine. The hand-rolled
    // insert wrote no line at all.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await services(db).providers.createRetroactiveOrder(
      PROVIDER,
      "rest-1",
      USER,
      caseInvoice,
    );

    expect(calls.lineInserts).toHaveLength(1);
    expect(calls.lineInserts[0].master_wine_id).toBe(MASTER_WINE);
    expect(calls.lineInserts[0].bottles_per_unit).toBe(12);
  });

  it("fills procurement_conversations.message_text, which is NOT NULL", async () => {
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await services(db).providers.createRetroactiveOrder(
      PROVIDER,
      "rest-1",
      USER,
      caseInvoice,
    );

    expect(calls.conversationInserts).toHaveLength(1);
    const conv = calls.conversationInserts[0];
    expect(conv.message_text).toBe(caseInvoice.rawInvoiceContent);
    expect(conv.direction).toBe("INBOUND");
    // `ai_summary` is not a column on this table; `conversation_summary` is.
    expect(conv).not.toHaveProperty("ai_summary");
  });

  it("still writes a message_text when the invoice body is empty", async () => {
    // NOT NULL means NOT NULL: an invoice entered by hand with no email body
    // must not take the whole conversation row down.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await services(db).providers.createRetroactiveOrder(
      PROVIDER,
      "rest-1",
      USER,
      { ...caseInvoice, rawInvoiceContent: undefined },
    );
    expect(calls.conversationInserts[0].message_text).toContain("INV-77");
  });

  it("writes nothing to order_interactions, which cannot hold this event", async () => {
    // The table has no `channel` and no `content` column, its interaction_type
    // CHECK accepts only VOICE|SMS|EMAIL|WHATSAPP (so "invoice_received" is a
    // 23514), and its interaction_direction is NOT NULL and was never written.
    // It has 0 rows and no other writer anywhere in the repository.
    //
    // Asserted alongside the positive above, because "no row was written" is
    // trivially true of code that writes nothing at all.
    const { db, calls } = makeDb({ insertedOrder, inventory: inventoryRow });
    await services(db).providers.createRetroactiveOrder(
      PROVIDER,
      "rest-1",
      USER,
      caseInvoice,
    );
    expect(calls.conversationInserts).toHaveLength(1);
    expect(calls.interactionInserts).toHaveLength(0);
    expect(calls.tables).not.toContain("order_interactions");
  });

  it("returns the order number, so the operator can find what was created", async () => {
    const { db } = makeDb({ insertedOrder, inventory: inventoryRow });
    const result = await services(db).providers.createRetroactiveOrder(
      PROVIDER,
      "rest-1",
      USER,
      caseInvoice,
    );
    expect(result.orderId).toBe(insertedOrder.id);
    expect(result.orderNumber).toBe(insertedOrder.order_number);
    expect(result.conversationId).toBe("conv-1");
    expect(result).not.toHaveProperty("interactionId");
  });
});
