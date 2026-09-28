import {
  INSIGHT_GENERATOR_VERSION,
  InsightGeneratorService,
} from "./insight-generator.service";
import { InsightSchedulerService } from "./insight-scheduler.service";

/**
 * A cached sentence is a claim made by a version of the code that may no
 * longer exist.
 *
 * On 2026-09-03, a day after the observed-day fix stopped the generator from
 * producing "Wednesday sales came in 100% lower than your average Wednesday",
 * the running gateway still answered:
 *
 *     GET /api/v1/analytics/insights/550e8400-…   → "source": "stored"
 *     "Tuesday sales came in 100% lower than your average Tuesday ($0 vs $72)."
 *
 * `analytics_insights` is a write-through cache that `getStored()` read with no
 * freshness and no version check, and three separate readers prefer it over a
 * fresh compute. Fixing the arithmetic fixed every FRESH compute and nothing
 * else — the retracted sentence kept being served from the table.
 *
 * These tests pin the repair: a row carries the arithmetic that produced it,
 * a reader refuses anything below its own version, and the hourly sweep
 * replaces such rows regardless of the cadence an operator configured.
 */

/** A Supabase stub that actually HONOURS `gte` / `lt` / `eq` / `in`. */
function makeClient(rowsByTable: Record<string, any[]>) {
  const writes: Array<{ table: string; op: string; rows: any }> = [];
  const client: any = {
    writes,
    from: (table: string) => {
      let rows = [...(rowsByTable[table] ?? [])];
      const builder: any = {};
      builder.select = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.eq = (col: string, v: any) => {
        rows = rows.filter((r) => r[col] === v);
        return builder;
      };
      builder.in = (col: string, vs: any[]) => {
        rows = rows.filter((r) => vs.includes(r[col]));
        return builder;
      };
      builder.gte = (col: string, v: any) => {
        rows = rows.filter((r) => (r[col] ?? 0) >= v);
        return builder;
      };
      builder.lt = (col: string, v: any) => {
        rows = rows.filter((r) => (r[col] ?? 0) < v);
        return builder;
      };
      builder.delete = () => {
        writes.push({ table, op: "delete", rows: null });
        return builder;
      };
      builder.insert = (payload: any) => {
        writes.push({ table, op: "insert", rows: payload });
        return builder;
      };
      builder.upsert = (payload: any) => {
        writes.push({ table, op: "upsert", rows: payload });
        return builder;
      };
      builder.maybeSingle = () =>
        Promise.resolve({ data: rows[0] ?? null, error: null });
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return builder;
    },
  };
  return client;
}

function row(over: Record<string, unknown> = {}) {
  return {
    restaurant_id: "r1",
    candidate_key: "overall.revenue.vs_same_weekday",
    category: "sales",
    sentence:
      "Tuesday sales came in 100% lower than your average Tuesday ($0 vs $72).",
    score: 3,
    generator_version: 0,
    computed_at: "2026-09-02T06:00:02.587889+00:00",
    ...over,
  };
}

function generatorWith(rowsByTable: Record<string, any[]>) {
  const client = makeClient(rowsByTable);
  const svc = new InsightGeneratorService(
    { getClient: () => client, supabase: client } as any,
    {
      load: async () => ({
        dates: new Set<string>(),
        readable: true,
        problem: null,
      }),
    } as any,
    {
      listSuppressions: async () => ({
        keys: new Set<string>(),
        readable: true,
        problem: null,
      }),
    } as any,
  );
  return { svc, client };
}

