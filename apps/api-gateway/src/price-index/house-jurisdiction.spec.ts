/**
 * A state is read inside its house's country (ADR 0305).
 *
 * The defect: every market reader of a house read `restaurants.state_province`
 * on its own, so a bare "MI" was Michigan whatever the house's country. An
 * Italian house that writes "MI" for Milano (Poste Italiane's own address
 * standard) was shown Michigan's posted prices, Michigan's distributors and
 * the United States' commodity series, and was counted in Michigan's pool of
 * price-book admitters. A house in Georgia the country was read as the US
 * state GA.
 *
 * The founder, 2026-10-07T19:48:13Z: *"Keep it, read inside the country
 * (Recommended)"* and, for a house with no country, *"Ask for the country
 * (Recommended)"*.
 *
 * One file for the resolver and all four readers, so the same five houses are
 * put to every reader and a reader that drifts from the others fails here.
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  COUNTRY_NOT_RECORDED_SENTENCE,
  houseJurisdictionKey,
  resolveHouseJurisdiction,
} from "./house-jurisdiction";
import { countryOf } from "./jurisdiction";
import { PriceIndexService } from "./price-index.service";
import { PriceIndexReviewService } from "./price-index-review.service";
import { CommodityService } from "../commodity/commodity.service";
import {
  BottleFactsService,
  type ResolvedBottleFacts,
} from "../commodity/bottle-facts";
import { DistributorFeedService } from "../distributor-feed/distributor-feed.service";
import { DatabaseService } from "../database/database.service";

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

describe("resolveHouseJurisdiction: the country first, the state inside it", () => {
  it("never reads an Italian 'MI' as Michigan", () => {
    for (const country of ["IT", "Italy", "Italia", "italy"]) {
      const house = resolveHouseJurisdiction("MI", country);
      expect(house.kind).toBe("country_unrecognised");
      expect(houseJurisdictionKey("MI", country)).toBeNull();
    }
    expect(houseJurisdictionKey("Milano", "Italy")).toBeNull();
    // Terni's sigla is "TR", which a state-first read took for Türkiye.
    expect(houseJurisdictionKey("TR", "Italy")).toBeNull();
  });

  it("reads 'MI' as Michigan on a United States house, however the country is spelled", () => {
    for (const country of [
      "US",
      "USA",
      "U.S.",
      "United States",
      "united States",
      "United States of America",
    ]) {
      expect(houseJurisdictionKey("MI", country)).toBe("US-MI");
    }
    expect(houseJurisdictionKey("Michigan", "United States")).toBe("US-MI");
    expect(houseJurisdictionKey("US-MI", "USA")).toBe("US-MI");
  });

  it("reads a United Kingdom house's nation, and never a US code inside it", () => {
    expect(houseJurisdictionKey("England", "United Kingdom")).toBe("GB-ENG");
    expect(houseJurisdictionKey("Wales", "UK")).toBe("GB-WLS");
    // 'MI' is nothing in the United Kingdom, so the country answers alone.
    expect(houseJurisdictionKey("MI", "United Kingdom")).toBe("GB");
    // A constituent nation written as the country is read as that nation.
    expect(houseJurisdictionKey(null, "England")).toBe("GB-ENG");
  });

  it("reads a Turkish house's province, and never a US or UK name inside it", () => {
    expect(houseJurisdictionKey("Muğla", "Türkiye")).toBe("TR-48");
    expect(houseJurisdictionKey("TR-07", "Turkey")).toBe("TR-07");
    expect(houseJurisdictionKey("Muğla", "Republic of Türkiye")).toBe("TR-48");
    expect(houseJurisdictionKey("MI", "Türkiye")).toBe("TR");
    expect(houseJurisdictionKey("England", "Türkiye")).toBe("TR");
    expect(houseJurisdictionKey(null, "Türkiye")).toBe("TR");
  });

  it("reads no foreign state on a United States house", () => {
    expect(houseJurisdictionKey("England", "USA")).toBe("US");
    expect(houseJurisdictionKey("Muğla", "United States")).toBe("US");
    expect(houseJurisdictionKey("Milano", "United States")).toBe("US");
  });

  it("does not read Georgia the country as the US state", () => {
    expect(resolveHouseJurisdiction(null, "Georgia").kind).toBe(
      "country_unrecognised",
    );
    expect(houseJurisdictionKey("GA", "Georgia")).toBeNull();
    expect(houseJurisdictionKey("Tbilisi", "GE")).toBeNull();
    // ...while the US state still reads on a United States house.
    expect(houseJurisdictionKey("Georgia", "United States")).toBe("US-GA");
  });

  it("guesses nothing when no country is recorded, not even a valid US code", () => {
    for (const blank of [null, undefined, "", "   "]) {
      const house = resolveHouseJurisdiction("MI", blank);
      expect(house).toEqual({ kind: "country_not_recorded", requested: "MI" });
      expect(houseJurisdictionKey("MI", blank)).toBeNull();
    }
    expect(resolveHouseJurisdiction(null, null)).toEqual({
      kind: "country_not_recorded",
      requested: null,
    });
  });

  it("keeps the text it read, so a silence can quote it", () => {
    expect(resolveHouseJurisdiction(" MI ", "USA")).toEqual({
      kind: "resolved",
      jurisdiction: "US-MI",
      requested: "MI",
    });
    expect(resolveHouseJurisdiction(null, "Türkiye")).toEqual({
      kind: "resolved",
      jurisdiction: "TR",
      requested: "Türkiye",
    });
    expect(resolveHouseJurisdiction("MI", "Italy")).toEqual({
      kind: "country_unrecognised",
      requested: "Italy",
    });
  });
});

/**
 * The web's one country table (ADR 0117 Q33) is what the location editor
 * writes into `restaurants.country`. Read as text, because the gateway cannot
 * import the web: every spelling it gives the United States, the United
 * Kingdom and Türkiye must resolve to that country, and every spelling of
 * every OTHER country must resolve to nothing, so no foreign house can ever
 * have a US, UK or Turkish state read for it.
 */
