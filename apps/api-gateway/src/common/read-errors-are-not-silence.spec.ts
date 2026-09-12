import { PosHubService } from "../pos-hub/pos-hub.service";
import { PerformanceService } from "../team/performance.service";
import { VendorCatalogueService } from "../vendor-catalogue/vendor-catalogue.service";
import { InsightSchedulerService } from "../analytics/insights/insight-scheduler.service";

/**
 * The READ half of the defect class `pos-hub.fail-open.spec.ts` covers on the
 * write side, and the behavioural half of the guard in
 * `scripts/check_read_errors_not_swallowed.py`. See ADR 0067.
 *
 * supabase-js **resolves** with `{ data, error }` — it does not throw. So
 * `const { data } = await client.from(t).select()` yields `[]` for BOTH a
 * failed query and a genuinely empty table, `maybeSingle()` yields `null` for
 * both "no row" and "query failed", and any wrapping try/catch is INERT.
 *
 * Each test below fails against the code as it stood on `origin/main`
 * (1f4717cc). A regression test that passes before its fix guards nothing.
 *
 * The paired "genuinely empty" test on each one is not padding: without it the
 * fix trades a silent failure for a permanent false alarm, and an alarm that is
 * always on is another way of reporting nothing.
 */

type Row = Record<string, any>;

/** `failing` names the tables whose query resolves with an error, as PostgREST does. */
function makeDb(failing: Set<string>, rowsByTable: Record<string, Row[]> = {}) {
  const err = (t: string) =>
    failing.has(t)
      ? { code: "57014", message: `statement timeout on ${t}`, details: null }
      : null;

  const client: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        is: () => q,
        gte: () => q,
        lte: () => q,
        or: () => q,
        order: () => q,
        limit: () => q,
        range: () => q,
        maybeSingle: async () => ({
          data: err(table) ? null : ((rowsByTable[table] ?? [])[0] ?? null),
          error: err(table),
        }),
        single: async () => ({
          data: err(table) ? null : ((rowsByTable[table] ?? [])[0] ?? null),
          error: err(table),
        }),
        upsert: async () => ({ data: null, error: err(table) }),
        insert: async () => ({ data: null, error: err(table) }),
        update: () => q,
      };
      q.then = (res: any) =>
        res({
          data: err(table) ? null : (rowsByTable[table] ?? []),
          count: err(table) ? null : (rowsByTable[table] ?? []).length,
          error: err(table),
        });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  return client;
}

const quiet = (s: any) => {
  jest.spyOn(s.logger, "error").mockImplementation(() => undefined);
  jest.spyOn(s.logger, "warn").mockImplementation(() => undefined);
  return s;
};

// ── pos-hub getStatus: "is my connection live?" ────────────────────────────
describe("PosHubService.getStatus does not answer a dead read with zero", () => {
  const svc = (client: any) =>
    quiet(
      new PosHubService({ getClient: () => client, supabase: client } as any),
    );

  it("reports unavailable rather than '0 checks, 0 sources' when the read fails", async () => {
    // BEFORE: `const { data } = …` → rows = [] → totalChecks 0, sources [].
    // Settings → POS rendered "Ingestion (30d): 0 checks from this source",
    // the same sentence a genuinely idle integration produces.
    const out: any = await svc(makeDb(new Set(["pos_checks"]))).getStatus(
      "r-1",
    );
    expect(out.unavailable).toBe(true);
    expect(out.totalChecks).toBeNull();
    expect(out.sources).toBeNull();
  });

  it("still reports a real measured zero as zero", async () => {
    const out: any = await svc(makeDb(new Set())).getStatus("r-1");
    expect(out.unavailable).toBe(false);
    expect(out.totalChecks).toBe(0);
    expect(out.sources).toEqual([]);
  });
});

// ── pos-hub loadItemMappings: the ingest's other silent lookup ─────────────
describe("PosHubService.ingest surfaces a failed item-mapping lookup", () => {
  const CHECK = {
    externalCheckId: "chk-1",
    tableRef: "T1",
    openedAt: "2026-09-01T18:00:00.000Z",
    closedAt: null,
    voided: false,
    items: [],
    raw: null,
  };
  const svc = (client: any) =>
    quiet(
      new PosHubService({ getClient: () => client, supabase: client } as any),
    );

  it("names pos_item_mappings in errors when that lookup failed", async () => {
    // BEFORE: [] → resolveWine finds nothing → every line ingests with
    // inventory_id null and no depletion, while errors stayed [].
    const out: any = await svc(makeDb(new Set(["pos_item_mappings"]))).ingest(
      "r-1",
      "generic_webhook",
      [CHECK],
    );
    expect(out.errors.join(" ")).toMatch(/pos_item_mappings/);
    // Degrade, do not 500 — the POS must not retry this forever.
    expect(out.upserted).toBe(1);
  });

  it("reports no error when the restaurant has simply mapped nothing yet", async () => {
    const out: any = await svc(makeDb(new Set())).ingest(
      "r-1",
      "generic_webhook",
      [CHECK],
    );
    expect(out.errors).toEqual([]);
  });
});

