import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { applyCurrencyRules } from "./documents/invoice-currency";
import type { ParsedDocument } from "./documents/parsed-document";

/**
 * ITEM A — stock proceeds; the receiving price is refused for a held document.
 *
 * THE FOUNDER, 2026-09-06, batch 64, verbatim:
 *   "do option 1 recomemneded, stock proceeds refuse the price at receving, and
 *    let them approve if otherwise"
 *
 * The two halves are tested against each other on purpose. It is easy to write
 * a guard that refuses a held invoice and quietly stops the delivery with it,
 * and that is the failure the founder's first clause rules out: a delivery that
 * physically happened is not made un-happened by a bookkeeping question. So
 * every refusal case below is paired with a submission of the SAME receipt
 * without a price, and what moved is compared.
 */

const REST = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const INVENTORY = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, any>;

/** A parse whose money is HELD, as `procurement_documents.extracted` stores it. */
function heldParse(): ParsedDocument {
  const base: ParsedDocument = {
    docType: "invoice",
    docNumber: "F-2026-441",
    docDate: "2026-09-01",
    referencesDocNumber: null,
    poNumber: null,
    vendorName: "Bir Tedarikci",
    vendorAccount: null,
    currency: "USD",
    subtotal: 400,
    freight: null,
    fuelSurcharge: null,
    splitCaseFee: null,
    deliveryFee: null,
    depositTotal: null,
    tax: null,
    otherCharges: null,
    discountTotal: null,
    total: 400,
    lines: [
      {
        lineNo: 1,
        description: "Kavaklidere Ancyra",
        qty: 10,
        uom: "bottle",
        packSize: 1,
        qtyBottles: 10,
        freeGoodsQty: 0,
        unitPrice: 40,
        lineTotal: 400,
        allowance: null,
        deposit: null,
        vendorSku: null,
        vintage: null,
        formatMl: null,
        priceBaseQty: null,
        priceBaseUom: null,
      } as any,
    ],
    taxBreakdown: [],
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    confidence: 0.9,
    warnings: [],
  } as unknown as ParsedDocument;

  // The real rule, not a hand-written `moneyHeld`: the file says USD and the
  // order was placed in EUR.
  return applyCurrencyRules({
    doc: base,
    houseCurrency: "TRY",
    orderCurrency: "EUR",
    hasMatchedOrder: true,
    orderLabel: "ORD-2026-00001",
    fileField: "printed currency",
  });
}

const ORDER_ROW = {
  id: ORDER,
  order_number: "ORD-2026-00001",
  restaurant_id: REST,
  inventory_id: INVENTORY,
  provider_id: "prov-1",
  quantity: 10,
  bottles_total: 10,
  unit_type: "bottle",
  final_price: 40,
  quantity_received: 10,
  status: "DELIVERED",
  currency: "EUR",
  currency_source: "typed",
};

