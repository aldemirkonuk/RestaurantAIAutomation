import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * Perf p8 s5. verifyReceipt used to read the held invoice, the booked bottles,
 * the order's units and the agreed line one after another, each waiting on the
 * last. They need only the order row, so they start together now. What must not
 * move: the held-invoice 409 stays first, the verdict is the one the serial code
 * gave, and the adjustment writes stay serial.
 */

type Row = Record<string, any>;
const REST = "rest-1";
const ORDER = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";
const INV = "11111111-1111-4111-8111-111111111111";

const order = {
  id: ORDER,
  order_number: "ORD-1",
  restaurant_id: REST,
  inventory_id: INV,
  provider_id: "prov-1",
  quantity: 10,
  bottles_total: 10,
  unit_type: "bottle",
  final_price: 40,
  status: "DELIVERED",
  delivery_notes: null,
};

/** A supabase stub whose four independent reads can be held shut and observed. */
function makeDb() {
  const started: string[] = [];
  const gates = new Map<string, Promise<void>>();
  const orderUpdates: Row[] = [];
  const hold = (table: string, gate: Promise<void>) => gates.set(table, gate);

  const supabase: any = {
    from(table: string) {
      let op = "select";
      const settle = async (): Promise<Row> => {
        if (op === "select") {
          started.push(table);
          const gate = gates.get(table);
          if (gate) await gate;
        }
        if (table === "procurement_orders")
          return op === "update"
            ? { data: { ...order, ...orderUpdates[orderUpdates.length - 1], inventory: { wine_name: "W" } }, error: null }
            : { data: order, error: null };
        if (table === "inventory_transactions")
          return { data: [{ id: "m1", quantity_change: 10 }], error: null };
        if (table === "restaurant_inventory")
          return { data: { master_wine_id: "55555555-5555-4555-8555-555555555555", wine_name: "W", shadow_stock: 0, in_transit_quantity: 0 }, error: null };
        return { data: null, error: null };
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
        insert: () => ((op = "insert"), q),
        update: (p: Row) => {
          op = "update";
          if (table === "procurement_orders") orderUpdates.push(p);
          return q;
        },
        delete: () => ((op = "delete"), q),
        single: settle,
        maybeSingle: settle,
        then: (res: any, rej: any) =>
          settle().then((r) => (r.data === null ? { ...r, data: [] } : r)).then(res, rej),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({}) },
  };
  const db = { supabase, getClient: () => supabase, client: supabase } as unknown as DatabaseService;
  return { db, started, hold, orderUpdates };
}

const events = { createEvent: jest.fn().mockResolvedValue({}) } as unknown as EventsService;
const ledger = { recordTransaction: jest.fn().mockResolvedValue({}) } as unknown as InventoryLedgerService;
const svc = (db: DatabaseService) => new ProcurementService(db, events, ledger);
const flush = () => new Promise((r) => setImmediate(r));

const body = {
  invoiceQuantity: 10,
  invoiceUom: "bottle",
  invoiceUnitPrice: 40,
  invoiceCurrency: "USD",
  acceptedQuantity: 10,
  countedUom: "bottle",
} as any;

describe("verifyReceipt starts its four order-row reads together", () => {
  it("has the ledger, order-line and held-invoice reads in flight before any one finishes", async () => {
    const { db, started, hold } = makeDb();
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    hold("inventory_transactions", gate);
    hold("procurement_order_items", gate);
    hold("procurement_document_links", gate);

    const run = svc(db).verifyReceipt(REST, ORDER, USER, body);
    await flush();

    // Serial code stopped at the first gated read (documents) and had started
    // neither of the others.
    expect(started).toEqual(
      expect.arrayContaining([
        "procurement_document_links",
        "inventory_transactions",
        "procurement_order_items",
      ]),
    );
    expect(started.filter((t) => t === "procurement_order_items")).toHaveLength(2);
    open();
    await run;
  });

  it("gives the same verdict as before: matched, and a price variance is refused", async () => {
    const a = makeDb();
    await svc(a.db).verifyReceipt(REST, ORDER, USER, body);
    expect(a.orderUpdates[0].match_status).toBe("matched");

    // A price off the agreed one is refused with the variance named, before any write.
    const b = makeDb();
    await expect(
      svc(b.db).verifyReceipt(REST, ORDER, USER, { ...body, invoiceUnitPrice: 55 }),
    ).rejects.toThrow(
      new UnprocessableEntityException(
        "Billed $55.00 against an agreed $40.00. Accept the price difference with a reason, or correct the invoice price.",
      ),
    );
    expect(b.orderUpdates).toEqual([]);
  });

  it("keeps the held-invoice 409 first and writes nothing", async () => {
    const { db, orderUpdates } = makeDb();
    const service = svc(db);
    jest.spyOn(service as any, "heldInvoiceForOrder").mockResolvedValue({
      reason: "currency_unknown",
      docNumber: "INV-9",
      documentId: "doc-1",
    });
    // The ledger read also fails; the 409 must still be what the caller sees.
    const supabase = (service as any).databaseService.supabase;
    const realFrom = supabase.from.bind(supabase);
    const fail = jest.spyOn(supabase, "from").mockImplementation(((t: string) => {
      if (t === "procurement_orders") return realFrom(t);
      throw new Error(`read ${t} failed`);
    }) as any);
    await expect(service.verifyReceipt(REST, ORDER, USER, body)).rejects.toBeInstanceOf(ConflictException);
    fail.mockRestore();
    expect(orderUpdates).toEqual([]);
  });

  it("starts no held-invoice read when no price was typed", async () => {
    const { db, started } = makeDb();
    await svc(db).verifyReceipt(REST, ORDER, USER, { acceptedQuantity: 10, countedUom: "bottle" } as any);
    expect(started).not.toContain("procurement_document_links");
  });
});
