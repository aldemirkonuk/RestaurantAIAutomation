import { Logger } from "@nestjs/common";
import { WHOLE_READ_CEILING } from "../../common/read-whole-window";
import { sourcesUnreadWords } from "../digest/digest-schedule";
import { RecommendationsService } from "../recommendations.service";
import {
  BUNDLE_READ_WORDS,
  InsightGeneratorService,
} from "./insight-generator.service";
import { stateBookFrom } from "./item-state";

/**
 * ADR 0292, fork 3 follow-on. The founder, 2026-10-07: *"Say it couldn't be
 * read (Recommended)"*.
 *
 * A refused or failed read inside the insight bundle leaves its slice `[]`,
 * so no insight states a figure from it: each family is gated on the slice it
 * is built on, and the per-table insights and the wine mover, which take a
 * label or a name from a second slice, are gated on that read too (the
 * middle describe block below; the last one is /recommendations). Before this change `generate()` still resolved,
 * /recommendations listed nothing in `sourcesUnread`, and its quiet tier said
 * every source answered: a failed read read as "nothing to recommend". Now
 * the generator names each such read in house words, and the feed names it in
 * its own `sourcesUnread`, which the page's quiet tier prints. The weekly
 * digest prints it only in a letter that carries entries; in a week where
 * nothing stands it sends nothing, and the name is in its log row only (not
 * tested here). A read that answered with no rows is not named: an empty read
 * is not a refused one.
 */

type Row = Record<string, any>;

/** How one table answers every request made of it. */
type Answer =
  | { rows: Row[] }
  /** A Supabase error on the response, as a statement timeout gives. */
  | { error: string }
  /** The request itself rejects (a network fault). */
  | { throws: string }
  /** Page 0 counts more rows than `readWholeWindow` will read. */
  | { overCeiling: true };

const READS = Object.keys(BUNDLE_READ_WORDS) as Array<
  keyof typeof BUNDLE_READ_WORDS
>;

/**
 * A client that answers by table. It honours what `readWholeWindow` adds
 * (`order("id")`, `.gt("id", …)`, `.limit`, `count: "exact"`) and
 * `maybeSingle`; every other filter is passed through, since each table here
 * holds only the house's own rows.
 */
function clientFor(answers: Partial<Record<string, Answer>>) {
  return {
    from(table: string) {
      const a: Answer = answers[table] ?? { rows: [] };
      let gt: string | null = null;
      let limit = Number.POSITIVE_INFINITY;
      let counted = false;
      let single = false;
      const b: any = {};
      for (const m of ["eq", "neq", "gte", "lte", "lt", "in", "is", "order"])
        b[m] = () => b;
      b.select = (_cols: string, opts?: { count?: string }) => {
        counted = opts?.count === "exact";
        return b;
      };
      b.gt = (col: string, v: string) => {
        if (col === "id") gt = v;
        return b;
      };
      b.limit = (n: number) => {
        limit = n;
        return b;
      };
      b.maybeSingle = () => {
        single = true;
        return b;
      };
      const answer = () => {
        if ("throws" in a) throw new Error(a.throws);
        if ("error" in a)
          return { data: null, error: { code: "57014", message: a.error } };
        if ("overCeiling" in a)
          return { data: [], error: null, count: WHOLE_READ_CEILING + 1 };
        let rows = [...a.rows].sort((x, y) =>
          String(x.id) < String(y.id) ? -1 : 1,
        );
        if (gt !== null) rows = rows.filter((r) => String(r.id) > gt!);
        if (single) return { data: rows[0] ?? null, error: null };
        return {
          data: rows.slice(0, limit),
          error: null,
          count: counted ? rows.length : null,
        };
      };
      b.then = (resolve: any, reject: any) =>
        Promise.resolve().then(answer).then(resolve, reject);
      return b;
    },
  };
}

function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

