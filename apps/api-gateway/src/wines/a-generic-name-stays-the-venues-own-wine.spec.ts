import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { WineSubmissionsService } from "./wine-submissions.service";
import {
  hashProvisionalWineSignature,
  hashWineSignature,
  isSpecificWineIdentity,
} from "./wine-signature";

/**
 * ADR 0130 — a generic name stays the venue's own wine.
 *
 * Measured on Antalya night (PR #314) and reproduced on the schema built from
 * all 100 migrations: the draft `"House White Wine"` — no producer, no
 * vintage, no region — scored 90 against `HOUSE WHITE`, a row the Sim
 * Meyhouse load created (United States / California / 2023), because
 * `match_library_wine`'s scorer reads two ABSENT producers as a perfect
 * producer match:
 *
 *     match_library_wine('House White Wine', NULL, NULL, NULL, NULL, NULL)
 *       -> HOUSE WHITE, confidence 90, name_sim 1, producer_sim 1
 *
 * 90 clears AUTO_LINK_CONFIDENCE (85), so the Antalya venue's Turkish house
 * white became a 2023 California wine on every screen.
 *
 * The library table below is not a stub that answers whatever is asked. It
 * enforces the two things the real schema enforces — the UNIQUE index on
 * `signature_hash` and the trigger that recomputes that hash from the row's
 * own fields — so a fix that produced one shared key for two venues would
 * fail here exactly the way it fails in Postgres.
 */

type Row = Record<string, any>;

class FakeLibrary {
  rows: Row[] = [];
  matchCalls: Array<Record<string, any>> = [];
  /** Candidates the matcher will hand back, whatever it is asked. */
  candidates: Row[] = [];
  private seq = 0;

  /**
   * Mirror of `trg_sync_signature_hash` as this migration leaves it: a shared
   * row is keyed on its six identity fields, a row owned by one venue on those
   * fields behind the venue id.
   */
  private hashFor(row: Row): string {
    const identity = {
      name: row.name,
      producer: row.producer,
      vintage: row.vintage,
      country: row.country,
      region: row.region,
      grapeVariety: row.grape_variety,
    };
    return row.provisional_for_restaurant_id
      ? hashProvisionalWineSignature(
          row.provisional_for_restaurant_id,
          identity,
        )
      : hashWineSignature(identity);
  }

  insert(payload: Row): Row | null {
    const signature_hash = this.hashFor(payload);
    // The partial UNIQUE index, with ignoreDuplicates: a colliding insert is
    // skipped and returns nothing.
    if (this.rows.some((r) => r.signature_hash === signature_hash)) return null;
    const row = { ...payload, signature_hash, id: `mw-${++this.seq}` };
    this.rows.push(row);
    return row;
  }
}

function fakeClient(lib: FakeLibrary) {
  const query = (filters: Row) => ({
    select: () => query(filters),
    eq: (col: string, val: any) => query({ ...filters, [col]: val }),
    maybeSingle: async () => ({
      data:
        lib.rows.find((r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v),
        ) ?? null,
      error: null,
    }),
    in: async (col: string, vals: any[]) => ({
      data: lib.rows.filter((r) => vals.includes(r[col])),
      error: null,
    }),
  });

  return {
    rpc: async (name: string, args: Record<string, any>) => {
      lib.matchCalls.push({ name, ...args });
      return { data: lib.candidates, error: null };
    },
    from: (_table: string) => ({
      ...query({}),
      upsert: (payload: Row | Row[]) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        const created = rows.map((r) => lib.insert(r));
        return {
          select: () => ({
            maybeSingle: async () => ({ data: created[0], error: null }),
          }),
          then: (resolve: (v: any) => void) => resolve({ error: null }),
        };
      },
    }),
  };
}

async function makeService(lib: FakeLibrary) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      WineSubmissionsService,
      { provide: DatabaseService, useValue: { supabase: fakeClient(lib) } },
    ],
  }).compile();
  return moduleRef.get(WineSubmissionsService);
}

const ANTALYA = "22222222-2222-2222-2222-222222222222";
const MEYHOUSE = "11111111-1111-1111-1111-111111111111";
const HOUSE_WHITE = { name: "House White Wine" };

