import { Test, TestingModule } from "@nestjs/testing";
import { ProviderIntelligenceService } from "./provider-intelligence.service";
import { DatabaseService } from "../database/database.service";

/**
 * OD-99 — `searchConversationMemory` called a phantom RPC.
 *
 * It called `search_provider_conversations` first, described in its own
 * comment as "vector similarity search". No CREATE FUNCTION for it exists
 * anywhere in this repository, and production does not have it: PostgREST
 * answers PGRST202 (verified against the live database on 2026-08-26, not
 * against supabase/migrations/ — five defects this week came from a migration
 * the repo had and production never saw).
 *
 * So the `catch` under it — a plain `ilike` substring search over
 * `conversation_embeddings` — has been the implementation since the day it was
 * written, on every single request. The RPC is deleted and that search is now
 * the body.
 *
 * These tests assert WHICH call is made, not what comes back, because a
 * return-value test would have passed against the broken code too: the old
 * code returned exactly the same rows, just after a guaranteed-failing round
 * trip. That is the shape of test this repository keeps discovering it has.
 */
describe("ProviderIntelligenceService — searchConversationMemory (OD-99)", () => {
  let service: ProviderIntelligenceService;
  let rpc: jest.Mock;
  let from: jest.Mock;
  let limit: jest.Mock;

  function buildClient(result: { data: any[] | null; error: any }) {
    limit = jest.fn().mockResolvedValue(result);
    const order = jest.fn().mockReturnValue({ limit });
    const ilike = jest.fn().mockReturnValue({ order });
    const eq = jest.fn().mockReturnValue({ ilike });
    const select = jest.fn().mockReturnValue({ eq });
    from = jest.fn().mockReturnValue({ select });
    rpc = jest.fn();
    return { from, rpc };
  }

  async function makeService(result: { data: any[] | null; error: any }) {
    const supabase = buildClient(result);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderIntelligenceService,
        { provide: DatabaseService, useValue: { supabase } },
      ],
    }).compile();
    return module.get<ProviderIntelligenceService>(ProviderIntelligenceService);
  }

  it("never calls the phantom RPC", async () => {
    service = await makeService({ data: [], error: null });

    await service.searchConversationMemory("prov-1", "shipping");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("searches conversation_embeddings directly", async () => {
    service = await makeService({
      data: [{ id: "m1", message_text: "late shipping again" }],
      error: null,
    });

    const rows = await service.searchConversationMemory("prov-1", "shipping");

    expect(from).toHaveBeenCalledWith("conversation_embeddings");
    expect(rows).toHaveLength(1);
  });

  it("throws on a failed search instead of returning an empty list (ADR 0020)", async () => {
    service = await makeService({
      data: null,
      error: { code: "PGRST205", message: "relation does not exist" },
    });

    // The old shape swallowed every failure into `return data || []`, so a
    // broken search and a search with no hits were the same answer.
    await expect(
      service.searchConversationMemory("prov-1", "shipping"),
    ).rejects.toMatchObject({ code: "PGRST205" });
  });

  it("still returns an empty list when the search genuinely has no hits", async () => {
    service = await makeService({ data: [], error: null });

    await expect(
      service.searchConversationMemory("prov-1", "nothing-matches-this"),
    ).resolves.toEqual([]);
  });
});

/**
 * 2026-09-17 finding — two cross-house leaks.
 *
 * `getSentimentTrend` filtered `provider_sentiment_history` on `provider_id`
 * only, so a provider shared between houses (`providers.restaurant_id` is
 * nullable; a `restaurant_providers` join table exists) handed back another
 * house's sentiment rows for it. `compareProviders` had no restaurant filter
 * at all — it returned every active provider in every house.
 *
 * A generic fake PostgREST builder is used here (rather than the fixed
 * chain above) because `compareProviders` issues four different query
 * shapes in one call and the fix's whole point is which `.eq()` filters are
 * now applied — the fake has to honour ALL of them, not just the ones the
 * old code already used.
 */
