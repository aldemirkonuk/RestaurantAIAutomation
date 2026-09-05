import { WineSubmissionsService } from "./wine-submissions.service";

/**
 * The shared library never invents a producer or a country (Antalya night).
 *
 * `wine-submissions.service.ts` wrote `producer: item.producer || item.name`
 * and `country: item.country || "Unknown"` on every row it created, because
 * both columns were NOT NULL. Measured on production 2026-09-05:
 *
 *     master_wine_library                  4252 rows
 *     country = 'Unknown'                   328
 *     source  = 'menu_import'                77  — all 77 country='Unknown'
 *     ...producer = the row's own name       48  (62%)
 *
 * This is not cosmetic. `master_wine_library` is the SHARED catalogue every
 * tenant matches against, and producer is an identity attribute: a row whose
 * producer is "House White Wine" asserts a producer by that name exists.
 *
 * And the placeholder disagrees with the key. `signature_hash` is computed over
 * `item.producer ?? null` / `item.country ?? null` while the ROW stored the
 * fabricated string — so the canonical row misrepresented the identity its own
 * dedup key was taken over.
 */

type Row = Record<string, any>;

function makeService() {
  const inserted: Row[] = [];

  // Reads on master_wine_library return what has been inserted so far, so the
  // service's own "did my row land?" re-read resolves rather than throwing.
  const chain = (table: string): any => {
    const rowsFor = () => (table === "master_wine_library" ? inserted : []);
    const capture = (payload: Row | Row[]) => {
      if (table === "master_wine_library") {
        for (const r of Array.isArray(payload) ? payload : [payload]) {
          inserted.push({ id: `mw-${inserted.length + 1}`, ...r });
        }
      }
    };
    const api: any = {
      _table: table,
      select: () => api,
      eq: () => api,
      in: () => api,
      not: () => api,
      or: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: rowsFor()[0] ?? null, error: null }),
      single: async () =>
        rowsFor()[0]
          ? { data: rowsFor()[0], error: null }
          : { data: null, error: { message: "not found" } },
      insert: (payload: Row | Row[]) => {
        capture(payload);
        return api;
      },
      upsert: (payload: Row | Row[]) => {
        capture(payload);
        return api;
      },
      update: () => api,
      then: (resolve: any) => resolve({ data: rowsFor(), error: null }),
    };
    return api;
  };

  const supabase = {
    from: (t: string) => chain(t),
    rpc: async () => ({ data: null, error: null }),
  };
  const dbService = { supabase, getClient: () => supabase } as any;
  const service = new WineSubmissionsService(dbService);
  return { service, inserted };
}

describe("master_wine_library writes carry no fabricated provenance", () => {
  it("writes producer null rather than the wine's own name", async () => {
    const { service, inserted } = makeService();

    await (service as any).resolveOrCreateLibraryWine({
      name: "House White Wine",
      // no producer — the ordinary case for a menu line
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].name).toBe("House White Wine");
    expect(inserted[0].producer).toBeNull();
    // The specific shape measured on 48 of 77 production rows.
    expect(inserted[0].producer).not.toBe("House White Wine");
  });

  it("writes country null rather than the string 'Unknown'", async () => {
    const { service, inserted } = makeService();

    await (service as any).resolveOrCreateLibraryWine({ name: "Efe Black" });

    expect(inserted[0].country).toBeNull();
    // 'Unknown' sorts, groups and filters as though it were a country.
    expect(inserted[0].country).not.toBe("Unknown");
  });

  it("still writes a real producer and country when the line has them", async () => {
    const { service, inserted } = makeService();

    await (service as any).resolveOrCreateLibraryWine({
      name: "Akakies",
      producer: "Kir-Yianni",
      country: "Greece",
    });

    expect(inserted[0].producer).toBe("Kir-Yianni");
    expect(inserted[0].country).toBe("Greece");
  });

  it("keeps primary_type 'unknown' — a vocabulary member, not a placeholder", async () => {
    // Deliberately unchanged: 'unknown' here MEANS unclassified, and
    // beverage_kind's trigger already reads it. Relaxing it would break a
    // classification to fix a fabrication that is not one.
    const { service, inserted } = makeService();

    await (service as any).resolveOrCreateLibraryWine({ name: "Efe Black" });

    expect(inserted[0].primary_type).toBe("unknown");
  });
});
