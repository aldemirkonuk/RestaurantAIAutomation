import { Test, TestingModule } from "@nestjs/testing";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { RecommendationsService } from "./recommendations.service";
import { RecommendationActionsService } from "./recommendation-actions.service";
import { TableAnalyticsService } from "./table-analytics.service";
import { ConfigService } from "@nestjs/config";
import { GoalsService } from "./goals.service";
import { GoalScenarioRequestsService } from "./goal-scenario-requests.service";
import { ConsultantsService } from "./consultants.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { InsightSchedulerService } from "./insights/insight-scheduler.service";
import { DayExclusionsService } from "./insights/day-exclusions.service";
import { DatabaseService } from "../database/database.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import {
  HOUSE_DAY_LOOKBACK_MS,
  HOUSE_ZONE_UNSET,
  HOUSE_ZONE_UNSET_PACE,
  houseDayBounds,
  houseDayOf,
  houseToday,
  readHouseZone,
} from "../common/house-day";
import { ScenarioVerifyService } from "../simpos/scenario-verify.service";
import { EXPORT_CUTTINGS } from "../reports/exports/report-export-cuttings";
import type { ExportDoc } from "../reports/exports/report-export-doc";
import { PAYLOADS } from "../reports/exports/__fixtures__/cutting-payloads";

/**
 * `AnalyticsService`, stubbed. Only `days_of_inventory` reaches it — it reads
 * the single published `daysInventoryOutstanding` field rather than
 * re-deriving the ratio, so two surfaces cannot disagree about one cellar.
 */
const analytics = {
  getFinancialSummary: async () => ({ daysInventoryOutstanding: null }),
} as any;

/**
 * The verdict recorder, captured (OD-59 / ADR 0029 P3.0).
 *
 * `goal_cutting_spec` used to emit a footprint row carrying `call_level_v0`
 * alone — "the HTTP request returned 200" — which is silent about whether the
 * assistant named an analysis this sheet carries. These rows are what
 * `check_task_types_are_graded.py` demands and what a reader of
 * `nf_a.doneability_verdict_coverage` will actually see.
 */
const graded: Array<{ basis: string; outcome: unknown; evidence: any }> = [];
const verdicts = {
  record: (_ref: unknown, basis: string, v: any) =>
    graded.push({ basis, outcome: v.outcome, evidence: v.evidence }),
  recordForEvent: () => {},
} as any;

/**
 * OD-85 — POS-backed sales revenue.
 *
 * Four web surfaces (COGS ratio, Wine Consumption Analytics, the labour
 * overlay, the channel donut) had no sales figure to read, so they either sat
 * blank or divided procurement spend by itself. Real revenue was already in
 * `pos_checks` and already summed correctly by `GoalsService` for goal
 * progress; this endpoint exposes that same query instead of adding a second
 * one that could drift from it.
 *
 * The load-bearing assertion in here is the NEGATIVE one: a restaurant with no
 * POS connected must get `revenue: null` and `posConnected: false`, never `0`.
 * Zero is a claim ("you sold nothing"); null is the truth ("we have no idea").
 * ADR 0020 — see .planning/decisions/0020-no-fabricated-answers.md.
 */

/**
 * Rows registered per table. A function value is called with the 0-based index
 * of that table's `.from()` call, so a test can return different rows to the
 * "has this restaurant ever had a POS check" probe than to the windowed sum —
 * the stub does not itself honour `.gte`/`.lte`, which is why the house-day
 * cases below can hand the fold rows the read would have let through and
 * watch which day each lands on.
 */
type Rows = Record<string, any[] | ((callIndex: number) => any[])>;

/**
 * Chainable Supabase stub. Every builder method records its arguments and
 * returns itself; awaiting the builder resolves the rows registered for the
 * table named in `.from()`, and `.single()`/`.maybeSingle()` resolve its first
 * row. `calls` lets a test assert the FILTERS that were applied — `voided =
 * false` is the difference between revenue and a number that includes
 * cancelled checks. A table named in `errors` answers with that error.
 */
function makeClient(rowsByTable: Rows, errors: Record<string, string> = {}) {
  const calls: Array<{ table: string; method: string; args: any[] }> = [];
  const passthrough = [
    "select",
    "update",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "is",
    "or",
    "not",
    "order",
    "limit",
    "in",
  ];
  const perTableCalls = new Map<string, number>();
  const client = {
    calls,
    from: jest.fn((table: string) => {
      const index = perTableCalls.get(table) ?? 0;
      perTableCalls.set(table, index + 1);
      const registered = rowsByTable[table];
      const rows =
        typeof registered === "function"
          ? registered(index)
          : (registered ?? []);
      const error = errors[table] ? { message: errors[table] } : null;
      const builder: any = {};
      for (const method of passthrough) {
        builder[method] = jest.fn((...args: any[]) => {
          calls.push({ table, method, args });
          return builder;
        });
      }
      const one = () =>
        Promise.resolve(
          error
            ? { data: null, error }
            : { data: rows[0] ?? null, error: null },
        );
      builder.single = jest.fn(one);
      builder.maybeSingle = jest.fn(one);
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve(
          error ? { data: null, error } : { data: rows, error: null },
        ).then(resolve, reject);
      return builder;
    }),
  };
  return client;
}

/** Tuzlu Rüzgar keeps Los Angeles time. */
const LA = "America/Los_Angeles";
const LA_HOUSE = { timezone: LA, country: "US" };

/**
 * A GoalsService over the stub. The house reads Los Angeles time unless a test
 * registers its own `restaurants` row (ADR 0296: every day here is the house's).
 */
function makeGoals(
  rowsByTable: Rows,
  errors: Record<string, string> = {},
  financial: any = analytics,
) {
  const client = makeClient(
    { restaurants: [LA_HOUSE], ...rowsByTable },
    errors,
  );
  const db = { getClient: () => client } as unknown as DatabaseService;
  // ConfigService and ModelClientService joined the constructor for the goals
  // desk's "ask the book which analysis shows this goal" (report-cuttings.ts).
  // Neither is reached by any POS-revenue path, so both are stubbed empty here.
  const service = new GoalsService(
    db,
    { getStored: async () => [] } as unknown as InsightGeneratorService,
    { get: () => undefined } as never,
    {} as never,
    verdicts,
    financial,
  );
  return { service, client };
}

