import { Test, TestingModule } from "@nestjs/testing";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { RecommendationsService } from "./recommendations.service";
import { RecommendationActionsService } from "./recommendation-actions.service";
import { TableAnalyticsService } from "./table-analytics.service";
import { GoalsService } from "./goals.service";
import { ConsultantsService } from "./consultants.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { InsightSchedulerService } from "./insights/insight-scheduler.service";
import { DatabaseService } from "../database/database.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";

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
 * the stub does not itself honour `.gte`/`.lte`.
 */
type Rows = Record<string, any[] | ((callIndex: number) => any[])>;

/**
 * Chainable Supabase stub. Every builder method records its arguments and
 * returns itself; awaiting the builder resolves the rows registered for the
 * table named in `.from()`. `calls` lets a test assert the FILTERS that were
 * applied — `voided = false` is the difference between revenue and a number
 * that includes cancelled checks.
 */
function makeClient(rowsByTable: Rows) {
  const calls: Array<{ table: string; method: string; args: any[] }> = [];
  const passthrough = [
    "select",
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
      const builder: any = {};
      for (const method of passthrough) {
        builder[method] = jest.fn((...args: any[]) => {
          calls.push({ table, method, args });
          return builder;
        });
      }
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return builder;
    }),
  };
  return client;
}

function makeGoals(rowsByTable: Rows) {
  const client = makeClient(rowsByTable);
  const db = { getClient: () => client } as unknown as DatabaseService;
  const service = new GoalsService(db, {} as InsightGeneratorService);
  return { service, client };
}

function makeAnalytics(rowsByTable: Rows) {
  const client = makeClient(rowsByTable);
  const db = { getClient: () => client } as unknown as DatabaseService;
  return { service: new AnalyticsService(db), client };
}

const today = () => new Date().toISOString().substring(0, 10);

describe("GoalsService.getPosRevenueWindow", () => {
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
    const day = `${today()}T12:00:00Z`;
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
    expect(result.dailySeries).toEqual([{ date: today(), revenue: 200 }]);

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
});

describe("AnalyticsService.getPosConsumptionBreakdown", () => {
  it("returns [] when nothing has been consumed", async () => {
    const { service } = makeAnalytics({ wine_consumption_log: [] });
    await expect(
      service.getPosConsumptionBreakdown("r1", "2026-08-01", "2026-08-26"),
    ).resolves.toEqual([]);
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
        { provide: ConsultantsService, useValue: {} },
        { provide: InsightGeneratorService, useValue: {} },
        { provide: InsightSchedulerService, useValue: {} },
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
    );
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
