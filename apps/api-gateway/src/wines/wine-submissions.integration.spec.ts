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

  /**
   * Every wine in this file carries a producer, so it is a SPECIFIC identity
   * (ADR 0130) and the resolver never reaches the venue-provisional branch —
   * `provisional_for_restaurant_id` is never written, and this id is never
   * dereferenced. It is here because the resolver now has to be TOLD whose
   * menu it is reading, precisely so that a generic name cannot be resolved
   * without an owner.
   */
  const RESTAURANT_ID = "00000000-0000-0000-0000-0000000000aa";

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
    const result = await service.resolveOrCreateLibraryWine(
      wine,
      RESTAURANT_ID,
    );

    expect(result.masterWineId).toBeTruthy();
    expect(result.matched).toBe(false);
    createdWineIds.push(result.masterWineId);
  });

  it("links the same wine to the existing row instead of duplicating it", async () => {
    const again = await service.resolveOrCreateLibraryWine(wine, RESTAURANT_ID);

    expect(again.masterWineId).toBe(createdWineIds[0]);
    expect(again.matched).toBe(true);
    expect(again.confidence).toBeGreaterThanOrEqual(85);
  });

  it("links a differently-phrased version of the same wine", async () => {
    // How a second menu might print it: producer abbreviated to its
    // distinctive word, name carrying the vintage the importer glued on.
    const rephrased = await service.resolveOrCreateLibraryWine(
      {
        name: `2019 Cuvee ${suffix}`,
        producer: `Domaine ${suffix}`,
        vintage: "2019",
        region: "Test Valley",
        grapeVariety: "Test Noir",
      },
      RESTAURANT_ID,
    );

    expect(rephrased.masterWineId).toBe(createdWineIds[0]);
    expect(rephrased.matched).toBe(true);
  });

  it("does not link a different producer's wine of the same name", async () => {
    const other = await service.resolveOrCreateLibraryWine(
      {
        ...wine,
        producer: `Bodega ${suffix}`,
      },
      RESTAURANT_ID,
    );

    expect(other.masterWineId).not.toBe(createdWineIds[0]);
    createdWineIds.push(other.masterWineId);
  });

  it("creates the row as a provisional stub", async () => {
    const { data } = await supabase
      .from("master_wine_library")
      .select(
        "library_tier, primary_type, source, signature_hash, normalized_name",
      )
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

  it("resolves a whole menu in one batch, index-aligned", async () => {
    const batch = [
      // already exists from the tests above — must link, not duplicate
      { ...wine },
      // genuinely new
      {
        name: `Batch Cuvee ${suffix}`,
        producer: `Domaine ${suffix}`,
        vintage: "2021",
      },
      // the same wine twice, which is what a by-the-glass / by-the-bottle
      // listing looks like. A naive bulk insert touches one conflict target
      // twice and the whole statement fails.
      {
        name: `Batch Cuvee ${suffix}`,
        producer: `Domaine ${suffix}`,
        vintage: "2021",
      },
    ];

    const results = await service.resolveLibraryWinesBatch(
      batch,
      RESTAURANT_ID,
    );

    expect(results).toHaveLength(3);
    expect(results[0]?.masterWineId).toBe(createdWineIds[0]);
    expect(results[0]?.matched).toBe(true);

    expect(results[1]?.masterWineId).toBeTruthy();
    expect(results[1]?.matched).toBe(false);
    // the duplicate resolves to the SAME row rather than creating a second
    expect(results[2]?.masterWineId).toBe(results[1]?.masterWineId);

    createdWineIds.push(results[1]!.masterWineId);
  });

  it("returns an entry per input even when nothing matches", async () => {
    // Index alignment is what the caller zips menu_items against. A dropped
    // or reordered entry silently attaches wines to the wrong rows.
    const results = await service.resolveLibraryWinesBatch(
      [
        { name: `Zeta ${suffix}`, producer: `Bodega Zeta ${suffix}` },
        { name: `Eta ${suffix}`, producer: `Bodega Eta ${suffix}` },
      ],
      RESTAURANT_ID,
    );

    expect(results).toHaveLength(2);
    expect(results[0]?.masterWineId).toBeTruthy();
    expect(results[1]?.masterWineId).toBeTruthy();
    expect(results[0]?.masterWineId).not.toBe(results[1]?.masterWineId);
    results.forEach((r) => r && createdWineIds.push(r.masterWineId));
  });

  it("normalizes every library row identically to Postgres", async () => {
    // The authoritative parity check, and the reason there is no standalone
    // script for it: a harness that keeps its own copy of the normalizer
    // drifts from the real one, which is precisely the failure this whole
    // area suffered from. This calls the shipped class and the shipped SQL
    // function over every row, so neither can move without the other.
    const { data: rows, error } = await supabase
      .from("master_wine_library")
      .select("name, producer, normalized_name, normalized_producer")
      .limit(2000);

    expect(error).toBeNull();
    expect(rows?.length).toBeGreaterThan(0);

    const drift = (rows ?? [])
      .filter(
        (r: any) =>
          service.normalizeText(r.name) !== r.normalized_name ||
          service.normalizeText(r.producer) !== r.normalized_producer,
      )
      .slice(0, 10)
      .map((r: any) => ({
        name: r.name,
        ts: service.normalizeText(r.name),
        sql: r.normalized_name,
        tsProducer: service.normalizeText(r.producer),
        sqlProducer: r.normalized_producer,
      }));

    expect(drift).toEqual([]);
  });

  it("expands trade abbreviations without inventing producers", async () => {
    // "Dom." is Domaine. Bare "Dom" is Dom Perignon and must survive intact —
    // expanding it would fabricate a producer that does not exist.
    expect(service.normalizeText("Dom. Mandeliere")).toBe("domaine mandeliere");
    expect(service.normalizeText("Ch. Clerc Milon")).toBe(
      "chateau clerc milon",
    );
    expect(service.normalizeText("Az. Agr. Gini")).toBe(
      "azienda agricola gini",
    );
    expect(service.normalizeText("St. Helena")).toBe("saint helena");
    expect(service.normalizeText("Dom Perignon")).toBe("dom perignon");
  });

  it("auto-links a wine whose producer the menu abbreviated", async () => {
    // Measured at 0 of 27 before abbreviation expansion: every abbreviated
    // producer fell below the auto-link floor and created a duplicate.
    const abbreviated = await service.resolveOrCreateLibraryWine(
      {
        ...wine,
        producer: `Dom. ${suffix}`,
      },
      RESTAURANT_ID,
    );

    expect(abbreviated.masterWineId).toBe(createdWineIds[0]);
    expect(abbreviated.matched).toBe(true);
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
