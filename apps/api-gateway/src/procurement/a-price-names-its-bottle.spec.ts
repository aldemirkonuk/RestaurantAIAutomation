/**
 * A priced row names the bottle it priced — ADR 0124 Q5, founder 2026-09-05:
 * *"Yes, identity_id on `price_history` now."*
 *
 * WHAT THIS FILE PROVES, AND WHY IT HAD TO BE THE WRITER
 * -----------------------------------------------------
 * `20260906060000_a_price_names_the_bottle_it_priced.sql` added
 * `price_history.identity_id` and backfilled it once through the row's
 * `master_wine_id` where a `mudavym:master_wine_library` key named EXACTLY ONE
 * identity. A backfill is a one-time act. `recordPriceHistory` — the table's
 * only writer — did not name the column at all, so every row written from that
 * migration onwards would have carried NULL forever, and the ladder would have
 * been keyed on a column that stopped filling the day it was created.
 *
 * THE PRE-FIX TREE, MEASURED RATHER THAN REMEMBERED
 * -------------------------------------------------
 * Nothing is reverted — this worktree is shared. The pre-fix insert is
 * transcribed from a copy taken with
 *   `git show HEAD:apps/api-gateway/src/procurement/procurement.service.ts >
 *    /Users/aldemirkonuk/Projects/p4-scratch/prefix-price-identity/procurement.service.prefix.ts`
 * at `c2c5725e` (298,781 bytes). Measured on that copy:
 *   `grep -c identity_id procurement.service.prefix.ts`  ->  0
 * — not "absent from the insert", absent from the whole file. The insert at
 * `procurement.service.prefix.ts:1434` names eleven keys and `identity_id` is
 * not among them; `PRE_FIX_PRICE_HISTORY_KEYS` below is that list, in file
 * order.
 *
 * THE THREE CASES, AND THE ONE RULE BEHIND THEM
 * ---------------------------------------------
 * The writer resolves through `joinByExactKey`, IMPORTED from
 * `vendor-intel/identity-join.ts` rather than re-implemented, which is the
 * backfill's `having count(distinct k.identity_id) = 1` in TypeScript:
 *
 *   one identity   -> written        (a price that names its bottle)
 *   two identities -> NULL + warning (an ambiguous key is a refusal, ADR 0124)
 *   no identity    -> NULL, silent   (the ordinary state of an empty register)
 *   read failed    -> NULL + warning AND THE PRICE IS STILL WRITTEN
 *
 * The last of those is the one that decides whether this is honest. A register
 * that could not be read has told us nothing about the bottle, so the row says
 * NULL and the log says why — but a failed analytics read must never cost the
 * house the record of what it paid.
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
const IDENTITY_750 = "77777777-7777-4777-8777-777777777777";
const IDENTITY_MAGNUM = "88888888-8888-4888-8888-888888888888";

/**
 * The nine keys the pre-fix insert named, transcribed in file order from
 * `procurement.service.prefix.ts:1434-1471` at `c2c5725e`. Nothing here is
 * imported from the working copy.
 */
const PRE_FIX_PRICE_HISTORY_KEYS = [
  "restaurant_id",
  "master_wine_id",
  "provider_id",
  "price",
  "quantity",
  "unit",
  "currency",
  "effective_date",
  "source",
  "order_id",
  "notes",
] as const;

type RegisterState = "one_identity" | "ambiguous" | "no_identity" | "unreadable";

