/**
 * The consumption mirror writes a row per depleting line, and a replay is a
 * no-op — proven against the database's real shape (ADR 0093, 2026-09-03).
 *
 * `wine_consumption_log_pos_idem_uidx` is a PARTIAL unique index
 * (`where notes is not null and source = 'pos'`). The mirror used to
 * `upsert(..., { onConflict: "restaurant_id,notes" })`, and Postgres answers
 * 42P10 to an ON CONFLICT target that does not repeat a partial index's
 * predicate — which PostgREST cannot express. Measured on the first live day:
 * 51 depleting lines, 0 rows, one ERROR log line each. The write is now a
 * plain INSERT; the index makes a replay raise 23505, which is the idempotent
 * outcome the upsert was meant to produce. This file pins both halves.
 */
import { Logger } from "@nestjs/common";
import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

type Row = Record<string, any>;

function makeDb(insertResult: (row: Row) => { error: any }) {
  const inserts: Row[] = [];
  const upserts: Row[] = [];
  const client: any = {
    from(table: string) {
      const q: any = {
        _table: table,
        select: () => q,
        eq: () => q,
        in: () => q,
        upsert: async (row: Row) => {
          if (table === "wine_consumption_log") upserts.push(row);
          return { error: null };
        },
        insert: async (row: Row) => {
          if (table === "wine_consumption_log") {
            inserts.push(row);
            return insertResult(row);
          }
          return { error: null };
        },
      };
      if (table === "pos_item_mappings") {
        q.in = async () => ({
          data: [
            {
              external_item_id: "item-1",
              item_name: "Caymus Cabernet",
              is_wine: true,
              inventory_id: "inv-1",
              sale_unit: "bottle",
            },
          ],
          error: null,
        });
      }
      if (table === "restaurant_inventory") {
        q.in = async () => ({
          data: [{ id: "inv-1", bottle_size_ml: 750, pour_size_ml: 150 }],
          error: null,
        });
      }
      if (table === "restaurant_tables") {
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      }
      return q;
    },
    rpc: async () => ({ data: "tx-1", error: null }),
  };
  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    inserts,
    upserts,
  };
}

const check = () => ({
  externalCheckId: "chk-mirror-1",
  openedAt: "2026-09-02T18:00:00Z",
  closedAt: "2026-09-02T19:00:00Z",
  items: [
    { name: "Caymus Cabernet", externalItemId: "item-1", qty: 2, price: 90 },
  ],
});

describe("PosHubService — the consumption mirror against the real index (ADR 0093)", () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it("writes one wine_consumption_log row per depleting line, keyed by the idempotency key in notes", async () => {
    const { db, inserts, upserts } = makeDb(() => ({ error: null }));
    await new PosHubService(db).ingest("r1", "generic_webhook", [check()]);
    expect(upserts).toHaveLength(0); // the call that could never match the partial index
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      restaurant_id: "r1",
      inventory_id: "inv-1",
      consumption_type: "bottle",
      quantity: 2,
      source: "pos",
      notes: "pos:generic_webhook:chk-mirror-1:item-1:0",
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("a replay's 23505 from the partial unique index is the idempotent no-op, not an error", async () => {
    const seen = new Set<string>();
    const { db, inserts } = makeDb((row) => {
      if (seen.has(row.notes))
        return { error: { code: "23505", message: "duplicate key value" } };
      seen.add(row.notes);
      return { error: null };
    });
    const service = new PosHubService(db);
    await service.ingest("r1", "generic_webhook", [check()]);
    await service.ingest("r1", "generic_webhook", [check()]);
    expect(inserts).toHaveLength(2);
    expect(seen.size).toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("any other database error is said, loudly, with its code", async () => {
    const { db } = makeDb(() => ({
      error: {
        code: "42P10",
        message:
          "there is no unique or exclusion constraint matching the ON CONFLICT specification",
      },
    }));
    await new PosHubService(db).ingest("r1", "generic_webhook", [check()]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("[42P10]");
  });
});