function makeAnalytics(rowsByTable: Rows) {
  const client = makeClient(rowsByTable);
  const db = { getClient: () => client } as unknown as DatabaseService;
  return { service: new AnalyticsService(db), client };
}

/**
 * The clock every house-day case runs on: 03:00 UTC on 2 September 2026, which
 * is still 20:00 on 1 September in Los Angeles.
 */
const NOW = "2026-09-02T03:00:00.000Z";
const LA_TODAY = "2026-09-01";

/** `n` checks closing `step` minutes apart from `firstClose`, each `total`. */
function checksClosing(
  n: number,
  firstClose: string,
  stepMinutes: number,
  total: number,
): Array<{ total: number; opened_at: string; closed_at: string; items: [] }> {
  const t0 = Date.parse(firstClose);
  return Array.from({ length: n }, (_, i) => {
    const closed = t0 + i * stepMinutes * 60_000;
    return {
      total,
      opened_at: new Date(closed - 90 * 60_000).toISOString(),
      closed_at: new Date(closed).toISOString(),
      items: [],
    };
  });
}

/** The windowed read sees `rows`; the connection probe sees one check. */
const probeThen = (rows: any[]) => (call: number) =>
  call === 0 ? [{ id: "probe" }] : rows;

const seriesOf = (r: {
  dailySeries: Array<{ date: string; revenue: number }>;
}) =>
  Object.fromEntries(
    r.dailySeries.map((d) => [d.date, Math.round(d.revenue * 100) / 100]),
  );

describe("house-day — the one rule (ADR 0296)", () => {
  it("files an instant on the house's own date", () => {
    // Tuzlu's last Jul 1 dinner closed 23:45 in LA — 06:45 UTC on Jul 2.
    expect(houseDayOf("2026-07-02T06:45:00Z", LA)).toBe("2026-07-01");
    // The street-fair booth check closed 18:00 LA on Aug 22.
    expect(houseDayOf("2026-08-23T01:00:00Z", LA)).toBe("2026-08-22");
    // Istanbul is three hours ahead of UTC: 21:30 UTC is already tomorrow.
    expect(houseDayOf("2026-07-01T21:30:00Z", "Europe/Istanbul")).toBe(
      "2026-07-02",
    );
    expect(houseDayOf(null, LA)).toBeNull();
    expect(houseDayOf("", LA)).toBeNull();
    expect(houseDayOf("not a time", LA)).toBeNull();
  });

  it("files a check by when it closed, else when it opened", () => {
    // Opened 23:30 LA on Jul 1, closed 00:20 LA on Jul 2: the next day's sale.
    expect(
      houseDayOf(
        {
          opened_at: "2026-07-02T06:30:00Z",
          closed_at: "2026-07-02T07:20:00Z",
        },
        LA,
      ),
    ).toBe("2026-07-02");
    // Still open: filed by when it opened.
    expect(
      houseDayOf({ opened_at: "2026-07-02T06:30:00Z", closed_at: null }, LA),
    ).toBe("2026-07-01");
    expect(houseDayOf({ opened_at: null, closed_at: null }, LA)).toBeNull();
    // An instant and a Date are filed by themselves, not read as a check.
    expect(houseDayOf(new Date("2026-07-02T06:30:00Z"), LA)).toBe("2026-07-01");
  });

  it("bounds a 23-hour and a 25-hour day by their own midnights", () => {
    const spring = houseDayBounds("2026-03-08", "2026-03-08", LA);
    expect(spring.startIso).toBe("2026-03-08T08:00:00.000Z");
    expect(spring.endIso).toBe("2026-03-09T07:00:00.000Z");
    expect(Date.parse(spring.endIso) - Date.parse(spring.startIso)).toBe(
      23 * 3_600_000,
    );
    const autumn = houseDayBounds("2026-11-01", "2026-11-01", LA);
    expect(autumn.startIso).toBe("2026-11-01T07:00:00.000Z");
    expect(autumn.endIso).toBe("2026-11-02T08:00:00.000Z");
    expect(Date.parse(autumn.endIso) - Date.parse(autumn.startIso)).toBe(
      25 * 3_600_000,
    );
    // A range spans both shifts on its own midnights.
    const across = houseDayBounds("2026-03-01", "2026-11-30", LA);
    expect(across.startIso).toBe("2026-03-01T08:00:00.000Z");
    expect(across.endIso).toBe("2026-12-01T08:00:00.000Z");
    // The read opens a day early, for a check opened before the first midnight.
    expect(Date.parse(across.startIso) - Date.parse(across.readFromIso)).toBe(
      HOUSE_DAY_LOOKBACK_MS,
    );
    expect(HOUSE_DAY_LOOKBACK_MS).toBe(24 * 3_600_000);
    expect(
      houseDayBounds("2026-07-01", "2026-07-01", "Europe/Istanbul").startIso,
    ).toBe("2026-06-30T21:00:00.000Z");
  });

  it("reads today on the house's clock", () => {
    expect(houseToday(LA, new Date(NOW))).toBe(LA_TODAY);
    expect(
      houseToday("Europe/Istanbul", new Date("2026-09-01T23:30:00Z")),
    ).toBe("2026-09-02");
  });

  it("reads the house's zone, else its country's only zone, else none — never UTC", async () => {
    const zoneOf = (row: any) =>
      readHouseZone(makeClient({ restaurants: row ? [row] : [] }), "r1");
    await expect(zoneOf(LA_HOUSE)).resolves.toEqual({
      zone: LA,
      source: "house",
    });
    await expect(zoneOf({ timezone: null, country: "TR" })).resolves.toEqual({
      zone: "Europe/Istanbul",
      source: "country",
    });
    // The US keeps several zones, so the country alone names none.
    await expect(zoneOf({ timezone: null, country: "US" })).resolves.toEqual({
      zone: null,
      source: "none",
    });
    await expect(
      zoneOf({ timezone: "Mars/Olympus", country: null }),
    ).resolves.toEqual({
      zone: null,
      source: "none",
    });
    await expect(zoneOf(null)).resolves.toEqual({ zone: null, source: "none" });
  });

  it("throws on a failed read of the house — a fault is not a settings gap", async () => {
    const client = makeClient({}, { restaurants: "connection reset" });
    await expect(readHouseZone(client, "r1")).rejects.toThrow(
      "The house's time zone could not be read: connection reset",
    );
  });
});