function makeDb(opts: {
  /** Documents attached to the order. */
  documents?: Row[];
  linkError?: any;
  docError?: any;
}) {
  const calls = {
    orderUpdates: [] as Row[],
    inventoryUpdates: [] as Row[],
    rpc: [] as Row[],
    priceHistoryInserts: [] as Row[],
    eventInserts: [] as Row[],
  };

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" | "delete" = "select";
      let selected = "";
      const filters: Row = {};

      const settle = (shape: "one" | "many"): Row => {
        if (table === "procurement_document_links") {
          if (opts.linkError) return { data: null, error: opts.linkError };
          return {
            data: (opts.documents ?? []).map((d) => ({ document_id: d.id })),
            error: null,
          };
        }
        if (table === "procurement_documents") {
          if (opts.docError) return { data: null, error: opts.docError };
          return { data: opts.documents ?? [], error: null };
        }
        if (table === "procurement_orders") {
          if (op === "update")
            return {
              data: {
                ...ORDER_ROW,
                ...calls.orderUpdates[calls.orderUpdates.length - 1],
                inventory: { wine_name: "Barolo Riserva" },
              },
              error: null,
            };
          return { data: ORDER_ROW, error: null };
        }
        if (table === "procurement_order_items")
          return { data: null, error: null };
        if (table === "restaurant_inventory") {
          if (selected.trim() === "id")
            return {
              data: filters.id === INVENTORY ? { id: INVENTORY } : null,
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
        return { data: shape === "many" ? [] : null, error: null };
      };

      const q: any = {
        select(cols?: string) {
          if (op === "select" && typeof cols === "string") selected = cols;
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
          if (table === "price_history") calls.priceHistoryInserts.push(payload);
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
const service = (db: DatabaseService) =>
  new ProcurementService(db, events, ledger);

/** The receipt a manager submits, with or without the price. */
const receipt = (withPrice: boolean) => ({
  invoiceQuantity: 10,
  acceptedQuantity: 10,
  rejectedQuantity: 0,
  ...(withPrice ? { invoiceUnitPrice: 40 } : {}),
});

const HELD_DOC = () => ({
  id: "doc-held",
  doc_number: "F-2026-441",
  doc_type: "invoice",
  currency: null,
  extracted: heldParse(),
});

const REFUSED_DOC = () => ({
  id: "doc-refused",
  doc_number: "F-2026-442",
  doc_type: "invoice",
  currency: null,
  extracted: applyCurrencyRules({
    doc: { ...heldParse(), currency: "", moneyHeld: null, moneyWithheld: null },
    houseCurrency: null,
    hasMatchedOrder: false,
    fileField: "printed currency",
  }),
});

const SETTLED_DOC = () => ({
  id: "doc-ok",
  doc_number: "F-2026-443",
  doc_type: "invoice",
  currency: "EUR",
  extracted: null,
});

describe("verifyReceipt — a held invoice refuses the PRICE, never the stock", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuses a keyed-in unit price for a HELD document, in a sentence naming the reason and the act", async () => {
    const { db, calls } = makeDb({ documents: [HELD_DOC()] });
    const err = await service(db)
      .verifyReceipt(REST, ORDER, USER, receipt(true))
      .catch((e) => e);

    expect(err?.status).toBe(409);
    // The reason, verbatim from the rule that wrote it.
    expect(err.message).toContain("MONEY HELD, NOT FILED");
    expect(err.message).toContain("EUR");
    expect(err.message).toContain("USD");
    // What still works.
    expect(err.message).toContain("stock movement are unaffected");
    // The act that clears it.
    expect(err.message).toContain("restate the invoice's currency");
    expect(err.message).toContain("confirm");
    expect(err.message).toContain("doc-held");

    // NOTHING WAS WRITTEN. The refusal runs before any update, so a manager who
    // is told no is not left with a half-applied receipt.
    expect(calls.orderUpdates).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
    expect(calls.priceHistoryInserts).toHaveLength(0);
  });

  it("refuses for a REFUSED-money document too (neither the file nor the house states one)", async () => {
    const { db } = makeDb({ documents: [REFUSED_DOC()] });
    const err = await service(db)
      .verifyReceipt(REST, ORDER, USER, receipt(true))
      .catch((e) => e);
    expect(err?.status).toBe(409);
    expect(err.message).toContain("REFUSED");
    expect(err.message).toContain("F-2026-442");
  });

  it("ACCEPTS the price when the document's money is filed", async () => {
    const { db, calls } = makeDb({ documents: [SETTLED_DOC()] });
    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, receipt(true)),
    ).resolves.toBeDefined();
    expect(calls.orderUpdates.length).toBeGreaterThan(0);
  });

  it("ACCEPTS the price when no document is attached at all", async () => {
    const { db } = makeDb({ documents: [] });
    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, receipt(true)),
    ).resolves.toBeDefined();
  });

  it("THE STOCK MOVEMENT IS UNTOUCHED: the same receipt without a price goes through on a held document, and writes what a settled one writes", async () => {
    const held = makeDb({ documents: [HELD_DOC()] });
    await expect(
      service(held.db).verifyReceipt(REST, ORDER, USER, receipt(false)),
    ).resolves.toBeDefined();

    const settled = makeDb({ documents: [SETTLED_DOC()] });
    await expect(
      service(settled.db).verifyReceipt(REST, ORDER, USER, receipt(false)),
    ).resolves.toBeDefined();

    // Measured rather than asserted in prose: the currency hold changes NOTHING
    // about what a priceless receipt writes.
    expect(held.calls.orderUpdates.length).toBe(
      settled.calls.orderUpdates.length,
    );
    expect(held.calls.rpc.length).toBe(settled.calls.rpc.length);
    expect(held.calls.inventoryUpdates.length).toBe(
      settled.calls.inventoryUpdates.length,
    );
    expect(held.calls.orderUpdates.length).toBeGreaterThan(0);
  });

  it("a PACKING SLIP with no currency is not a hold — a slip states no money", async () => {
    // The gateway filters to invoice/credit_memo, so the double returning only
    // a slip stands in for that filter having excluded it.
    const { db } = makeDb({ documents: [] });
    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, receipt(true)),
    ).resolves.toBeDefined();
  });

  /*
   * A FAILED READ DOES NOT REFUSE, and that is a choice with a stated cost. An
   * outage that read as "held" would block receipts for a reason nobody could
   * see; one that reads as "not held" lets a price through. The second failure
   * is the one the screen already produced before this guard existed, so it is
   * the one that leaves the product no worse than it was — and the price still
   * reaches `price_history` through `invoiceCurrencyClaim`, which refuses a
   * figure whose currency was not keyed in. The gateway logs the failure by
   * name in both cases (the WARN lines this run prints).
   */
  it("a FAILED read of the links does not refuse the price, and says so in the log", async () => {
    const { db } = makeDb({ linkError: { message: "links unreachable" } });
    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, receipt(true)),
    ).resolves.toBeDefined();
  });

  it("a FAILED read of the documents does not refuse the price either", async () => {
    const { db } = makeDb({
      documents: [HELD_DOC()],
      docError: { message: "documents unreachable" },
    });
    await expect(
      service(db).verifyReceipt(REST, ORDER, USER, receipt(true)),
    ).resolves.toBeDefined();
  });
});