describe("isSpecificWineIdentity — the rule the founder locked", () => {
  it.each([
    ["a bare name", { name: "House White Wine" }, false],
    [
      "a name and a blank producer",
      { name: "House White", producer: "  " },
      false,
    ],
    ["a name and a vintage", { name: "Cankaya", vintage: 2023 }, false],
    ["a name and a region", { name: "Cankaya", region: "Anatolia" }, false],
    [
      "a name and a producer",
      { name: "Cankaya", producer: "Kavaklidere" },
      true,
    ],
    [
      "a name, a vintage and a region",
      { name: "Cankaya", vintage: 2023, region: "Anatolia" },
      true,
    ],
    ["a producer with no name", { name: "", producer: "Kavaklidere" }, false],
  ])("%s -> %s", (_label, input, expected) => {
    expect(isSpecificWineIdentity(input as any)).toBe(expected);
  });

  it("treats a vintage Postgres would read as NULL as absent", () => {
    // The RPC takes an `integer`; the resolver reaches it through
    // `parseInt(...) || null`. A predicate that accepted "MMXV" here would
    // answer a different question from the one the database answers.
    expect(
      isSpecificWineIdentity({
        name: "Cankaya",
        vintage: "MMXV",
        region: "Anatolia",
      }),
    ).toBe(false);
  });
});

