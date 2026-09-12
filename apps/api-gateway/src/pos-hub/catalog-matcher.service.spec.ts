import { CatalogMatcherService } from "./catalog-matcher.service";
import { DatabaseService } from "../database/database.service";
import { PosHubService } from "./pos-hub.service";

/**
 * Catalog matcher (SimPOS testbed plan, decisions D32-39).
 *
 * Locks in: external id / SKU tiers beat trigram, a vintage/size mismatch
 * caps confidence below the auto threshold (substitution, never silently
 * merged), a tie at the top score never auto-maps even if it clears 0.9,
 * and anything short of a confident unambiguous match lands in the review
 * queue rather than getting silently written or dropped.
 */

type Row = Record<string, any>;

const RESTAURANT_ID = "sim-rest-1";

function makeFakeSupabase(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(initial));

  function from(table: string) {
    const filters: Array<[string, any]> = [];
    const inFilters: Array<[string, any[]]> = [];
    const notNullFilters: string[] = [];
    let pendingInsert: Row | null = null;
    let pendingUpdate: Row | null = null;

    const matches = (row: Row) =>
      filters.every(([c, v]) => row[c] === v) &&
      inFilters.every(([c, vals]) => vals.includes(row[c])) &&
      notNullFilters.every((c) => row[c] != null);

    // Insert/update are deferred until a terminal call (then/maybeSingle/
    // single), because eq() filters chained *after* .update(...) must be
    // in place before the mutation is applied — mirroring real query builders.
    const apply = (): Row[] => {
      if (pendingInsert) {
        tables[table] = [...(tables[table] || []), pendingInsert];
        return [pendingInsert];
      }
      if (pendingUpdate) {
        tables[table] = (tables[table] || []).map((r) =>
          matches(r) ? { ...r, ...pendingUpdate } : r,
        );
        return (tables[table] || []).filter(matches);
      }
      return (tables[table] || []).filter(matches);
    };

    const api: any = {
      select() {
        return api;
      },
      eq(col: string, val: any) {
        filters.push([col, val]);
        return api;
      },
      in(col: string, vals: any[]) {
        inFilters.push([col, vals]);
        return api;
      },
      not(col: string, op: string, _val: any) {
        if (op === "is") notNullFilters.push(col);
        return api;
      },
      order() {
        return api;
      },
      insert(payload: Row) {
        pendingInsert = payload;
        return api;
      },
      update(payload: Row) {
        pendingUpdate = payload;
        return api;
      },
      maybeSingle: async () => {
        const rows = apply();
        return { data: rows[0] ?? null, error: null };
      },
      single: async () => {
        const rows = apply();
        return rows[0]
          ? { data: rows[0], error: null }
          : { data: null, error: { message: "not found" } };
      },
      then(resolve: any) {
        resolve({ data: apply(), error: null });
      },
    };
    return api;
  }

  return { client: { from } as any, tables };
}

function makeService(
  candidates: Row[],
  posCatalog: Row[],
  extraTables: Record<string, Row[]> = {},
) {
  const { client, tables } = makeFakeSupabase({
    simpos_catalog: posCatalog,
    pos_item_mappings: [],
    pos_catalog_match_proposals: [],
    ...extraTables,
  });
  const dbService = {
    getClient: () => client,
    getRestaurantInventory: async () => candidates,
  } as unknown as DatabaseService;

  const upsertItemMapping = jest.fn(
    async (_restaurantId: string, mapping: any) => mapping,
  );
  const posHub = { upsertItemMapping } as unknown as PosHubService;

  const service = new CatalogMatcherService(dbService, posHub);
  return { service, upsertItemMapping, tables };
}

const inv = (overrides: Row = {}): Row => ({
  id: "inv-1",
  master_wine_id: "mw-1",
  wine_name: "Opus One",
  master_wine_library: { producer: "Opus One Winery", vintage: 2018 },
  bottle_size_ml: 750,
  pos_sku: null,
  sku: null,
  internal_sku: null,
  sku_aliases: null,
  ...overrides,
});

const posItem = (overrides: Row = {}): Row => ({
  restaurant_id: RESTAURANT_ID,
  external_item_id: "ext-1",
  wine_name: "Opus One",
  producer: "Opus One Winery",
  vintage: 2018,
  size_ml: 750,
  is_active: true,
  ...overrides,
});