// ── performance: the peer median that flattered everyone ───────────────────
describe("PerformanceService peer benchmark is unknown, not zero", () => {
  const team = {
    assertAccess: async () => ({ role: "manager" }),
    assertMemberInRestaurant: async () => undefined,
  } as any;
  const rows = [
    {
      service_date: "2026-08-01",
      net_sales: 900,
      wine_sales: 300,
      covers: 30,
      checks: 12,
    },
  ];

  /**
   * The member's own series and the team benchmark are the SAME table read
   * twice. Only the second (the benchmark) fails here, which is the case that
   * matters: the member card still renders, and it renders a peer comparison
   * built from nothing.
   */
  const failNthServerSalesRead = (n: number) => {
    let seen = 0;
    const base = makeDb(new Set(), { server_sales: rows });
    return {
      from(table: string) {
        if (table !== "server_sales") return base.from(table);
        seen += 1;
        return seen === n
          ? makeDb(new Set(["server_sales"])).from(table)
          : base.from(table);
      },
    } as any;
  };

  it("returns a null median and band when the benchmark query failed", async () => {
    // BEFORE: percentile([]) === 0, so median 0 and band [0,0] — which puts
    // every server in every restaurant above their team.
    const svc: any = quiet(
      new PerformanceService(
        { supabase: failNthServerSalesRead(2) } as any,
        team,
      ),
    );
    const out = await svc.getMemberPerformance("u-1", "r-1", "m-1");

    expect(out.hasData).toBe(true);
    expect(out.analytic.median).toBeNull();
    expect(out.analytic.band).toBeNull();
  });

  it("returns a null median when the team genuinely has no peer covers", async () => {
    // Unknown for the honest reason must render identically to unknown for the
    // failure reason — the em dash, never a zero (ADR 0051).
    const client = makeDb(new Set(), {
      server_sales: [{ ...rows[0], covers: 0 }],
    });
    const svc: any = quiet(
      new PerformanceService({ supabase: client } as any, team),
    );
    const out = await svc.getMemberPerformance("u-1", "r-1", "m-1");
    expect(out.analytic.median).toBeNull();
  });

  it("returns a real median when peers exist", async () => {
    const client = makeDb(new Set(), { server_sales: rows });
    const svc: any = quiet(
      new PerformanceService({ supabase: client } as any, team),
    );
    const out = await svc.getMemberPerformance("u-1", "r-1", "m-1");
    expect(out.analytic.median).toBe(30);
  });
});

// ── vendor-catalogue: wrong results, not empty ones ────────────────────────
describe("VendorCatalogueService.search refuses rather than returning a different query", () => {
  it("throws instead of silently dropping every filter", async () => {
    // BEFORE: on ANY error it re-ran a query with no country, no listing_tier,
    // no text match and no type, and returned that as the search result.
    const client = makeDb(new Set(["vendor_catalogue"]));
    const svc = quiet(new VendorCatalogueService({ supabase: client } as any));
    await expect(
      svc.search({ q: "Breakthru", country: "US", type: "distributor" } as any),
    ).rejects.toThrow(/unavailable/i);
  });

  it("returns an empty page when the catalogue genuinely matches nothing", async () => {
    const client = makeDb(new Set(), { vendor_catalogue: [] });
    const svc = quiet(new VendorCatalogueService({ supabase: client } as any));
    await expect(svc.search({ q: "zzz" } as any)).resolves.toMatchObject({
      data: [],
      total: 0,
    });
  });
});

// ── insight-scheduler: the widest blast radius of them all ─────────────────
describe("InsightSchedulerService.runSweep does not no-op the whole product in silence", () => {
  const gen = {
    refresh: async () => undefined,
    generate: async () => undefined,
  } as any;

  it("throws when the restaurants list cannot be read", async () => {
    // BEFORE: `const { data: restaurants } = …` → null → `if
    // (!restaurants?.length) return` → the ENTIRE hourly sweep no-ops for every
    // tenant, and sweep()'s try/catch never fires because nothing threw.
    const client = makeDb(new Set(["restaurants"]));
    const svc: any = quiet(
      new InsightSchedulerService({ getClient: () => client } as any, gen),
    );
    await expect(svc.runSweep(new Date())).rejects.toThrow(/restaurants/i);
  });

  it("returns quietly when there genuinely are no restaurants", async () => {
    const client = makeDb(new Set(), { restaurants: [] });
    const svc: any = quiet(
      new InsightSchedulerService({ getClient: () => client } as any, gen),
    );
    await expect(svc.runSweep(new Date())).resolves.toBeUndefined();
  });
});
