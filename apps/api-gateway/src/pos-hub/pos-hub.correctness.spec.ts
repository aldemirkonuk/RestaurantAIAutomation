import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

/**
 * Three defects found by driving 66 real checks through the live webhook
 * (.planning/04-specs/POS-BRIDGE-AUDIT.md, Appendix A). None had corrupted
 * anything for one reason only: `pos_checks` held 0 rows until 2026-08-24.
 *
 * Each of these tests fails against the code as it stood that morning. That is
 * the bar — a regression test that passes before the fix guards nothing.
 */

type Row = Record<string, any>;

function makeDb(opts: { mappings?: Row[]; inventory?: Row } = {}) {
  const calls = {
    rpc: [] as any[],
    checkUpserts: [] as Row[],
    mappingUpserts: [] as Row[],
    consumptionInserts: [] as { row: Row }[],
    consumptionDuplicates: [] as Row[],
  };

  const client: any = {
    from(table: string) {
      const q: any = {
        _table: table,
        select: () => q,
        eq: () => q,
        in: () => q,
        maybeSingle: async () => ({
          data: opts.inventory ?? null,
          error: null,
        }),
        single: async () => ({ data: { id: "map-1" }, error: null }),
      };
      if (table === "restaurant_inventory") {
        // ADR 0011: depletion resolves the sale volume from the inventory row
        // BEFORE it issues an RPC, in one batched read per check — so the
        // fixture is served through .in(), not the per-line maybeSingle the
        // consumption mirror used to do on its own.
        q.in = async () => ({
          data: opts.inventory ? [{ id: "inv-1", ...opts.inventory }] : [],
          error: null,
        });
      }
      if (table === "pos_item_mappings") {
        q.in = async () => ({ data: opts.mappings ?? [], error: null });
        q.upsert = (row: Row) => {
          calls.mappingUpserts.push(row);
          return {
            select: () => ({
              single: async () => ({ data: row, error: null }),
            }),
          };
        };
      }
      if (table === "restaurant_tables") {
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      }
      if (table === "pos_checks") {
        q.upsert = async (row: Row) => {
          calls.checkUpserts.push(row);
          return { error: null };
        };
      }
      if (table === "pos_unresolved_lines") {
        q.insert = async () => ({ error: null });
      }
      if (table === "wine_consumption_log") {
        // The real table has a PARTIAL unique index on (restaurant_id, notes)
        // for POS rows; PostgREST cannot name it in ON CONFLICT, so the mirror
        // is a plain insert and a replay answers 23505 (ADR 0093, 2026-09-03).
        q.insert = async (row: Row) => {
          if (calls.consumptionInserts.some((c) => c.row.notes === row.notes)) {
            calls.consumptionDuplicates.push(row);
            return { error: { code: "23505", message: "duplicate key value" } };
          }
          calls.consumptionInserts.push({ row });
          return { error: null };
        };
        q.upsert = async () => {
          throw new Error(
            "wine_consumption_log must be written with insert — an upsert names " +
              "a conflict target the partial unique index cannot match (42P10).",
          );
        };
      }
      return q;
    },
    rpc: async (name: string, args: Row) => {
      calls.rpc.push({ name, args });
      return { data: "tx-1", error: null };
    },
  };

  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    calls,
  };
}

function makeService(opts: { mappings?: Row[]; inventory?: Row } = {}) {
  const { db, calls } = makeDb(opts);
  return { service: new PosHubService(db), calls };
}

const glassMapping = {
  external_item_id: "item-glass",
  item_name: "Chardonnay by the glass",
  is_wine: true,
  inventory_id: "inv-1",
  sale_unit: "glass",
};

const closedCheck = (overrides: Row = {}) => ({
  externalCheckId: "chk-1",
  openedAt: "2026-08-24T18:00:00Z",
  closedAt: "2026-08-24T19:00:00Z",
  total: 120,
  items: [
    {
      name: "Chardonnay by the glass",
      externalItemId: "item-glass",
      qty: 1,
      price: 18,
    },
  ],
  ...overrides,
});