describe("the insight cache carries its arithmetic", () => {
  it("never serves a row from superseded arithmetic", async () => {
    const { svc } = generatorWith({
      analytics_insights: [row(), row({ generator_version: 1 })],
    });
    // Both rows exist, both are for this restaurant, both are readable — and
    // neither is data any more.
    await expect(svc.getStored("r1")).resolves.toEqual([]);
  });

  it("serves a row written by this build", async () => {
    const fresh = row({
      generator_version: INSIGHT_GENERATOR_VERSION,
      sentence: "Tuesday sales came in 23% lower than your average Tuesday.",
    });
    const { svc } = generatorWith({ analytics_insights: [row(), fresh] });
    const out = await svc.getStored("r1");
    expect(out).toHaveLength(1);
    expect(out[0].sentence).not.toContain("100%");
  });

  it("serves a row from a NEWER build rather than recomputing over it", async () => {
    // Rolling deploy: a newer pod's arithmetic is better, not worse. Refusing
    // it would make this pod recompute and overwrite on every single read.
    const { svc } = generatorWith({
      analytics_insights: [
        row({ generator_version: INSIGHT_GENERATOR_VERSION + 1 }),
      ],
    });
    expect(await svc.getStored("r1")).toHaveLength(1);
  });

  it("serves nothing — not rows of unknown provenance — when the read fails", async () => {
    // The window between this code deploying and migration 20260903130000
    // applying: the column does not exist and PostgREST answers 42703.
    const client: any = {
      from: () => {
        const b: any = {};
        for (const m of ["select", "eq", "in", "gte", "lt", "order", "limit"])
          b[m] = () => b;
        b.then = (res: any) =>
          res({
            data: null,
            error: { message: 'column "generator_version" does not exist' },
          });
        return b;
      },
    };
    const svc = new InsightGeneratorService(
      { getClient: () => client, supabase: client } as any,
      { load: async () => ({ dates: new Set(), readable: true, problem: null }) } as any,
      {
        listSuppressions: async () => ({
          keys: new Set(),
          readable: true,
          problem: null,
        }),
      } as any,
    );
    expect(await svc.getStored("r1")).toEqual([]);
  });

  it("stamps every row it writes with the version that produced it", async () => {
    const { svc, client } = generatorWith({ analytics_insights: [] });
    await (svc as any).persist("r1", [
      {
        candidateKey: "overall.revenue.vs_same_weekday",
        category: "sales",
        sentence: "Tuesday sales came in 23% lower than your average Tuesday.",
        score: 2,
        effectPct: -0.23,
        z: -2,
        entityKey: "Tuesday",
        entityLabel: "Tuesday",
        evidence: {},
        subject: "Tuesday",
        periodKey: "d:2026-09-02",
        suppression: { key: "k", scope: "insight", keys: {} },
        periodStart: null,
        periodEnd: null,
      },
    ]);
    const insert = client.writes.find((w: any) => w.op === "insert");
    expect(insert.rows[0].generator_version).toBe(INSIGHT_GENERATOR_VERSION);
  });

  it("finds the tenants still holding superseded rows", async () => {
    const { svc } = generatorWith({
      analytics_insights: [
        row(),
        row({ category: "purchasing" }),
        row({ restaurant_id: "r2", category: "inventory" }),
        row({ generator_version: INSIGHT_GENERATOR_VERSION, category: "staff" }),
      ],
    });
    const stale = await svc.staleVersionCategories();
    expect(Array.from(stale!.get("r1")!).sort()).toEqual([
      "purchasing",
      "sales",
    ]);
    expect(Array.from(stale!.get("r2")!)).toEqual(["inventory"]);
    // The current-version row is not stale and contributes nothing.
    expect(stale!.get("r1")!.has("staff")).toBe(false);
  });
});

describe("the hourly sweep replaces superseded rows regardless of cadence", () => {
  function makeScheduler(opts: {
    prefs: any[];
    stale: Map<string, Set<string>> | null;
  }) {
    const client = makeClient({
      restaurants: [{ id: "r1" }],
      analytics_insight_prefs: opts.prefs,
    });
    const generated: Array<{ rid: string; categories: string[] }> = [];
    const generator: any = {
      generate: async (rid: string, o: any) => {
        generated.push({ rid, categories: o.categories });
        return { insights: [] };
      },
      staleVersionCategories: async () => opts.stale,
    };
    const svc = new InsightSchedulerService(
      { getClient: () => client } as any,
      generator,
    );
    return { svc, generated };
  }

  const manualEverywhere = InsightSchedulerService.ALL_CATEGORIES.map(
    (category) => ({
      restaurant_id: "r1",
      category,
      cadence: "manual",
      enabled: false,
      hour_of_day: 6,
      last_run_at: null,
    }),
  );

  it("refreshes a superseded category even when the operator set it to manual", async () => {
    // `manual` and `enabled:false` govern how often we look for NEW findings —
    // not whether the product may keep a sentence it has retracted.
    const { svc, generated } = makeScheduler({
      prefs: manualEverywhere,
      stale: new Map([["r1", new Set(["sales"])]]),
    });
    await svc.runSweep(new Date("2026-09-03T13:00:00Z"));
    expect(generated).toEqual([{ rid: "r1", categories: ["sales"] }]);
  });

  it("does nothing when nothing is superseded and every cadence is manual", async () => {
    const { svc, generated } = makeScheduler({
      prefs: manualEverywhere,
      stale: new Map(),
    });
    await svc.runSweep(new Date("2026-09-03T13:00:00Z"));
    expect(generated).toEqual([]);
  });

  it("survives a failed stale scan without claiming nothing was stale", async () => {
    const { svc, generated } = makeScheduler({
      prefs: manualEverywhere,
      stale: null,
    });
    // The sweep still runs on cadence (nothing is due here), and does NOT
    // invent an empty stale set that would read as "all tenants are current".
    await expect(
      svc.runSweep(new Date("2026-09-03T13:00:00Z")),
    ).resolves.toBeUndefined();
    expect(generated).toEqual([]);
  });
});
