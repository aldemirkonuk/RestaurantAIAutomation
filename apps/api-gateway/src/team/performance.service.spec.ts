import { TeamService } from "./team.service";
import { PerformanceService } from "./performance.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * A-048 (analytics walk, 2026-10-03), ADR 0294: the /team Performance card
 * printed "a house median of 72" — dollars per cover, with no unit and no
 * currency — under "Average check $186", and set it beside nothing it could be
 * compared with. These specs pin what the gateway now sends so the card can
 * say what the median is:
 *
 * - the member's own sales per cover, over the same services the median is
 *   taken over (those that record covers with their sales);
 * - the house's currency and country, so every figure prints in them;
 * - `analytic.benchmark`: why there is a median or why there is none, and how
 *   many services and servers it covers, this member included or not;
 * - when every per-cover figure in the window is this member's own, no
 *   median at all (the founder's pick, 2026-10-04: "House median
 *   (Recommended)", which refuses that comparison);
 * - an average over no checks, and a share of no sales, are unknown (null),
 *   never 0 (ADR 0051).
 *
 * Every case here fails at origin/main `f5f658934`, where none of these keys
 * exist, the self-only median is a number, and the empty averages are 0.
 */

const RID = "11111111-1111-4111-8111-111111111111";
const MANAGER = "user-manager";
const LUCAS = "55555555-5555-4555-8555-555555555555";
const MAYA = "66666666-6666-4666-8666-666666666666";

type Sale = {
  member_id: string;
  service_date: string;
  net_sales: number;
  covers: number;
  checks?: number;
  wine_sales?: number;
};

const sale = (s: Sale) => ({
  restaurant_id: RID,
  checks: 0,
  wine_sales: 0,
  source: "manual",
  ...s,
});

function seed(
  sales: Sale[],
  opts: {
    house?: Record<string, any> | null;
    errors?: Record<string, { message: string }>;
  } = {},
): StubDb {
  const house =
    opts.house === undefined
      ? { id: RID, currency: "TRY", country: "Türkiye" }
      : opts.house;
  return makeStubDb(
    {
      user_restaurant_access: [
        {
          id: "a1",
          user_id: MANAGER,
          restaurant_id: RID,
          role: "manager",
          is_active: true,
        },
      ],
      users: [{ user_id: MANAGER, restaurant_id: RID, role: "manager" }],
      team_members: [
        { id: LUCAS, restaurant_id: RID, display_name: "Lucas" },
        { id: MAYA, restaurant_id: RID, display_name: "Maya" },
      ],
      restaurants: house ? [house] : [],
      server_sales: sales.map(sale),
    },
    opts.errors ?? {},
  );
}

function build(db: StubDb, supabase?: any) {
  const dbs = supabase
    ? { ...asDatabaseService(db), supabase }
    : asDatabaseService(db);
  const team = new TeamService(asDatabaseService(db));
  const perf = new PerformanceService(dbs, team);
  jest.spyOn((team as any).logger, "error").mockImplementation(() => {});
  jest.spyOn((perf as any).logger, "error").mockImplementation(() => {});
  jest.spyOn((perf as any).logger, "warn").mockImplementation(() => {});
  return perf;
}

/** Lucas's two services and Maya's two: per cover 72, 80 (his) and 70, 75 (hers). */
const TWO_SERVERS: Sale[] = [
  {
    member_id: LUCAS,
    service_date: "2026-09-01",
    net_sales: 1800,
    covers: 25,
    checks: 10,
    wine_sales: 450,
  },
  {
    member_id: LUCAS,
    service_date: "2026-09-02",
    net_sales: 2000,
    covers: 25,
    checks: 10,
    wine_sales: 500,
  },
  {
    member_id: MAYA,
    service_date: "2026-09-01",
    net_sales: 1400,
    covers: 20,
    checks: 8,
  },
  {
    member_id: MAYA,
    service_date: "2026-09-02",
    net_sales: 1500,
    covers: 20,
    checks: 8,
  },
];

describe("GET …/members/:id/performance — the house median has a unit and a comparison (A-048)", () => {
  it("sends the member's own sales per cover beside a per-cover house median", async () => {
    const out = await build(seed(TWO_SERVERS)).getMemberPerformance(
      MANAGER,
      RID,
      LUCAS,
    );

    expect(out.metrics).toEqual({
      salesPerShift: 1900,
      avgCheck: 190, // 3800 / 20 checks
      salesPerCover: 76, // 3800 / 50 covers, the figure the median is set against
      coverServices: 2,
      wineAttachPct: 25, // 950 / 3800: a share of sales, labelled so on the card
    });
    // Per cover across the house: 70, 72, 75, 80.
    expect(out.analytic.unit).toBe("/cover");
    expect(out.analytic.median).toBe(75);
    expect(out.analytic.band).toEqual([72, 80]);
    expect(out.analytic.benchmark).toEqual({
      state: "computed",
      services: 4,
      servers: 2,
      includesMember: true,
    });
  });

  it("sends the house's currency and country with the figures", async () => {
    const out = await build(seed(TWO_SERVERS)).getMemberPerformance(
      MANAGER,
      RID,
      LUCAS,
    );
    expect(out.money).toEqual({
      currency: "TRY",
      country: "Türkiye",
      readable: true,
    });
  });

  it("says the currency is not recorded, not a guessed dollar, when the house states none", async () => {
    const out = await build(
      seed(TWO_SERVERS, { house: { id: RID, currency: null, country: null } }),
    ).getMemberPerformance(MANAGER, RID, LUCAS);
    expect(out.money).toEqual({
      currency: null,
      country: null,
      readable: true,
    });
  });

  it("marks the currency unreadable when that read fails, and still sends the figures", async () => {
    const out = await build(
      seed(TWO_SERVERS, {
        errors: { "restaurants:select": { message: "timeout" } },
      }),
    ).getMemberPerformance(MANAGER, RID, LUCAS);
    expect(out.money).toEqual({
      currency: null,
      country: null,
      readable: false,
    });
    expect(out.metrics.salesPerCover).toBe(76);
  });

  it("refuses the comparison when every per-cover figure in the window is the member's own", async () => {
    // At origin/main this answered a median of 80 — Lucas against himself.
    const mine = TWO_SERVERS.filter((s) => s.member_id === LUCAS);
    const out = await build(seed(mine)).getMemberPerformance(
      MANAGER,
      RID,
      LUCAS,
    );
    expect(out.analytic.median).toBeNull();
    expect(out.analytic.band).toBeNull();
    expect(out.analytic.benchmark).toEqual({
      state: "self-only",
      services: 2,
      servers: 1,
      includesMember: true,
    });
    // His own figure still stands, alone.
    expect(out.metrics.salesPerCover).toBe(76);
  });

  it("computes the median when the only other server is someone else", async () => {
    // Lucas's services record no covers; Maya's do. The median is hers alone,
    // and it does not include him.
    const sales: Sale[] = [
      {
        member_id: LUCAS,
        service_date: "2026-09-01",
        net_sales: 1800,
        covers: 0,
        checks: 10,
      },
      ...TWO_SERVERS.filter((s) => s.member_id === MAYA),
    ];
    const out = await build(seed(sales)).getMemberPerformance(
      MANAGER,
      RID,
      LUCAS,
    );
    expect(out.analytic.median).toBe(75);
    expect(out.analytic.benchmark).toMatchObject({
      state: "computed",
      services: 2,
      servers: 1,
      includesMember: false,
    });
    expect(out.metrics.salesPerCover).toBeNull();
    expect(out.metrics.coverServices).toBe(0);
  });

  it("says no service records covers when none in the window does", async () => {
    const sales = TWO_SERVERS.map((s) => ({ ...s, covers: 0 }));
    const out = await build(seed(sales)).getMemberPerformance(
      MANAGER,
      RID,
      LUCAS,
    );
    expect(out.analytic.median).toBeNull();
    expect(out.analytic.benchmark).toMatchObject({
      state: "no-covers",
      services: 0,
      servers: 0,
      includesMember: false,
    });
  });

  it("says the benchmark could not be read when that read fails — not 'no covers'", async () => {
    const db = seed(TWO_SERVERS);
    // The member's own rows and the benchmark are the same table read twice;
    // only the second (the benchmark: no member filter) fails.
    const supabase = {
      from(table: string) {
        const q = db.supabase.from(table);
        if (table !== "server_sales") return q;
        let mine = false;
        const eq = q.eq.bind(q);
        q.eq = (col: string, v: any) => {
          if (col === "member_id") mine = true;
          return eq(col, v);
        };
        const then = q.then.bind(q);
        q.then = (ok: any, ko: any) =>
          mine
            ? then(ok, ko)
            : Promise.resolve({
                data: null,
                error: { code: "57014", message: "statement timeout" },
              }).then(ok, ko);
        return q;
      },
    };
    const out = await build(db, supabase).getMemberPerformance(
      MANAGER,
      RID,
      LUCAS,
    );
    expect(out.hasData).toBe(true);
    expect(out.analytic.median).toBeNull();
    expect(out.analytic.benchmark).toMatchObject({
      state: "unreadable",
      services: 0,
      servers: 0,
    });
    expect(out.metrics.salesPerCover).toBe(76);
  });

  it("takes the member's per cover over the services that record covers, as the median does", async () => {
    // A service typed in with no covers stores covers = 0 (the ingest writes
    // `?? 0`). Its 1000 in sales must not be divided by another night's covers:
    // that would read 2800 / 25 = 112 per cover against a median of ~72.
    const sales: Sale[] = [
      {
        member_id: LUCAS,
        service_date: "2026-09-01",
        net_sales: 1800,
        covers: 25,
        checks: 10,
      },
      {
        member_id: LUCAS,
        service_date: "2026-09-02",
        net_sales: 1000,
        covers: 0,
        checks: 5,
      },
      ...TWO_SERVERS.filter((s) => s.member_id === MAYA),
    ];
    const out = await build(seed(sales)).getMemberPerformance(
      MANAGER,
      RID,
      LUCAS,
    );
    expect(out.metrics.salesPerCover).toBe(72);
    expect(out.metrics.coverServices).toBe(1);
    // The median is taken over the same kind of service: 70, 72, 75.
    expect(out.analytic.median).toBe(72);
    expect(out.analytic.benchmark.services).toBe(3);
  });

  it("answers an average over no checks, and a share of no sales, as unknown — never 0", async () => {
    const sales: Sale[] = [
      {
        member_id: LUCAS,
        service_date: "2026-09-01",
        net_sales: 0,
        covers: 0,
        checks: 0,
      },
    ];
    const out = await build(seed(sales)).getMemberPerformance(
      MANAGER,
      RID,
      LUCAS,
    );
    expect(out.hasData).toBe(true);
    expect(out.metrics.avgCheck).toBeNull();
    expect(out.metrics.wineAttachPct).toBeNull();
    expect(out.metrics.salesPerCover).toBeNull();
  });

  it("reads the house's newest 200 services, and says when the member is not among them", async () => {
    // 200 newer services of Maya's push Lucas's one service out of the window.
    const maya: Sale[] = Array.from({ length: 200 }, (_, i) => ({
      member_id: MAYA,
      service_date: new Date(Date.UTC(2026, 1, 1) + i * 86_400_000)
        .toISOString()
        .slice(0, 10),
      net_sales: 1400,
      covers: 20,
    }));
    const sales: Sale[] = [
      {
        member_id: LUCAS,
        service_date: "2026-01-05",
        net_sales: 1800,
        covers: 25,
        checks: 10,
      },
      ...maya,
    ];
    const db = seed(sales);
    const out = await build(db).getMemberPerformance(MANAGER, RID, LUCAS);
    const team = db
      .opsOn("server_sales", "select")
      .find((op) => !op.filters.some((f) => f.column === "member_id"));
    expect(team?.filters).toEqual([
      { kind: "eq", column: "restaurant_id", value: RID },
    ]);
    expect(out.analytic.benchmark).toEqual({
      state: "computed",
      services: 200,
      servers: 1,
      includesMember: false,
    });
    expect(out.analytic.median).toBe(70);
  });
});