describe("GoalsService.getPosRevenueWindow", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });
  afterEach(() => jest.useRealTimers());

  it("reports posConnected:false and revenue:null when the restaurant has no POS checks at all", async () => {
    const { service } = makeGoals({ pos_checks: [] });

    const result = await service.getPosRevenueWindow("r1", 30);

    expect(result.posConnected).toBe(false);
    // Not 0. A restaurant with no POS did not sell nothing — we do not know.
    expect(result.revenue).toBeNull();
    expect(result.checkCount).toBeNull();
    expect(result.dailySeries).toEqual([]);
  });

  it("sums pos_checks.total over the window and excludes voided checks in SQL", async () => {
    // 12:00 in Los Angeles on the house's today.
    const day = `${LA_TODAY}T19:00:00Z`;
    const { service, client } = makeGoals({
      pos_checks: (call) =>
        call === 0
          ? [{ id: "c1" }] // connection probe
          : [
              { total: 120.5, opened_at: day, closed_at: day, items: [] },
              { total: 79.5, opened_at: day, closed_at: day, items: [] },
            ],
    });

    const result = await service.getPosRevenueWindow("r1", 30);

    expect(result.posConnected).toBe(true);
    expect(result.revenue).toBeCloseTo(200);
    expect(result.checkCount).toBe(2);
    expect(result.dailySeries).toEqual([{ date: LA_TODAY, revenue: 200 }]);

    // The void filter is not optional: a voided check never happened.
    const voidFilter = client.calls.find(
      (c) =>
        c.table === "pos_checks" &&
        c.method === "eq" &&
        c.args[0] === "voided" &&
        c.args[1] === false,
    );
    expect(voidFilter).toBeDefined();

    // Tenant scoping.
    expect(
      client.calls.some(
        (c) =>
          c.table === "pos_checks" &&
          c.method === "eq" &&
          c.args[0] === "restaurant_id" &&
          c.args[1] === "r1",
      ),
    ).toBe(true);

    // A closed date range, not an open-ended `gte`.
    expect(
      client.calls.some((c) => c.table === "pos_checks" && c.method === "gte"),
    ).toBe(true);
    expect(
      client.calls.some((c) => c.table === "pos_checks" && c.method === "lte"),
    ).toBe(true);
  });

  it("distinguishes 'POS connected, nothing sold this window' from 'no POS'", async () => {
    // The probe finds history; the windowed query finds nothing in range.
    const { service } = makeGoals({
      pos_checks: (call) => (call === 0 ? [{ id: "c1" }] : []),
    });

    const result = await service.getPosRevenueWindow("r1", 7);

    expect(result.posConnected).toBe(true);
    // Connected and genuinely quiet: 0 is a true statement here, null is not.
    expect(result.revenue).toBe(0);
    expect(result.checkCount).toBe(0);
    expect(result.dailySeries).toEqual([]);
  });

  it("returns an inclusive from/to window matching the requested day count", async () => {
    const { service } = makeGoals({ pos_checks: [] });
    const result = await service.getPosRevenueWindow("r1", 7);
    const spanDays =
      (Date.parse(`${result.to}T00:00:00Z`) -
        Date.parse(`${result.from}T00:00:00Z`)) /
        86400000 +
      1;
    expect(spanDays).toBe(7);
    expect(result.days).toBe(7);
  });

  // ── F-086 / A-027: Tuzlu Rüzgar's days, on Tuzlu's clock ──────────────

  it("(a) files Tuzlu's opening day whole: 52 checks, $10,945 on Jul 1 — the dinners included", async () => {
    // Lunch closes 11:30–13:30 LA (18:30–20:30 UTC Jul 1); dinner closes
    // 17:00–23:45 LA, which is 00:00–06:45 UTC on Jul 2.
    const lunch = [
      ...checksClosing(8, "2026-07-01T18:30:00Z", 15, 181.5),
      ...checksClosing(1, "2026-07-01T20:30:00Z", 0, 184.5),
    ];
    const dinner = [
      ...checksClosing(42, "2026-07-02T00:00:00Z", 9, 216.5),
      ...checksClosing(1, "2026-07-02T06:45:00Z", 0, 215.5),
    ];
    const { service } = makeGoals({
      pos_checks: probeThen([...lunch, ...dinner]),
    });

    const result = await service.getPosRevenueWindow("r1", 100);

    expect(result.checkCount).toBe(52);
    expect(result.revenue).toBeCloseTo(10945, 2);
    // One day, not a lunch on Jul 1 and a dinner on Jul 2.
    expect(seriesOf(result)).toEqual({ "2026-07-01": 10945 });
  });

  it("(b) keeps the Wednesday Tuzlu was shut empty — Tuesday's dinner stays on Tuesday", async () => {
    // Jul 21 dinners closing 17:30–22:30 LA are 00:30–05:30 UTC on Jul 22.
    const tuesday = checksClosing(11, "2026-07-22T00:30:00Z", 30, 200);
    const { service } = makeGoals({ pos_checks: probeThen(tuesday) });

    const result = await service.getPosRevenueWindow("r1", 100);

    expect(seriesOf(result)).toEqual({ "2026-07-21": 2200 });
    expect(seriesOf(result)["2026-07-22"]).toBeUndefined();
  });

  it("(c) files the street-fair booth check on Aug 22, the day it was rung", async () => {
    const booth = {
      total: 4201.1,
      opened_at: "2026-08-22T17:00:00Z",
      closed_at: "2026-08-23T01:00:00Z",
      items: [],
    };
    const { service } = makeGoals({ pos_checks: probeThen([booth]) });

    const result = await service.getPosRevenueWindow("r1", 30);

    expect(seriesOf(result)).toEqual({ "2026-08-22": 4201.1 });
  });

  it("(c2) files a check that crosses the house's midnight on the day it closed, not the day it opened", async () => {
    // Opened 23:30 LA on Aug 20, closed 00:20 LA on Aug 21: the goals fold
    // hands `houseDayOf` the whole check, so the close decides the day.
    const late = {
      total: 180,
      opened_at: "2026-08-21T06:30:00Z",
      closed_at: "2026-08-21T07:20:00Z",
      items: [],
    };
    const { service } = makeGoals({ pos_checks: probeThen([late]) });

    const result = await service.getPosRevenueWindow("r1", 30);

    expect(seriesOf(result)).toEqual({ "2026-08-21": 180 });
  });

  it("(d) drops a check the lookback read whose house day precedes the window — so a day reads the same in every window", async () => {
    // 7 days ending Sep 1 open on Aug 26. This check closed 22:00 LA on Aug 25
    // (05:00 UTC Aug 26): the read lets it through, the fold must not count it.
    const before = {
      total: 999,
      opened_at: "2026-08-26T03:00:00Z",
      closed_at: "2026-08-26T05:00:00Z",
      items: [],
    };
    const inside = {
      total: 150,
      opened_at: "2026-08-26T18:00:00Z",
      closed_at: "2026-08-26T19:30:00Z",
      items: [],
    };
    const { service } = makeGoals({ pos_checks: probeThen([before, inside]) });

    const result = await service.getPosRevenueWindow("r1", 7);

    expect(result.from).toBe("2026-08-26");
    expect(result.revenue).toBe(150);
    expect(result.checkCount).toBe(1);
    expect(seriesOf(result)).toEqual({ "2026-08-26": 150 });

    // And the day before reads the same whether the window holds it at its
    // edge or deep inside.
    const wide = makeGoals({ pos_checks: probeThen([before, inside]) });
    const eight = await wide.service.getPosRevenueWindow("r1", 8);
    expect(seriesOf(eight)).toEqual({ "2026-08-25": 999, "2026-08-26": 150 });
  });

  it("(e) reads opens from 24 h before the first house midnight to the midnight that ends the last day", async () => {
    const { service, client } = makeGoals({ pos_checks: probeThen([]) });

    await service.getPosRevenueWindow("r1", 7);

    const bound = (method: string) =>
      client.calls.find(
        (c) =>
          c.table === "pos_checks" &&
          c.method === method &&
          c.args[0] === "opened_at",
      )?.args[1];
    // localMidnight(Aug 26, LA) = 07:00 UTC Aug 26; less 24 h.
    expect(bound("gte")).toBe("2026-08-25T07:00:00.000Z");
    // localMidnight(Sep 2, LA) = 07:00 UTC Sep 2; the last instant before it.
    expect(bound("lte")).toBe("2026-09-02T06:59:59.999Z");
  });

  it("(f) ends the window on the house's today, not the server's", async () => {
    // 03:00 UTC on Sep 2 is still Sep 1 in Los Angeles.
    const { service } = makeGoals({ pos_checks: probeThen([]) });

    const result = await service.getPosRevenueWindow("r1", 7);

    expect(result.to).toBe(LA_TODAY);
    expect(result.from).toBe("2026-08-26");
    expect(result.timezone).toBe(LA);
    expect(result.zoneUnset).toBe(false);
  });

  it("(g) states no figure for a house with no zone, and reads no window for it", async () => {
    const { service, client } = makeGoals({
      restaurants: [{ timezone: null, country: "US" }],
      pos_checks: probeThen(checksClosing(3, "2026-08-30T19:00:00Z", 30, 100)),
    });

    const result = await service.getPosRevenueWindow("r1", 30);

    expect(result).toMatchObject({
      posConnected: true,
      zoneUnset: true,
      timezone: null,
      from: null,
      to: null,
      revenue: null,
      checkCount: null,
      dailySeries: [],
    });
    // Only the connection probe ran: no UTC window was read as a stand-in.
    expect(
      client.calls.some((c) => c.table === "pos_checks" && c.method === "gte"),
    ).toBe(false);

    // A house with no zone and no POS still says "no POS" first.
    const none = makeGoals({
      restaurants: [{ timezone: null, country: "US" }],
      pos_checks: [],
    });
    const quiet = await none.service.getPosRevenueWindow("r1", 30);
    expect(quiet.posConnected).toBe(false);
    expect(quiet.revenue).toBeNull();
  });

  it("(h) rejects when the house cannot be read — never falls back to UTC", async () => {
    const { service } = makeGoals(
      { pos_checks: probeThen([]) },
      { restaurants: "statement timeout" },
    );
    await expect(service.getPosRevenueWindow("r1", 30)).rejects.toThrow(
      "The house's time zone could not be read: statement timeout",
    );
  });
});

