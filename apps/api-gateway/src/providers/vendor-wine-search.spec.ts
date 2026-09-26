/**
 * The name-only wine search on /vendors (founder, 2026-09-26, round 7, item
 * 48; ADR 0221): a search by a wine's NAME matches ANY vintage, and each vendor
 * is labelled with the vintage(s) its evidence names. "Supplies my menu" keeps
 * the exact vintage (vendor-menu-supply.spec.ts); these tests pin the other
 * half.
 *
 * The fake client applies the real filters (including the `.or()` strings the
 * register's visibility rule writes, and `.ilike()` wildcards) to in-memory
 * tables, so each test states rows and reads the answer.
 */

import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ID_CHUNK,
  accentBlindLike,
  matchesWine,
  parseWineQuery,
  readCatalogueWineListers,
  readOwnWineSellers,
  vintageWritten,
  type WineQuery,
} from "./vendor-wine-search";
import { PAGE_ROWS } from "./vendor-menu-supply";
import { ProvidersService } from "./providers.service";
import { ProvidersController } from "./providers.controller";

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;
type Filter = { op: string; col: string; val: unknown };
type Seen = { table: string; select: string; filters: Filter[] };

const HOUSE = "house-a";
const OTHER = "house-b";

function likeToRegex(pattern: string): RegExp {
  let re = "";
  for (const ch of pattern) {
    if (ch === "%") re += ".*";
    else if (ch === "_") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is");
}

function test1(v: unknown, op: string, val: unknown): boolean {
  switch (op) {
    case "eq":
      return v === val;
    case "neq":
      return v != null && v !== val;
    case "in":
      return (val as unknown[]).includes(v);
    case "gt":
      return v != null && String(v) > String(val);
    case "is":
      return v == null;
    case "not.is":
      return v != null;
    case "ilike":
      return typeof v === "string" && likeToRegex(String(val)).test(v);
    default:
      throw new Error(`fake has no ${op}`);
  }
}

/** `a.is.null,b.eq.x` — PostgREST's or-string, as the visibility rule writes it. */
function orMatches(r: Row, spec: string): boolean {
  return spec.split(",").some((part) => {
    const [col, op, ...rest] = part.split(".");
    const raw = rest.join(".");
    const val = raw === "null" ? null : raw;
    return test1(r[col], op, val);
  });
}

function fakeDb(tables: Tables, fail?: string) {
  const seen: Seen[] = [];
  const supabase: any = {
    from(table: string) {
      const rec: Seen = { table, select: "", filters: [] };
      seen.push(rec);
      let limit = Infinity;
      const push = (op: string) => (col: string, val: unknown) => (
        rec.filters.push({ op, col, val }),
        q
      );
      const q: any = {
        select(cols: string) {
          rec.select = cols;
          return q;
        },
        eq: push("eq"),
        neq: push("neq"),
        in: push("in"),
        gt: push("gt"),
        is: push("is"),
        ilike: push("ilike"),
        or: (spec: string) => (
          rec.filters.push({ op: "or", col: "", val: spec }),
          q
        ),
        not: (col: string, op: string, val: unknown) => (
          rec.filters.push({ op: `not.${op}`, col, val }),
          q
        ),
        order: () => q,
        limit: (n: number) => ((limit = n), q),
        then(resolve: any) {
          if (fail === table) {
            return resolve({
              data: null,
              error: { message: "statement timeout" },
            });
          }
          const embedOrders = rec.select.includes("procurement_orders!inner");
          let rows: Row[] = (tables[table] ?? []).map(
            (r): Row =>
              embedOrders
                ? {
                    ...r,
                    procurement_orders:
                      (tables.procurement_orders ?? []).find(
                        (o) => o.id === r.order_id,
                      ) ?? null,
                  }
                : { ...r },
          );
          if (embedOrders) rows = rows.filter((r) => r.procurement_orders);
          const get = (r: Row, col: string) =>
            col.includes(".")
              ? r[col.split(".")[0]]?.[col.split(".")[1]]
              : r[col];
          for (const f of rec.filters) {
            rows = rows.filter((r) =>
              f.op === "or"
                ? orMatches(r, String(f.val))
                : test1(get(r, f.col), f.op, f.val),
            );
          }
          rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
          return resolve({ data: rows.slice(0, limit), error: null });
        },
      };
      return q;
    },
  };
  return { supabase, seen };
}

const Q = (s: string): WineQuery => {
  const q = parseWineQuery(s);
  if (!q) throw new Error(`test query ${s} did not parse`);
  return q;
};

const LIBRARY: Row[] = [
  {
    id: "w-opus-18",
    name: "Opus One",
    producer: "Opus One Winery",
    vintage: 2018,
  },
  {
    id: "w-opus-19",
    name: "Opus One",
    producer: "Opus One Winery",
    vintage: 2019,
  },
  {
    id: "w-opus-nv",
    name: "Opus One",
    producer: "Opus One Winery",
    vintage: null,
  },
  {
    id: "w-overture",
    name: "Overture",
    producer: "Opus One Winery",
    vintage: null,
  },
  {
    id: "w-margaux-15",
    name: "Grand Vin",
    producer: "Château Margaux",
    vintage: 2015,
  },
  { id: "w-malbec", name: "Malbec Reserva", producer: "Catena", vintage: 2021 },
];

// ---------------------------------------------------------------------------

describe("the query", () => {
  it("needs two characters of NAME; a year alone is not a name", () => {
    expect(parseWineQuery("")).toBeNull();
    expect(parseWineQuery("o")).toBeNull();
    expect(parseWineQuery("2019")).toBeNull();
    expect(parseWineQuery(42)).toBeNull();
    expect(parseWineQuery("op")).toEqual({
      text: "op",
      words: ["op"],
      vintages: [],
    });
  });

  it("a four-digit year is a vintage, not a word of the name", () => {
    expect(parseWineQuery("  Opus One 2019 ")).toEqual({
      text: "Opus One 2019",
      words: ["opus", "one"],
      vintages: [2019],
    });
  });

  it("a name alone matches every vintage, including an unstated one", () => {
    const q = Q("opus one");
    expect(matchesWine(q, "Opus One Winery Opus One", 2018)).toBe(true);
    expect(matchesWine(q, "Opus One Winery Opus One", 2019)).toBe(true);
    expect(matchesWine(q, "Opus One Winery Opus One", null)).toBe(true);
  });

  it("a stated year matches that vintage exactly, and never an unstated one", () => {
    const q = Q("opus one 2019");
    expect(matchesWine(q, "Opus One", 2019)).toBe(true);
    expect(matchesWine(q, "Opus One", 2018)).toBe(false);
    expect(matchesWine(q, "Opus One", null)).toBe(false);
  });

  it("is accent-, case- and order-blind, and every word is required", () => {
    expect(
      matchesWine(Q("margaux chateau"), "Château Margaux Grand Vin", 2015),
    ).toBe(true);
    expect(matchesWine(Q("MARGAUX"), "château margaux", null)).toBe(true);
    expect(matchesWine(Q("margaux latour"), "Château Margaux", null)).toBe(
      false,
    );
  });

  it("reads a vintage out of a vendor's own text", () => {
    expect(vintageWritten("Opus One 2019 750ml")).toBe(2019);
    expect(vintageWritten("Opus One NV")).toBeNull();
    expect(vintageWritten(null)).toBeNull();
  });

  it("the server-side narrowing is accent-blind and carries no person's wildcard", () => {
    expect(accentBlindLike("chateau")).toBe("%_h_t___%");
    expect(
      likeToRegex(accentBlindLike("chateau")).test("Château Margaux"),
    ).toBe(true);
    expect(accentBlindLike("opus")).toBe("%_p__%");
  });
});

// ---------------------------------------------------------------------------

function ownTables(): Tables {
  return {
    master_wine_library: LIBRARY,
    price_history: [
      {
        id: "p1",
        restaurant_id: HOUSE,
        provider_id: "v1",
        master_wine_id: "w-opus-18",
      },
      {
        id: "p2",
        restaurant_id: HOUSE,
        provider_id: "v3",
        master_wine_id: "w-malbec",
      },
      // Another house's price: never this house's evidence.
      {
        id: "p3",
        restaurant_id: OTHER,
        provider_id: "v-theirs",
        master_wine_id: "w-opus-19",
      },
    ],
    procurement_orders: [
      {
        id: "o1",
        restaurant_id: HOUSE,
        provider_id: "v1",
        status: "DELIVERED",
      },
      { id: "o2", restaurant_id: HOUSE, provider_id: "v4", status: "PENDING" },
      {
        id: "o3",
        restaurant_id: HOUSE,
        provider_id: "v5",
        status: "CANCELLED",
      },
    ],
    procurement_order_items: [
      { id: "oi1", order_id: "o1", master_wine_id: "w-opus-19" },
      { id: "oi2", order_id: "o2", master_wine_id: "w-opus-19" },
      { id: "oi3", order_id: "o3", master_wine_id: "w-opus-18" },
    ],
    restaurant_inventory: [
      {
        id: "i1",
        restaurant_id: HOUSE,
        provider_id: "v2",
        master_wine_id: "w-opus-19",
        deleted_at: null,
      },
      {
        id: "i2",
        restaurant_id: HOUSE,
        provider_id: "v6",
        master_wine_id: "w-opus-nv",
        deleted_at: "2026-01-01",
      },
      {
        id: "i3",
        restaurant_id: HOUSE,
        provider_id: "v7",
        master_wine_id: "w-margaux-15",
        deleted_at: null,
      },
    ],
  };
}

describe("All my vendors — a name search matches any vintage (item 48)", () => {
  it("finds every vendor who sold any vintage, labelled with the vintages and the evidence", async () => {
    const { supabase } = fakeDb(ownTables());
    const out = await readOwnWineSellers(supabase, HOUSE, Q("Opus One"));
    expect(out.winesMatched).toBe(2);
    expect(out.sellers).toEqual([
      {
        providerId: "v1",
        wines: [
          {
            masterWineId: "w-opus-19",
            producer: "Opus One Winery",
            name: "Opus One",
            vintage: 2019,
            priced: false,
            ordered: true,
            stocked: false,
          },
          {
            masterWineId: "w-opus-18",
            producer: "Opus One Winery",
            name: "Opus One",
            vintage: 2018,
            priced: true,
            ordered: false,
            stocked: false,
          },
        ],
      },
      {
        providerId: "v2",
        wines: [
          {
            masterWineId: "w-opus-19",
            producer: "Opus One Winery",
            name: "Opus One",
            vintage: 2019,
            priced: false,
            ordered: false,
            stocked: true,
          },
        ],
      },
    ]);
  });

  it("a stated year narrows to that exact vintage", async () => {
    const { supabase } = fakeDb(ownTables());
    const out = await readOwnWineSellers(supabase, HOUSE, Q("opus one 2018"));
    expect(
      out.sellers.map((s) => [s.providerId, s.wines.map((w) => w.vintage)]),
    ).toEqual([["v1", [2018]]]);
  });

  it("a pending or cancelled order, a deleted stock line and another house's price are not evidence", async () => {
    const { supabase } = fakeDb(ownTables());
    const out = await readOwnWineSellers(supabase, HOUSE, Q("opus"));
    const ids = out.sellers.map((s) => s.providerId);
    expect(ids).not.toContain("v4");
    expect(ids).not.toContain("v5");
    expect(ids).not.toContain("v6");
    expect(ids).not.toContain("v-theirs");
  });

  it("matches the producer too, without accents", async () => {
    const { supabase } = fakeDb(ownTables());
    const out = await readOwnWineSellers(supabase, HOUSE, Q("chateau margaux"));
    expect(out.sellers).toHaveLength(1);
    expect(out.sellers[0]).toMatchObject({ providerId: "v7" });
    expect(out.sellers[0].wines[0]).toMatchObject({
      name: "Grand Vin",
      vintage: 2015,
      stocked: true,
    });
  });

  it("a name nobody sold is an empty answer, not an error", async () => {
    const { supabase } = fakeDb(ownTables());
    const out = await readOwnWineSellers(supabase, HOUSE, Q("sassicaia"));
    expect(out).toMatchObject({ winesMatched: 0, sellers: [] });
  });

  it("every house table is read for the caller's house; the library only by id", async () => {
    const { supabase, seen } = fakeDb(ownTables());
    await readOwnWineSellers(supabase, HOUSE, Q("opus"));
    const scopeCol: Record<string, string> = {
      price_history: "restaurant_id",
      procurement_order_items: "procurement_orders.restaurant_id",
      restaurant_inventory: "restaurant_id",
    };
    for (const s of seen) {
      if (s.table === "master_wine_library") {
        expect(s.filters.map((f) => [f.op, f.col])).toEqual([["in", "id"]]);
        continue;
      }
      expect(scopeCol[s.table]).toBeDefined();
      expect(s.filters).toContainEqual({
        op: "eq",
        col: scopeCol[s.table],
        val: HOUSE,
      });
    }
    // Presence only: the unit guard's presence arm must keep admitting this read.
    const ph = seen.find((s) => s.table === "price_history")!;
    expect(ph.select).toBe("id, provider_id, master_wine_id");
  });

  it("reads past the 1000-row page and chunks the library by id — no silent cap", async () => {
    const t = ownTables();
    const n = PAGE_ROWS + 5;
    const lib: Row[] = [];
    t.price_history = [];
    for (let i = 0; i < n; i += 1) {
      const id = `w-x-${String(i).padStart(5, "0")}`;
      lib.push({
        id,
        name: "Opus One",
        producer: "Opus One Winery",
        vintage: 1900 + (i % 150),
      });
      t.price_history.push({
        id: `p-${String(i).padStart(5, "0")}`,
        restaurant_id: HOUSE,
        provider_id: "v9",
        master_wine_id: id,
      });
    }
    t.master_wine_library = lib;
    const { supabase, seen } = fakeDb(t);
    const out = await readOwnWineSellers(supabase, HOUSE, Q("opus"));
    const v9 = out.sellers.find((s) => s.providerId === "v9")!;
    expect(v9.wines).toHaveLength(n);
    const libReads = seen.filter((s) => s.table === "master_wine_library");
    expect(libReads.length).toBeGreaterThanOrEqual(Math.ceil(n / ID_CHUNK));
    for (const r of libReads) {
      expect((r.filters[0].val as unknown[]).length).toBeLessThanOrEqual(
        ID_CHUNK,
      );
    }
  });

  it.each([
    "price_history",
    "procurement_order_items",
    "restaurant_inventory",
    "master_wine_library",
  ])("a failed read of %s throws, never an empty answer", async (table) => {
    const { supabase } = fakeDb(ownTables(), table);
    await expect(
      readOwnWineSellers(supabase, HOUSE, Q("opus")),
    ).rejects.toThrow(/could not be read/);
  });
});

// ---------------------------------------------------------------------------

function catalogueTables(): Tables {
  return {
    master_wine_library: LIBRARY,
    vendor_catalogue: [
      {
        id: "c1",
        name: "Napa Imports",
        type: "importer",
        country: "US",
        state: "CA",
        city: "Napa",
        is_active: true,
        listing_tier: "curated",
      },
      {
        id: "c2",
        name: "Bay Wholesale",
        type: "wholesaler",
        country: "US",
        state: "CA",
        city: "Oakland",
        is_active: true,
        listing_tier: "curated",
      },
      {
        id: "c3",
        name: "Registry Row",
        type: "other",
        country: "US",
        is_active: true,
        listing_tier: "registry",
      },
      {
        id: "c4",
        name: "Istanbul Şarap",
        type: "distributor",
        country: "TR",
        is_active: true,
        listing_tier: "curated",
      },
      {
        id: "c5",
        name: "Closed Co",
        type: "other",
        country: "US",
        is_active: false,
        listing_tier: "curated",
      },
    ],
    vendor_price_observations: [
      // This house's own sightings.
      {
        id: "s1",
        restaurant_id: HOUSE,
        vendor_catalogue_id: "c1",
        master_wine_id: "w-opus-18",
        product_name_raw: "Opus One 2018",
        source_type: "website_scrape",
        observed_at: "2026-08-01T00:00:00Z",
      },
      {
        id: "s2",
        restaurant_id: HOUSE,
        vendor_catalogue_id: "c1",
        master_wine_id: "w-opus-18",
        product_name_raw: "Opus One 2018 750",
        source_type: "quote",
        observed_at: "2026-09-01T00:00:00Z",
      },
      // Openly posted (no house), unresolved: the vintage is read from the text.
      {
        id: "s3",
        restaurant_id: null,
        vendor_catalogue_id: "c2",
        master_wine_id: null,
        product_name_raw: "OPUS ONE Napa Valley 2016",
        source_type: "website_scrape",
        observed_at: "2026-07-01T00:00:00Z",
      },
      // Another house's paper: never shown to this house.
      {
        id: "s4",
        restaurant_id: OTHER,
        vendor_catalogue_id: "c2",
        master_wine_id: "w-opus-19",
        product_name_raw: "Opus One 2019",
        source_type: "invoice",
        observed_at: "2026-09-01T00:00:00Z",
      },
      // Contributed-aggregate-only: never a row, even this house's own.
      {
        id: "s5",
        restaurant_id: HOUSE,
        visibility: "contributed_aggregate_only",
        vendor_catalogue_id: "c2",
        master_wine_id: "w-opus-19",
        product_name_raw: "Opus One 2019",
        source_type: "invoice",
        observed_at: "2026-09-01T00:00:00Z",
      },
      // Tier/country/active filters.
      {
        id: "s6",
        restaurant_id: null,
        vendor_catalogue_id: "c3",
        master_wine_id: null,
        product_name_raw: "Opus One 2015",
        source_type: "website_scrape",
        observed_at: "2026-07-01T00:00:00Z",
      },
      {
        id: "s7",
        restaurant_id: null,
        vendor_catalogue_id: "c4",
        master_wine_id: null,
        product_name_raw: "Opus One 2017",
        source_type: "website_scrape",
        observed_at: "2026-07-01T00:00:00Z",
      },
      {
        id: "s8",
        restaurant_id: null,
        vendor_catalogue_id: "c5",
        master_wine_id: null,
        product_name_raw: "Opus One 2017",
        source_type: "website_scrape",
        observed_at: "2026-07-01T00:00:00Z",
      },
      // A house provider's sighting with no catalogue vendor: not this rung's.
      {
        id: "s9",
        restaurant_id: HOUSE,
        provider_id: "v1",
        vendor_catalogue_id: null,
        master_wine_id: "w-opus-19",
        product_name_raw: "Opus One 2019",
        source_type: "invoice",
        observed_at: "2026-09-01T00:00:00Z",
      },
      // Accented text, unaccented query.
      {
        id: "s10",
        restaurant_id: null,
        vendor_catalogue_id: "c1",
        master_wine_id: null,
        product_name_raw: "Château Margaux 2015",
        source_type: "website_scrape",
        observed_at: "2026-07-01T00:00:00Z",
      },
    ],
  };
}

describe("Find new vendors — a name search over curated catalogue sightings (item 48)", () => {
  it("lists catalogue vendors tied to any vintage, with the strongest source and the vintage", async () => {
    const { supabase } = fakeDb(catalogueTables());
    const out = await readCatalogueWineListers(
      supabase,
      HOUSE,
      Q("opus one"),
      "US",
    );
    // Equal wine counts: by vendor name ("Bay Wholesale" before "Napa Imports").
    expect(out.listers.map((l) => l.vendor.id)).toEqual(["c2", "c1"]);
    expect(out.listers[1].wines).toEqual([
      {
        masterWineId: "w-opus-18",
        producer: "Opus One Winery",
        name: "Opus One",
        vintage: 2018,
        vintageFromText: false,
        kind: "quoted",
        lastSeen: "2026-09-01T00:00:00Z",
      },
    ]);
    expect(out.listers[0].wines).toEqual([
      {
        masterWineId: null,
        producer: null,
        name: "OPUS ONE Napa Valley 2016",
        vintage: 2016,
        vintageFromText: true,
        kind: "listed",
        lastSeen: "2026-07-01T00:00:00Z",
      },
    ]);
  });

  it("never shows another house's paper or a contributed-only row", async () => {
    const { supabase } = fakeDb(catalogueTables());
    const out = await readCatalogueWineListers(
      supabase,
      HOUSE,
      Q("opus one 2019"),
      "US",
    );
    expect(out.listers).toEqual([]);
  });

  it("keeps to the rung's own catalogue: curated, active, in the chosen country", async () => {
    const { supabase } = fakeDb(catalogueTables());
    const us = await readCatalogueWineListers(supabase, HOUSE, Q("opus"), "US");
    expect(us.listers.map((l) => l.vendor.id)).not.toEqual(
      expect.arrayContaining(["c3"]),
    );
    expect(us.listers.map((l) => l.vendor.id)).not.toContain("c4");
    expect(us.listers.map((l) => l.vendor.id)).not.toContain("c5");
    const tr = await readCatalogueWineListers(
      fakeDb(catalogueTables()).supabase,
      HOUSE,
      Q("opus"),
      "TR",
    );
    expect(tr.listers.map((l) => l.vendor.id)).toEqual(["c4"]);
  });

  it("finds accented text from an unaccented query", async () => {
    const { supabase } = fakeDb(catalogueTables());
    const out = await readCatalogueWineListers(
      supabase,
      HOUSE,
      Q("chateau margaux"),
      "US",
    );
    expect(out.listers.map((l) => [l.vendor.id, l.wines[0].vintage])).toEqual([
      ["c1", 2015],
    ]);
  });

  it("reads sightings only through the register's visibility rule (this house + openly posted)", async () => {
    const { supabase, seen } = fakeDb(catalogueTables());
    await readCatalogueWineListers(supabase, HOUSE, Q("opus"), "US");
    const vpo = seen.filter((s) => s.table === "vendor_price_observations");
    expect(vpo.length).toBeGreaterThan(0);
    for (const s of vpo) {
      expect(s.filters).toContainEqual({
        op: "or",
        col: "",
        val: `restaurant_id.is.null,restaurant_id.eq.${HOUSE}`,
      });
      expect(s.filters).toContainEqual({
        op: "or",
        col: "",
        val: "visibility.is.null,visibility.neq.contributed_aggregate_only",
      });
    }
    for (const s of seen.filter((x) => x.table === "vendor_catalogue")) {
      expect(s.filters).toContainEqual({
        op: "eq",
        col: "listing_tier",
        val: "curated",
      });
      expect(s.filters).toContainEqual({ op: "eq", col: "country", val: "US" });
    }
  });

  it.each([
    "vendor_price_observations",
    "vendor_catalogue",
    "master_wine_library",
  ])("a failed read of %s throws, never an empty answer", async (table) => {
    const { supabase } = fakeDb(catalogueTables(), table);
    await expect(
      readCatalogueWineListers(supabase, HOUSE, Q("opus"), "US"),
    ).rejects.toThrow(/could not be read/);
  });
});

// ---------------------------------------------------------------------------

describe("the service and the routes", () => {
  it("the service turns a failed read into a 503 with the reason", async () => {
    const { supabase } = fakeDb(ownTables(), "restaurant_inventory");
    const svc = Object.create(ProvidersService.prototype) as any;
    svc.databaseService = { supabase };
    svc.logger = { error: jest.fn() };
    const err = await svc
      .ownWineSellers(HOUSE, Q("opus"))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toMatch(
      /inventory could not be read.*not a wine nobody sold you/,
    );

    const { supabase: s2 } = fakeDb(catalogueTables(), "vendor_catalogue");
    svc.databaseService = { supabase: s2 };
    const err2 = await svc
      .catalogueWineListers(HOUSE, Q("opus"), "US")
      .catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(ServiceUnavailableException);
  });

  const organizations: any = {};

  it("GET /providers/wine-sellers answers for the caller's house with the parsed query", async () => {
    const ownWineSellers = jest.fn().mockResolvedValue({ sellers: [] });
    const c = new ProvidersController({ ownWineSellers } as any, organizations);
    await c.wineSellers(
      { userId: "u1", restaurantId: HOUSE } as any,
      "Opus One 2019",
    );
    expect(ownWineSellers).toHaveBeenCalledWith(HOUSE, {
      text: "Opus One 2019",
      words: ["opus", "one"],
      vintages: [2019],
    });
  });

  it("refuses a query too short to be a name (400) and a session with no house (403), reading nothing", async () => {
    const ownWineSellers = jest.fn();
    const c = new ProvidersController({ ownWineSellers } as any, organizations);
    await expect(
      c.wineSellers({ userId: "u1", restaurantId: HOUSE } as any, "o"),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      c.wineSellers({ userId: "u1", restaurantId: null } as any, "opus"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ownWineSellers).not.toHaveBeenCalled();
  });

  it("GET /providers/catalogue-wine-listers needs a two-letter country", async () => {
    const catalogueWineListers = jest.fn().mockResolvedValue({ listers: [] });
    const c = new ProvidersController(
      { catalogueWineListers } as any,
      organizations,
    );
    await expect(
      c.catalogueWineListers(
        { userId: "u1", restaurantId: HOUSE } as any,
        "opus",
        "USA",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await c.catalogueWineListers(
      { userId: "u1", restaurantId: HOUSE } as any,
      "opus",
      " tr ",
    );
    expect(catalogueWineListers).toHaveBeenCalledWith(
      HOUSE,
      { text: "opus", words: ["opus"], vintages: [] },
      "TR",
    );
  });
});
