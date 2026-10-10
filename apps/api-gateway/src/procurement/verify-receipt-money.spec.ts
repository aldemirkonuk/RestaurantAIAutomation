import { ForbiddenException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * verifyReceipt against a STATEFUL stub, sim wave 12 (S69).
 *
 * `verify-receipt.spec.ts` stubs rpc() as always-succeeds and answers every
 * ledger read with one fixed row, which is why none of these was ever caught:
 *
 *  F-464 every correction on an order was booked under one key, and
 *        `apply_stock_movement` answers a seen key with the old movement — so a
 *        second verification's delta never moved stock.
 *  F-465 a re-verify opened a second open credit claim for the same money, and
 *        a later clean check never closed the first.
 *  F-466 staff could post the invoice price, invoice quantity, an override
 *        reason, or a payload that opens a claim.
 *
 * Here the ledger is a list of rows that `apply_stock_movement` appends to (and
 * dedupes by key, as 20261222100000:187-189 does), and procurement_credits is a
 * table the reads filter.
 */

type Row = Record<string, any>;

const REST = "rest-1";
const ORDER = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";
const ITEM = "11111111-1111-4111-8111-111111111111";

function makeDb(order: Row) {
  const ledger: Row[] = [];
  const credits: Row[] = [];
  const seenKeys = new Set<string>();
  let creditSeq = 0;

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" = "select";
      let payload: Row = {};
      const eq: Row = {};
      const isNull: string[] = [];
      const neq: Row = {};
      const inList: Record<string, any[]> = {};
      let selected = "";

      const matches = (r: Row) =>
        Object.entries(eq).every(([k, v]) => r[k] === v) &&
        isNull.every((k) => r[k] == null) &&
        Object.entries(neq).every(([k, v]) => r[k] !== v) &&
        Object.entries(inList).every(([k, v]) => v.includes(r[k]));

      const settle = (shape: "one" | "many"): Row => {
        if (table === "procurement_orders") {
          if (op === "update") Object.assign(order, payload);
          return {
            data: { ...order, inventory: { wine_name: "Barolo" } },
            error: null,
          };
        }
        if (table === "inventory_transactions")
          return {
            data: ledger.filter((r) => r.order_id === eq.order_id),
            error: null,
          };
        if (table === "procurement_credits") {
          if (op === "insert") {
            const clash = credits.some(
              (c) =>
                c.state === "open" &&
                c.order_id === payload.order_id &&
                c.reason === payload.reason &&
                c.document_id == null &&
                c.document_line_id == null,
            );
            if (clash)
              return { data: null, error: { code: "23505", message: "dup" } };
            credits.push({
              id: `claim-${++creditSeq}`,
              document_id: null,
              document_line_id: null,
              notes: null,
              ...payload,
            });
            return { data: null, error: null };
          }
          const hit = credits.filter(matches);
          if (op === "update") for (const c of hit) Object.assign(c, payload);
          return {
            data: shape === "many" ? hit : (hit[0] ?? null),
            error: null,
          };
        }
        if (table === "restaurant_inventory") {
          if (selected.trim() === "id")
            return { data: { id: eq.id }, error: null };
          return {
            data: { master_wine_id: "lib-1", wine_name: "Barolo" },
            error: null,
          };
        }
        return { data: shape === "many" ? [] : null, error: null };
      };

      const q: any = {
        select(cols?: string) {
          if (op === "select" && typeof cols === "string") selected = cols;
          return q;
        },
        eq(k: string, v: any) {
          eq[k] = v;
          return q;
        },
        is(k: string, v: any) {
          if (v === null) isNull.push(k);
          return q;
        },
        neq(k: string, v: any) {
          neq[k] = v;
          return q;
        },
        in(k: string, v: any[]) {
          inList[k] = v;
          return q;
        },
        not: () => q,
        gt: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        insert(p: Row) {
          op = "insert";
          payload = p;
          return q;
        },
        update(p: Row) {
          op = "update";
          payload = p;
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
      if (name === "apply_stock_movement") {
        // The real primitive: a key it has seen returns the old movement.
        if (seenKeys.has(args.p_idempotency_key))
          return { data: null, error: null };
        seenKeys.add(args.p_idempotency_key);
        ledger.push({
          id: `m-${ledger.length + 1}`,
          order_id: args.p_order_id,
          inventory_id: args.p_inventory_id,
          quantity_change: args.p_delta,
          idempotency_key: args.p_idempotency_key,
        });
      }
      return { data: { lots_matched: 1, lots_revalued: 1 }, error: null };
    },
    storage: { from: () => ({}) },
  };

  const db = {
    supabase,
    getClient: () => supabase,
    client: supabase,
  } as unknown as DatabaseService;
  const shelf = () => ledger.reduce((s, r) => s + r.quantity_change, 0);
  return { db, ledger, credits, shelf };
}

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledgerSvc = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;
const service = (db: DatabaseService) =>
  new ProcurementService(db, events, ledgerSvc);

function twelveBottleOrder(): Row {
  return {
    id: ORDER,
    order_number: "ORD-1",
    restaurant_id: REST,
    inventory_id: ITEM,
    provider_id: "prov-1",
    quantity: 12,
    bottles_total: 12,
    unit_type: "bottle",
    final_price: 40,
    status: "DELIVERED",
    delivery_notes: null,
  };
}

/** A phone count: bottles only, no invoice figures. */
const count = (accepted: number) => ({
  countedUom: "bottle",
  acceptedQuantityInCountedUom: accepted,
  rejectedQuantityInCountedUom: 0,
});

/** A desk check with the invoice: 12 billed at $40. */
const desk = (accepted: number) => ({
  ...count(accepted),
  invoiceUom: "bottle",
  invoiceQuantityInInvoiceUom: 12,
  invoiceUnitPrice: 40,
  invoiceCurrency: "USD",
});

const MANAGER = { role: "manager" };

describe("F-464 — each verification moves stock; a replay does not", () => {
  it("truck one 6, truck two 12: the shelf holds 12", async () => {
    const { db, shelf } = makeDb(twelveBottleOrder());
    await service(db).verifyReceipt(
      REST,
      ORDER,
      USER,
      count(6) as any,
      MANAGER,
    );
    expect(shelf()).toBe(6);
    await service(db).verifyReceipt(
      REST,
      ORDER,
      USER,
      count(12) as any,
      MANAGER,
    );
    expect(shelf()).toBe(12);
  });

  it("a re-check that finds one more broken bottle moves the shelf down by one", async () => {
    const { db, shelf } = makeDb(twelveBottleOrder());
    await service(db).verifyReceipt(
      REST,
      ORDER,
      USER,
      count(12) as any,
      MANAGER,
    );
    await service(db).verifyReceipt(
      REST,
      ORDER,
      USER,
      count(11) as any,
      MANAGER,
    );
    expect(shelf()).toBe(11);
  });

  it("back and forth (6, 12, 6, 12) never drops a movement", async () => {
    const { db, shelf } = makeDb(twelveBottleOrder());
    for (const n of [6, 12, 6, 12]) {
      await service(db).verifyReceipt(
        REST,
        ORDER,
        USER,
        count(n) as any,
        MANAGER,
      );
      expect(shelf()).toBe(n);
    }
  });

  it("the same verification sent twice moves stock once", async () => {
    const { db, shelf, ledger } = makeDb(twelveBottleOrder());
    await service(db).verifyReceipt(
      REST,
      ORDER,
      USER,
      count(6) as any,
      MANAGER,
    );
    await service(db).verifyReceipt(
      REST,
      ORDER,
      USER,
      count(6) as any,
      MANAGER,
    );
    expect(shelf()).toBe(6);
    expect(ledger).toHaveLength(1);
  });

  it("two copies racing on the same ledger share one key, so only one books", async () => {
    const { db, shelf } = makeDb(twelveBottleOrder());
    await Promise.all([
      service(db).verifyReceipt(REST, ORDER, USER, count(6) as any, MANAGER),
      service(db).verifyReceipt(REST, ORDER, USER, count(6) as any, MANAGER),
    ]);
    expect(shelf()).toBe(6);
  });
});

describe("F-465 — one open claim per order and reason; a later check restates or closes it", () => {
  it("re-verifying the same short delivery keeps one open claim", async () => {
    const { db, credits } = makeDb(twelveBottleOrder());
    await service(db).verifyReceipt(REST, ORDER, USER, desk(8) as any, MANAGER);
    await service(db).verifyReceipt(REST, ORDER, USER, desk(8) as any, MANAGER);
    const open = credits.filter((c) => c.state === "open");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ reason: "qty_short", claimed_amount: 160 });
  });

  it("a later check that is shorter by less restates the open claim's amount", async () => {
    const { db, credits } = makeDb(twelveBottleOrder());
    await service(db).verifyReceipt(REST, ORDER, USER, desk(8) as any, MANAGER);
    await service(db).verifyReceipt(
      REST,
      ORDER,
      USER,
      desk(10) as any,
      MANAGER,
    );
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ state: "open", claimed_amount: 80 });
  });

  it("truck two brings the four: the clean check writes the open claim off, saying why", async () => {
    const { db, credits } = makeDb(twelveBottleOrder());
    await service(db).verifyReceipt(REST, ORDER, USER, desk(8) as any, MANAGER);
    await service(db).verifyReceipt(
      REST,
      ORDER,
      USER,
      desk(12) as any,
      MANAGER,
    );
    expect(credits).toHaveLength(1);
    expect(credits[0].state).toBe("written_off");
    expect(credits[0].notes).toMatch(/later check of this delivery/);
    expect(credits[0].settled_by).toBe(USER);
  });

  it("a count with no invoice closes nothing: it cannot say what is owed", async () => {
    const { db, credits } = makeDb(twelveBottleOrder());
    await service(db).verifyReceipt(REST, ORDER, USER, desk(8) as any, MANAGER);
    await service(db).verifyReceipt(
      REST,
      ORDER,
      USER,
      count(8) as any,
      MANAGER,
    );
    expect(credits).toHaveLength(1);
    expect(credits[0].state).toBe("open");
  });

  it("a claim already asked of the vendor is left alone and no second one opens", async () => {
    const { db, credits } = makeDb(twelveBottleOrder());
    await service(db).verifyReceipt(REST, ORDER, USER, desk(8) as any, MANAGER);
    credits[0].state = "requested";
    await service(db).verifyReceipt(REST, ORDER, USER, desk(8) as any, MANAGER);
    expect(credits).toHaveLength(1);
    expect(credits[0].state).toBe("requested");
  });
});

