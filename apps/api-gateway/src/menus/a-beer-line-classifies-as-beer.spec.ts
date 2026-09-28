import * as fs from "fs";
import * as path from "path";

import { MenusService } from "./menus.service";
import {
  MENU_CATEGORY_VOCABULARY,
  type MenuCategory,
} from "./wine-extract-item.interface";
import { WineSubmissionsService } from "../wines/wine-submissions.service";
import { registerForKind } from "../cellar/cellar-registers";
import type { DatabaseService } from "../database/database.service";

/**
 * A beer on an uploaded menu comes back as beer.
 *
 * THE BREAK, end to end, before this file existed:
 *
 *   1. The extraction prompt was a WINE prompt — every field note named a
 *      winery, a vintage, a grape — so beer lines were extracted erratically
 *      or not at all, and `category` came back in whatever words the menu
 *      happened to print.
 *   2. `menus.service.ts` handed the resolver five fields and `category` was
 *      not one of them, so whatever the extraction did decide died there.
 *   3. `resolveLibraryWinesBatch` wrote the library row with
 *      `primary_type: 'unknown'` and no `data_enrichment` at all — and
 *      `beverage_kind` is NOT settable by application code. The trigger
 *      recomputes it from those two inputs and nothing else, so every row a
 *      menu upload created came out `beverage_kind = 'unknown'`.
 *
 * Measured on production 2026-09-05 and recorded in
 * `.planning/v3.0-TECH-DEBT.md`: 78 rows `classification_status =
 * 'unclassified'`, all `source = 'menu_import'`, all `beverage_kind =
 * 'unknown'` — with the diagnosis "the real fault is upstream: the bulk-add
 * path writes a library row without ever asking the classifier".
 *
 * So `CellarRegistersService` could infer Beer perfectly well and never had a
 * beer to infer it from. The four tests below are the four links of that
 * chain: the vocabulary the prompt may emit, the field the import carries, the
 * column the writer fills, and the register the kind lands in.
 */

const RESTAURANT_ID = "33333333-3333-3333-3333-333333333333";

/* ── link 1: the vocabulary the classifier can actually read ───────────── */

/**
 * The classifier, read out of the migration rather than restated here.
 *
 * `wine_classify_beverage_kind()` lives in SQL and cannot be called from a
 * unit test, and hand-copying its keyword lists into TypeScript would create
 * a second home for the one fact this whole change depends on — the two would
 * drift the first time either side gained a word. So the branches are PARSED
 * from the migration file and evaluated in their own order. When the SQL
 * changes, this changes with it.
 */