describe("GoalsService goal progress on the house's days (j)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });
  afterEach(() => jest.useRealTimers());

  // Set at 21:30 LA on Aug 1 — 04:30 UTC on Aug 2.
  const goal = {
    id: "g1",
    restaurant_id: "r1",
    metric_key: "checks",
    target_value: 600,
    direction: "at_least",
    period: "custom",
    deadline: "2026-09-30",
    created_at: "2026-08-02T04:30:00Z",
  };

  it("opens the goal on the house date it was set, and paces it from that house midnight", async () => {
    const { service, client } = makeGoals({
      analytics_goals: [goal],
      pos_checks: [
        // 23:00 LA on Jul 31: read by the lookback, before the goal's day.
        {
          total: 50,
          opened_at: "2026-08-01T05:00:00Z",
          closed_at: "2026-08-01T06:00:00Z",
          items: [],
        },
        // 22:00 LA on Aug 1: the goal's first day.
        {
          total: 80,
          opened_at: "2026-08-02T04:00:00Z",
          closed_at: "2026-08-02T05:00:00Z",
          items: [],
        },
      ],
    });

    const progress: any = await service.getGoalProgress("r1", "g1");

    const since = client.calls.find(
      (c) =>
        c.table === "pos_checks" &&
        c.method === "gte" &&
        c.args[0] === "opened_at",
    )?.args[1];
    // localMidnight(Aug 1, LA) = 07:00 UTC Aug 1, less the 24 h lookback.
    expect(since).toBe("2026-07-31T07:00:00.000Z");
    expect(progress.current).toBe(1);
    // Aug 1 00:00 LA → Sep 30 00:00 LA is 60 days; 31 d 20 h of it have run.
    expect(progress.expectedByNow).toBeCloseTo((600 * (31 + 20 / 24)) / 60, 6);
    expect(progress.daysLeft).toBe(29);
  });

  it("scores no goal for a house with no zone, and says why", async () => {
    const { service } = makeGoals({
      restaurants: [{ timezone: null, country: "US" }],
      analytics_goals: [goal],
      pos_checks: [],
    });

    const list: any = await service.listGoalsWithProgress("r1");

    expect(list.goals).toHaveLength(1);
    expect(list.goals[0]).toMatchObject({
      unreadable: true,
      reason: HOUSE_ZONE_UNSET,
      zoneUnset: true,
    });
  });

  it("marks a goal that could not be read for another reason as not a zone matter", async () => {
    const { service } = makeGoals(
      { analytics_goals: [goal] },
      { pos_checks: "statement timeout" },
    );

    const list: any = await service.listGoalsWithProgress("r1");

    expect(list.goals[0].unreadable).toBe(true);
    expect(list.goals[0].reason).not.toBe(HOUSE_ZONE_UNSET);
    expect(list.goals[0].zoneUnset).toBe(false);
  });

  it("refuses to create a windowed goal for a house with no zone", async () => {
    const { service, client } = makeGoals({
      restaurants: [{ timezone: null, country: "US" }],
      pos_checks: [],
    });

    await expect(
      service.createGoal("r1", {
        name: "Covers",
        metricKey: "checks",
        targetValue: 500,
      }),
    ).rejects.toThrow(HOUSE_ZONE_UNSET);
    expect(client.calls.some((c) => c.table === "analytics_goals")).toBe(false);
  });

  // Days of stock is the one goal a house with no zone still scores: its
  // number is what is on the shelf now. Its pace is not known: the deadline is
  // a house date, and with no zone it has no midnight to count down to.
  const stock = {
    ...goal,
    id: "g-stock",
    metric_key: "days_of_inventory",
    target_value: 30,
    direction: "at_most",
  };
  const shelf = {
    getFinancialSummary: async () => ({ daysInventoryOutstanding: 42 }),
  };
  const NO_ZONE = { timezone: null, country: "US" };

  it("(k) scores a days-of-stock goal for a house with no zone, and says why its deadline has no pace", async () => {
    const { service } = makeGoals(
      { restaurants: [NO_ZONE], analytics_goals: [stock] },
      {},
      shelf,
    );

    const list: any = await service.listGoalsWithProgress("r1");
    expect(list.goals[0].unreadable).toBeUndefined();
    expect(list.goals[0]).toMatchObject({
      current: 42,
      onTrack: null,
      daysLeft: null,
      expectedByNow: null,
      projectedAtDeadline: null,
      paceUnread: HOUSE_ZONE_UNSET_PACE,
    });
    // The one-goal route says the same.
    const one: any = await service.getGoalProgress("r1", "g-stock");
    expect(one.paceUnread).toBe(HOUSE_ZONE_UNSET_PACE);
  });

  it("(k2) paces the same goal in a house with a zone, and sends no reason", async () => {
    const { service } = makeGoals({ analytics_goals: [stock] }, {}, shelf);

    const progress: any = await service.getGoalProgress("r1", "g-stock");

    expect(progress.paceUnread).toBeNull();
    // 42 days of stock against "at most 30", 31 d 20 h into a 60-day schedule.
    expect(progress.onTrack).toBe(false);
    expect(progress.daysLeft).toBe(29);
  });

  it("(k3) sends no reason for a goal with no deadline: no deadline is not an unread pace", async () => {
    const { service } = makeGoals(
      {
        restaurants: [NO_ZONE],
        analytics_goals: [{ ...stock, deadline: null }],
      },
      {},
      shelf,
    );

    const progress: any = await service.getGoalProgress("r1", "g-stock");

    expect([progress.onTrack, progress.paceUnread]).toEqual([null, null]);
  });
});