describe("a generic name never joins the shared library", () => {
  it("gives two venues two different wines for the same words", async () => {
    const lib = new FakeLibrary();
    const service = await makeService(lib);

    const meyhouse = await service.resolveOrCreateLibraryWine(
      HOUSE_WHITE,
      MEYHOUSE,
    );
    const antalya = await service.resolveOrCreateLibraryWine(
      HOUSE_WHITE,
      ANTALYA,
    );

    expect(antalya.masterWineId).not.toBe(meyhouse.masterWineId);
    expect(lib.rows).toHaveLength(2);
    expect(lib.rows.map((r) => r.provisional_for_restaurant_id)).toEqual([
      MEYHOUSE,
      ANTALYA,
    ]);
    expect(new Set(lib.rows.map((r) => r.signature_hash)).size).toBe(2);
    expect(antalya.provisional).toBe(true);
  });

  it("never asks the matcher about a name that identifies nothing", async () => {
    const lib = new FakeLibrary();
    // The Sim Meyhouse row, offered at the confidence the live database
    // actually returned. Even handed the answer, the resolver must not take it.
    lib.candidates = [
      { id: "meyhouse-house-white", library_tier: 4, confidence: 90 },
    ];
    const service = await makeService(lib);

    const result = await service.resolveOrCreateLibraryWine(
      HOUSE_WHITE,
      ANTALYA,
    );

    expect(lib.matchCalls).toHaveLength(0);
    expect(result.masterWineId).not.toBe("meyhouse-house-white");
    expect(result.matched).toBe(false);
    expect(result.provisional).toBe(true);
    // No comparison happened, so there is no score to report.
    expect(result.confidence).toBeNull();
  });

  it("lands the same venue back on its own row instead of duplicating it", async () => {
    const lib = new FakeLibrary();
    const service = await makeService(lib);

    const first = await service.resolveOrCreateLibraryWine(
      HOUSE_WHITE,
      ANTALYA,
    );
    const again = await service.resolveOrCreateLibraryWine(
      HOUSE_WHITE,
      ANTALYA,
    );

    expect(again.masterWineId).toBe(first.masterWineId);
    expect(lib.rows).toHaveLength(1);
  });

  it("refuses to resolve a generic name with no venue to own it", async () => {
    const lib = new FakeLibrary();
    const service = await makeService(lib);

    await expect(
      service.resolveOrCreateLibraryWine(HOUSE_WHITE, ""),
    ).rejects.toThrow(/only ever one venue's own wine/);
    expect(lib.rows).toHaveLength(0);
  });

  it("still links a specific identity to the shared library", async () => {
    const lib = new FakeLibrary();
    lib.candidates = [{ id: "shared-musar", library_tier: 2, confidence: 96 }];
    const service = await makeService(lib);

    const result = await service.resolveOrCreateLibraryWine(
      { name: "Musar Rouge", producer: "Chateau Musar", vintage: 2015 },
      ANTALYA,
    );

    expect(lib.matchCalls).toHaveLength(1);
    expect(result.masterWineId).toBe("shared-musar");
    expect(result.matched).toBe(true);
    expect(result.provisional).toBeUndefined();
  });

  it("creates a SHARED row for a specific wine the library has never seen", async () => {
    const lib = new FakeLibrary();
    const service = await makeService(lib);

    const result = await service.resolveOrCreateLibraryWine(
      { name: "Cankaya", producer: "Kavaklidere", vintage: 2023 },
      ANTALYA,
    );

    expect(result.provisional).toBeUndefined();
    expect(lib.rows[0].provisional_for_restaurant_id).toBeUndefined();
    // Deliberately NOT asserted: that the stored hash equals
    // hashWineSignature(the draft). On the shared path it does not, and that
    // is a pre-existing defect this change does not touch — the row is written
    // with `country: item.country || "Unknown"`, the trigger rehashes from the
    // STORED fields, and the read-back then looks for the draft's hash. A
    // second import of the same countryless wine therefore raises "insert was
    // skipped but no row carries signature". Measured here, filed in
    // v3.0-TECH-DEBT.md; the fix belongs with the ops track that is removing
    // the fabrication.
    expect(lib.rows[0].name).toBe("Cankaya");
  });
});

describe("a whole menu at once", () => {
  it("separates the venue's own lines from the shared ones", async () => {
    const lib = new FakeLibrary();
    const service = await makeService(lib);

    const results = await service.resolveLibraryWinesBatch(
      [
        { name: "House White Wine" },
        // Carries a country on purpose: without one the shared path writes
        // "Unknown" into the row and then reads back by a hash computed from
        // the draft's absent country, which is the pre-existing defect noted
        // above. This test is about the ADR 0130 split, not about that.
        {
          name: "Cankaya",
          producer: "Kavaklidere",
          vintage: 2023,
          country: "Turkey",
        },
      ],
      ANTALYA,
    );

    expect(results[0]?.provisional).toBe(true);
    expect(results[1]?.provisional).toBe(false);
    const owned = lib.rows.map((r) => r.provisional_for_restaurant_id);
    expect(owned).toEqual([ANTALYA, null]);
  });

  it("does not let a matcher hit override the rule for a generic line", async () => {
    const lib = new FakeLibrary();
    // A matcher that forgot the gate hands back the Meyhouse row for index 0.
    lib.candidates = [
      {
        input_index: 0,
        id: "meyhouse-house-white",
        library_tier: 4,
        confidence: 90,
      },
    ];
    const service = await makeService(lib);

    const results = await service.resolveLibraryWinesBatch(
      [{ name: "House White Wine" }],
      ANTALYA,
    );

    expect(results[0]?.masterWineId).not.toBe("meyhouse-house-white");
    expect(results[0]?.provisional).toBe(true);
  });

  it("refuses a menu with generic lines and no venue to own them", async () => {
    const lib = new FakeLibrary();
    const service = await makeService(lib);

    await expect(
      service.resolveLibraryWinesBatch([{ name: "House White" }], ""),
    ).rejects.toThrow(/only ever one venue's own wine/);
  });
});

describe("the venue-scoped key", () => {
  it("cannot be mistaken for a shared key", () => {
    // Not "unlikely to collide" — disjoint by construction. A shared key's
    // first segment is normalized producer text, whose alphabet is [a-z0-9 ],
    // so it can never begin with "venue:".
    expect(hashProvisionalWineSignature(ANTALYA, HOUSE_WHITE)).not.toBe(
      hashWineSignature(HOUSE_WHITE),
    );
    expect(hashProvisionalWineSignature(ANTALYA, HOUSE_WHITE)).not.toBe(
      hashProvisionalWineSignature(MEYHOUSE, HOUSE_WHITE),
    );
    expect(hashProvisionalWineSignature(ANTALYA, HOUSE_WHITE)).toBe(
      hashProvisionalWineSignature(ANTALYA, { name: "  House White Wine " }),
    );
  });
});