/** One row on every read, so "answered" means answered with rows. */
const ROWS: Record<keyof typeof BUNDLE_READ_WORDS, Row[]> = {
  wine_consumption_log: [
    {
      id: "c1",
      inventory_id: "inv-1",
      quantity: 1,
      volume_ml: null,
      created_at: dayBack(3),
      restaurant_inventory: { master_wine_id: "M1" },
    },
  ],
  procurement_orders: [
    {
      provider_id: "p1",
      providers: { name: "Vendor" },
      total_cost: 100,
      final_price: null,
      bottles_total: 12,
      quantity: 12,
      delivered_at: dayBack(5),
      created_at: dayBack(6),
      status: "DELIVERED",
    },
  ],
  restaurant_inventory: [
    {
      id: "inv-1",
      wine_name: "Wine M1",
      stock_live: 6,
      menu_price_current: 60,
      last_purchase_price: 20,
      master_wine_id: "M1",
      master_wine_library: { primary_type: "red" },
    },
  ],
  pos_checks: [
    {
      id: "k1",
      source: "test",
      table_id: null,
      server_name: null,
      server_external_id: null,
      opened_at: dayBack(2),
      closed_at: dayBack(2),
      covers: 2,
      total: 80,
      tip: 0,
      items: null,
    },
  ],
  restaurant_tables: [{ id: "t1", label: "T1", seats: 4, is_outdoor: false }],
  restaurant_venue_profiles: [{ id: "v1", features: { terrace: true } }],
  analytics_goals: [
    { id: "g1", metric_key: "wine_revenue", target_value: 1, status: "active" },
  ],
};

const withRows = (): Record<string, Answer> =>
  Object.fromEntries(READS.map((t) => [t, { rows: ROWS[t] }]));

const empty = (): Record<string, Answer> =>
  Object.fromEntries(READS.map((t) => [t, { rows: [] }]));

function generatorOver(answers: Record<string, Answer>) {
  const client = clientFor(answers);
  return new InsightGeneratorService(
    { getClient: () => client, supabase: client } as any,
    {
      load: async () => ({ dates: new Set(), readable: true, problem: null }),
    } as any,
    {
      readState: async () => ({
        book: stateBookFrom([]),
        readable: true,
        problem: null,
      }),
    } as any,
  );
}

/**
 * The feed with every lens answering (as nothing), price advice and the
 * price locks answering, and the generator given: so `sourcesUnread` holds
 * only what this file makes unread.
 */
function feedOver(
  generator: Pick<InsightGeneratorService, "generate">,
  goals: { listGoals: () => Promise<unknown> } = { listGoals: async () => [] },
) {
  const client = clientFor({});
  return new RecommendationsService(
    {
      getFinancialSummary: async () => null,
      getRiskProfile: async () => null,
      getInventoryScience: async () => null,
    } as any,
    {
      getMenuEngineering: async () => null,
      getSeasonality: async () => null,
      getCashflow: async () => null,
    } as any,
    generator as any,
    goals as any,
    {
      readDispositions: async () => ({
        map: new Map(),
        readable: true,
        problem: null,
      }),
    } as any,
    { supabase: client, getClient: () => client } as any,
    { adviseHouse: async () => null } as any,
    {
      list: async () => ({
        readable: true,
        markersReadable: true,
        counts: { open: 0, toReview: 0 },
        locks: [],
      }),
    } as any,
  );
}