/**
 * The goal reads' fold, per metric (`computeMetricWithSeries`). Goal progress
 * hands back the sum, and no day key changes a sum, so these read the series
 * the fold builds, as `read-whole-window.spec.ts` does. In September Los
 * Angeles is seven hours behind UTC, so each early-evening-and-later row below
 * sits on a house day its UTC date does not name.
 */
describe("the goal reads file every row on the house's day (ADR 0296)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });
  afterEach(() => jest.useRealTimers());

  const foldOf = (
    service: GoalsService,
    metric: string,
    since: string,
    until?: string,
  ) =>
    (service as any).computeMetricWithSeries(
      "r1",
      metric,
      since,
      until,
      LA,
    ) as Promise<{
      current: number;
      dailySeries: number[];
      dailyDates: string[];
      rowCount: number;
    }>;

  it("files a bottle on the house day it was poured, not on its UTC date", async () => {
    const { service } = makeGoals({
      wine_consumption_log: [
        // 22:00 LA on Aug 30, which is 05:00 UTC on Aug 31.
        {
          id: "w1",
          consumption_type: "bottle",
          quantity: 2,
          volume_ml: null,
          created_at: "2026-08-31T05:00:00Z",
        },
        // 10:00 LA on Aug 31.
        {
          id: "w2",
          consumption_type: "bottle",
          quantity: 1,
          volume_ml: null,
          created_at: "2026-08-31T17:00:00Z",
        },
      ],
    });

    const out = await foldOf(service, "bottles_sold", "2026-08-30");

    expect(out.dailyDates).toEqual(["2026-08-30", "2026-08-31"]);
    expect(out.dailySeries).toEqual([2, 1]);
  });

  it("files a purchase on the house day it was delivered, not on its UTC date", async () => {
    const { service } = makeGoals({
      procurement_orders: [
        // Delivered 21:00 LA on Aug 30, which is 04:00 UTC on Aug 31.
        {
          total_cost: 400,
          final_price: null,
          delivered_at: "2026-08-31T04:00:00Z",
          created_at: "2026-08-28T16:00:00Z",
          status: "delivered",
        },
        // Delivered 09:00 LA on Aug 31.
        {
          total_cost: 150,
          final_price: null,
          delivered_at: "2026-08-31T16:00:00Z",
          created_at: "2026-08-29T16:00:00Z",
          status: "delivered",
        },
      ],
    });

    const out = await foldOf(service, "purchase_spend", "2026-08-30");

    expect(out.dailyDates).toEqual(["2026-08-30", "2026-08-31"]);
    expect(out.dailySeries).toEqual([400, 150]);
  });

  it("drops a check the read lets through when it closed after the window's last house day", async () => {
    const { service, client } = makeGoals({
      pos_checks: [
        // 13:00 LA on Aug 30.
        {
          id: "c1",
          total: 100,
          opened_at: "2026-08-30T19:00:00Z",
          closed_at: "2026-08-30T20:00:00Z",
        },
        // Opened 23:30 LA on Aug 30, closed 00:20 LA on Aug 31: Aug 31's sale.
        {
          id: "c2",
          total: 60,
          opened_at: "2026-08-31T06:30:00Z",
          closed_at: "2026-08-31T07:20:00Z",
        },
      ],
    });

    const out = await foldOf(
      service,
      "pos_revenue",
      "2026-08-29",
      "2026-08-30",
    );

    // The read bounds the OPEN by the last instant of Aug 30 in LA, so a real
    // read returns c2 too; only the fold keeps it out of the window.
    const until = client.calls.find(
      (c) =>
        c.table === "pos_checks" &&
        c.method === "lte" &&
        c.args[0] === "opened_at",
    )?.args[1];
    expect(until).toBe("2026-08-31T06:59:59.999Z");
    expect(out.dailyDates).toEqual(["2026-08-30"]);
    expect([out.current, out.rowCount]).toEqual([100, 1]);
  });
});