describe("sale_unit reaches the mapping row", () => {
  // The whole defect: upsertItemMapping is the ONLY writer of sale_unit and it
  // omitted the column, so all 92 production mappings were null and every glass
  // pour took the `?? "bottle"` fallback — 750ml booked instead of 150ml.
  it("persists sale_unit, the column that decides glass vs bottle depletion", async () => {
    const { service, calls } = makeService();

    await service.upsertItemMapping("r1", {
      external_item_id: "item-glass",
      item_name: "Chardonnay by the glass",
      is_wine: true,
      inventory_id: "inv-1",
      sale_unit: "glass",
    });

    expect(calls.mappingUpserts).toHaveLength(1);
    expect(calls.mappingUpserts[0]).toHaveProperty("sale_unit", "glass");
  });

  it("still allows a deliberate null — which now queues rather than defaulting", async () => {
    const { service, calls } = makeService();
    await service.upsertItemMapping("r1", { item_name: "Unknown pour" });
    expect(calls.mappingUpserts[0].sale_unit).toBeNull();
  });

  // Superseded by ADR 0011. This used to assert that "Glass"/"bottles" were
  // REJECTED, because sale_unit was a closed two-value vocabulary and anything
  // else fell through to the `?? "bottle"` default while looking mapped. The
  // vocabulary is now open — the label is for reporting, sale_volume_ml carries
  // the arithmetic, and an unrecognised label queues instead of defaulting. So
  // "Glass" is a legal label; what is still rejected is malformed input.
  it.each(["", "   ", 0, {}])(
    "rejects %p — malformed input is not a label",
    async (bad) => {
      const { service, calls } = makeService();
      await expect(
        service.upsertItemMapping("r1", { item_name: "x", sale_unit: bad }),
      ).rejects.toThrow(/sale_unit/);
      expect(calls.mappingUpserts).toHaveLength(0);
    },
  );

  it("accepts a label outside glass/bottle and stores it verbatim", async () => {
    const { service, calls } = makeService();
    await service.upsertItemMapping("r1", {
      item_name: "Magnum of Barolo",
      sale_unit: "magnum",
      sale_volume_ml: 1500,
    });
    expect(calls.mappingUpserts[0]).toMatchObject({
      sale_unit: "magnum",
      sale_volume_ml: 1500,
    });
  });

  it("a glass mapping depletes a glass, not a bottle", async () => {
    const { service, calls } = makeService({
      mappings: [glassMapping],
      inventory: { bottle_size_ml: 750, pour_size_ml: 150 },
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    const pours = calls.rpc.filter((c) => c.name === "record_glass_pour");
    const bottles = calls.rpc.filter((c) => c.name === "apply_stock_movement");
    expect(pours).toHaveLength(1);
    expect(bottles).toHaveLength(0);
    expect(calls.consumptionInserts[0].row).toMatchObject({
      consumption_type: "glass",
      volume_ml: 150,
    });
  });
});

describe("voided is persisted, not just acted on", () => {
  // `voided` drove stock reversal from the start but was never written to the
  // row, and the column did not exist — so a voided check returned its stock
  // and stayed revenue forever.
  it("writes voided=true so revenue readers can exclude it", async () => {
    const { service, calls } = makeService({ mappings: [glassMapping] });
    await service.ingest("r1", "generic_webhook", [
      closedCheck({ voided: true }),
    ]);
    expect(calls.checkUpserts[0]).toHaveProperty("voided", true);
  });

  it("writes voided=false for an ordinary check rather than leaving it absent", async () => {
    const { service, calls } = makeService({ mappings: [glassMapping] });
    await service.ingest("r1", "generic_webhook", [closedCheck()]);
    expect(calls.checkUpserts[0]).toHaveProperty("voided", false);
  });
});

describe("the consumption log is as idempotent as the stock write", () => {
  // apply_stock_movement returns the EXISTING transaction for a known key, so
  // "no rpcError" never meant "this depleted just now". The bare insert that
  // followed left stock correct and the log inflated — the worse direction,
  // because stock is the number a human checks.
  it("writes through insert, keyed for the partial unique index that dedupes it", async () => {
    const { service, calls } = makeService({
      mappings: [glassMapping],
      inventory: { bottle_size_ml: 750, pour_size_ml: 150 },
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    expect(calls.consumptionInserts).toHaveLength(1);
    expect(calls.consumptionInserts[0].row.source).toBe("pos");
    expect(calls.consumptionInserts[0].row.notes).toMatch(
      /^pos:generic_webhook:/,
    );
  });

  it("keys on the POS idempotency key, unprefixed", async () => {
    const { service, calls } = makeService({
      mappings: [glassMapping],
      inventory: { bottle_size_ml: 750, pour_size_ml: 150 },
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    const notes = calls.consumptionInserts[0].row.notes;
    // Used to render "pos:pos:…" because the key already carried the prefix.
    expect(notes).not.toMatch(/^pos:pos:/);
    expect(notes).toMatch(/^pos:generic_webhook:chk-1:/);
  });

  it("replaying the same check does not write a second consumption row per line", async () => {
    const { service, calls } = makeService({
      mappings: [glassMapping],
      inventory: { bottle_size_ml: 750, pour_size_ml: 150 },
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);
    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    // Two upserts are attempted — the dedupe is the database's job, and the
    // unique index in 20260824190000 is what enforces it. What matters is that
    // both carry the SAME key, so the second is a no-op rather than a new row.
    // one row landed; the replay hit the index and was answered 23505 — quietly
    expect(calls.consumptionInserts).toHaveLength(1);
    expect(calls.consumptionDuplicates).toHaveLength(1);
    expect(calls.consumptionDuplicates[0].notes).toBe(
      calls.consumptionInserts[0].row.notes,
    );
  });

  // Asserted as a DIFFERENCE, not an absence. "A voided check writes no
  // consumption row" passed against the pre-fix code too — because pre-fix,
  // nothing ever reached wine_consumption_log through this path at all. A test
  // that passes for the wrong reason is worse than no test: it reports the
  // behaviour is guarded when only the failure mode is.
  it("skips the consumption row for a void, and writes one otherwise", async () => {
    const harness = () =>
      makeService({
        mappings: [glassMapping],
        inventory: { bottle_size_ml: 750, pour_size_ml: 150 },
      });

    const voided = harness();
    await voided.service.ingest("r1", "generic_webhook", [
      closedCheck({ voided: true }),
    ]);

    const normal = harness();
    await normal.service.ingest("r1", "generic_webhook", [closedCheck()]);

    expect(voided.calls.consumptionInserts).toHaveLength(0);
    expect(normal.calls.consumptionInserts).toHaveLength(1);
  });
});