describe("ProviderIntelligenceService — house scoping (2026-09-17)", () => {
  type Row = Record<string, any>;

  function makeFakeSupabase(tables: Record<string, Row[]>) {
    return {
      from(table: string) {
        const eqFilters: Array<[string, any]> = [];
        const inFilters: Array<[string, any[]]> = [];
        const isFilters: Array<[string, any]> = [];
        // Each `.or(...)` call is one AND'd-in OR-group, the same as real
        // PostgREST: a row must satisfy at least one clause in EVERY group
        // pushed here. Only `is`/`eq` clauses are parsed — the only ones this
        // service emits via `.or()`.
        const orGroups: string[] = [];
        const api: any = {
          select: () => api,
          eq(col: string, val: any) {
            eqFilters.push([col, val]);
            return api;
          },
          in(col: string, vals: any[]) {
            inFilters.push([col, vals]);
            return api;
          },
          is(col: string, val: any) {
            isFilters.push([col, val]);
            return api;
          },
          or(filterStr: string) {
            orGroups.push(filterStr);
            return api;
          },
          order: () => api,
          limit: () => api,
          then(resolve: any) {
            let rows = tables[table] || [];
            rows = rows.filter((r) => eqFilters.every(([c, v]) => r[c] === v));
            rows = rows.filter((r) =>
              inFilters.every(([c, vals]) => vals.includes(r[c])),
            );
            rows = rows.filter((r) =>
              isFilters.every(([c, v]) => (r[c] ?? null) === v),
            );
            rows = rows.filter((r) =>
              orGroups.every((group) =>
                group.split(",").some((clause) => {
                  const [col, op, val] = clause.split(".");
                  const actual = r[col] ?? null;
                  if (op === "is") return actual === (val === "null" ? null : val);
                  if (op === "eq") return actual === val;
                  return false;
                }),
              ),
            );
            resolve({ data: rows, error: null });
          },
        };
        return api;
      },
    };
  }

  async function makeScopedService(tables: Record<string, Row[]>) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderIntelligenceService,
        {
          provide: DatabaseService,
          useValue: { supabase: makeFakeSupabase(tables) },
        },
      ],
    }).compile();
    return module.get<ProviderIntelligenceService>(ProviderIntelligenceService);
  }

  describe("getSentimentTrend", () => {
    it("returns only the caller house's sentiment rows for a provider shared across houses", async () => {
      const service = await makeScopedService({
        provider_sentiment_history: [
          {
            provider_id: "prov-shared",
            restaurant_id: "r1",
            sentiment: "positive",
            sentiment_score: 0.5,
            created_at: "2026-09-01T00:00:00Z",
          },
          {
            provider_id: "prov-shared",
            restaurant_id: "r2",
            sentiment: "negative",
            sentiment_score: -0.9,
            created_at: "2026-09-02T00:00:00Z",
          },
        ],
      });

      const res = await service.getSentimentTrend("prov-shared", "r1");

      expect(res.dataPoints).toHaveLength(1);
      expect(res.dataPoints[0].sentiment).toBe("positive");
    });

    it("returns no data points for a foreign house, not another house's trend", async () => {
      const service = await makeScopedService({
        provider_sentiment_history: [
          {
            provider_id: "prov-shared",
            restaurant_id: "r2",
            sentiment: "negative",
            sentiment_score: -0.9,
            created_at: "2026-09-02T00:00:00Z",
          },
        ],
      });

      const res = await service.getSentimentTrend("prov-shared", "r1");

      expect(res.dataPoints).toEqual([]);
      expect(res.averageScore).toBe(0);
    });
  });

  describe("compareProviders", () => {
    it("returns only the caller house's providers, never every tenant's", async () => {
      const service = await makeScopedService({
        providers: [
          {
            id: "p-mine",
            restaurant_id: "r1",
            name: "Mine Distribution",
            is_active: true,
            deleted_at: null,
          },
          {
            id: "p-theirs",
            restaurant_id: "r2",
            name: "Their Distribution",
            is_active: true,
            deleted_at: null,
          },
        ],
        provider_promotions: [],
        provider_sentiment_history: [],
        provider_knowledge: [],
      });

      const result = await service.compareProviders("r1");

      expect(result.map((p) => p.id)).toEqual(["p-mine"]);
    });

    it("scopes a shared provider's sentiment aggregate to the caller house", async () => {
      const service = await makeScopedService({
        providers: [
          {
            id: "p-shared",
            restaurant_id: "r1",
            name: "Shared Vendor",
            is_active: true,
            deleted_at: null,
          },
        ],
        provider_promotions: [],
        provider_sentiment_history: [
          {
            provider_id: "p-shared",
            restaurant_id: "r1",
            sentiment_score: 0.8,
          },
          {
            provider_id: "p-shared",
            restaurant_id: "r2",
            sentiment_score: -1,
          },
        ],
        provider_knowledge: [],
      });

      const result = await service.compareProviders("r1");

      expect(result).toHaveLength(1);
      expect(result[0].avgSentiment).toBe(0.8);
    });

    it("includes a provider deliberately shared across every house (restaurant_id IS NULL), never a different house's own provider", async () => {
      const service = await makeScopedService({
        providers: [
          {
            id: "p-shared",
            restaurant_id: null,
            name: "Shared Distributor",
            is_active: true,
            deleted_at: null,
          },
          {
            id: "p-theirs",
            restaurant_id: "r2",
            name: "Their Distribution",
            is_active: true,
            deleted_at: null,
          },
        ],
        provider_promotions: [],
        provider_sentiment_history: [],
        provider_knowledge: [],
      });

      const result = await service.compareProviders("r1");

      expect(result.map((p) => p.id)).toEqual(["p-shared"]);
    });
  });
});