/**
 * The till and goals exports read the payloads above (ADR 0296). These cases
 * sit here, beside the payloads they read, rather than in
 * `report-export-cuttings.spec.ts`.
 */
describe("the till and goals exports on the house's day (ADR 0296)", () => {
  function exportFigure(doc: ExportDoc, label: string) {
    const f = doc.figures.find((x) => x.label === label);
    if (!f) throw new Error(`no figure "${label}"`);
    return f.value;
  }

  it("through the till: a house with no time zone says so and withholds every figure for that reason", () => {
    const doc = EXPORT_CUTTINGS.till.write(
      {
        posConnected: true,
        zoneUnset: true,
        timezone: null,
        revenue: null,
        checkCount: null,
        from: null,
        to: null,
        days: 30,
        dailySeries: [],
      },
      { days: 30 },
    );
    expect(doc.say).toBe(HOUSE_ZONE_UNSET);
    for (const label of ["Taken", "Checks", "Average check"])
      expect([label, exportFigure(doc, label)]).toEqual([
        label,
        { withheld: true, why: HOUSE_ZONE_UNSET },
      ]);
    expect(doc.tables).toEqual([]);
  });

  it("through the till: the basis names the house's zone the days were filed in", () => {
    const doc = EXPORT_CUTTINGS.till.write(
      {
        ...(PAYLOADS.till as Record<string, unknown>),
        timezone: "America/Los_Angeles",
        zoneUnset: false,
      },
      { days: 30 },
    );
    expect(doc.basis[0]).toContain(
      "filed on the house's day in America/Los_Angeles by when it closed, else when it opened",
    );
    // An older payload, with neither key, reads as it always did.
    expect(
      EXPORT_CUTTINGS.till.write(PAYLOADS.till, { days: 30 }).basis[0],
    ).not.toContain("house's day");
  });

  const stockRow = (over: Record<string, unknown> = {}) => ({
    goal: {
      id: "g-stock",
      name: "Days of stock",
      metric_key: "days_of_inventory",
      deadline: "2026-09-30",
    },
    metricLabel: "Days of stock",
    unit: "days",
    current: 42,
    target: 30,
    progressPct: 1.4,
    onTrack: null,
    paceUnread: HOUSE_ZONE_UNSET_PACE,
    ...over,
  });

  it("goals: a deadline whose pace was not judged is withheld with the gateway's reason, never as 'no deadline'", () => {
    const doc = EXPORT_CUTTINGS.goals.write(
      { goals: [stockRow()], total: 1 },
      { days: null },
    );
    const why = "no goal's pace was judged; each goal's row says why";
    expect(exportFigure(doc, "On pace")).toEqual({ withheld: true, why });
    expect(exportFigure(doc, "Behind")).toEqual({ withheld: true, why });
    // Column 5 is "On pace".
    expect(doc.tables[0].rows[0][5]).toEqual({
      withheld: true,
      why: HOUSE_ZONE_UNSET_PACE,
    });
  });

  it("goals: with no deadline on any goal, the sheet still says there is none", () => {
    const row = stockRow({
      goal: {
        id: "g-stock",
        name: "Days of stock",
        metric_key: "days_of_inventory",
        deadline: null,
      },
      paceUnread: null,
    });
    const doc = EXPORT_CUTTINGS.goals.write(
      { goals: [row], total: 1 },
      { days: null },
    );
    expect(exportFigure(doc, "On pace")).toEqual({
      withheld: true,
      why: "no goal carries a deadline, so none has a pace",
    });
    expect(doc.tables[0].rows[0][5]).toEqual({
      withheld: true,
      why: "no deadline, so no pace",
    });
  });
});