describe("CatalogMatcherService.pullAndMatch", () => {
  it("throws for a source with no wired pull implementation", async () => {
    const { service } = makeService([], []);
    await expect(service.pullAndMatch(RESTAURANT_ID, "toast")).rejects.toThrow(
      /not implemented/,
    );
  });

  it("auto-maps an exact pos_sku match at high confidence", async () => {
    const { service, upsertItemMapping } = makeService(
      [inv({ pos_sku: "ext-1" })],
      [posItem({ wine_name: "Totally Different Name Text" })],
    );
    const summary = await service.pullAndMatch(RESTAURANT_ID, "simpos");

    expect(summary.autoMapped).toHaveLength(1);
    expect(summary.autoMapped[0].inventoryId).toBe("inv-1");
    expect(upsertItemMapping).toHaveBeenCalledWith(
      RESTAURANT_ID,
      expect.objectContaining({
        inventory_id: "inv-1",
        master_wine_id: "mw-1",
      }),
    );
  });

  it("queues a strong trigram match as a proposal — text alone never auto-applies", async () => {
    // Mirrors line-matcher.ts's own rule: trigram is capped below the auto
    // threshold even on an exact name match, because a wrong link is worse
    // than no link and two different wines from the same producer can share
    // almost all their words.
    const { service, upsertItemMapping } = makeService([inv()], [posItem()]);
    const summary = await service.pullAndMatch(RESTAURANT_ID, "simpos");

    expect(summary.autoMapped).toHaveLength(0);
    expect(summary.proposed).toHaveLength(1);
    expect(summary.proposed[0].method).toBe("trigram");
    expect(summary.proposed[0].confidence).toBeCloseTo(0.88);
    expect(upsertItemMapping).not.toHaveBeenCalled();
  });

  it("never auto-maps a vintage substitution — queues it as a proposal instead", async () => {
    const { service, upsertItemMapping } = makeService(
      [
        inv({
          master_wine_library: { producer: "Opus One Winery", vintage: 2015 },
        }),
      ],
      [posItem({ vintage: 2018 })],
    );
    const summary = await service.pullAndMatch(RESTAURANT_ID, "simpos");

    expect(summary.autoMapped).toHaveLength(0);
    expect(summary.proposed).toHaveLength(1);
    expect(summary.proposed[0].method).toBe("trigram");
    expect(upsertItemMapping).not.toHaveBeenCalled();
  });

  it("a tie at the top score is ambiguous and never auto-maps even above 0.9", async () => {
    const { service, upsertItemMapping } = makeService(
      [inv({ id: "inv-1" }), inv({ id: "inv-2" })],
      [posItem()],
    );
    const summary = await service.pullAndMatch(RESTAURANT_ID, "simpos");

    expect(summary.autoMapped).toHaveLength(0);
    expect(summary.proposed).toHaveLength(1);
    expect(upsertItemMapping).not.toHaveBeenCalled();
  });

  it("queues a proposal with a null candidate when nothing scores above the suggest threshold", async () => {
    const { service } = makeService(
      [
        inv({
          wine_name: "Screaming Eagle",
          master_wine_library: {
            producer: "Screaming Eagle Winery",
            vintage: 2010,
          },
        }),
      ],
      [posItem({ wine_name: "Coca Cola Zero", producer: null, vintage: null })],
    );
    const summary = await service.pullAndMatch(RESTAURANT_ID, "simpos");

    expect(summary.autoMapped).toHaveLength(0);
    expect(summary.proposed).toHaveLength(1);
    expect(summary.proposed[0].confidence).toBeNull();
  });

  it("skips items already mapped to an inventory row", async () => {
    const { service, upsertItemMapping } = makeService(
      [inv({ pos_sku: "ext-1" })],
      [posItem()],
      {
        pos_item_mappings: [
          {
            restaurant_id: RESTAURANT_ID,
            source: "simpos",
            external_item_id: "ext-1",
            inventory_id: "inv-1",
          },
        ],
      },
    );
    const summary = await service.pullAndMatch(RESTAURANT_ID, "simpos");

    expect(summary.alreadyMapped).toBe(1);
    expect(summary.autoMapped).toHaveLength(0);
    expect(summary.proposed).toHaveLength(0);
    expect(upsertItemMapping).not.toHaveBeenCalled();
  });
});

