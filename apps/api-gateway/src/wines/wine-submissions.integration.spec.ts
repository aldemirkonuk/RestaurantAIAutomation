import { Test } from "@nestjs/testing";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { DatabaseService } from "../database/database.service";
import { WineSubmissionsService } from "./wine-submissions.service";

/**
 * Integration test against the real database.
 *
 * The unit tests pin the normalizer. They cannot catch the class of bug that
 * actually broke this pipeline, because that bug lived in the gap between the
 * TypeScript and the schema: `.upsert({ onConflict: "signature_hash" })`
 * against a PARTIAL unique index returns 42P10, and menus.service.ts caught
 * that as non-fatal and imported the wine unlinked. Every unit test passed the
 * whole time, and not one wine had ever been linked in production.
 *
 * So this exercises the real service against the real PostgREST, and asserts
 * the properties that matter end to end:
 *   1. an unmatched wine actually gets created (the 42P10 regression)
 *   2. importing the same wine twice links to one row, never two
 *   3. the created row is a provisional stub, and therefore
 *   4. it is visible to the enrichment dispatcher's eligibility query
 *
 * Skipped automatically when SUPABASE_URL is absent, so CI without secrets
 * stays green rather than failing for the wrong reason.
 */
const HAS_DB = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const describeIfDb = HAS_DB ? describe : describe.skip;

describeIfDb("WineSubmissionsService against the real database", () => {
  let service: WineSubmissionsService;
  let supabase: SupabaseClient;
  const createdWineIds: string[] = [];

  // A wine that cannot collide with anything real. The suffix keeps parallel
  // runs and reruns from matching each other's leftovers.
  const suffix = `ZZTEST${Date.now().toString(36).toUpperCase()}`;
  const wine = {
    name: `Cuvee ${suffix}`,
    producer: `Domaine ${suffix}`,
    vintage: "2019",
    region: "Test Valley",
    grapeVariety: "Test Noir",
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        WineSubmissionsService,
        { provide: DatabaseService, useValue: { supabase } },
      ],
    }).compile();
    service = moduleRef.get(WineSubmissionsService);
  });

  afterAll(async () => {
    if (createdWineIds.length > 0) {
      await supabase
        .from("master_wine_library")
        .delete()
        .in("id", createdWineIds);
    }
  });

  it("creates a library row for a wine that matches nothing", async () => {
    // The regression guard. This returned 42P10 for the entire life of the
    // feature because the unique index on signature_hash was partial.
    const result = await service.resolveOrCreateLibraryWine(wine);

    expect(result.masterWineId).toBeTruthy();
    expect(result.matched).toBe(false);
    createdWineIds.push(result.masterWineId);
  });

  it("links the same wine to the existing row instead of duplicating it", async () => {
    const again = await service.resolveOrCreateLibraryWine(wine);

    expect(again.masterWineId).toBe(createdWineIds[0]);
    expect(again.matched).toBe(true);
    expect(again.confidence).toBeGreaterThanOrEqual(85);
  });

  it("links a differently-phrased version of the same wine", async () => {
    // How a second menu might print it: producer abbreviated to its
    // distinctive word, name carrying the vintage the importer glued on.
    const rephrased = await service.resolveOrCreateLibraryWine({
      name: `2019 Cuvee ${suffix}`,
      producer: `Domaine ${suffix}`,
      vintage: "2019",
      region: "Test Valley",
      grapeVariety: "Test Noir",
    });

    expect(rephrased.masterWineId).toBe(createdWineIds[0]);
    expect(rephrased.matched).toBe(true);
  });

  it("does not link a different producer's wine of the same name", async () => {
    const other = await service.resolveOrCreateLibraryWine({
      ...wine,
      producer: `Bodega ${suffix}`,
    });

    expect(other.masterWineId).not.toBe(createdWineIds[0]);
    createdWineIds.push(other.masterWineId);
  });

  it("creates the row as a provisional stub", async () => {
    const { data } = await supabase
      .from("master_wine_library")
      .select("library_tier, primary_type, source, signature_hash, normalized_name")
      .eq("id", createdWineIds[0])
      .single();

    expect(data?.library_tier).toBe(3);
    expect(data?.primary_type).toBe("unknown");
    expect(data?.source).toBe("menu_import");
    // Both keys must be populated or the next import cannot find this row —
    // the exact state all 293 pre-existing rows were in.
    expect(data?.signature_hash).toBeTruthy();
    expect(data?.normalized_name).toBeTruthy();
  });

  it("exposes the stub to the enrichment dispatcher once a submission exists", async () => {
    // resolveOrCreateLibraryWine does not write submissions — menus.service
    // does, after the bulk insert. Stand one in so the eligibility query has
    // the shape it sees in production.
    const { data: submission } = await supabase
      .from("master_wine_library_submissions")
      .insert({
        payload: wine,
        status: "pending_review",
        decision_reason: "provisional_created",
        matched_master_id: createdWineIds[0],
        normalized_fields: {
          normalized_name: service.normalizeText(wine.name),
          normalized_producer: service.normalizeText(wine.producer),
        },
      })
      .select("id")
      .single();

    expect(submission?.id).toBeTruthy();

    const { data: eligible, error } = await supabase.rpc(
      "research_eligible_submissions",
      { p_limit: 500, p_cooldown_days: 7 },
    );

    expect(error).toBeNull();
    const ids = (eligible ?? []).map((r: any) => r.submission_id);
    expect(ids).toContain(submission?.id);

    const row = (eligible ?? []).find(
      (r: any) => r.submission_id === submission?.id,
    );
    expect(row?.reason).toBe("provisional_stub");

    await supabase
      .from("master_wine_library_submissions")
      .delete()
      .eq("id", submission?.id);
  });
});
