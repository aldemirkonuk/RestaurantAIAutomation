import { WineSubmissionsService } from "./wine-submissions.service";
import { hashWineSignature } from "./wine-signature";

/**
 * F-497 — the submission dedup worker and the SHARED wine library.
 *
 * `processPendingSubmissions` (the five-minute cron) used to:
 *  - let a generic identity into the shared library. The panel only needs a
 *    non-empty producer, and a producer written in Greek or Georgian script,
 *    or as "-", normalizes to "" — so with no vintage or region the identity
 *    is not specific, the matcher answers nothing, and the worker created a
 *    shared row from one house's reading (ADR 0130 forbids it);
 *  - upsert with the default MERGE, so a submission whose signature matched
 *    an existing shared row rewrote that row's fields, NULL for every one it
 *    left out, for every house stocking that wine.
 *
 * The library below enforces the UNIQUE `signature_hash` the real table has,
 * and honours `ignoreDuplicates` the way PostgREST does: a skipped insert
 * returns no row, a merge overwrites.
 */

type Row = Record<string, any>;

function fakeDb(
  library: Row[],
  submissions: Row[],
  readError: { message: string } | null = null,
) {
  const submissionUpdates: Array<{ id: string; patch: Row }> = [];
  let seq = 0;

  const libraryTable = () => {
    let pending: { payload: Row; ignoreDuplicates: boolean } | null = null;
    let eqFilter: [string, any] | null = null;
    const resolve = () => {
      if (pending) {
        const { payload, ignoreDuplicates } = pending;
        const clash = library.find(
          (r) => r.signature_hash === payload.signature_hash,
        );
        if (clash) {
          if (ignoreDuplicates) return { data: null, error: null };
          Object.assign(clash, payload);
          return { data: { id: clash.id }, error: null };
        }
        const row = { ...payload, id: `mw-new-${++seq}` };
        library.push(row);
        return { data: { id: row.id }, error: null };
      }
      if (readError) return { data: null, error: readError };
      const hit = eqFilter
        ? library.find((r) => r[eqFilter![0]] === eqFilter![1])
        : undefined;
      return { data: hit ? { id: hit.id } : null, error: null };
    };
    const q: any = {
      upsert: (payload: Row, opts: Row) => {
        pending = { payload, ignoreDuplicates: !!opts?.ignoreDuplicates };
        return q;
      },
      select: () => q,
      eq: (col: string, val: any) => {
        eqFilter = [col, val];
        return q;
      },
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
    };
    return q;
  };

  const submissionsTable = () => {
    let patch: Row | null = null;
    const q: any = {
      select: () => q,
      order: () => q,
      limit: async () => ({
        data: submissions.filter((s) => s.status === "pending"),
        error: null,
      }),
      update: (p: Row) => {
        patch = p;
        return q;
      },
      eq: (col: string, val: any) => {
        if (patch && col === "id") {
          submissionUpdates.push({ id: val, patch });
          return Promise.resolve({ data: null, error: null });
        }
        return q;
      },
    };
    return q;
  };

  const supabase = {
    from: jest.fn((table: string) =>
      table === "master_wine_library" ? libraryTable() : submissionsTable(),
    ),
    // A generic identity matches nothing; a specific one is new here.
    rpc: jest.fn(async () => ({ data: [], error: null })),
  };
  return { db: { supabase } as any, supabase, submissionUpdates };
}

function service(db: any) {
  const s = new WineSubmissionsService(db);
  (s as any).logger.error = jest.fn();
  return s;
}

describe("F-497 dedup worker keeps the shared library to specific wines, and never overwrites one", () => {
  it("sends a generic identity (producer in Greek script, no vintage, no region) to review, not to the shared library", async () => {
    const library: Row[] = [];
    const t = fakeDb(library, [
      {
        id: "sub-1",
        status: "pending",
        payload: { name: "Agiorgitiko", producer: "Κτήμα Γεροβασιλείου" },
      },
    ]);

    const out = await service(t.db).processPendingSubmissions();

    expect(out.results).toEqual([{ id: "sub-1", status: "pending_review" }]);
    expect(library).toHaveLength(0);
    expect(t.submissionUpdates).toEqual([
      {
        id: "sub-1",
        patch: expect.objectContaining({
          status: "pending_review",
          decision_reason: "generic_identity_not_shared",
        }),
      },
    ]);
    // Never asked the matcher: a generic query has no business there.
    expect(t.supabase.rpc).not.toHaveBeenCalled();
  });

  it("links a submission to the existing shared row with the same signature and leaves that row's fields alone", async () => {
    const identity = {
      name: "Barolo Cannubi",
      producer: "Damilano",
      vintage: 2018,
      country: "Italy",
      region: "Piedmont",
      grapeVariety: "Nebbiolo",
    };
    const shared: Row = {
      id: "mw-shared",
      wine_id: "WINE_CURATED",
      name: identity.name,
      producer: identity.producer,
      vintage: identity.vintage,
      country: identity.country,
      region: identity.region,
      grape_variety: identity.grapeVariety,
      primary_type: "red",
      appellation: "Barolo DOCG",
      price_reference: 62,
      sensory_profile: { body: 4 },
      signature_hash: hashWineSignature(identity),
    };
    const before = { ...shared };
    const library: Row[] = [shared];
    const t = fakeDb(library, [
      { id: "sub-2", status: "pending", payload: { ...identity } },
    ]);

    const out = await service(t.db).processPendingSubmissions();

    expect(library).toHaveLength(1);
    expect(library[0]).toEqual(before);
    expect(out.results).toEqual([
      { id: "sub-2", status: "merged", matchedMasterId: "mw-shared" },
    ]);
    expect(t.submissionUpdates[0].patch).toEqual(
      expect.objectContaining({
        status: "merged",
        matched_master_id: "mw-shared",
        decision_reason: "existing_shared_row",
      }),
    );
  });

  it("says why when the existing shared row cannot be read back, instead of leaving the submission pending in silence", async () => {
    const identity = {
      name: "Barolo Cannubi",
      producer: "Damilano",
      vintage: 2018,
      country: "Italy",
      region: "Piedmont",
      grapeVariety: "Nebbiolo",
    };
    const library: Row[] = [
      { id: "mw-shared", signature_hash: hashWineSignature(identity) },
    ];
    const t = fakeDb(
      library,
      [{ id: "sub-4", status: "pending", payload: { ...identity } }],
      { message: "connection reset" },
    );

    const out = await service(t.db).processPendingSubmissions();

    expect(out.results).toEqual([{ id: "sub-4", status: "pending" }]);
    expect(t.submissionUpdates).toEqual([
      {
        id: "sub-4",
        patch: expect.objectContaining({
          status: "pending",
          decision_reason: "retry 1/5: library read: connection reset",
        }),
      },
    ]);
  });

  it("still creates a shared row for a specific wine the library does not hold", async () => {
    const library: Row[] = [];
    const t = fakeDb(library, [
      {
        id: "sub-3",
        status: "pending",
        payload: { name: "Etna Rosso", producer: "Benanti", vintage: 2021 },
      },
    ]);

    const out = await service(t.db).processPendingSubmissions();

    expect(library).toHaveLength(1);
    expect(library[0]).toEqual(
      expect.objectContaining({ name: "Etna Rosso", producer: "Benanti" }),
    );
    expect(out.results).toEqual([
      { id: "sub-3", status: "accepted", matchedMasterId: library[0].id },
    ]);
  });
});