// Every refusal below is logged by the generator; the log is not what is
// tested here, so it is kept out of the run's output.
beforeAll(() => {
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe("the insight generator names a read it could not make (ADR 0292, 2026-10-07)", () => {
  it("names nothing when every read answers, with rows", async () => {
    const out = await generatorOver(withRows()).generate("r1", {
      persist: false,
    });
    expect(out.sourcesUnread).toEqual([]);
  });

  it("names nothing for a read that answered with no rows: empty is not refused", async () => {
    const out = await generatorOver(empty()).generate("r1", {
      persist: false,
    });
    expect(out.sourcesUnread).toEqual([]);
    // The empty house still reads as one with nothing of that kind.
    expect(out.availability).toEqual([]);
  });

  it.each(READS.map((t) => [t, BUNDLE_READ_WORDS[t]]))(
    "the %s read failing is named %p, and nothing else is",
    async (table, word) => {
      const out = await generatorOver({
        ...withRows(),
        [table]: { error: "canceling statement due to statement timeout" },
      }).generate("r1", { persist: false });
      expect(out.sourcesUnread).toEqual([word]);
    },
  );

  it.each(READS.map((t) => [t, BUNDLE_READ_WORDS[t]]))(
    "the %s read rejecting is named %p",
    async (table, word) => {
      const out = await generatorOver({
        ...withRows(),
        [table]: { throws: "fetch failed" },
      }).generate("r1", { persist: false });
      expect(out.sourcesUnread).toEqual([word]);
    },
  );

  it.each([
    ["wine_consumption_log", "pour history"],
    ["pos_checks", "till checks"],
  ])(
    "a whole-window %s read refused past the ceiling is named %p, and its family is silent",
    async (table, word) => {
      const out = await generatorOver({
        ...withRows(),
        [table]: { overCeiling: true },
      }).generate("r1", { persist: false });
      expect(out.sourcesUnread).toEqual([word]);
      const need = table === "pos_checks" ? "checks" : "consumption";
      expect(out.availability).not.toContain(need);
    },
  );

  it("names every read that could not be made, in the bundle's order", async () => {
    const out = await generatorOver({
      ...withRows(),
      wine_consumption_log: { overCeiling: true },
      pos_checks: { error: "timeout" },
      restaurant_tables: { throws: "fetch failed" },
    }).generate("r1", { persist: false });
    expect(out.sourcesUnread).toEqual([
      "pour history",
      "till checks",
      "table list",
    ]);
  });

  it("uses house words, never a table name", () => {
    for (const [table, word] of Object.entries(BUNDLE_READ_WORDS)) {
      expect(word).not.toMatch(/_/);
      expect(word).not.toBe(table);
    }
  });
});

/**
 * Two groups of insights read a second slice besides the one their family
 * is built on:
 * the per-table insights take the table's label from the table list, and the
 * wine mover takes the wine's name from the inventory list. Gating the family
 * on its own slice did not cover that second read, so a failed table read
 * printed "Top table" and "A table", and a failed inventory read printed the
 * wine's id as its name. Each case below first shows the insight firing with
 * every read answered, so its absence after a refusal is not a fixture that
 * never fires.
 */
describe("an insight that takes a name from a read that could not be made does not fire", () => {
  const TABLE_RANK = "table.avg_check.peer_rank";
  const TABLE_HOT = "table.revenue.hot_entity_live";
  const WAITER_RANK = "waiter.avg_check.peer_rank";
  const MOVER = "wine.bottles.vs_prev_period_7d";

  /**
   * Three tables, 40 closed checks each, T1 well ahead; Ana adds $100 a check
   * on every table, so her lead survives the table adjustment; and one check
   * open at T1 for 10 minutes at $2,000, far past T1's usual pace.
   */
  function floor(): Record<string, Answer> {
    const checks: Row[] = [];
    let n = 0;
    for (const [table, base] of [
      ["t1", 300],
      ["t2", 100],
      ["t3", 100],
    ] as const) {
      for (let i = 0; i < 40; i++) {
        const server = i % 2 === 0 ? "Ana" : "Ben";
        const date = dayBack(1 + (i % 60)).substring(0, 10);
        checks.push({
          id: `k${String(n++).padStart(4, "0")}`,
          source: "test",
          table_id: table,
          server_name: server,
          server_external_id: null,
          opened_at: `${date}T19:00:00.000Z`,
          closed_at: `${date}T21:00:00.000Z`,
          covers: 2,
          total: base + (server === "Ana" ? 100 : 0) + (i % 7) * 3,
          tip: 0,
          items: null,
        });
      }
    }
    checks.push({
      id: "k9999",
      source: "test",
      table_id: "t1",
      server_name: "Ana",
      server_external_id: null,
      opened_at: new Date(Date.now() - 10 * 60000).toISOString(),
      closed_at: null,
      covers: 4,
      total: 2000,
      tip: 0,
      items: null,
    });
    return {
      ...withRows(),
      pos_checks: { rows: checks },
      restaurant_tables: {
        rows: ["t1", "t2", "t3"].map((id, i) => ({
          id,
          label: `T${i + 1}`,
          seats: 4,
          is_outdoor: false,
        })),
      },
    };
  }

  /** One wine, two bottles a day last week and six a day this week. */
  function mover(): Record<string, Answer> {
    const rows: Row[] = [];
    for (let d = 1; d <= 14; d++)
      rows.push({
        id: `c${String(d).padStart(3, "0")}`,
        inventory_id: "inv-1",
        consumption_type: "bottle",
        quantity: d <= 7 ? 6 : 2,
        volume_ml: null,
        created_at: dayBack(d),
        restaurant_inventory: { master_wine_id: "M1" },
      });
    return { ...withRows(), wine_consumption_log: { rows } };
  }

  const fire = async (answers: Record<string, Answer>) =>
    (await generatorOver(answers).generate("r1", { persist: false })).insights;
  const of = <X extends { candidateKey: string }>(xs: X[], key: string) =>
    xs.filter((i) => i.candidateKey === key);

  it("with the table list read, the table #1 and the surge fire and name the table", async () => {
    const xs = await fire(floor());
    expect(of(xs, TABLE_RANK).map((i) => i.entityLabel)).toEqual(["Table T1"]);
    expect(of(xs, TABLE_HOT).map((i) => i.entityLabel)).toEqual(["Table T1"]);
    expect(of(xs, WAITER_RANK).map((i) => i.entityLabel)).toEqual(["Ana"]);
  });

  it.each([
    ["failing", { error: "canceling statement due to statement timeout" }],
    ["rejecting", { throws: "fetch failed" }],
  ] as Array<[string, Answer]>)(
    "with the table list %s, no per-table insight fires, and the server #1 still does",
    async (_how, answer) => {
      const out = await generatorOver({
        ...floor(),
        restaurant_tables: answer,
      }).generate("r1", { persist: false });
      expect(out.sourcesUnread).toEqual(["table list"]);
      expect(of(out.insights, TABLE_RANK)).toEqual([]);
      expect(of(out.insights, TABLE_HOT)).toEqual([]);
      expect(
        out.insights.filter((i) => /Top table|A table/.test(i.sentence)),
      ).toEqual([]);
      // Built on the checks alone, which a check's own table_id serves.
      expect(of(out.insights, WAITER_RANK).map((i) => i.entityLabel)).toEqual([
        "Ana",
      ]);
    },
  );

  it("with the inventory list read, the mover fires and names the wine", async () => {
    const xs = await fire(mover());
    expect(of(xs, MOVER).map((i) => i.entityLabel)).toEqual(["Wine M1"]);
  });

  it.each([
    ["failing", { error: "canceling statement due to statement timeout" }],
    ["rejecting", { throws: "fetch failed" }],
  ] as Array<[string, Answer]>)(
    "with the inventory list %s, the mover does not fire, and no insight names a wine by its id",
    async (_how, answer) => {
      const out = await generatorOver({
        ...mover(),
        restaurant_inventory: answer,
      }).generate("r1", { persist: false });
      expect(out.sourcesUnread).toEqual(["inventory list"]);
      expect(of(out.insights, MOVER)).toEqual([]);
      expect(
        out.insights.filter(
          (i) =>
            i.entityLabel === "M1" ||
            i.evidence.entity === "M1" ||
            /\bM1\b/.test(i.sentence),
        ),
      ).toEqual([]);
    },
  );
});

describe("/recommendations says which insight read could not be made", () => {
  it("a refused pour read is named in sourcesUnread, so the feed is not 'nothing to recommend'", async () => {
    const out = await feedOver(
      generatorOver({
        ...withRows(),
        wine_consumption_log: { overCeiling: true },
      }),
    ).getRecommendations("r1", { recordImpressions: false });
    expect(out.sourcesUnread).toEqual(["pour history"]);
    // `generate()` answered, so the engine is not named as a whole.
    expect(out.sourcesUnread).not.toContain("insights");
  });

  it("names nothing when the bundle's reads all answered, even with no rows", async () => {
    const out = await feedOver(generatorOver(empty())).getRecommendations(
      "r1",
      { recordImpressions: false },
    );
    expect(out.sourcesUnread).toEqual([]);
  });

  it("still names 'insights' when generate() itself rejects", async () => {
    const out = await feedOver({
      generate: async () => {
        throw new Error("generator down");
      },
    } as any).getRecommendations("r1", { recordImpressions: false });
    expect(out.sourcesUnread).toEqual(["insights"]);
  });

  it("lists a name two sources share once ('goals')", async () => {
    const out = await feedOver(
      generatorOver({ ...withRows(), analytics_goals: { error: "timeout" } }),
      {
        listGoals: async () => {
          throw new Error("goals down");
        },
      },
    ).getRecommendations("r1", { recordImpressions: false });
    expect(out.sourcesUnread).toEqual(["goals"]);
  });

  it("an older generator that names nothing adds nothing", async () => {
    const out = await feedOver({
      generate: async () => ({ insights: [] }),
    } as any).getRecommendations("r1", { recordImpressions: false });
    expect(out.sourcesUnread).toEqual([]);
  });

  it("the digest's sentence names the read, from the feed's own list", async () => {
    const out = await feedOver(
      generatorOver({ ...withRows(), pos_checks: { error: "timeout" } }),
    ).getRecommendations("r1", { recordImpressions: false });
    expect(sourcesUnreadWords(out.sourcesUnread)).toBe(
      "The engine could not read one of its sources (till checks), so entries that depend on it could not fire.",
    );
  });
});
