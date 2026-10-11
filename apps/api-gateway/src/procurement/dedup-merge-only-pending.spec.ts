import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { GATES_AFTER_LEDGER } from "./testing/passing-vendor-gates";

/**
 * F-1131 (rehit of F-109): `createOrder`'s dedup merge folds a re-quote into
 * the house's open order for the same wine and vendor. It excluded seven
 * "terminal" statuses and so rewrote an APPROVED, APPROVAL_NEEDED,
 * NEGOTIATING or PARTIALLY_RECEIVED order — quantity and price changed on a
 * sealed order with no new seal. It now merges only into PENDING, on the
 * lookup and on the write.
 *
 * The stub answers `procurement_orders` by the filters it was given (eq, in,
 * not-in), so a lookup that dropped its status filter would find the sealed
 * row and the test would see the UPDATE. Every write to `procurement_orders`
 * answers an error, which stops `createOrder` right after the fork this spec
 * is about: the assertions are on WHICH write was attempted.
 */

type Row = Record<string, any>;

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENDOR = "11111111-1111-4111-8111-111111111111";
const USER = "44444444-4444-4444-8444-444444444444";

function makeDb(orders: Row[], opts: { updateFindsNothing?: boolean } = {}) {
  const writes: Array<{ kind: "update" | "insert"; filters: unknown[] }> = [];

  const supabase: any = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let head = false;
      let write: "update" | "insert" | null = null;

      const matches = (r: Row) =>
        filters.every(([op, col, val]) => {
          if (op === "eq") return r[col] === val;
          if (op === "in") return (val as unknown[]).includes(r[col]);
          if (op === "not-in") {
            const list = String(val).replace(/[()]/g, "").split(",");
            return !list.includes(r[col]);
          }
          return true;
        });

      const settle = (one: boolean) => {
        if (table === "restaurant_inventory") {
          return { data: { id: "inv-1", restaurant_id: HOUSE }, error: null };
        }
        if (table === "providers") {
          const row = { id: VENDOR, restaurant_id: HOUSE, is_active: true };
          return {
            data: head ? null : one ? row : [row],
            count: 1,
            error: null,
          };
        }
        if (table === "procurement_orders") {
          if (write) {
            writes.push({ kind: write, filters: [...filters] });
            if (write === "update" && opts.updateFindsNothing) {
              return { data: null, error: null };
            }
            return { data: null, error: { message: `stop at ${write}` } };
          }
          const rows = orders.filter(matches);
          return { data: one ? (rows[0] ?? null) : rows, error: null };
        }
        return {
          data: null,
          error: { message: `unexpected read of ${table}` },
        };
      };

      const q: any = {
        select: (_cols?: string, o?: { head?: boolean }) => {
          head = Boolean(o?.head);
          return q;
        },
        eq: (col: string, val: unknown) => {
          filters.push(["eq", col, val]);
          return q;
        },
        in: (col: string, val: unknown[]) => {
          filters.push(["in", col, val]);
          return q;
        },
        not: (col: string, op: string, val: unknown) => {
          if (op === "in") filters.push(["not-in", col, val]);
          return q;
        },
        neq: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        insert: () => {
          write = "insert";
          return q;
        },
        update: () => {
          write = "update";
          return q;
        },
        single: async () => settle(true),
        maybeSingle: async () => settle(true),
        then: (res: any, rej: any) =>
          Promise.resolve(settle(false)).then(res, rej),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };

  const db = {
    supabase,
    getClient: () => supabase,
    client: supabase,
  } as unknown as DatabaseService;
  return { db, writes };
}

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledger = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;

const service = (db: DatabaseService) =>
  new ProcurementService(db, events, ledger, ...GATES_AFTER_LEDGER);

const reQuote = {
  inventoryId: "inv-1",
  providerId: VENDOR,
  quantity: 12,
  unitType: "bottles",
  finalPrice: 20,
} as any;

const openOrder = (status: string): Row => ({
  id: `order-${status}`,
  restaurant_id: HOUSE,
  inventory_id: "inv-1",
  provider_id: VENDOR,
  status,
  quantity: 6,
});

describe("createOrder's dedup merge folds only into a PENDING order (F-1131)", () => {
  it.each(["APPROVED", "APPROVAL_NEEDED", "NEGOTIATING", "PARTIALLY_RECEIVED"])(
    "never rewrites a %s order — the re-quote becomes a new order",
    async (status) => {
      const { db, writes } = makeDb([openOrder(status)]);
      await expect(
        service(db).createOrder(HOUSE, USER, reQuote),
      ).rejects.toBeTruthy();
      expect(writes.map((w) => w.kind)).toEqual(["insert"]);
    },
  );

  it("still folds a re-quote into the open PENDING order, and only while it is PENDING", async () => {
    const { db, writes } = makeDb([openOrder("PENDING")]);
    await expect(
      service(db).createOrder(HOUSE, USER, reQuote),
    ).rejects.toBeTruthy();
    expect(writes.map((w) => w.kind)).toEqual(["update"]);
    expect(writes[0].filters).toContainEqual(["in", "status", ["PENDING"]]);
  });

  it("places a new order when the PENDING order was approved between the lookup and the write", async () => {
    const { db, writes } = makeDb([openOrder("PENDING")], {
      updateFindsNothing: true,
    });
    await expect(
      service(db).createOrder(HOUSE, USER, reQuote),
    ).rejects.toBeTruthy();
    expect(writes.map((w) => w.kind)).toEqual(["update", "insert"]);
  });
});