describe("the country step mirrors the web's country table", () => {
  const source = readFileSync(
    join(__dirname, "../../../web/src/lib/countries.ts"),
    "utf8",
  );
  const unquote = (s: string) => s.replace(/\\'/g, "'");
  const rows = [
    ...source.matchAll(
      /\{\s*code:\s*'([A-Z]{2})',\s*name:\s*'((?:[^'\\]|\\.)*)'([^}]*)\}/g,
    ),
  ].map((m) => {
    const aliasList = /aliases:\s*\[([^\]]*)\]/.exec(m[3]);
    const aliases = aliasList
      ? [...aliasList[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((a) =>
          unquote(a[1]),
        )
      : [];
    return { code: m[1], spellings: [unquote(m[2]), m[1], ...aliases] };
  });

  it("parses the whole table, so an empty parse cannot pass", () => {
    expect(rows.length).toBeGreaterThanOrEqual(194);
    for (const code of ["US", "GB", "TR", "IT", "GE"]) {
      expect(rows.some((r) => r.code === code)).toBe(true);
    }
  });

  it("resolves every spelling of the three listed countries to that country", () => {
    const listed = rows.filter((r) => ["US", "GB", "TR"].includes(r.code));
    expect(listed).toHaveLength(3);
    for (const row of listed) {
      for (const spelling of row.spellings) {
        const house = resolveHouseJurisdiction(null, spelling);
        expect({ spelling, kind: house.kind }).toEqual({
          spelling,
          kind: "resolved",
        });
        if (house.kind === "resolved") {
          expect({ spelling, country: countryOf(house.jurisdiction) }).toEqual({
            spelling,
            country: row.code,
          });
        }
      }
    }
  });

  it("resolves no spelling of any other country", () => {
    const others = rows.filter((r) => !["US", "GB", "TR"].includes(r.code));
    for (const row of others) {
      for (const spelling of row.spellings) {
        expect({ spelling, kind: resolveHouseJurisdiction("MI", spelling).kind })
          .toEqual({ spelling, kind: "country_unrecognised" });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The readers
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
interface Call {
  table: string;
}

/** A thenable PostgREST builder: every chain returns itself, every read the handler's rows. */
function makeDb(
  handler: (call: Call) => { data?: Row[]; error?: unknown },
): { db: DatabaseService; tables: string[] } {
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const call: Call = { table };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "is", "or", "order", "limit", "gte", "lte", "neq", "not", "filter"]) {
        builder[m] = () => builder;
      }
      const one = () => {
        const r = handler(call);
        return Promise.resolve({
          data: (r.data && r.data[0]) ?? null,
          error: r.error ?? null,
        });
      };
      builder.single = one;
      builder.maybeSingle = one;
      builder.then = (resolve: (v: unknown) => unknown) => {
        const r = handler(call);
        return Promise.resolve({
          data: r.data ?? null,
          count: r.data ? r.data.length : 0,
          error: r.error ?? null,
        }).then(resolve);
      };
      return builder;
    },
  };
  return { db: { client } as unknown as DatabaseService, tables };
}

/** One house and an otherwise empty register. */
function house(state_province: string | null, country: string | null) {
  return makeDb((call) =>
    call.table === "restaurants"
      ? { data: [{ id: "h1", name: "House", state_province, country }] }
      : { data: [] },
  );
}

/** A restaurants read that fails. */
function unreadable() {
  return makeDb((call) =>
    call.table === "restaurants"
      ? { error: { message: "permission denied" } }
      : { data: [] },
  );
}

function stubBottles(): BottleFactsService {
  return {
    forHouseItem: async (): Promise<ResolvedBottleFacts> => ({
      facts: { sizeMl: null, sizeSource: null, abvPercent: null, abvSource: null },
      refusal: null,
      detail: null,
    }),
  } as unknown as BottleFactsService;
}

const US_SERIES = "usda_ams.shell_egg_index.national";
const FAO_SERIES = "fao.food_price_index.all";
const TR_SERIES = "tuik.tufe_tt01.food_and_non_alcoholic_beverages";
const MICHIGAN_DISTRIBUTOR = "libdib-national";

describe("PriceIndexService.forHouse reads the state inside the country", () => {
  it("IT + 'MI': no Michigan, and the country is what is not recognised", async () => {
    const res = await new PriceIndexService(house("MI", "IT").db).forHouse("h1");
    expect(res.state).toBeNull();
    expect(res.lines).toEqual([]);
    expect(res.silence).toContain('"IT" is not a jurisdiction');
    expect(res.countryNotRecorded).toBe(false);
  });

  it("US + 'MI': Michigan", async () => {
    const res = await new PriceIndexService(
      house("MI", "United States").db,
    ).forHouse("h1");
    expect(res.state).toBe("US-MI");
    expect(res.countryNotRecorded).toBe(false);
  });

  it("GB + 'MI' is the United Kingdom; TR + 'MI' is Türkiye", async () => {
    expect(
      (await new PriceIndexService(house("MI", "United Kingdom").db).forHouse("h1"))
        .state,
    ).toBe("GB");
    expect(
      (await new PriceIndexService(house("England", "UK").db).forHouse("h1")).state,
    ).toBe("GB-ENG");
    expect(
      (await new PriceIndexService(house("MI", "Türkiye").db).forHouse("h1")).state,
    ).toBe("TR");
    expect(
      (await new PriceIndexService(house("Muğla", "Türkiye").db).forHouse("h1"))
        .state,
    ).toBe("TR-48");
  });

  it("no country + 'MI': country not recorded, no price read at all", async () => {
    const { db, tables } = house("MI", null);
    const res = await new PriceIndexService(db).forHouse("h1");
    expect(res.countryNotRecorded).toBe(true);
    expect(res.state).toBeNull();
    expect(res.lines).toEqual([]);
    expect(res.sources).toEqual([]);
    expect(res.silence).toBe(COUNTRY_NOT_RECORDED_SENTENCE);
    expect(tables).toEqual(["restaurants"]);
  });

  it("Georgia the country is not the US state", async () => {
    for (const state of [null, "GA"]) {
      const res = await new PriceIndexService(house(state, "Georgia").db).forHouse(
        "h1",
      );
      expect(res.state).toBeNull();
      expect(res.countryNotRecorded).toBe(false);
    }
  });

  it("an unreadable address is unknown, never 'country not recorded'", async () => {
    const res = await new PriceIndexService(unreadable().db).forHouse("h1");
    expect(res.countryNotRecorded).toBe(false);
    expect(res.state).toBeNull();
    expect(res.silence).toContain("could not be read");
  });
});

describe("PriceIndexReviewService reads the state inside the country", () => {
  const review = (db: DatabaseService) =>
    new PriceIndexReviewService(db, {} as never, {} as never);

  it("jurisdictionOfHouse: IT + 'MI' none, US + 'MI' Michigan, GB, TR, no country, Georgia", async () => {
    const cases: Array<[string | null, string | null, string | null]> = [
      ["MI", "Italy", null],
      ["MI", "United States", "US-MI"],
      ["MI", "United Kingdom", "GB"],
      ["Muğla", "Türkiye", "TR-48"],
      ["MI", null, null],
      [null, "Georgia", null],
    ];
    for (const [state, country, expected] of cases) {
      const key = await review(house(state, country).db).jurisdictionOfHouse("h1");
      expect({ state, country, key }).toEqual({ state, country, key: expected });
    }
  });

  it("admittersFor('US-MI') counts the Michigan house, not the Italian or the no-country one", async () => {
    const { db } = makeDb((call) => {
      if (call.table === "restaurants") {
        return {
          data: [
            { id: "h-us", name: "A", state_province: "MI", country: "United States" },
            { id: "h-it", name: "B", state_province: "MI", country: "Italy" },
            { id: "h-none", name: "C", state_province: "MI", country: null },
          ],
        };
      }
      return { data: [{ user_id: "u1", restaurant_id: "h-us", role: "owner" }] };
    });
    const pool = await review(db).admittersFor("US-MI");
    expect(pool.housesInJurisdiction).toBe(1);
    expect(pool.people.map((p) => p.restaurantId)).toEqual(["h-us"]);
  });

  it("admittersFor('US-GA') does not count a house in Georgia the country", async () => {
    const { db } = makeDb((call) =>
      call.table === "restaurants"
        ? {
            data: [
              { id: "h-ge", name: "A", state_province: null, country: "Georgia" },
              { id: "h-ge2", name: "B", state_province: "GA", country: "GE" },
            ],
          }
        : { data: [{ user_id: "u1", restaurant_id: "h-ge", role: "owner" }] },
    );
    const pool = await review(db).admittersFor("US-GA");
    expect(pool.housesInJurisdiction).toBe(0);
    expect(pool.people).toEqual([]);
  });
});

describe("CommodityService.forHouse reads the state inside the country", () => {
  const commodity = (db: DatabaseService) =>
    new CommodityService(db, stubBottles());
  const keys = (r: { series: Array<{ seriesKey: string }> }) =>
    r.series.map((s) => s.seriesKey);

  it("IT + 'MI': no US series, only the world one", async () => {
    const r = await commodity(house("MI", "Italy").db).forHouse("h1");
    expect(r.jurisdiction).toBeNull();
    expect(keys(r)).toEqual([FAO_SERIES]);
    expect(r.countryNotRecorded).toBe(false);
  });

  it("US + 'MI': Michigan, with the US series", async () => {
    const r = await commodity(house("MI", "USA").db).forHouse("h1");
    expect(r.jurisdiction).toBe("US-MI");
    expect(keys(r)).toContain(US_SERIES);
  });

  it("GB + 'MI' and TR + 'MI' read the country", async () => {
    const gb = await commodity(house("MI", "United Kingdom").db).forHouse("h1");
    expect(gb.jurisdiction).toBe("GB");
    expect(keys(gb)).not.toContain(US_SERIES);
    const tr = await commodity(house("MI", "Türkiye").db).forHouse("h1");
    expect(tr.jurisdiction).toBe("TR");
    expect(keys(tr)).toContain(TR_SERIES);
  });

  it("no country + 'MI': country not recorded, the world series alone", async () => {
    const r = await commodity(house("MI", null).db).forHouse("h1");
    expect(r.countryNotRecorded).toBe(true);
    expect(r.jurisdiction).toBeNull();
    expect(keys(r)).toEqual([FAO_SERIES]);
  });

  it("Georgia the country is not the US state", async () => {
    const r = await commodity(house(null, "Georgia").db).forHouse("h1");
    expect(r.jurisdiction).toBeNull();
    expect(keys(r)).not.toContain(US_SERIES);
  });

  it("an unreadable address is unknown, never 'country not recorded'", async () => {
    const r = await commodity(unreadable().db).forHouse("h1");
    expect(r.countryNotRecorded).toBe(false);
  });
});

describe("DistributorFeedService.forHouse reads the state inside the country", () => {
  const feed = (db: DatabaseService) => new DistributorFeedService(db);
  const keys = (r: { distributors: Array<{ key: string }> }) =>
    r.distributors.map((d) => d.key);

  it("IT + 'MI': no Michigan distributors", async () => {
    const r = await feed(house("MI", "Italy").db).forHouse("h1");
    expect(r.jurisdiction).toBeNull();
    expect(r.distributors).toEqual([]);
    expect(r.countryNotRecorded).toBe(false);
  });

  it("US + 'MI': Michigan's distributors", async () => {
    const r = await feed(house("MI", "United States").db).forHouse("h1");
    expect(r.jurisdiction).toBe("US-MI");
    expect(keys(r)).toContain(MICHIGAN_DISTRIBUTOR);
  });

  it("GB + 'MI' and TR + 'MI' read the country, with no Michigan list", async () => {
    const gb = await feed(house("MI", "United Kingdom").db).forHouse("h1");
    expect(gb.jurisdiction).toBe("GB");
    expect(keys(gb)).not.toContain(MICHIGAN_DISTRIBUTOR);
    const tr = await feed(house("MI", "Türkiye").db).forHouse("h1");
    expect(tr.jurisdiction).toBe("TR");
    expect(keys(tr)).not.toContain(MICHIGAN_DISTRIBUTOR);
  });

  it("no country + 'MI': country not recorded, no list", async () => {
    const r = await feed(house("MI", null).db).forHouse("h1");
    expect(r.countryNotRecorded).toBe(true);
    expect(r.distributors).toEqual([]);
    expect(r.silence).toBe(COUNTRY_NOT_RECORDED_SENTENCE);
  });

  it("Georgia the country is not the US state", async () => {
    const r = await feed(house("GA", "Georgia").db).forHouse("h1");
    expect(r.jurisdiction).toBeNull();
  });

  it("an unreadable address is unknown, never 'country not recorded'", async () => {
    const r = await feed(unreadable().db).forHouse("h1");
    expect(r.countryNotRecorded).toBe(false);
    expect(r.silence).toContain("could not be read");
  });
});