describe("F-466 — staff record the count; the money is an owner's or a manager's", () => {
  const moneyPayloads: [string, Row][] = [
    [
      "the invoice price",
      {
        ...count(12),
        invoiceUom: "bottle",
        invoiceUnitPrice: 40,
        invoiceCurrency: "USD",
      },
    ],
    [
      "the invoice quantity",
      { ...count(12), invoiceUom: "bottle", invoiceQuantityInInvoiceUom: 12 },
    ],
    [
      "the invoice quantity (old name)",
      { ...count(12), invoiceUom: "bottle", invoiceQuantity: 12 },
    ],
    [
      "an override reason",
      { ...count(12), priceOverrideReason: "agreed on the phone" },
    ],
    ["delivery charges", { ...count(12), allocatedCharges: 15 }],
  ];

  it.each(moneyPayloads)(
    "staff posting %s is refused and nothing is written",
    async (_label, body) => {
      const order = twelveBottleOrder();
      const { db, ledger, credits } = makeDb(order);
      const run = service(db).verifyReceipt(REST, ORDER, USER, body as any, {
        role: "staff",
      });
      await expect(run).rejects.toBeInstanceOf(ForbiddenException);
      await expect(run).rejects.toThrow(
        /owner's or a manager's job, so nothing was saved/,
      );
      expect(ledger).toHaveLength(0);
      expect(credits).toHaveLength(0);
      expect(order.status).toBe("DELIVERED");
    },
  );

  it("a session with no role at the house is refused the money too", async () => {
    const { db } = makeDb(twelveBottleOrder());
    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, desk(8) as any, {
        role: null,
      }),
    ).rejects.toThrow(/could not be shown to hold a role/);
  });

  it("staff may still record the bottle count", async () => {
    const { db, shelf } = makeDb(twelveBottleOrder());
    await service(db).verifyReceipt(REST, ORDER, USER, count(12) as any, {
      role: "staff",
    });
    expect(shelf()).toBe(12);
  });

  it.each(["owner", "manager", "admin"])(
    "%s may record the invoice and open the claim",
    async (role) => {
      const { db, credits } = makeDb(twelveBottleOrder());
      await service(db).verifyReceipt(REST, ORDER, USER, desk(8) as any, {
        role,
      });
      expect(credits).toHaveLength(1);
    },
  );
});
