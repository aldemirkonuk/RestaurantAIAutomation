import { PriceIndexService } from "./price-index.service";
import { DatabaseService } from "../database/database.service";

/**
 * What the three non-US houses are actually told.
 *
 * Kept in its own file with its own mock rather than appended to
 * `price-index.service.spec.ts`, because several builders are editing this
 * module at once (Michigan/Illinois, the size reader, the sweep target) and a
 * shared spec file is the easiest thing in it to collide in.
 *
 * THE FAULT THESE COVER. Before 2026-09-05 every one of these houses got
 * "not a jurisdiction this register recognises" — false about Muğla, England
 * and Türkiye, and true only about our table. The four silences below are four
 * different facts and none of them is an empty box:
 *
 *   the country publishes nothing           -> the market's own sentence
 *   the country publishes, its STATES do    -> "set the state" (US)
 *   the source was read and holds no price  -> the source named, with why
 *   the place is genuinely unknown to us    -> "not a jurisdiction..."
 */

interface QueryCtx {
  table: string;
  columns: string;
  opts: { count?: string; head?: boolean } | undefined;
  eqs: Array<[string, unknown]>;
}

function makeDb(
  handler: (ctx: QueryCtx) => {
    data?: unknown[];
    count?: number;
    error?: unknown;
  },
): DatabaseService {
  const client = {
    from(table: string) {
      const ctx: QueryCtx = { table, columns: "", opts: undefined, eqs: [] };
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
        or() {
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

/** Nothing in the register: every read empty, every count zero. */
function emptyRegister(): DatabaseService {
  return makeDb(() => ({ data: [], count: 0 }));
}

describe("forState — Türkiye", () => {
  afterEach(() => {
    delete process.env.PRICE_INDEX_FETCH_ENABLED;
  });

  it("resolves the province the Fethiye house records, and names the market's cause", async () => {
    const res = await new PriceIndexService(emptyRegister()).forState("Muğla");
    expect(res.state).toBe("TR-48");
    expect(res.lines).toHaveLength(0);
    expect(res.silence).toContain("No market price is published in Türkiye");
    expect(res.silence).not.toContain("not a jurisdiction");
  });

  it("names both Turkish sources as read-but-priceless, never as unfetchable", async () => {
    const res = await new PriceIndexService(emptyRegister()).forState("Türkiye");
    expect(res.state).toBe("TR");
    expect(res.sources.map((s) => s.key).sort()).toEqual([
      "gib-otv-alcohol-schedule",
      "hks-hal-daily-bulletin",
    ]);
    expect(res.sources.every((s) => s.withheld === null)).toBe(true);
    expect(res.sources.every((s) => s.silent !== null)).toBe(true);
    expect(res.silence).toContain("a tax, not a price");
    expect(res.silence).toContain("Hal Kayit Sistemi");
  });

  it("gives the province house the same national sources as the country house", async () => {
    // The OTV schedule is a fact about Türkiye, so it speaks for Muğla too.
    const res = await new PriceIndexService(emptyRegister()).forState("Muğla");
    expect(res.sources.map((s) => s.key)).toContain("gib-otv-alcohol-schedule");
  });
});

describe("forState — the United Kingdom", () => {
  afterEach(() => {
    delete process.env.PRICE_INDEX_FETCH_ENABLED;
  });

  it("resolves England and offers it the UK-wide and England-and-Wales sources", async () => {
    const res = await new PriceIndexService(emptyRegister()).forState("England");
    expect(res.state).toBe("GB-ENG");
    expect(res.sources.map((s) => s.key).sort()).toEqual([
      "defra-wholesale-fruit-veg",
      "hmrc-alcohol-duty-rates",
      "ons-rpi-average-price-alcohol",
    ]);
  });

  it("does NOT offer the England-and-Wales series to a house known only as GB", async () => {
    // It may be in Scotland. A Birmingham wholesale price is not its market.
    const res = await new PriceIndexService(emptyRegister()).forState(
      "United Kingdom",
    );
    expect(res.state).toBe("GB");
    expect(res.sources.map((s) => s.key)).not.toContain(
      "defra-wholesale-fruit-veg",
    );
    // Reworded 2026-09-05 (Q24): "no DRINKS price", because one UK source was
    // found and is now shown — saying nothing was found beside a box that is
    // showing something teaches the reader to distrust both.
    expect(res.silence).toContain(
      "No drinks price is published in the United Kingdom",
    );
    expect(res.silence).toContain("labelled as produce");
  });

  it("names the produce list and the switch, not a 'posted list', when the fetch is off", async () => {
    // Q24, 2026-09-05. The generic sentence said "England has a fetchable
    // POSTED LIST" — wrong twice for a UK house: there is no posting regime in
    // the UK at all, and the source waiting is produce, not drink.
    delete process.env.PRICE_INDEX_FETCH_ENABLED; // off, the default
    const res = await new PriceIndexService(emptyRegister()).forState("England");
    expect(res.silence).toContain("Wholesale produce (Defra, England and Wales)");
    expect(res.silence).toContain("scheduled fetch is off");
    expect(res.silence).toContain("PRICE_INDEX_FETCH_ENABLED is set on the deployment");
    expect(res.silence).not.toContain("posted list");
    // and it still says the drinks half of the truth
    expect(res.silence).toContain("No drinks price is published");
  });

  it("titles the produce source for the panel, and leaves drinks sources untitled", async () => {
    const res = await new PriceIndexService(emptyRegister()).forState("England");
    const defra = res.sources.find((s) => s.key === "defra-wholesale-fruit-veg")!;
    expect(defra.display).toEqual({
      category: "Wholesale produce",
      shortIssuer: "Defra",
      extent: "England and Wales",
    });
    const hmrc = res.sources.find((s) => s.key === "hmrc-alcohol-duty-rates")!;
    expect(hmrc.display).toBeNull();
  });

  it("keeps the discontinued ONS series visible with the reason it is dead", async () => {
    const res = await new PriceIndexService(emptyRegister()).forState("England");
    const ons = res.sources.find(
      (s) => s.key === "ons-rpi-average-price-alcohol",
    )!;
    expect(ons.silent?.kind).toBe("discontinued");
    expect(ons.silent?.reason).toContain("last observation is January 2025");
  });
});

describe("forState — the United States, a country without a state", () => {
  it("says the address is missing, never that nothing is posted", async () => {
    const res = await new PriceIndexService(emptyRegister()).forState("USA");
    expect(res.state).toBe("US");
    expect(res.silence).toContain("publishes prices state by state");
    expect(res.silence).not.toContain("No posted list");
  });
});

describe("forHouse — the jurisdiction the house actually records", () => {
  function house(row: Record<string, unknown>): DatabaseService {
    return makeDb((ctx) =>
      ctx.table === "restaurants" ? { data: [row] } : { data: [], count: 0 },
    );
  }

  it("reads the province when there is one (Chez Community, Fethiye)", async () => {
    const res = await new PriceIndexService(
      house({ state_province: "Muğla", country: "Türkiye" }),
    ).forHouse("r-tr-1");
    expect(res.state).toBe("TR-48");
  });

  it("falls back to the country when the province is null (The Old House Pub, Antalya)", async () => {
    // Before this fallback the house was told "no state recorded", although its
    // country is known and is the level Türkiye publishes at.
    const res = await new PriceIndexService(
      house({ state_province: null, country: "Türkiye" }),
    ).forHouse("r-tr-2");
    expect(res.state).toBe("TR");
    expect(res.silence).toContain("No market price is published in Türkiye");
  });

  it("reads England for the London house (ADMIN 1)", async () => {
    const res = await new PriceIndexService(
      house({ state_province: "England", country: "United Kingdom" }),
    ).forHouse("r-gb-1");
    expect(res.state).toBe("GB-ENG");
  });

  it("asks a US house with a country and no state for its state", async () => {
    const res = await new PriceIndexService(
      house({ state_province: null, country: "USA" }),
    ).forHouse("r-us-1");
    expect(res.state).toBe("US");
    expect(res.silence).toContain("publishes prices state by state");
  });

  it("selects both columns, so the country fallback can never be silently lost", async () => {
    let columns = "";
    const db = makeDb((ctx) => {
      if (ctx.table === "restaurants") {
        columns = ctx.columns;
        return {
          data: [{ state_province: "England", country: "United Kingdom" }],
        };
      }
      return { data: [], count: 0 };
    });
    await new PriceIndexService(db).forHouse("r-gb-1");
    expect(columns).toContain("state_province");
    expect(columns).toContain("country");
  });
});

describe("status — every non-US source says why it is quiet", () => {
  it("distinguishes withheld (unread) from silent (read, no price)", async () => {
    delete process.env.PRICE_INDEX_FETCH_ENABLED;
    const status = await new PriceIndexService(emptyRegister()).status();

    const hmrc = status.sources.find(
      (s) => s.key === "hmrc-alcohol-duty-rates",
    )!;
    expect(hmrc.withheld).toBeNull();
    expect(hmrc.silentBecause).toContain("not_a_price");

    const hks = status.sources.find((s) => s.key === "hks-hal-daily-bulletin")!;
    expect(hks.silentBecause).toContain("no_machine_endpoint");

    // Defra is the one non-US source with a parser, so its silence is the flag.
    const defra = status.sources.find(
      (s) => s.key === "defra-wholesale-fruit-veg",
    )!;
    expect(defra.silent).toBeNull();
    expect(defra.silentBecause).toContain("fetch disabled");
  });
});
