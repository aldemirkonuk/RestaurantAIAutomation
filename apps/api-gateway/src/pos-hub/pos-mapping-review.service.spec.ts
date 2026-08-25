import { PosMappingReviewService } from "./pos-mapping-review.service";
import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

/**
 * Sale-unit review surface.
 *
 * Locks in the two things that make this surface safe to point at 92 live
 * mappings: the read never derives a unit (it returns the observed line price
 * and the bottle price as separate raw numbers, and says so explicitly when
 * there is no evidence at all), and the write changes `sale_unit` and nothing
 * else — the inventory link that makes a mapping worth anything must survive
 * an answer.
 */

type Row = Record<string, any>;

function makeDb(opts: {
  mappings?: Row[];
  inventory?: Row[];
  checks?: Row[];
  mappingError?: string;
}) {
  const calls = { upserts: [] as Row[], inQueries: [] as any[] };

  const client: any = {
    from(table: string) {
      if (table === "pos_item_mappings") {
        const q: any = {
          _eqs: {} as Row,
          select: () => q,
          eq: (col: string, val: any) => {
            q._eqs[col] = val;
            // The list read ends at .eq("restaurant_id"), so it must be
            // awaitable there; the single-row read chains a second .eq()
            // then .maybeSingle().
            return Object.assign(
              Promise.resolve(
                opts.mappingError
                  ? { data: null, error: { message: opts.mappingError } }
                  : { data: opts.mappings ?? [], error: null },
              ),
              q,
            );
          },
          maybeSingle: async () => {
            const row = (opts.mappings ?? []).find(
              (m) =>
                m.id === q._eqs.id && m.restaurant_id === q._eqs.restaurant_id,
            );
            return { data: row ?? null, error: null };
          },
          upsert: (row: Row) => {
            calls.upserts.push(row);
            return {
              select: () => ({
                single: async () => ({ data: { ...row }, error: null }),
              }),
            };
          },
        };
        return q;
      }

      if (table === "restaurant_inventory") {
        const q: any = {
          select: () => q,
          eq: () => q,
          in: async (_col: string, ids: string[]) => {
            calls.inQueries.push(ids);
            return {
              data: (opts.inventory ?? []).filter((i) => ids.includes(i.id)),
              error: null,
            };
          },
        };
        return q;
      }

      if (table === "pos_checks") {
        const q: any = {
          select: () => q,
          eq: () => q,
          not: () => q,
          order: () => q,
          limit: async () => ({ data: opts.checks ?? [], error: null }),
        };
        return q;
      }

      throw new Error(`unexpected table ${table}`);
    },
  };

  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    calls,
  };
}

function makeService(opts: Parameters<typeof makeDb>[0] = {}) {
  const { db, calls } = makeDb(opts);
  // The real PosHubService is used, not a stub: the merge-before-write
  // contract this spec is protecting is a contract with *that* method's
  // rebuild-from-scratch behaviour, and a stub would assert nothing.
  const service = new PosMappingReviewService(db, new PosHubService(db));
  return { service, calls };
}

const RESTAURANT = "rest-1";

const mapping = (overrides: Row = {}): Row => ({
  id: "map-1",
  restaurant_id: RESTAURANT,
  source: "generic_webhook",
  external_item_id: "ext-1",
  item_name: "BORDEAUX BLEND",
  category: "wine",
  is_wine: true,
  master_wine_id: "mw-1",
  inventory_id: "inv-1",
  sale_unit: null,
  updated_at: "2026-08-11T18:39:11Z",
  ...overrides,
});

const check = (lines: Row[], closedAt: string): Row => ({
  closed_at: closedAt,
  items: lines,
});

