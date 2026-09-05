/**
 * The register's own-paper dedup probe, when the probe itself cannot be read.
 *
 * `recordOwnPaperSighting` asks `vendor_price_observations` whether this exact
 * `(source_ref, content_hash)` is already on the register, and writes only if it
 * is not. That probe used to bind `data` and drop `error`. supabase-js RESOLVES
 * with `{ data, error }` — it never throws — so a failed probe arrived as
 * `data: null`, which `maybeSingle()` also returns for "no such row". The guard
 * therefore FAILED OPEN: on any transport hiccup it read "not on the register
 * yet" and inserted a row it had no evidence was new. That is the same failure
 * `providers.service.ts` shipped to production against its 409 dedup.
 *
 * The honest failure is a refusal: if we cannot tell whether the sighting is
 * already there, we do not write it, and the sentence "Could not record the
 * price sighting" is logged with the order and the source. A price register is
 * evidence; a row that may be a duplicate of itself is not.
 *
 * These cases fail against the pre-fix file (`git show HEAD:` copy): there the
 * insert goes through and no warning is logged.
 */

import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { Logger } from "@nestjs/common";

type Row = Record<string, any>;

const REST = "rest-1";
const ORDER = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";
const INVENTORY = "11111111-1111-4111-8111-111111111111";
const WINE = "55555555-5555-4555-8555-555555555555";

function makeDb(opts: { orderRow: Row; dedupProbeFails: boolean }) {
  const sightingInserts: Row[] = [];

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" | "delete" = "select";
      let selectedColumns = "";
      const filters: Record<string, any> = {};

      const settle = (shape: "one" | "many"): Row => {
        if (table === "procurement_orders") {
          if (op === "update") return { data: opts.orderRow, error: null };
          return { data: opts.orderRow, error: null };
        }
        if (table === "procurement_order_items")
          return { data: null, error: null };

        if (table === "restaurant_inventory") {
          if (selectedColumns.trim() === "id")
            return { data: { id: filters.id }, error: null };
          return {
            data: {
              master_wine_id: WINE,
              bottle_size_ml: 750,
              wine_name: "Barolo Riserva",
              shadow_stock: 0,
              in_transit_quantity: 0,
            },
            error: null,
          };
        }

        if (table === "vendor_price_observations") {
          if (selectedColumns.trim() === "id") {
            // THE PROBE. Failing here is the whole subject of this file.
            if (opts.dedupProbeFails)
              return {
                data: null,
                error: { message: "canceling statement due to statement timeout" },
              };
            return { data: null, error: null };
          }
          // The outlier population read: empty, and honestly so.
          return { data: [], error: null };
        }

        return { data: shape === "many" ? [] : null, error: null };
      };

      const q: any = {
        select(cols?: string) {
          if (op === "select" && typeof cols === "string") selectedColumns = cols;
          return q;
        },
        eq(col: string, value: any) {
          filters[col] = value;
          return q;
        },
        neq: () => q,
        not: () => q,
        or: () => q,
        in: () => q,
        is: () => q,
        gt: () => q,
        gte: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        insert(payload: Row) {
          op = "insert";
          if (table === "vendor_price_observations") sightingInserts.push(payload);
          return q;
        },
        update() {
          op = "update";
          return q;
        },
        delete: () => {
          op = "delete";
          return q;
        },
        single: async () => settle("one"),
        maybeSingle: async () => settle("one"),
        then: (res: any, rej: any) => Promise.resolve(settle("many")).then(res, rej),
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
  return { db, sightingInserts };
}

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledger = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;

const deliveredOrder = {
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
  delivery_notes: null,
  providers: { name: "Vinos Iberia", contact_email: null },
};

const verifyBody = {
  invoiceQuantity: 10,
  invoiceUnitPrice: 40,
  acceptedQuantity: 10,
} as any;

describe("own-paper sighting — a dedup probe that could not be read is not a clear one", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("writes NOTHING and says why when the probe fails", async () => {
    const { db, sightingInserts } = makeDb({
      orderRow: deliveredOrder,
      dedupProbeFails: true,
    });

    await new ProcurementService(db, events, ledger).verifyReceipt(
      REST,
      ORDER,
      USER,
      verifyBody,
    );

    // The guard fails CLOSED. Pre-fix this array had one row: a sighting the
    // code had no evidence was new.
    expect(sightingInserts).toHaveLength(0);

    const said = warn.mock.calls
      .map((c) => c.map((a: unknown) => JSON.stringify(a)).join(" "))
      .join("\n");
    expect(said).toContain("Could not record the price sighting");
    expect(said).toContain("statement timeout");
  });

  it("still writes when the probe reads cleanly and finds nothing", async () => {
    const { db, sightingInserts } = makeDb({
      orderRow: deliveredOrder,
      dedupProbeFails: false,
    });

    await new ProcurementService(db, events, ledger).verifyReceipt(
      REST,
      ORDER,
      USER,
      verifyBody,
    );

    // The control: the refusal above is the read failing, not the fix
    // suppressing every write.
    expect(sightingInserts).toHaveLength(1);
    expect(sightingInserts[0].restaurant_id).toBe(REST);
    expect(sightingInserts[0].source_type).toBe("invoice");
  });
});