function loadSqlClassifier(): (menuCategory: string) => string {
  const migration = path.resolve(
    __dirname,
    "../../../../supabase/migrations/20260817060000_beverage_kind_classification.sql",
  );
  const sql = fs.readFileSync(migration, "utf8");

  // `WHEN mc.v ~ '…' THEN 'kind'`, including the branches whose pattern is
  // built by `||`-concatenating several quoted fragments across lines.
  const branchRe =
    /WHEN\s+mc\.v\s+~\s+\(?((?:'[^']*'\s*(?:\|\|\s*)?)+)\)?\s*THEN\s+'(\w+)'/g;

  const branches: Array<{ re: RegExp; kind: string }> = [];
  for (const m of sql.matchAll(branchRe)) {
    const pattern = [...m[1].matchAll(/'([^']*)'/g)].map((q) => q[1]).join("");
    // Postgres spells a word boundary \m (start) and \M (end); JavaScript
    // spells both \b. Everything else in these patterns is shared syntax.
    branches.push({
      re: new RegExp(pattern.replace(/\\m/g, "\\b").replace(/\\M/g, "\\b")),
      kind: m[2],
    });
  }

  if (branches.length === 0) {
    throw new Error(
      "Parsed no WHEN branches out of the beverage_kind migration — the " +
        "classifier moved or changed shape, and this guard is now blind.",
    );
  }

  return (menuCategory: string) => {
    // The function's own normalisation: lower(btrim(...)) with parens
    // stripped, because "whisk(e)y" prints parens that are not regex groups.
    const v = menuCategory.trim().toLowerCase().replace(/[()]/g, "");
    for (const b of branches) if (b.re.test(v)) return b.kind;
    return "unknown";
  };
}

describe("every category the extractor may emit is one the database can read", () => {
  const classify = loadSqlClassifier();

  /**
   * The point of the whole change, stated as data.
   *
   * `soft drink` is the one deliberate `unknown`: the classifier has no value
   * for it, which is exactly why `soft_drinks` is a NAME_ONLY_REGISTER
   * (cellar/cellar-registers.ts). It is in the vocabulary anyway so the model
   * does not file a cola under `non-alcoholic` and lose the distinction the
   * menu-label reader can still make.
   */
  const EXPECTED: Record<MenuCategory, string> = {
    red: "wine",
    white: "wine",
    rose: "wine",
    sparkling: "wine",
    orange: "wine",
    dessert: "wine",
    fortified: "wine",
    beer: "beer",
    cider: "cider",
    sake: "sake",
    cocktail: "cocktail",
    spirit: "spirit",
    whiskey: "spirit",
    "soft drink": "unknown",
    "non-alcoholic": "non_alcoholic",
  };

  it("has an expectation recorded for every vocabulary member", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      [...MENU_CATEGORY_VOCABULARY].sort(),
    );
  });

  it.each(MENU_CATEGORY_VOCABULARY)(
    "category %s reaches the kind the register reader expects",
    (category) => {
      expect(classify(category)).toBe(EXPECTED[category]);
    },
  );

  it("classifies beer as beer, which is the register the founder named", () => {
    expect(classify("beer")).toBe("beer");
    expect(registerForKind(classify("beer"))).toBe("beer");
  });

  it("still classifies a wine line as wine — this change adds, it does not move", () => {
    expect(registerForKind(classify("red"))).toBe("wines");
    expect(registerForKind(classify("sparkling"))).toBe("wines");
  });

  /**
   * Not the founder's ask, but the scope note says to report what the same
   * change does and does not reach. Cocktails, spirits and non-alcoholic ride
   * along on the identical mechanism; sake and cider classify correctly and
   * have no register in the founder's seven, so they surface as
   * `unmappedKinds` rather than being folded into a neighbour.
   */
  it("carries the other non-wine registers on the same mechanism", () => {
    expect(registerForKind(classify("cocktail"))).toBe("cocktails");
    expect(registerForKind(classify("spirit"))).toBe("spirits");
    expect(registerForKind(classify("whiskey"))).toBe("spirits");
    expect(registerForKind(classify("non-alcoholic"))).toBe("non_alcoholic");
    expect(registerForKind(classify("sake"))).toBeNull();
    expect(registerForKind(classify("cider"))).toBeNull();
  });
});

/* ── link 2: the import carries the category to the resolver ───────────── */

function makeMenusService() {
  const calls: { resolveInput: any[] } = { resolveInput: [] };

  const chain = (table: string): any => {
    const api: any = {
      select: () => api,
      eq: () => api,
      is: () => api,
      order: () => api,
      insert: (payload: any) => {
        api._inserted = payload;
        return api;
      },
      update: () => api,
      maybeSingle: async () =>
        table === "restaurant_menus"
          ? {
              data: { id: "menu-1", restaurant_id: RESTAURANT_ID },
              error: null,
            }
          : { data: null, error: null },
      single: async () => ({ data: { id: "menu-1" }, error: null }),
      then: (resolve: any) => {
        if (table === "menu_items" && api._inserted) {
          resolve({
            data: (api._inserted as any[]).map((r, i) => ({
              id: `mi-${i + 1}`,
              wine_library_id: r.wine_library_id,
              name: r.name,
            })),
            error: null,
          });
          return;
        }
        resolve({ data: [], error: null });
      },
    };
    return api;
  };

  const dbService = {
    supabase: { from: chain },
    getClient: () => ({ from: chain }),
  } as unknown as DatabaseService;

  const wineSubmissions = {
    resolveLibraryWinesBatch: async (input: any[]) => {
      calls.resolveInput = input;
      return input.map((_, i) => ({
        masterWineId: `mw-${i + 1}`,
        matched: false,
        libraryTier: 3,
        confidence: null,
      }));
    },
    normalizeText: (s: string | null | undefined) =>
      (s ?? "").toLowerCase().trim(),
  } as unknown as WineSubmissionsService;

  const service = new MenusService(
    dbService,
    undefined as any,
    undefined as any,
    wineSubmissions,
  );
  return { service, calls };
}