describe("PosMappingReviewService.listNeedingSaleUnit — read shape", () => {
  it("returns only rows missing a unit, and counts the rest", async () => {
    const { service } = makeService({
      mappings: [
        mapping(),
        mapping({ id: "map-2", external_item_id: "ext-2", sale_unit: "glass" }),
      ],
    });

    const res = await service.listNeedingSaleUnit(RESTAURANT);

    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe("map-1");
    expect(res.summary.total_mappings).toBe(2);
    expect(res.summary.needing_unit).toBe(1);
  });

  it("includes already-answered rows when asked, so an answer can be corrected", async () => {
    const { service } = makeService({
      mappings: [
        mapping(),
        mapping({ id: "map-2", external_item_id: "ext-2", sale_unit: "glass" }),
      ],
    });

    const res = await service.listNeedingSaleUnit(RESTAURANT, {
      includeAnswered: true,
    });

    expect(res.items).toHaveLength(2);
    expect(res.summary.needing_unit).toBe(1);
  });

  it("carries the linked inventory row so a decision needs no second screen", async () => {
    const { service } = makeService({
      mappings: [mapping()],
      inventory: [
        {
          id: "inv-1",
          wine_name: "Château Something 2018",
          bottle_size_ml: 750,
          pour_size_ml: 150,
          menu_price_current: 90,
          menu_price_glass: 18,
        },
      ],
    });

    const res = await service.listNeedingSaleUnit(RESTAURANT);

    expect(res.items[0].inventory_link).toBe("ok");
    expect(res.items[0].inventory).toEqual({
      id: "inv-1",
      wine_name: "Château Something 2018",
      bottle_size_ml: 750,
      pour_size_ml: 150,
      menu_price_current: 90,
      menu_price_glass: 18,
    });
  });

  it("reports the observed POS line price from recent closed checks", async () => {
    const { service } = makeService({
      mappings: [mapping()],
      checks: [
        check(
          [
            {
              external_item_id: "ext-1",
              name: "BORDEAUX BLEND",
              qty: 2,
              price: 18,
            },
          ],
          "2026-08-23T23:11:00Z",
        ),
        check(
          [
            {
              external_item_id: "ext-1",
              name: "BORDEAUX BLEND",
              qty: 1,
              price: 22,
            },
          ],
          "2026-08-20T21:00:00Z",
        ),
        check(
          [{ external_item_id: "other", name: "Espresso", qty: 1, price: 5 }],
          "2026-08-19T20:00:00Z",
        ),
      ],
    });

    const res = await service.listNeedingSaleUnit(RESTAURANT);
    const observed = res.items[0].observed_price;

    expect(observed.matched_by).toBe("external_item_id");
    expect(observed.line_count).toBe(2);
    expect(observed.unit_count).toBe(3);
    expect(observed.min).toBe(18);
    expect(observed.max).toBe(22);
    // Checks arrive newest-first, so `latest` is the most recent sighting.
    expect(observed.latest).toBe(18);
    expect(observed.latest_at).toBe("2026-08-23T23:11:00Z");
    expect(res.checks_scanned).toBe(3);
  });

  it("falls back to an exact name match, the way the ingest resolver does", async () => {
    const { service } = makeService({
      mappings: [mapping({ external_item_id: "" })],
      checks: [
        check(
          [
            {
              external_item_id: null,
              name: "bordeaux blend",
              qty: 1,
              price: 19,
            },
          ],
          "2026-08-23T23:11:00Z",
        ),
      ],
    });

    const res = await service.listNeedingSaleUnit(RESTAURANT);

    expect(res.items[0].observed_price.matched_by).toBe("item_name");
    expect(res.items[0].observed_price.latest).toBe(19);
  });

  it("keeps observed price and bottle price separate and emits no derived unit", async () => {
    const { service } = makeService({
      mappings: [mapping()],
      inventory: [
        {
          id: "inv-1",
          wine_name: "Château Something 2018",
          bottle_size_ml: 750,
          pour_size_ml: 150,
          menu_price_current: 90,
          menu_price_glass: 18,
        },
      ],
      checks: [
        check(
          [
            {
              external_item_id: "ext-1",
              name: "BORDEAUX BLEND",
              qty: 1,
              price: 18,
            },
          ],
          "2026-08-23T23:11:00Z",
        ),
      ],
    });

    const res = await service.listNeedingSaleUnit(RESTAURANT);
    const row = res.items[0] as Record<string, unknown>;

    // An $18 line against a $90 bottle is a glass — but that is the human's
    // read, not this service's. B36: no inferred unit reaches the response
    // under any name.
    expect(row.observed_price).toMatchObject({ latest: 18 });
    expect((row.inventory as Row).menu_price_current).toBe(90);
    expect(row.sale_unit).toBeNull();
    expect(row).not.toHaveProperty("suggested_unit");
    expect(row).not.toHaveProperty("inferred_sale_unit");
    expect(row).not.toHaveProperty("confidence");
    // What the existing code does if nobody answers — a statement about
    // applyStockEffects, not a recommendation.
    expect(row.unit_if_unanswered).toBe("bottle");
  });

  it("says 'dangling' rather than blank when inventory_id resolves to nothing", async () => {
    // The live shape as of 2026-08-25: inventory_id is set on all 92 rows but
    // has no FK, and none of them resolve to a restaurant_inventory row.
    const { service } = makeService({ mappings: [mapping()], inventory: [] });

    const res = await service.listNeedingSaleUnit(RESTAURANT);

    expect(res.items[0].inventory_link).toBe("dangling");
    expect(res.items[0].inventory).toBeNull();
    expect(res.summary.dangling_inventory).toBe(1);
    expect(res.summary.with_inventory).toBe(0);
  });

  it("reports absent price evidence as explicit zeros, not missing fields", async () => {
    const { service } = makeService({ mappings: [mapping()], checks: [] });

    const res = await service.listNeedingSaleUnit(RESTAURANT);

    expect(res.items[0].observed_price).toEqual({
      matched_by: null,
      line_count: 0,
      unit_count: 0,
      min: null,
      max: null,
      latest: null,
      latest_at: null,
    });
    expect(res.summary.with_observed_price).toBe(0);
  });

  it("flags the rows that will mis-deplete on the next sale", async () => {
    const { service } = makeService({
      mappings: [
        mapping(),
        // Wine, but no inventory link — queues to pos_unresolved_lines
        // instead of reaching the unit branch at all.
        mapping({ id: "map-2", external_item_id: "ext-2", inventory_id: null }),
        // Not wine — applyStockEffects skips it before the unit matters.
        mapping({ id: "map-3", external_item_id: "ext-3", is_wine: false }),
      ],
    });

    const res = await service.listNeedingSaleUnit(RESTAURANT);
    const byId = new Map(res.items.map((r) => [r.id, r]));

    expect(byId.get("map-1")!.depletes_stock).toBe(true);
    expect(byId.get("map-2")!.depletes_stock).toBe(false);
    expect(byId.get("map-2")!.inventory_link).toBe("unmapped");
    expect(byId.get("map-3")!.depletes_stock).toBe(false);
    expect(res.summary.deplete_on_next_sale).toBe(1);
  });

  it("orders decidable rows first", async () => {
    const { service } = makeService({
      mappings: [
        mapping({
          id: "no-evidence",
          external_item_id: "ext-9",
          item_name: "AAA",
        }),
        mapping({
          id: "has-price",
          external_item_id: "ext-1",
          item_name: "ZZZ",
        }),
      ],
      checks: [
        check(
          [{ external_item_id: "ext-1", name: "ZZZ", qty: 1, price: 18 }],
          "2026-08-23T23:11:00Z",
        ),
      ],
    });

    const res = await service.listNeedingSaleUnit(RESTAURANT);

    expect(res.items.map((r) => r.id)).toEqual(["has-price", "no-evidence"]);
  });

  it("scopes the inventory read to the mapping's own restaurant", async () => {
    const { service, calls } = makeService({ mappings: [mapping()] });

    await service.listNeedingSaleUnit(RESTAURANT);

    // inventory_id carries no FK, so a cross-tenant id must read as dangling
    // rather than surfacing another restaurant's bottle price as evidence.
    expect(calls.inQueries).toEqual([["inv-1"]]);
  });

  it("surfaces a read failure instead of returning an empty review", async () => {
    const { service } = makeService({ mappingError: "connection reset" });

    await expect(service.listNeedingSaleUnit(RESTAURANT)).rejects.toThrow(
      "connection reset",
    );
  });
});

