/**
 * The read side, with the database mocked.
 *
 * What matters here is the same thing that matters on the price-index panel:
 * **the silences must not look alike.** A register that could not be read, a
 * series with no observation yet, a series that may not be fetched at all and a
 * house with no exposure mapped are four different facts, and every one of them
 * produces WORDS from this service rather than an empty list.
 */

import { CommodityService } from "./commodity.service";
import { CommodityFetchService, parserFor } from "./commodity-fetch.service";
import { DatabaseService } from "../database/database.service";
import { SERIES, fetchableSeries } from "./commodity.registry";
import {
  BottleFactsService,
  type ResolvedBottleFacts,
} from "./bottle-facts";
import { readFileSync } from "fs";
import { join } from "path";

interface QueryCtx {
  table: string;
  columns: string;
  opts: { count?: string; head?: boolean } | undefined;
  eqs: Array<[string, unknown]>;
  iss: Array<[string, unknown]>;
}

type Handler = (ctx: QueryCtx) => {
  data?: unknown[];
  count?: number;
  error?: unknown;
};

/** A thenable PostgREST builder mock, the shape price-index.service.spec uses. */
function makeDb(handler: Handler): DatabaseService {
  const client = {
    from(table: string) {
      const ctx: QueryCtx = { table, columns: "", opts: undefined, eqs: [], iss: [] };
      const builder: Record<string, unknown> = {
        select(columns: string, opts?: { count?: string; head?: boolean }) {
          ctx.columns = columns;
          ctx.opts = opts;
          return builder;
        },
        eq(col: string, val: unknown) {
          ctx.eqs.push([col, val]);
          return builder;
        },
        is(col: string, val: unknown) {
          ctx.iss.push([col, val]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        upsert: () => builder,
        single() {
          const r = handler(ctx);
          return Promise.resolve({
            data: (r.data && r.data[0]) ?? null,
            error: r.error ?? null,
          });
        },
        maybeSingle() {
          const r = handler(ctx);
          return Promise.resolve({
            data: (r.data && r.data[0]) ?? null,
            error: r.error ?? null,
          });
        },
        then(resolve: (v: unknown) => unknown) {
          const r = handler(ctx);
          return Promise.resolve({
            data: r.data ?? null,
            count: r.count ?? null,
            error: r.error ?? null,
          }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { client } as unknown as DatabaseService;
}

/**
 * The bottle-facts resolver, stubbed to "nothing stated" -- which is the real
 * state of every bottle in this product until somebody types a strength and a
 * size. Its own contract is tested in `bottle-facts.spec.ts`.
 */
function stubBottles(over: Partial<ResolvedBottleFacts> = {}): BottleFactsService {
  return {
    forHouseItem: async (): Promise<ResolvedBottleFacts> => ({
      facts: { sizeMl: null, sizeSource: null, abvPercent: null, abvSource: null },
      refusal: null,
      detail: null,
      ...over,
    }),
  } as unknown as BottleFactsService;
}

const HOUSE = "rest-1";
const FAO_KEY = "fao.food_price_index.all";

describe("which series answer for a house", () => {
  it("answers with the WORLD series when the address cannot be placed", async () => {
    const svc = new CommodityService(
      makeDb((ctx) =>
        ctx.table === "restaurants"
          ? { data: [{ state_province: null, country: "Atlantis" }] }
          : { data: [] },
      ),
      stubBottles(),
    );
    const r = await svc.forHouse(HOUSE);
    expect(r.jurisdiction).toBeNull();
    expect(r.requested).toBe("Atlantis");
    expect(r.series.map((s) => s.seriesKey)).toEqual([FAO_KEY]);
    // A real line, not a silence: the FAO index is not scoped to anywhere, so
    // a house whose address this register cannot place still gets it.
    expect(r.silence).toBeNull();
  });

  it("adds the UK series for an England house, by containment", async () => {
    const svc = new CommodityService(
      makeDb((ctx) =>
        ctx.table === "restaurants"
          ? { data: [{ state_province: "England", country: "United Kingdom" }] }
          : { data: [] },
      ),
      stubBottles(),
    );
    const r = await svc.forHouse(HOUSE);
    expect(r.jurisdiction).toBe("GB-ENG");
    expect(r.series.map((s) => s.seriesKey)).toContain(
      "ons.d7bu.cpi_food_and_non_alcoholic_beverages",
    );
  });

  it("falls back to the COUNTRY when no province is recorded", async () => {
    // Measured on this estate 2026-09-05: the Antalya house records no province
    // and country 'Türkiye', and reading only the province told it it had no
    // address at all.
    const svc = new CommodityService(
      makeDb((ctx) =>
        ctx.table === "restaurants"
          ? { data: [{ state_province: null, country: "United Kingdom" }] }
          : { data: [] },
      ),
      stubBottles(),
    );
    expect((await svc.forHouse(HOUSE)).jurisdiction).toBe("GB");
  });
});

describe("the four silences, told apart", () => {
  it("a register that could not be read is UNKNOWN, never empty", async () => {
    const svc = new CommodityService(
      makeDb((ctx) => {
        if (ctx.table === "restaurants") {
          return { data: [{ state_province: null, country: null }] };
        }
        return { error: { message: "permission denied" } };
      }),
      stubBottles(),
    );
    const line = (await svc.forHouse(HOUSE)).series[0];
    expect(line.note).toMatch(/unknown, not absent/);
    expect(line.latest).toBeNull();
  });

  it("a registered series with no observation says so, and claims nothing", async () => {
    const svc = new CommodityService(
      makeDb((ctx) => {
        if (ctx.table === "restaurants") return { data: [{ state_province: null, country: null }] };
        if (ctx.table === "commodity_index_series") {
          return { data: [{ id: "s1", series_key: FAO_KEY, armed: false }] };
        }
        if (ctx.table === "commodity_index_observations") return { data: [], count: 0 };
        return { data: [] };
      }),
      stubBottles(),
    );
    const line = (await svc.forHouse(HOUSE)).series[0];
    expect(line.latest).toBeNull();
    expect(line.observationCount).toBe(0);
    expect(line.note).toMatch(/holds no observation of this series yet/);
  });

  it("a series that may not be fetched at all names the 403 rather than going quiet", async () => {
    const svc = new CommodityService(
      makeDb((ctx) => {
        if (ctx.table === "restaurants") {
          return { data: [{ state_province: "California", country: "USA" }] };
        }
        return { data: [] }; // no series rows written
      }),
      stubBottles(),
    );
    const egg = (await svc.forHouse(HOUSE)).series.find(
      (s) => s.seriesKey === "usda_ams.shell_egg_index.national",
    )!;
    expect(egg.admission).toBe("upload_only");
    expect(egg.note).toMatch(/403/);
  });

  it("a house with no mapping anywhere is flagged, not left to be inferred from a zero", async () => {
    const svc = new CommodityService(
      makeDb((ctx) => {
        if (ctx.table === "restaurants") return { data: [{ state_province: null, country: null }] };
        if (ctx.table === "commodity_index_series") {
          return { data: [{ id: "s1", series_key: FAO_KEY, armed: false }] };
        }
        if (ctx.table === "commodity_index_observations") {
          return {
            data: [
              {
                period_start: "2026-08-01",
                period_grain: "month",
                value: 133.3,
                issued_at: "2026-09-05T00:00:00Z",
                issued_at_basis: "fetch_date",
                fetched_at: "2026-09-05T00:00:00Z",
                vintage: null,
              },
            ],
            count: 440,
          };
        }
        return { data: [] };
      }),
      stubBottles(),
    );
    const r = await svc.forHouse(HOUSE);
    expect(r.noExposureRecorded).toBe(true);
    expect(r.series[0].latest?.value).toBe(133.3);
    // `fetch_date` is what makes the panel print "read on" instead of "issued".
    expect(r.series[0].latest?.issuedAtBasis).toBe("fetch_date");
    expect(r.series[0].exposures).toEqual([]);
  });

  it("an unreadable exposure read is UNKNOWN, never 'no mapping'", async () => {
    const svc = new CommodityService(
      makeDb((ctx) => {
        if (ctx.table === "restaurants") return { data: [{ state_province: null, country: null }] };
        if (ctx.table === "commodity_index_series") {
          return { data: [{ id: "s1", series_key: FAO_KEY, armed: false }] };
        }
        if (ctx.table === "commodity_index_observations") return { data: [], count: 0 };
        return { error: { message: "relation does not exist" } };
      }),
      stubBottles(),
    );
    const line = (await svc.forHouse(HOUSE)).series[0];
    expect(line.note).toMatch(/unknown, not "none"/);
  });
});

describe("staleness is judged on the OBSERVATION'S period", () => {
  it("marks a year-old newest observation stale even though the row was just fetched", async () => {
    const svc = new CommodityService(
      makeDb((ctx) => {
        if (ctx.table === "restaurants") return { data: [{ state_province: null, country: null }] };
        if (ctx.table === "commodity_index_series") {
          return { data: [{ id: "s1", series_key: FAO_KEY, armed: false }] };
        }
        if (ctx.table === "commodity_index_observations") {
          return {
            data: [
              {
                period_start: "2018-03-01",
                period_grain: "month",
                value: 100,
                issued_at: new Date().toISOString(),
                issued_at_basis: "fetch_date",
                fetched_at: new Date().toISOString(),
                vintage: null,
              },
            ],
            count: 1,
          };
        }
        return { data: [] };
      }),
      stubBottles(),
    );
    const line = (await svc.forHouse(HOUSE)).series[0];
    expect(line.stale).toBe(true);
    expect(line.staleReason).toMatch(/a 200 OK is not freshness/);
  });
});

describe("the status route", () => {
  it("reports the fetch OFF and names the flag", () => {
    const svc = new CommodityService(makeDb(() => ({ data: [] })),
      stubBottles(),);
    const s = svc.status();
    expect(s.fetchArmed).toBe(false);
    expect(s.flag).toBe("COMMODITY_INDEX_FETCH_ENABLED");
    expect(s.series).toHaveLength(6);
  });
});

describe("the fetch service, driven with the RECORDED fixtures and no network", () => {
  const fao = SERIES[FAO_KEY];
  const ons = SERIES["ons.d7bu.cpi_food_and_non_alcoholic_beverages"];
  const read = async (e: typeof fao) =>
    readFileSync(
      join(
        __dirname,
        "__fixtures__",
        e.seriesKey === FAO_KEY
          ? "fao-food-price-index-2026-09-05.sample.csv"
          : "ons-d7bu-2026-09-05.sample.json",
      ),
      "utf8",
    );

  it("declares a parser for each fetchable series", () => {
    expect(parserFor(fao)).not.toBeNull();
    expect(parserFor(ons)).not.toBeNull();
  });

  it("gives the shell-egg series a parser AND still refuses to fetch it", () => {
    // Two separate facts, and conflating them is what `upload_only` exists to
    // prevent. The parser is there so that the day a person's own download
    // lands the upload path has something to call and nothing else changes
    // (the founder's Q1 answer, 2026-09-05); `admission` is what stops any
    // reader being pointed at a host whose robots.txt returns 403.
    const egg = SERIES["usda_ams.shell_egg_index.national"];
    expect(parserFor(egg)).not.toBeNull();
    expect(egg.admission).toBe("upload_only");
    expect(egg.awaitingHumanDownload).toBe(true);
    expect(fetchableSeries().map((s) => s.seriesKey)).not.toContain(egg.seriesKey);
  });

  it("declares no parser for a rate: a rate is brought, never scraped", () => {
    for (const r of Object.values(SERIES).filter((s) => s.valueKind === "rate")) {
      expect(parserFor(r)).toBeNull();
    }
  });

  it("fetches nothing at all while the flag is off, and says why", async () => {
    const svc = new CommodityFetchService(makeDb(() => ({ data: [] })));
    const r = await svc.run(read);
    expect(r.armed).toBe(false);
    expect(r.outcomes).toEqual([]);
    expect(r.note).toMatch(/deliberate silence, not a failed read/);
  });

  it("parses and admits both fixtures without writing, when asked not to write", async () => {
    const svc = new CommodityFetchService(makeDb(() => ({ data: [] })));
    const at = new Date("2026-09-05T00:00:00Z");
    const a = await svc.runOne(fao, read, at, false);
    expect(a.admission.admitted).toBe(true);
    expect(a.observationsParsed).toBe(40);
    expect(a.written).toBe(0);
    const b = await svc.runOne(ons, read, at, false);
    expect(b.admission.admitted).toBe(true);
    expect(b.observationsParsed).toBe(40);
  });

  it("refuses to read the withheld series even when handed a reader", async () => {
    // The guarantee is structural: `fetchableSeries()` excludes it, AND
    // `runOne` refuses it. Two gates, because one of them is a filter somebody
    // could widen.
    const svc = new CommodityFetchService(makeDb(() => ({ data: [] })));
    let called = false;
    const outcome = await svc.runOne(
      SERIES["usda_ams.shell_egg_index.national"],
      async () => {
        called = true;
        return "";
      },
      new Date("2026-09-05T00:00:00Z"),
      false,
    );
    expect(called).toBe(false);
    expect(outcome.admission.reason).toBe("upload_only");
    expect(outcome.note).toMatch(/403/);
  });

  it("reports a payload that could not be read as unknown, not as an empty series", async () => {
    const svc = new CommodityFetchService(makeDb(() => ({ data: [] })));
    const outcome = await svc.runOne(
      fao,
      async () => {
        throw new Error("HTTP 503");
      },
      new Date("2026-09-05T00:00:00Z"),
      false,
    );
    expect(outcome.admission.admitted).toBe(false);
    expect(outcome.note).toMatch(/HTTP 503/);
    expect(outcome.observationsParsed).toBe(0);
  });
});
