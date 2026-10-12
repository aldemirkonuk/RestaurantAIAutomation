/**
 * F-1433: a sale that closed before the item's last count of every shelf,
 * but reached the hub after it (a nightly export, a till that synced late),
 * is already in that count. It moves no stock, its sale is kept, and the
 * import says so. A sale after the count is taken as before.
 *
 * F-1436: "count this bottle and correct its stock by hand" reaches the house
 * as an inbox note, not only the import's errors[], which a webhook's till
 * never reads.
 *
 * sim ledger S199 (integ18-bar-night, N1 and N4).
 */
import { Logger } from "@nestjs/common";
import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";
import { NotificationsService } from "../notifications/notifications.service";

type Row = Record<string, any>;

const CLOSED = "2026-07-14T22:30:00.000Z";
const COUNT_AFTER = "2026-07-14T23:00:00+00:00";
const COUNT_BEFORE = "2026-07-14T21:00:00+00:00";

function makeDb(inventory: Row[]) {
  const calls = {
    rpc: [] as Array<{ fn: string; args: Row }>,
    consumption: [] as Row[],
    reversed: [] as Row[],
  };
  const booked: Array<{ fn: string; args: Row }> = [];
  const logged = new Set<string>();
  const client: any = {
    from(table: string) {
      let update: Row | null = null;
      const q: any = {
        select: () => q,
        update: (row: Row) => {
          update = row;
          return q;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        eq: () => q,
        is: () => q,
        neq: () => q,
        in: async () => ({ data: [], error: null }),
        like: async () => {
          if (update) {
            calls.reversed.push({ table, ...update });
            return { data: null, error: null };
          }
          return {
            data:
              table === "inventory_transactions"
                ? booked
                    .filter((c) => c.fn === "apply_stock_movement")
                    .map((c) => ({
                      idempotency_key: c.args.p_idempotency_key,
                      inventory_id: c.args.p_inventory_id,
                      quantity_change: c.args.p_delta,
                    }))
                : table === "pour_events"
                  ? booked
                      .filter((c) => c.fn === "record_glass_pour")
                      .map((c) => ({
                        idempotency_key: c.args.p_idempotency_key,
                        inventory_id: c.args.p_inventory_id,
                        pours: c.args.p_pours,
                        pour_ml: c.args.p_pour_ml,
                      }))
                  : [],
            error: null,
          };
        },
        upsert: async () => ({ error: null }),
        insert: async (row: Row) => {
          if (table !== "wine_consumption_log") return { error: null };
          // The partial unique index on notes: a replay is a 23505.
          if (logged.has(row.notes))
            return { error: { code: "23505", message: "duplicate key" } };
          logged.add(row.notes);
          calls.consumption.push(row);
          return { error: null };
        },
      };
      if (table === "pos_item_mappings") {
        q.in = async () => ({ data: MAPPINGS, error: null });
      }
      if (table === "restaurant_inventory") {
        q.in = async (_col: string, ids: string[]) => ({
          data: inventory.filter((r) => ids.includes(r.id)),
          error: null,
        });
      }
      if (table === "restaurant_tables") {
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      }
      return q;
    },
    rpc: async (fn: string, args: Row) => {
      calls.rpc.push({ fn, args });
      booked.push({ fn, args });
      return { data: "tx-1", error: null };
    },
  };
  const persistForRestaurant = jest.fn(async () => ({
    inserted: 2,
    ids: ["n-1", "n-2"],
  }));
  const notifications = {
    persistForRestaurant,
  } as unknown as NotificationsService;
  return {
    service: new PosHubService(
      { getClient: () => client } as unknown as DatabaseService,
      undefined,
      notifications,
    ),
    calls,
    persistForRestaurant,
  };
}

const BOTTLE = {
  external_item_id: "btl-1",
  item_name: "SYNTHETIC Yakut bottle",
  is_wine: true,
  inventory_id: "inv-1",
  sale_unit: "bottle",
  sale_volume_ml: null,
};
const GLASS = {
  external_item_id: "gls-2",
  item_name: "SYNTHETIC Malbec glass",
  is_wine: true,
  inventory_id: "inv-2",
  sale_unit: null,
  sale_volume_ml: 150,
};
const MAPPINGS = [BOTTLE, GLASS];

const row = (id: string, lastCountedAt: string | null) => ({
  id,
  bottle_size_ml: 750,
  pour_size_ml: 150,
  last_counted_at: lastCountedAt,
});
const line = (m: Row, qty = 1) => ({
  name: m.item_name,
  externalItemId: m.external_item_id,
  qty,
  price: 10,
});
const check = (id: string, items: Row[], extra: Row = {}) => ({
  externalCheckId: id,
  openedAt: "2026-07-14T20:00:00Z",
  closedAt: CLOSED,
  items,
  ...extra,
});
const ingest = async (service: PosHubService, checks: Row[]) =>
  (await service.ingest("r-1", "generic_webhook", checks)) as any;

beforeEach(() => {
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("F-1433: a sale already in a count is not taken off it again", () => {
  it("a bottle sold before the count, imported after it, moves no stock and keeps its sale", async () => {
    const { service, calls } = makeDb([
      row("inv-1", COUNT_AFTER),
      row("inv-2", null),
    ]);
    const res = await ingest(service, [check("c-1", [line(BOTTLE, 2)])]);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.consumption).toHaveLength(1);
    expect(calls.consumption[0]).toMatchObject({ inventory_id: "inv-1" });
    expect(res.stock).toMatchObject({
      lines: 1,
      booked: 0,
      // A sub-count of alreadyBooked: the count already took it.
      alreadyBooked: 1,
      alreadyCounted: 1,
      failed: 0,
      notStock: 0,
    });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain('"SYNTHETIC Yakut bottle"');
    expect(res.errors[0]).toContain(
      "before the count of 2026-07-14 23:00 UTC, so that count already holds it",
    );
  });

  it("is idempotent: the same check sent again moves nothing and writes its sale once", async () => {
    const { service, calls } = makeDb([row("inv-1", COUNT_AFTER)]);
    await ingest(service, [check("c-2", [line(BOTTLE)])]);
    const again = await ingest(service, [check("c-2", [line(BOTTLE)])]);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.consumption).toHaveLength(1);
    expect(again.stock).toMatchObject({ booked: 0, alreadyCounted: 1 });
  });

  it("a glass sold before the count is not poured", async () => {
    const { service, calls } = makeDb([row("inv-2", COUNT_AFTER)]);
    const res = await ingest(service, [check("c-3", [line(GLASS, 3)])]);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.consumption).toHaveLength(1);
    expect(calls.consumption[0]).toMatchObject({ volume_ml: 450 });
    expect(res.stock.alreadyCounted).toBe(1);
  });

  it("a sale closed after the count is taken as before", async () => {
    const { service, calls } = makeDb([
      row("inv-1", COUNT_BEFORE),
      row("inv-2", COUNT_BEFORE),
    ]);
    const res = await ingest(service, [
      check("c-4", [line(BOTTLE, 2), line(GLASS, 1)]),
    ]);

    expect(calls.rpc.map((c) => c.fn).sort()).toEqual([
      "apply_stock_movement",
      "record_glass_pour",
    ]);
    expect(
      calls.rpc.find((c) => c.fn === "apply_stock_movement")?.args,
    ).toMatchObject({ p_delta: -2 });
    expect(res.stock).toMatchObject({ booked: 2, alreadyCounted: 0 });
    expect(res.errors).toEqual([]);
  });

  it("an item never counted is taken as before", async () => {
    const { service, calls } = makeDb([row("inv-1", null)]);
    await ingest(service, [check("c-5", [line(BOTTLE)])]);
    expect(calls.rpc).toHaveLength(1);
  });

  it("on a check with a counted and an uncounted item, a replay still leaves the counted one alone", async () => {
    const { service, calls } = makeDb([
      row("inv-1", COUNT_AFTER),
      row("inv-2", null),
    ]);
    const payload = [check("c-6", [line(BOTTLE), line(GLASS, 2)])];
    await ingest(service, payload);
    const again = await ingest(service, payload);

    // Only the glass moved, once; the bottle never did.
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].fn).toBe("record_glass_pour");
    expect(calls.consumption).toHaveLength(2);
    expect(again.stock).toMatchObject({
      booked: 0,
      alreadyBooked: 2,
      alreadyCounted: 1,
    });
  });

  it("a void of a sale already in the count returns no stock and takes its sale back", async () => {
    const { service, calls } = makeDb([row("inv-1", COUNT_AFTER)]);
    await ingest(service, [check("c-7", [line(BOTTLE)])]);
    await ingest(service, [check("c-7", [line(BOTTLE)], { voided: true })]);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.reversed).toHaveLength(1);
    expect(calls.reversed[0]).toMatchObject({
      table: "wine_consumption_log",
      reversed_at: CLOSED,
    });
  });
});