function makeDb(opts: { orderRow: Row; register: RegisterState }) {
  const priceInserts: Row[] = [];

  const identityKeyRows = (): Row[] => {
    if (opts.register === "one_identity")
      return [
        {
          identity_id: IDENTITY_750,
          key_namespace: "mudavym:master_wine_library",
          key_class: "source_local",
          key_value: WINE,
        },
      ];
    if (opts.register === "ambiguous")
      return [
        {
          identity_id: IDENTITY_750,
          key_namespace: "mudavym:master_wine_library",
          key_class: "source_local",
          key_value: WINE,
        },
        {
          identity_id: IDENTITY_MAGNUM,
          key_namespace: "mudavym:master_wine_library",
          key_class: "source_local",
          key_value: WINE,
        },
      ];
    return [];
  };

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" | "delete" = "select";
      let selectedColumns = "";
      const filters: Record<string, any> = {};

      const settle = (shape: "one" | "many"): Row => {
        if (table === "procurement_orders") return { data: opts.orderRow, error: null };
        if (table === "procurement_order_items") return { data: null, error: null };

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

        if (table === "beverage_identity_keys") {
          // THE REGISTER. Its four states are the subject of this file.
          if (opts.register === "unreadable")
            return {
              data: null,
              error: { message: "canceling statement due to statement timeout" },
            };
          return { data: identityKeyRows(), error: null };
        }

        if (table === "vendor_price_observations") {
          if (selectedColumns.trim() === "id") return { data: null, error: null };
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
          if (table === "price_history") priceInserts.push(payload);
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
  return { db, priceInserts };
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
  // ADR 0117 Q25: a sighting without its currency is refused, so the fixture
  // states one — this file is about identity, not about currency.
  invoiceCurrency: "USD",
  acceptedQuantity: 10,
} as any;

async function writeOnePrice(register: RegisterState) {
  const { db, priceInserts } = makeDb({ orderRow: deliveredOrder, register });
  await new ProcurementService(db, events, ledger).verifyReceipt(
    REST,
    ORDER,
    USER,
    verifyBody,
  );
  return priceInserts;
}

describe("a price names the bottle it priced (ADR 0124 Q5)", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const said = () =>
    warn.mock.calls
      .map((c) => c.map((a: unknown) => JSON.stringify(a)).join(" "))
      .join("\n");

  it("named no bottle at all before this pass", () => {
    // The pre-fix tree, transcribed. Not "it wrote NULL" — it never named the
    // column, and `identity_id` appears zero times in the whole 298,781-byte
    // file (`grep -c identity_id`, on the `git show HEAD:` copy at c2c5725e).
    expect(PRE_FIX_PRICE_HISTORY_KEYS).not.toContain("identity_id");
    expect(PRE_FIX_PRICE_HISTORY_KEYS).toHaveLength(11);
  });

  it("writes the identity when the library link names exactly one bottle", async () => {
    const inserts = await writeOnePrice("one_identity");

    expect(inserts).toHaveLength(1);
    expect(inserts[0].identity_id).toBe(IDENTITY_750);
    // The wine is still recorded beside it: one wine, one trade item, two
    // different questions, and the row answers both.
    expect(inserts[0].master_wine_id).toBe(WINE);
    // A resolved identity is not an event worth a line in the log, and it adds
    // nothing to the row's notes.
    expect(said()).not.toContain("carries no identity");
  });

  it("leaves the identity NULL when the key names more than one bottle", async () => {
    const inserts = await writeOnePrice("ambiguous");

    expect(inserts).toHaveLength(1);
    // The refusal, applied unattended. Picking `IDENTITY_750` because it sorted
    // first would be a coin toss recorded as a fact — Iowa's own file names
    // more than one product on 1,736 of its 9,118 UPCs.
    expect(inserts[0].identity_id).toBeNull();
    expect(inserts[0].identity_id).not.toBe(IDENTITY_750);
    expect(inserts[0].identity_id).not.toBe(IDENTITY_MAGNUM);
    // And the price survives the refusal untouched.
    expect(inserts[0].price).toBe(40);

    expect(said()).toContain("carries no identity");
    expect(said()).toContain("2 different identities");
    // The gap is on the ROW too, not only in a log nobody will read later.
    expect(inserts[0].notes).toContain("ambiguous key is a refusal");
  });

  it("still writes the price when the identity register cannot be read", async () => {
    const inserts = await writeOnePrice("unreadable");

    // THE POINT OF THE WHOLE BRANCH: an analytics read that failed must not
    // cost the house the record of what it paid.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].price).toBe(40);
    expect(inserts[0].unit).toBe("bottle");
    expect(inserts[0].identity_id).toBeNull();

    // A failed read is never an empty one. supabase-js resolves `{ data, error }`
    // and never throws, so "no rows came back" and "we could not ask" are the
    // same shape and must not be the same sentence.
    const log = said();
    expect(log).toContain("the identity register could not be read");
    expect(log).toContain("statement timeout");
    expect(log).toContain("UNKNOWN");
    expect(inserts[0].notes).toContain("unknown, not unidentified");
  });

  it("leaves NULL without a word when nobody has identified this wine yet", async () => {
    const inserts = await writeOnePrice("no_identity");

    // The ordinary case today: `beverage_identities` holds 0 rows in
    // production because every identity is an assertion somebody makes. A
    // warning here would fire on every price the platform records.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].identity_id).toBeNull();
    expect(said()).not.toContain("carries no identity");
    // Nothing is appended to the notes either: the NULL is the fact, and the
    // column comment obliges the reader to print it as "unidentified".
    expect(String(inserts[0].notes ?? "")).not.toContain("Identity not resolved");
  });

  it("names identity_id explicitly on every row, whatever the answer", async () => {
    // Never a conditional spread. The key is present in all four states, so the
    // capture-contract guard can read what this write claims and no row reaches
    // the table with the column simply missing.
    for (const state of [
      "one_identity",
      "ambiguous",
      "no_identity",
      "unreadable",
    ] as RegisterState[]) {
      const inserts = await writeOnePrice(state);
      expect(Object.keys(inserts[0])).toContain("identity_id");
    }
  });
});