describe("AnalyticsService.getPosConsumptionBreakdown", () => {
  it("returns [] when nothing has been consumed", async () => {
    const { service } = makeAnalytics({ wine_consumption_log: [] });
    await expect(
      service.getPosConsumptionBreakdown("r1", "2026-08-01", "2026-08-26", LA),
    ).resolves.toEqual([]);
  });

  it("reads the same house days as the till beside it", async () => {
    const { service, client } = makeAnalytics({ wine_consumption_log: [] });
    await service.getPosConsumptionBreakdown(
      "r1",
      "2026-08-01",
      "2026-08-26",
      LA,
    );
    const bound = (method: string) =>
      client.calls.find(
        (c) => c.table === "wine_consumption_log" && c.method === method,
      )?.args;
    expect(bound("gte")).toEqual(["created_at", "2026-08-01T07:00:00.000Z"]);
    expect(bound("lt")).toEqual(["created_at", "2026-08-27T07:00:00.000Z"]);
  });

  it("groups bottle and glass sales per wine with summed real revenue and volume", async () => {
    const { service } = makeAnalytics({
      wine_consumption_log: [
        {
          inventory_id: "inv-1",
          wine_name: "Malbec",
          consumption_type: "bottle",
          quantity: 2,
          volume_ml: 1500,
          total_revenue: 90,
          restaurant_inventory: {
            wine_name: "Malbec",
            last_purchase_price: 12,
          },
        },
        {
          inventory_id: "inv-1",
          wine_name: "Malbec",
          consumption_type: "glass",
          quantity: 4,
          volume_ml: 600,
          total_revenue: 48,
          restaurant_inventory: {
            wine_name: "Malbec",
            last_purchase_price: 12,
          },
        },
        {
          inventory_id: "inv-2",
          wine_name: "Riesling",
          consumption_type: "bottle",
          quantity: 1,
          volume_ml: 750,
          // Revenue unknown for this line — must NOT be silently counted as $0.
          total_revenue: null,
          restaurant_inventory: {
            wine_name: "Riesling",
            last_purchase_price: null,
          },
        },
      ],
    });

    const rows = await service.getPosConsumptionBreakdown(
      "r1",
      "2026-08-01",
      "2026-08-26",
      LA,
    );

    const malbec = rows.find((r) => r.wineName === "Malbec")!;
    expect(malbec.bottlesSold).toBe(2);
    expect(malbec.bottleRevenue).toBeCloseTo(90);
    expect(malbec.bottleVolumeMl).toBe(1500);
    expect(malbec.avgBottleMl).toBe(750);
    expect(malbec.glassesSold).toBe(4);
    expect(malbec.glassRevenue).toBeCloseTo(48);
    expect(malbec.avgPourMl).toBe(150);
    expect(malbec.costPerBottle).toBe(12);
    expect(malbec.bottleRevenueComplete).toBe(true);

    const riesling = rows.find((r) => r.wineName === "Riesling")!;
    // No priced line at all → null, not 0.
    expect(riesling.bottleRevenue).toBeNull();
    expect(riesling.bottleRevenueComplete).toBe(false);
    // No cost on the inventory row → margin cannot be computed honestly.
    expect(riesling.costPerBottle).toBeNull();
  });
});

describe("GET /analytics/pos-revenue/:restaurantId", () => {
  let controller: AnalyticsController;
  const goals = { getPosRevenueWindow: jest.fn() };
  const analytics = { getPosConsumptionBreakdown: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: AdvancedAnalyticsService, useValue: {} },
        { provide: RecommendationsService, useValue: {} },
        { provide: RecommendationActionsService, useValue: {} },
        { provide: TableAnalyticsService, useValue: {} },
        { provide: GoalsService, useValue: goals },
        // ADR 0120 Q4: the controller now also carries the scenario-request
        // store and one platform-admin route. Nothing in this file calls
        // either; they are provided so the module compiles — and ConfigService
        // with them, because `ServiceKeyGuard` injects it and Nest builds every
        // route guard when the module is created, not when a route is hit.
        { provide: GoalScenarioRequestsService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: ConsultantsService, useValue: {} },
        { provide: InsightGeneratorService, useValue: {} },
        { provide: InsightSchedulerService, useValue: {} },
        // The controller now also exposes the day-exclusion store (the
        // engine's "do not count this day" hook). Nothing in this file calls
        // it; it is provided so the module compiles.
        { provide: DayExclusionsService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AnalyticsController);
    jest.clearAllMocks();
  });

  it("sits behind the class-level JwtAuthGuard and is not @Public()", () => {
    const guards = Reflect.getMetadata("__guards__", AnalyticsController) || [];
    expect(guards).toContain(JwtAuthGuard);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        (AnalyticsController.prototype as any).getPosRevenue,
      ),
    ).toBeFalsy();
  });

  it("skips the consumption query entirely when no POS is connected", async () => {
    goals.getPosRevenueWindow.mockResolvedValue({
      from: "2026-07-28",
      to: "2026-08-26",
      days: 30,
      timezone: LA,
      zoneUnset: false,
      posConnected: false,
      revenue: null,
      checkCount: null,
      dailySeries: [],
    });

    const body = await controller.getPosRevenue("r1", "30");

    expect(body.posConnected).toBe(false);
    expect(body.revenue).toBeNull();
    expect(body.consumption).toEqual([]);
    expect(analytics.getPosConsumptionBreakdown).not.toHaveBeenCalled();
  });

  it("attaches the per-wine consumption breakdown once POS data exists", async () => {
    goals.getPosRevenueWindow.mockResolvedValue({
      from: "2026-07-28",
      to: "2026-08-26",
      days: 30,
      timezone: LA,
      zoneUnset: false,
      posConnected: true,
      revenue: 4200,
      checkCount: 61,
      dailySeries: [{ date: "2026-08-26", revenue: 4200 }],
    });
    analytics.getPosConsumptionBreakdown.mockResolvedValue([
      { wineName: "Malbec", bottlesSold: 2 },
    ]);

    const body = await controller.getPosRevenue("r1", undefined);

    expect(body.revenue).toBe(4200);
    expect(body.consumption).toHaveLength(1);
    expect(analytics.getPosConsumptionBreakdown).toHaveBeenCalledWith(
      "r1",
      "2026-07-28",
      "2026-08-26",
      LA,
    );
  });

  it("(i) skips the consumption query for a house with no zone, and answers null — not an empty cellar", async () => {
    goals.getPosRevenueWindow.mockResolvedValue({
      from: null,
      to: null,
      days: 30,
      timezone: null,
      zoneUnset: true,
      posConnected: true,
      revenue: null,
      checkCount: null,
      dailySeries: [],
    });

    const body = await controller.getPosRevenue("r1", "30");

    expect(body.zoneUnset).toBe(true);
    expect(body.consumption).toBeNull();
    expect(analytics.getPosConsumptionBreakdown).not.toHaveBeenCalled();
  });

  it("clamps an absurd or unparseable `days` to a sane window", async () => {
    goals.getPosRevenueWindow.mockResolvedValue({
      from: "a",
      to: "b",
      days: 30,
      posConnected: false,
      revenue: null,
      checkCount: null,
      dailySeries: [],
    });

    await controller.getPosRevenue("r1", "99999");
    expect(goals.getPosRevenueWindow).toHaveBeenLastCalledWith("r1", 365);

    await controller.getPosRevenue("r1", "banana");
    expect(goals.getPosRevenueWindow).toHaveBeenLastCalledWith("r1", 30);

    // A parseable-but-tiny window clamps to the floor rather than snapping back
    // to the default — `?days=0` asking for today is a coherent request.
    await controller.getPosRevenue("r1", "0");
    expect(goals.getPosRevenueWindow).toHaveBeenLastCalledWith("r1", 1);
  });
});

