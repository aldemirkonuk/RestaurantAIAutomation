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