describe("a menu import hands the line's own category to the library writer", () => {
  it("carries category through as menuCategory for beer and for wine alike", async () => {
    const { service, calls } = makeMenusService();

    await service.importMenu(
      {
        restaurantId: RESTAURANT_ID,
        method: "manual",
        data: {
          items: [
            { name: "Pale Ale", producer: "Sierra Nevada", category: "beer" },
            { name: "Merlot", producer: "Duckhorn", category: "red" },
          ],
        },
      } as any,
      "user-1",
    );

    // Before this change the resolver was handed five fields and category was
    // not one of them, so the kind of drink died at this boundary.
    expect(calls.resolveInput).toHaveLength(2);
    expect(calls.resolveInput[0].menuCategory).toBe("beer");
    expect(calls.resolveInput[1].menuCategory).toBe("red");
  });
});

/* ── link 3: the writer fills the column the trigger reads ─────────────── */

function makeSubmissionsService() {
  const inserted: Array<Record<string, any>> = [];

  const chain = (table: string): any => {
    const rowsFor = () => (table === "master_wine_library" ? inserted : []);
    const capture = (payload: any) => {
      if (table !== "master_wine_library") return;
      for (const r of Array.isArray(payload) ? payload : [payload]) {
        inserted.push({ id: `mw-${inserted.length + 1}`, ...r });
      }
    };
    const api: any = {
      select: () => api,
      eq: () => api,
      in: () => api,
      is: () => api,
      not: () => api,
      or: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: rowsFor()[0] ?? null, error: null }),
      single: async () => ({ data: rowsFor()[0] ?? null, error: null }),
      insert: (payload: any) => {
        capture(payload);
        return api;
      },
      upsert: (payload: any) => {
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
    rpc: async () => ({ data: [], error: null }),
  };
  const dbService = { supabase, getClient: () => supabase } as any;
  return { service: new WineSubmissionsService(dbService), inserted };
}

describe("the library row a menu upload creates arrives classifiable", () => {
  it("writes data_enrichment.menu_category so the trigger can read it", async () => {
    const { service, inserted } = makeSubmissionsService();

    await service.resolveLibraryWinesBatch(
      [
        {
          name: "Pale Ale",
          producer: "Sierra Nevada",
          menuCategory: "beer",
        },
      ],
      RESTAURANT_ID,
    );

    expect(inserted).toHaveLength(1);
    // The only input trg_wine_beverage_kind has, given primary_type 'unknown'.
    expect(inserted[0].data_enrichment).toEqual({ menu_category: "beer" });
    // Unchanged on purpose: 'unknown' here MEANS unclassified, and inventing a
    // wine style for a beer would be the fabrication this row avoids.
    expect(inserted[0].primary_type).toBe("unknown");
  });

  it("writes null rather than an empty object when the menu gave no category", async () => {
    const { service, inserted } = makeSubmissionsService();

    await service.resolveLibraryWinesBatch(
      [{ name: "House White" }],
      RESTAURANT_ID,
    );

    expect(inserted).toHaveLength(1);
    expect(inserted[0].data_enrichment).toBeNull();
  });

  it("keeps the category out of the identity — it is not a matching field", async () => {
    const { service, inserted } = makeSubmissionsService();

    await service.resolveLibraryWinesBatch(
      [
        { name: "Pale Ale", producer: "Sierra Nevada", menuCategory: "beer" },
        { name: "Pale Ale", producer: "Sierra Nevada", menuCategory: "cider" },
      ],
      RESTAURANT_ID,
    );

    // One bottle, listed twice. Two rows here would be a duplicate in the
    // SHARED catalogue keyed on a field that is not part of the identity.
    expect(inserted).toHaveLength(1);
  });
});

/* ── link 4: the kind the trigger computes is a register the reader shows ─ */

describe("beverage_kind 'beer' is the Beer register", () => {
  it("maps through registerForKind, which the cellar readout already uses", () => {
    expect(registerForKind("beer")).toBe("beer");
  });
});