/**
 * The scenario verifier's POS-revenue check, over the real GoalsService (ADR
 * 0296). It calls the same `getPosRevenueWindow` the route above serves, so
 * its pass is a statement about the house's day. These cases sit here, beside
 * the window they read, rather than in `scenario-verify.service.spec.ts`, so
 * the PR stays within its 15 files.
 */
describe("ScenarioVerifyService — pos revenue on the house's day (ADR 0296)", () => {
  // 03:00 UTC on 2 September 2026: still 20:00 on 1 September in Los Angeles.
  // Only the clock is fixed; the verifier's timers keep running.
  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "queueMicrotask",
        "setImmediate",
        "clearImmediate",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
      ],
    });
    jest.setSystemTime(new Date(NOW));
  });
  afterEach(() => jest.useRealTimers());

  /**
   * A sim run on `serviceDate` in `zone` whose checks (each 125) close at
   * `closes`, verified against `house`. One stub serves both the verifier's
   * reads and the real GoalsService's.
   */
  function runOn(
    serviceDate: string,
    zone: string,
    closes: string[],
    house: { timezone: string | null; country: string },
  ) {
    const checks = closes.map((closed_at, i) => ({
      external_check_id: `chk-${i + 1}`,
      table_id: "t-12",
      server_name: "Ana",
      opened_at: new Date(Date.parse(closed_at) - 3_600_000).toISOString(),
      closed_at,
      covers: 2,
      subtotal: 120,
      total: 125,
      tip: 0,
      voided: false,
      items: [],
    }));
    const expected = {
      contract_version: 1,
      source: "generic_webhook",
      service_date: serviceDate,
      timezone: zone,
      checks: checks.map((c) => ({ ...c, posted: true, lines: [] })),
      totals: {
        checks: checks.length,
        posted_checks: checks.length,
        wine_lines: 0,
        food_lines: 0,
        revenue: 125 * checks.length,
      },
    };
    const run = {
      id: "run-1",
      restaurant_id: "r-sim",
      archetype_id: "bistro",
      scenario: "random",
      seed: 7,
      service_date: serviceDate,
      timezone: zone,
      operating_hours: null,
      params: {},
      expected,
      posted_at: closes[closes.length - 1],
      created_at: closes[closes.length - 1],
    };
    const { service: goals, client } = makeGoals({
      restaurants: [house],
      sim_scenario_runs: [run],
      pos_checks: checks,
    });
    const db = { getClient: () => client } as unknown as DatabaseService;
    const service = new ScenarioVerifyService(
      db,
      { assertSimRestaurant: async () => undefined } as any,
      goals,
      {
        getTablePerformance: async () => ({
          sinceDays: 1,
          tables: [],
          correlations: [],
          drivers: {},
          dataStatus: "live",
        }),
      } as any,
      { generate: async () => ({}) } as any,
      { triggerEdgeSweep: async () => undefined } as any,
    );
    return { service, goals };
  }

  const posRevenueRow = async (service: ScenarioVerifyService) =>
    (await service.verify("r-sim", "run-1")).checks.find(
      (c: any) => c.id === "analytics.pos_revenue",
    ) as any;

  it("passes a Los Angeles service day whose dinners close after 17:00 there", async () => {
    // 16:00 and 20:00 LA on Aug 30 are 23:00 UTC Aug 30 and 03:00 UTC Aug 31.
    const { service } = runOn(
      "2026-08-30",
      LA,
      ["2026-08-30T23:00:00.000Z", "2026-08-31T03:00:00.000Z"],
      LA_HOUSE,
    );
    const row = await posRevenueRow(service);
    expect([row.status, row.actual]).toEqual(["pass", 250]);
  });

  it("is unverifiable, with the reason, for a house with no zone", async () => {
    const { service } = runOn("2026-08-30", LA, ["2026-08-30T23:00:00.000Z"], {
      timezone: null,
      country: "US",
    });
    const row = await posRevenueRow(service);
    expect(row.status).toBe("unverifiable");
    expect(row.detail).toContain(HOUSE_ZONE_UNSET);
  });

  it("still covers service_date when the house is a day ahead of UTC (Istanbul at 23:30 UTC)", async () => {
    jest.setSystemTime(new Date("2026-09-01T23:30:00.000Z")); // 02:30 Sep 2 in Istanbul
    const IST = "Europe/Istanbul";
    // 20:00 Istanbul on Sep 1 — the run's day, which UTC also calls Sep 1.
    const { service, goals } = runOn(
      "2026-09-01",
      IST,
      ["2026-09-01T17:00:00.000Z"],
      { timezone: IST, country: "TR" },
    );
    const spy = jest.spyOn(goals, "getPosRevenueWindow");
    const row = await posRevenueRow(service);
    // One day back by UTC; one more for the house's clock, so Sep 1 is in.
    expect(spy).toHaveBeenCalledWith("r-sim", 2);
    expect([row.status, row.actual]).toEqual(["pass", 125]);
  });
});