describe("F-1436: a bottle to count by hand reaches the house, not only errors[]", () => {
  it("a poured glass the till took back files one inbox note for the bar", async () => {
    const { service, persistForRestaurant } = makeDb([row("inv-2", null)]);
    await ingest(service, [check("c-8", [line(GLASS, 3)])]);
    expect(persistForRestaurant).not.toHaveBeenCalled();

    const res = await ingest(service, [check("c-8", [line(GLASS, 1)])]);

    expect(res.errors.join(" ")).toContain("count this bottle");
    expect(persistForRestaurant).toHaveBeenCalledTimes(1);
    const [house, note, opts] = (persistForRestaurant.mock.calls[0] ??
      []) as unknown as [string, Row, Row];
    expect(house).toBe("r-1");
    expect(note).toMatchObject({
      type: "inventory_needs_count",
      priority: "low",
      actionUrl: "/inventory",
    });
    expect(note.title).toBe(
      "Count SYNTHETIC Malbec glass: a poured glass was taken back",
    );
    expect(note.message).toContain("SYNTHETIC Malbec glass");
    expect(note.message).toContain(
      "count this bottle and correct its stock by hand",
    );
    expect(note.groupKey).toMatch(
      /^inventory_needs_count:generic_webhook:[0-9a-f]{16}$/,
    );
    expect(opts).toMatchObject({ dedupeWithinMinutes: 1440, area: "bar" });
  });

  it("the same taken-back glass sent again asks with the same group key", async () => {
    const { service, persistForRestaurant } = makeDb([row("inv-2", null)]);
    await ingest(service, [check("c-9", [line(GLASS, 3)])]);
    await ingest(service, [check("c-9", [line(GLASS, 1)])]);
    await ingest(service, [check("c-9", [line(GLASS, 1)])]);

    const keys = persistForRestaurant.mock.calls.map(
      (c) => ((c as unknown as [string, Row])[1] ?? {}).groupKey,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("an import with nothing to count files no note", async () => {
    const { service, persistForRestaurant } = makeDb([row("inv-2", null)]);
    await ingest(service, [check("c-10", [line(GLASS, 2)])]);
    expect(persistForRestaurant).not.toHaveBeenCalled();
  });
});
