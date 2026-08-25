import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

/**
 * ADR 0011 — the sale-volume contract.
 *
 * `pos_item_mappings.sale_volume_ml` is the truth for how much stock one sale
 * removes; `sale_unit` is an open human label that may inform the derivation
 * (`glass`, `bottle`) but never carries arithmetic on its own. When neither
 * resolves, the line is QUEUED and nothing is depleted — the `?? "bottle"`
 * default that booked 750ml for every one of the 92 production mappings is
 * gone.
 *
 * Every test in the first four describes fails against the code as it stood on
 * 2026-08-25 (commit 9a7762a2). The "no regression" describe is a guard and is
 * expected to pass both before and after — it exists to prove the fix did not
 * buy fail-closed depletion by breaking the two units that already worked.
 */

type Row = Record<string, any>;

function makeDb(opts: { mappings?: Row[]; inventory?: Row[] } = {}) {
  const calls = {
    rpc: [] as Array<{ name: string; args: Row }>,
    checkUpserts: [] as Row[],
    mappingUpserts: [] as Row[],
    unresolvedInserts: [] as Row[],
    consumptionUpserts: [] as { row: Row; options: Row }[],
  };

  const client: any = {
    from(table: string) {
      const q: any = {
        _table: table,
        select: () => q,
        eq: () => q,
        in: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: { id: "map-1" }, error: null }),
      };
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
      if (table === "restaurant_inventory") {
        // Batched prefetch: one select for every inventory row the check
        // touches, replacing the per-line maybeSingle the consumption mirror
        // used to do on its own.
        q.in = async () => ({ data: opts.inventory ?? [], error: null });
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
        q.insert = async (row: Row) => {
          calls.unresolvedInserts.push(row);
          return { error: null };
        };
      }
      if (table === "wine_consumption_log") {
        q.upsert = async (row: Row, options: Row) => {
          calls.consumptionUpserts.push({ row, options });
          return { error: null };
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

function makeService(opts: { mappings?: Row[]; inventory?: Row[] } = {}) {
  const { db, calls } = makeDb(opts);
  return { service: new PosHubService(db), calls };
}

/** A 750ml bottle poured at 150ml — the shape of all 92 production rows. */
const std750 = {
  id: "inv-1",
  bottle_size_ml: 750,
  pour_size_ml: 150,
  menu_price_current: 60,
};

const mapping = (over: Row = {}) => ({
  external_item_id: "item-1",
  item_name: "Caymus Cabernet",
  is_wine: true,
  inventory_id: "inv-1",
  sale_unit: null,
  sale_volume_ml: null,
  ...over,
});

const closedCheck = (over: Row = {}) => ({
  externalCheckId: "chk-1",
  openedAt: "2026-08-25T18:00:00Z",
  closedAt: "2026-08-25T19:00:00Z",
  total: 60,
  items: [
    { name: "Caymus Cabernet", externalItemId: "item-1", qty: 1, price: 24 },
  ],
  ...over,
});

const pours = (calls: any) =>
  calls.rpc.filter((c: any) => c.name === "record_glass_pour");
const moves = (calls: any) =>
  calls.rpc.filter((c: any) => c.name === "apply_stock_movement");

// ===========================================================================
// 1. sale_volume_ml is the truth
// ===========================================================================

describe("sale_volume_ml is the truth", () => {
  it("wins over sale_unit — a 60ml taster on a glass mapping pours 60, not 150", async () => {
    const { service, calls } = makeService({
      mappings: [mapping({ sale_unit: "glass", sale_volume_ml: 60 })],
      inventory: [std750],
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    expect(pours(calls)).toHaveLength(1);
    expect(pours(calls)[0].args.p_pour_ml).toBe(60);
    expect(moves(calls)).toHaveLength(0);
    expect(calls.consumptionUpserts[0].row.volume_ml).toBe(60);
  });

  it("routes an arbitrary carafe volume through record_glass_pour's p_pour_ml", async () => {
    const { service, calls } = makeService({
      mappings: [mapping({ sale_unit: "carafe", sale_volume_ml: 500 })],
      inventory: [std750],
    });

    await service.ingest("r1", "generic_webhook", [
      closedCheck({
        items: [
          {
            name: "Caymus Cabernet",
            externalItemId: "item-1",
            qty: 2,
            price: 40,
          },
        ],
      }),
    ]);

    expect(pours(calls)).toHaveLength(1);
    expect(pours(calls)[0].args.p_pours).toBe(2);
    expect(pours(calls)[0].args.p_pour_ml).toBe(500);
    // 2 carafes x 500ml. Under the old bottle default this booked 1500ml.
    expect(calls.consumptionUpserts[0].row.volume_ml).toBe(1000);
  });

  it("a magnum sale off a magnum row is a whole-bottle move, not a 1500ml pour", async () => {
    const { service, calls } = makeService({
      mappings: [mapping({ sale_unit: "magnum", sale_volume_ml: 1500 })],
      inventory: [{ ...std750, bottle_size_ml: 1500 }],
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    expect(moves(calls)).toHaveLength(1);
    expect(moves(calls)[0].args.p_delta).toBe(-1);
    expect(pours(calls)).toHaveLength(0);
    expect(calls.consumptionUpserts[0].row).toMatchObject({
      consumption_type: "bottle",
      volume_ml: 1500,
    });
  });

  it("carries sale_volume_ml onto the persisted check line", async () => {
    const { service, calls } = makeService({
      mappings: [mapping({ sale_unit: "half_bottle", sale_volume_ml: 375 })],
      inventory: [std750],
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    expect(calls.checkUpserts[0].items[0]).toMatchObject({
      sale_unit: "half_bottle",
      sale_volume_ml: 375,
    });
  });
});

// ===========================================================================
// 2. Fail closed — the `?? "bottle"` default is gone
// ===========================================================================

describe("an unresolvable sale volume queues and depletes nothing", () => {
  // The headline. All 92 production mappings are sale_unit = null with an
  // inventory_id, and every one of them booked a whole 750ml bottle here.
  it("queues a mapped line with no unit and no volume, and calls no RPC", async () => {
    const { service, calls } = makeService({
      mappings: [mapping()],
      inventory: [std750],
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.consumptionUpserts).toHaveLength(0);
    expect(calls.unresolvedInserts).toHaveLength(1);
  });

  it("queues it under a reason that is not 'unmapped', and names the inventory row", async () => {
    // Conflating "we don't know what this item is" with "we know exactly what
    // it is but not how much one sale removes" makes the review queue useless:
    // the two need different questions asked of the human.
    const { service, calls } = makeService({
      mappings: [mapping()],
      inventory: [std750],
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    expect(calls.unresolvedInserts[0].reason).toBe("no_sale_volume");
    expect(calls.unresolvedInserts[0].mapped_inventory_id).toBe("inv-1");
  });

  it("still queues an unmapped line as 'unmapped' with no inventory row", async () => {
    const { service, calls } = makeService({ mappings: [] });

    await service.ingest("r1", "generic_webhook", [
      closedCheck({
        items: [
          {
            name: "Mystery Cabernet",
            externalItemId: "item-9",
            qty: 1,
            price: 30,
          },
        ],
      }),
    ]);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.unresolvedInserts).toHaveLength(1);
    expect(calls.unresolvedInserts[0].reason).toBe("unmapped");
    expect(calls.unresolvedInserts[0].mapped_inventory_id).toBeNull();
  });

  it("queues a label it cannot price in ml rather than guessing a bottle", async () => {
    const { service, calls } = makeService({
      mappings: [mapping({ sale_unit: "flight" })],
      inventory: [std750],
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.unresolvedInserts[0].reason).toBe("no_sale_volume");
  });

  it("queues when the mapped inventory row cannot be read at all", async () => {
    const { service, calls } = makeService({
      mappings: [mapping({ sale_unit: "glass" })],
      inventory: [],
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.unresolvedInserts).toHaveLength(1);
  });

  it("refuses a volume larger than the container it pours from", async () => {
    // record_glass_pour subtracts p_pour_ml from a freshly opened bottle
    // (baseline_from_production.sql:1170). A 1500ml pour off a 750ml row drives
    // open_bottle_ml to -750 — silent lot corruption, not an under-depletion.
    const { service, calls } = makeService({
      mappings: [mapping({ sale_unit: "magnum", sale_volume_ml: 1500 })],
      inventory: [std750],
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.unresolvedInserts).toHaveLength(1);
    expect(calls.unresolvedInserts[0].reason).toBe("no_sale_volume");
  });
});

// ===========================================================================
// 3. sale_unit is an open label
// ===========================================================================

describe("sale_unit is an open human label", () => {
  it("accepts labels outside glass/bottle when a volume backs them", async () => {
    const { service, calls } = makeService();

    for (const unit of [
      "half_bottle",
      "magnum",
      "carafe",
      "taster",
      "flight",
    ]) {
      await service.upsertItemMapping("r1", {
        item_name: `x-${unit}`,
        sale_unit: unit,
        sale_volume_ml: 375,
      });
    }

    expect(calls.mappingUpserts.map((m) => m.sale_unit)).toEqual([
      "half_bottle",
      "magnum",
      "carafe",
      "taster",
      "flight",
    ]);
  });

  it("persists sale_volume_ml — the column the arithmetic actually reads", async () => {
    const { service, calls } = makeService();

    await service.upsertItemMapping("r1", {
      item_name: "Carafe of the house red",
      sale_unit: "carafe",
      sale_volume_ml: 500,
    });

    expect(calls.mappingUpserts[0]).toHaveProperty("sale_volume_ml", 500);
  });

  it.each(["", "   ", "\t", 0, 42, {}, []])(
    "still rejects %p — malformed is not a label",
    async (bad) => {
      const { service, calls } = makeService();
      await expect(
        service.upsertItemMapping("r1", { item_name: "x", sale_unit: bad }),
      ).rejects.toThrow(/sale_unit/);
      expect(calls.mappingUpserts).toHaveLength(0);
    },
  );

  it.each([0, -1, 1.5, "abc", 999999, {}])(
    "rejects %p as a sale_volume_ml rather than depleting a nonsense amount",
    async (bad) => {
      const { service, calls } = makeService();
      await expect(
        service.upsertItemMapping("r1", {
          item_name: "x",
          sale_volume_ml: bad,
        }),
      ).rejects.toThrow(/sale_volume_ml/);
      expect(calls.mappingUpserts).toHaveLength(0);
    },
  );
});

// ===========================================================================
// 4. No regression on the two units that already worked
// ===========================================================================

describe("glass and bottle still derive correctly", () => {
  it("glass derives pour_size_ml and pours it explicitly", async () => {
    const { service, calls } = makeService({
      mappings: [mapping({ sale_unit: "glass" })],
      inventory: [std750],
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    expect(pours(calls)).toHaveLength(1);
    expect(pours(calls)[0].args.p_pour_ml).toBe(150);
    expect(calls.consumptionUpserts[0].row).toMatchObject({
      consumption_type: "glass",
      volume_ml: 150,
    });
  });

  it("bottle stays a whole-bottle move on apply_stock_movement", async () => {
    const { service, calls } = makeService({
      mappings: [mapping({ sale_unit: "bottle" })],
      inventory: [std750],
    });

    await service.ingest("r1", "generic_webhook", [
      closedCheck({
        items: [
          {
            name: "Caymus Cabernet",
            externalItemId: "item-1",
            qty: 2,
            price: 60,
          },
        ],
      }),
    ]);

    expect(moves(calls)).toHaveLength(1);
    expect(moves(calls)[0].args.p_delta).toBe(-2);
    expect(moves(calls)[0].args.p_transaction_type).toBe("sale");
    expect(pours(calls)).toHaveLength(0);
    expect(calls.consumptionUpserts[0].row).toMatchObject({
      consumption_type: "bottle",
      volume_ml: 1500,
    });
  });

  it("a bottle mapping needs no bottle_size_ml to deplete", async () => {
    // bottle_size_ml is nullable in production (baseline:3316) and a whole-
    // bottle move never needed it. Requiring one would have queued good sales.
    const { service, calls } = makeService({
      mappings: [mapping({ sale_unit: "bottle" })],
      inventory: [{ id: "inv-1", bottle_size_ml: null, pour_size_ml: 150 }],
    });

    await service.ingest("r1", "generic_webhook", [closedCheck()]);

    expect(moves(calls)).toHaveLength(1);
    expect(moves(calls)[0].args.p_delta).toBe(-1);
  });

  it("an open check still depletes nothing (B18)", async () => {
    const { service, calls } = makeService({
      mappings: [mapping({ sale_unit: "glass" })],
      inventory: [std750],
    });

    await service.ingest("r1", "generic_webhook", [
      { ...closedCheck(), closedAt: null },
    ]);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.unresolvedInserts).toHaveLength(0);
  });

  it("a void still reverses, and writes no consumption row (B19)", async () => {
    const { service, calls } = makeService({
      mappings: [mapping({ sale_unit: "bottle" })],
      inventory: [std750],
    });

    await service.ingest("r1", "generic_webhook", [
      closedCheck({ voided: true }),
    ]);

    expect(moves(calls)[0].args.p_delta).toBe(1);
    expect(moves(calls)[0].args.p_transaction_type).toBe("return");
    expect(calls.consumptionUpserts).toHaveLength(0);
  });
});
