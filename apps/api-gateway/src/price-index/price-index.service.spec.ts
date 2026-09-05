import { PriceIndexService } from "./price-index.service";
import { DatabaseService } from "../database/database.service";

/**
 * The read side, with the database mocked. What matters here:
 *   1. state scoping — 'CA' / 'California' / 'US-CA' all resolve to US-CA, and
 *      an unrecognised jurisdiction returns null with WORDS, never silent rows;
 *   2. the three silences are distinct — no source, withheld source, read
 *      failure — because collapsing them is the absence-reported-as-health fault;
 *   3. a US-CA row from the register comes back as a labelled index line.
 */

interface QueryCtx {
  table: string;
  columns: string;
  opts: { count?: string; head?: boolean } | undefined;
  eqs: Array<[string, unknown]>;
  ors: string[];
}

/**
 * A PostgREST builder mock: thenable, chainable, resolving through a handler
 * that sees what was asked. The service chains .eq()/.or() AFTER .limit(), so
 * limit must return the builder too.
 */
function makeDb(
  handler: (ctx: QueryCtx) => { data?: unknown[]; count?: number; error?: unknown },
): DatabaseService {
  const client = {
    from(table: string) {
      const ctx: QueryCtx = { table, columns: "", opts: undefined, eqs: [], ors: [] };
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
        or(clause: string) {
          ctx.ors.push(clause);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        single() {
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

const CA_ROW = {
  id: "abc",
  source_key: "california-abc-beer-price-posting",
  source_class: "posted_wholesale_list",
  state: "US-CA",
  region: "Santa Clara",
  issuer: "California Department of Alcoholic Beverage Control",
  issued_at: "2026-03-10",
  fetched_at: "2026-09-04T00:00:00Z",
  price_basis: "Retailers",
  product_name: "Coopers Best Extra Stout",
  brand: "Coopers Brewery",
  producer: "COOPERS BREWERY LIMITED",
  package_desc: "4 x 6 Pack",
  container_type: "Glass Bottle",
  size_value: 375,
  size_unit: "Milliliter",
  price: 52.7,
  currency: "USD",
  price_unit: "per package",
  pack: null,
  container_charge: 0,
  is_promotion: false,
  source_status: "Active",
  attribution: null,
  source_url: "https://priceposting.abc.ca.gov/publicPricePosts",
  source_ref: "https://priceposting.abc.ca.gov/publicPricePosts#id=7475103",
};

function isCount(ctx: QueryCtx): boolean {
  return ctx.opts?.head === true || ctx.columns === "id";
}

describe("PriceIndexService.forState — state scoping", () => {
  afterEach(() => {
    delete process.env.PRICE_INDEX_FETCH_ENABLED;
  });

  it.each(["CA", "California", "us-ca", "US-CA"])(
    "resolves %s to US-CA and returns the index line",
    async (input) => {
      const svc = new PriceIndexService(
        makeDb((ctx) => (isCount(ctx) ? { count: 1 } : { data: [CA_ROW] })),
      );
      const res = await svc.forState(input);
      expect(res.state).toBe("US-CA");
      expect(res.lines).toHaveLength(1);
      expect(res.lines[0].priceBasis).toBe("Retailers");
      expect(res.lines[0].sizeUnit).toBe("Milliliter");
      expect(res.silence).toBeNull();
    },
  );

  it("scopes the query to the resolved state, never leaking another state's rows", async () => {
    let mainEqs: Array<[string, unknown]> = [];
    const svc = new PriceIndexService(
      makeDb((ctx) => {
        if (!isCount(ctx)) mainEqs = ctx.eqs;
        return isCount(ctx) ? { count: 1 } : { data: [CA_ROW] };
      }),
    );
    await svc.forState("California");
    expect(mainEqs).toContainEqual(["state", "US-CA"]);
  });

  it("returns null state and WORDS for an unrecognised jurisdiction", async () => {
    const svc = new PriceIndexService(makeDb(() => ({ data: [] })));
    const res = await svc.forState("Atlantis");
    expect(res.state).toBeNull();
    expect(res.lines).toHaveLength(0);
    expect(res.silence).toContain("not a jurisdiction");
  });

  it("names the withheld source for a state that posts but cannot be fetched (Michigan)", async () => {
    const svc = new PriceIndexService(
      makeDb((ctx) => (isCount(ctx) ? { count: 0 } : { data: [] })),
    );
    const res = await svc.forState("Michigan");
    expect(res.state).toBe("US-MI");
    expect(res.lines).toHaveLength(0);
    expect(res.silence).toContain("cannot be fetched");
    expect(res.sources[0].withheld).not.toBeNull();
  });

  it("says a state with a fetchable list but fetch OFF has recorded nothing yet", async () => {
    delete process.env.PRICE_INDEX_FETCH_ENABLED; // off
    const svc = new PriceIndexService(
      makeDb((ctx) => (isCount(ctx) ? { count: 0 } : { data: [] })),
    );
    const res = await svc.forState("Oregon");
    expect(res.state).toBe("US-OR");
    expect(res.silence).toContain("scheduled fetch is off");
  });

  it("says UNKNOWN, not empty, when the register read fails", async () => {
    const svc = new PriceIndexService(
      makeDb((ctx) =>
        isCount(ctx) ? { count: 0 } : { error: new Error("boom") },
      ),
    );
    const res = await svc.forState("California");
    expect(res.silence).toContain("could not be read");
  });
});

describe("PriceIndexService.forHouse — resolves the caller's own state", () => {
  it("reads restaurants.state_province and scopes to that state", async () => {
    const svc = new PriceIndexService(
      makeDb((ctx) => {
        if (ctx.table === "restaurants") return { data: [{ state_province: "California" }] };
        return isCount(ctx) ? { count: 1 } : { data: [CA_ROW] };
      }),
    );
    const res = await svc.forHouse("r-1");
    expect(res.state).toBe("US-CA");
    expect(res.lines).toHaveLength(1);
  });

  it("says WORDS when the house has no state recorded (2 of 14 tenants)", async () => {
    const svc = new PriceIndexService(
      makeDb((ctx) =>
        ctx.table === "restaurants" ? { data: [{ state_province: null }] } : { data: [] },
      ),
    );
    const res = await svc.forHouse("r-2");
    expect(res.state).toBeNull();
    expect(res.silence).toContain("no state recorded");
  });

  it("says WORDS when there is no active restaurant", async () => {
    const svc = new PriceIndexService(makeDb(() => ({ data: [] })));
    const res = await svc.forHouse(null);
    expect(res.state).toBeNull();
    expect(res.silence).toContain("No active restaurant");
  });
});

describe("PriceIndexService.status", () => {
  it("reports every source, marking Michigan withheld and the rest by armed/rows", async () => {
    delete process.env.PRICE_INDEX_FETCH_ENABLED;
    const svc = new PriceIndexService(
      makeDb(() => ({ data: [], count: 0 })),
    );
    const status = await svc.status();
    expect(status.armed).toBe(false);
    expect(status.flag).toBe("PRICE_INDEX_FETCH_ENABLED");
    const mi = status.sources.find((s) => s.jurisdiction === "US-MI")!;
    expect(mi.silentBecause).toContain("withheld");
    const ca = status.sources.find((s) => s.jurisdiction === "US-CA")!;
    expect(ca.silentBecause).toContain("fetch disabled");
  });
});