describe("PosMappingReviewService.setSaleUnit — write validation", () => {
  it("writes the unit the human sent, and only that column", async () => {
    const { service, calls } = makeService({ mappings: [mapping()] });

    const result = await service.setSaleUnit(RESTAURANT, "map-1", "glass");

    expect(calls.upserts).toHaveLength(1);
    const written = calls.upserts[0];
    expect(written.sale_unit).toBe("glass");
    // The merge that keeps upsertItemMapping's rebuild-from-scratch behaviour
    // from wiping the row: without these, is_wine goes false and the
    // inventory link goes null, and the mapping stops depleting anything.
    expect(written.is_wine).toBe(true);
    expect(written.inventory_id).toBe("inv-1");
    expect(written.master_wine_id).toBe("mw-1");
    expect(written.category).toBe("wine");
    expect(written.source).toBe("generic_webhook");
    expect(written.external_item_id).toBe("ext-1");
    expect(written.item_name).toBe("BORDEAUX BLEND");
    expect(written.restaurant_id).toBe(RESTAURANT);
    expect(result).toMatchObject({
      mapping_id: "map-1",
      ok: true,
      sale_unit: "glass",
      previous_sale_unit: null,
    });
  });

  it("rejects a unit that is neither glass nor bottle rather than coercing it", async () => {
    const { service, calls } = makeService({ mappings: [mapping()] });

    await expect(
      service.setSaleUnit(RESTAURANT, "map-1", "Glass " as any),
    ).rejects.toThrow(/sale_unit must be/);
    await expect(
      service.setSaleUnit(RESTAURANT, "map-1", "bottles" as any),
    ).rejects.toThrow(/sale_unit must be/);
    expect(calls.upserts).toHaveLength(0);
  });

  it("refuses to write a mapping belonging to another restaurant", async () => {
    const { service, calls } = makeService({
      mappings: [mapping({ restaurant_id: "someone-else" })],
    });

    await expect(
      service.setSaleUnit(RESTAURANT, "map-1", "bottle"),
    ).rejects.toThrow(/not found for this restaurant/);
    expect(calls.upserts).toHaveLength(0);
  });

  it("refuses an unknown mapping id instead of creating a row", async () => {
    const { service, calls } = makeService({ mappings: [mapping()] });

    await expect(
      service.setSaleUnit(RESTAURANT, "map-missing", "bottle"),
    ).rejects.toThrow(/not found for this restaurant/);
    expect(calls.upserts).toHaveLength(0);
  });

  it("reports the previous unit when an answer is corrected", async () => {
    const { service } = makeService({
      mappings: [mapping({ sale_unit: "bottle" })],
    });

    const result = await service.setSaleUnit(RESTAURANT, "map-1", "glass");

    expect(result.previous_sale_unit).toBe("bottle");
    expect(result.sale_unit).toBe("glass");
  });
});

describe("PosMappingReviewService.setSaleUnitBatch", () => {
  it("applies each answer independently and reports per-entry outcomes", async () => {
    const { service, calls } = makeService({
      mappings: [
        mapping(),
        mapping({ id: "map-2", external_item_id: "ext-2" }),
      ],
    });

    const res = await service.setSaleUnitBatch(RESTAURANT, [
      { mapping_id: "map-1", sale_unit: "glass" },
      { mapping_id: "map-missing", sale_unit: "bottle" },
      { mapping_id: "map-2", sale_unit: "bottle" },
    ]);

    // A bad id in the middle must not discard the good answers around it.
    expect(res.updated).toBe(2);
    expect(res.failed).toBe(1);
    expect(calls.upserts.map((u) => u.sale_unit)).toEqual(["glass", "bottle"]);
    expect(res.results[1]).toMatchObject({
      mapping_id: "map-missing",
      ok: false,
    });
    expect(res.results[1].error).toMatch(/not found/);
  });
});