describe("CatalogMatcherService review queue", () => {
  it("approveProposal writes the mapping and marks the proposal approved", async () => {
    const { service, upsertItemMapping, tables } = makeService([], [], {
      pos_catalog_match_proposals: [
        {
          id: "prop-1",
          restaurant_id: RESTAURANT_ID,
          source: "simpos",
          external_item_id: "ext-1",
          item_name: "Opus One",
          candidate_inventory_id: "inv-1",
          candidate_master_wine_id: "mw-1",
          status: "pending",
        },
      ],
    });

    const result = await service.approveProposal(RESTAURANT_ID, "prop-1");

    expect(result.approved).toBe(true);
    expect(upsertItemMapping).toHaveBeenCalledWith(
      RESTAURANT_ID,
      expect.objectContaining({ inventory_id: "inv-1" }),
    );
    expect(
      tables.pos_catalog_match_proposals.find((p) => p.id === "prop-1")?.status,
    ).toBe("approved");
  });

  it("approveProposal refuses a proposal with no candidate", async () => {
    const { service } = makeService([], [], {
      pos_catalog_match_proposals: [
        {
          id: "prop-2",
          restaurant_id: RESTAURANT_ID,
          source: "simpos",
          external_item_id: "ext-2",
          item_name: "Mystery Item",
          candidate_inventory_id: null,
          status: "pending",
        },
      ],
    });

    await expect(
      service.approveProposal(RESTAURANT_ID, "prop-2"),
    ).rejects.toThrow(/no candidate/);
  });

  it("rejectProposal marks the proposal rejected without writing a mapping", async () => {
    const { service, upsertItemMapping, tables } = makeService([], [], {
      pos_catalog_match_proposals: [
        {
          id: "prop-3",
          restaurant_id: RESTAURANT_ID,
          source: "simpos",
          external_item_id: "ext-3",
          item_name: "Whatever",
          status: "pending",
        },
      ],
    });

    await service.rejectProposal(RESTAURANT_ID, "prop-3");

    expect(upsertItemMapping).not.toHaveBeenCalled();
    expect(
      tables.pos_catalog_match_proposals.find((p) => p.id === "prop-3")?.status,
    ).toBe("rejected");
  });
});

/**
 * Approval must produce a mapping that can actually deplete (POS lens defect 2).
 *
 * Measured on the Sim Meyhouse lens run: approving 107 proposals produced 107
 * mappings with `sale_unit`/`sale_volume_ml` null, so the very next sale of an
 * approved item queued again as `no_sale_volume` (ADR 0011 fails closed). Two
 * invisible queues stood between an approval and one bottle moving. The owner
 * answers "what does one sale remove?" in the same tap that confirms identity.
 */
describe("CatalogMatcherService.approveProposal — the unit travels with the approval", () => {
  const pending = (id: string, ext: string, name: string): Row => ({
    id,
    restaurant_id: RESTAURANT_ID,
    source: "simpos",
    external_item_id: ext,
    item_name: name,
    candidate_inventory_id: "inv-1",
    candidate_master_wine_id: "mw-1",
    status: "pending",
  });

  it("writes the sale unit and volume the approver chose", async () => {
    const { service, upsertItemMapping } = makeService([], [], {
      pos_catalog_match_proposals: [
        pending("prop-u1", "ext-u1", "Opus One BTG"),
      ],
    });

    await service.approveProposal(RESTAURANT_ID, "prop-u1", {
      sale_unit: "glass",
      sale_volume_ml: 150,
    });

    expect(upsertItemMapping).toHaveBeenCalledWith(
      RESTAURANT_ID,
      expect.objectContaining({
        inventory_id: "inv-1",
        sale_unit: "glass",
        sale_volume_ml: 150,
      }),
    );
  });

  it("passes null rather than a guess when the approver did not answer", async () => {
    const { service, upsertItemMapping } = makeService([], [], {
      pos_catalog_match_proposals: [pending("prop-u2", "ext-u2", "Opus One")],
    });

    await service.approveProposal(RESTAURANT_ID, "prop-u2");

    const mapping = upsertItemMapping.mock.calls[0][1];
    expect(mapping.sale_unit).toBeNull();
    expect(mapping.sale_volume_ml).toBeNull();
  });

  it("approves many proposals in ONE request, reporting per-entry ok/error", async () => {
    // The lens approved 107 one at a time and 7 POSTs were rejected 429 by the
    // 100-request/60s default limit (rate-limit.guard.ts:28). One request for
    // the whole queue is the structural fix; a lowered threshold is not.
    const { service, upsertItemMapping } = makeService([], [], {
      pos_catalog_match_proposals: [
        pending("prop-b1", "ext-b1", "Akakies"),
        pending("prop-b2", "ext-b2", "Efe Black"),
      ],
    });

    const result = await service.approveProposalsBatch(RESTAURANT_ID, [
      { proposal_id: "prop-b1", sale_unit: "bottle", sale_volume_ml: 750 },
      { proposal_id: "prop-b2", sale_unit: "glass", sale_volume_ml: 150 },
      { proposal_id: "prop-missing" },
    ]);

    expect(upsertItemMapping).toHaveBeenCalledTimes(2);
    expect(result.approved).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results[2].ok).toBe(false);
    expect(result.results[2].error).toMatch(/not found/i);
  });
});
