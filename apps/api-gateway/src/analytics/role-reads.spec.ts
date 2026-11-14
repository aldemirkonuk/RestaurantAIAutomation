/**
 * Which money lenses and insight types each house role reads, and the
 * overview that composes them (ADR 0348 decision 3). Pure: ROLE_POLICY and
 * the insight catalogue are the inputs.
 */
import { policyFor } from "../ask-readings/reading-data-classes";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { IMPLEMENTED_INSIGHT_TYPES } from "./insights/insight-implementations";
import {
  insightClasses,
  insightReadable,
  insightsForRole,
  lensHidden,
  reorderCostReadable,
  riskForRole,
  seesFor,
} from "./role-reads";

const STAFF = policyFor("staff").sees;
const OWNER = policyFor("owner").sees;

describe("lensHidden", () => {
  it("withholds every money lens from staff, and none from a manager", () => {
    expect(lensHidden("menuEngineering", STAFF)).toEqual(["money", "sales"]);
    expect(lensHidden("cashflow", STAFF)).toEqual(["money", "suppliers"]);
    expect(lensHidden("vendorScorecard", STAFF)).toEqual(["money", "suppliers"]);
    expect(lensHidden("wine360", STAFF)).toEqual(["money", "sales"]);
    expect(lensHidden("financial", STAFF)).toEqual(["money", "sales", "suppliers"]);
    const manager = seesFor({ role: "manager" });
    for (const lens of ["menuEngineering", "cashflow", "vendorScorecard", "wine360", "financial"] as const)
      expect(lensHidden(lens, manager)).toEqual([]);
  });
  it("reads no role, or an unknown one, as staff", () => {
    expect(seesFor(undefined)).toEqual(STAFF);
    expect(seesFor({ role: "sommelier" })).toEqual(STAFF);
  });
});

describe("the overview as a role reads it", () => {
  const make = () => {
    const svc = new AdvancedAnalyticsService(
      {} as never,
      {
        getFinancialSummary: async () => ({ ok: true }),
        getRiskProfile: async () => ({ ok: true }),
        getInventoryScience: async () => ({ reorderCount: 0, reorderList: [], skuCount: 1 }),
      } as never,
      {
        getStored: async () => [
          { candidate_key: "waiter.avg_check.peer_rank", sentence: "ranked" },
          { candidate_key: "wine.stockout_risk.peer_rank", sentence: "runs out" },
        ],
      } as never,
      { listGoals: async () => [] } as never,
    );
    const spies = {
      menu: jest
        .spyOn(svc, "getMenuEngineering")
        .mockResolvedValue({ counts: { star: 1 }, items: [{ name: "Rakı" }] } as never),
      cash: jest.spyOn(svc, "getCashflow").mockResolvedValue({ spendLast30d: 9330 } as never),
    };
    jest.spyOn(svc, "getSeasonality").mockResolvedValue({ weekday: [] } as never);
    return { svc, spies };
  };

  it("[REVERT-FAILS] does not read menu engineering or cashflow for staff, and says each is withheld", async () => {
    const { svc, spies } = make();
    const o = await svc.getOverview("h", { withSales: false }, STAFF);
    expect(spies.menu).not.toHaveBeenCalled();
    expect(spies.cash).not.toHaveBeenCalled();
    expect(o.menuEngineering).toEqual({ withheldForRole: ["money", "sales"] });
    expect(o.cashflow).toEqual({ withheldForRole: ["money", "suppliers"] });
    expect(o.seasonality).toEqual({ weekday: [] });
    expect(o.insights.map((r: { sentence: string }) => r.sentence)).toEqual(["runs out"]);
  });

  it("reads every lens for an owner, and for an internal caller that names no role", async () => {
    for (const sees of [OWNER, undefined]) {
      const { svc } = make();
      const o = await svc.getOverview("h", { withSales: true }, sees);
      expect(o.menuEngineering).toEqual({ counts: { star: 1 }, top: [{ name: "Rakı" }] });
      expect(o.cashflow).toEqual({ spendLast30d: 9330 });
      expect(o.insights).toHaveLength(2);
    }
  });
});

describe("insightClasses", () => {
  it("names the till, money and a person for the server ranking", () => {
    expect(insightClasses("waiter.avg_check.peer_rank")?.sort()).toEqual(["money", "people", "sales"]);
  });
  it("names suppliers and money for the house's spend", () => {
    expect(insightClasses("overall.purchase_spend.trend_direction")?.sort()).toEqual(["money", "suppliers"]);
  });
  it("names stock only for a stockout risk, and no class for a volume", () => {
    expect(insightClasses("wine.stockout_risk.peer_rank")).toEqual(["stock"]);
    expect(insightClasses("overall.bottles.vs_prev_period_7d")).toEqual([]);
  });
  it("is null for a key outside the catalogue", () => {
    expect(insightClasses("nope.nope.nope")).toBeNull();
  });
});

describe("what staff read of the implemented feed", () => {
  it("is the stock and volume types: none names money, the till, a vendor or a person", () => {
    expect(IMPLEMENTED_INSIGHT_TYPES.filter((k) => insightReadable(k, STAFF))).toEqual([
      "overall.bottles.anomaly_day",
      "overall.bottles.forecast_gap",
      "overall.bottles.trend_direction",
      "overall.bottles.vs_prev_period_7d",
      "overall.bottles.vs_same_weekday",
      "wine.bottles.vs_prev_period_7d",
      "wine.consumption_qty.concentration",
      "wine.stockout_risk.peer_rank",
    ]);
  });
  it("an owner reads every implemented type and a key outside the catalogue; staff do not read that key", () => {
    for (const k of IMPLEMENTED_INSIGHT_TYPES) expect(insightReadable(k, OWNER)).toBe(true);
    expect(insightReadable("nope.nope.nope", OWNER)).toBe(true);
    expect(insightReadable("nope.nope.nope", STAFF)).toBe(false);
  });
});

describe("insightsForRole", () => {
  it("reads a stored row's candidate_key and a live row's candidateKey, and counts what it withholds", () => {
    const rows = [
      { candidate_key: "waiter.avg_check.peer_rank" },
      { candidateKey: "wine.stockout_risk.peer_rank" },
      { candidateKey: "overall.revenue.anomaly_day" },
      {},
    ];
    expect(insightsForRole(rows, STAFF)).toEqual({
      kept: [{ candidateKey: "wine.stockout_risk.peer_rank" }],
      withheldForRole: 3,
    });
    expect(insightsForRole(rows, OWNER).withheldForRole).toBe(0);
  });
});

const PROFILE = {
  basis: { demand: "bottles/day" },
  vendorConcentration: { hhi: 0.41, cr4: 1, vendorCount: 3 },
  revenueConcentration: { gini: 0.7, hhi: 0.3 },
  demandRisk: { volatility: 0.2, sampleDays: 90 },
  generatedAt: "2026-11-13T10:00:00.000Z",
};

describe("riskForRole (slice 4)", () => {
  it("[REVERT-FAILS] withholds the spend and value shares from staff, and keeps demand risk", () => {
    expect(riskForRole(PROFILE, STAFF)).toEqual({
      ...PROFILE,
      vendorConcentration: { withheldForRole: ["money", "suppliers"] },
      revenueConcentration: { withheldForRole: ["money"] },
    });
  });
  it("never says the whole lens is withheld, so the page still reads demand risk", () => {
    expect((riskForRole(PROFILE, STAFF) as Record<string, unknown>).withheldForRole).toBeUndefined();
  });
  it("hands an owner the profile unchanged, and does not add a part the lens lacks", () => {
    expect(riskForRole(PROFILE, OWNER)).toEqual(PROFILE);
    expect(riskForRole({ demandRisk: {} }, STAFF)).toEqual({ demandRisk: {} });
  });
});

describe("reorderCostReadable (slice 4)", () => {
  it("is money: staff restock without the cost, an owner and a manager read it", () => {
    expect(reorderCostReadable(STAFF)).toBe(false);
    expect(reorderCostReadable(OWNER)).toBe(true);
    expect(reorderCostReadable(seesFor({ role: "manager" }))).toBe(true);
  });
});

describe("the overview's figures of record, risk and reorder rows as a role reads them (slice 4)", () => {
  const make = () => {
    const analytics = {
      getFinancialSummary: jest.fn(async () => ({ inventoryValue: 41000 })),
      getRiskProfile: jest.fn(async () => PROFILE),
      getInventoryScience: jest.fn(async () => ({ reorderCount: 0, reorderList: [], skuCount: 1 })),
    };
    const svc = new AdvancedAnalyticsService(
      {} as never,
      analytics as never,
      { getStored: async () => [] } as never,
      { listGoals: async () => [] } as never,
    );
    jest.spyOn(svc, "getMenuEngineering").mockResolvedValue({ counts: {}, items: [] } as never);
    jest.spyOn(svc, "getCashflow").mockResolvedValue({} as never);
    jest.spyOn(svc, "getSeasonality").mockResolvedValue({} as never);
    return { svc, analytics };
  };

  it("[REVERT-FAILS] staff: the figures of record are not read, risk keeps demand only, reorder rows carry no cost", async () => {
    const { svc, analytics } = make();
    const o = await svc.getOverview("h", { withSales: false }, STAFF);
    expect(analytics.getFinancialSummary).not.toHaveBeenCalled();
    expect(o.financial).toEqual({ withheldForRole: ["money", "sales", "suppliers"] });
    expect(o.risk.vendorConcentration).toEqual({ withheldForRole: ["money", "suppliers"] });
    expect(o.risk.revenueConcentration).toEqual({ withheldForRole: ["money"] });
    expect(o.risk.demandRisk).toEqual(PROFILE.demandRisk);
    expect(analytics.getInventoryScience).toHaveBeenCalledWith("h", { withCost: false });
  });

  it("an owner, and an internal caller naming no role, read all three whole", async () => {
    for (const sees of [OWNER, undefined]) {
      const { svc, analytics } = make();
      const o = await svc.getOverview("h", { withSales: true }, sees);
      expect(o.financial).toEqual({ inventoryValue: 41000 });
      expect(o.risk).toEqual(PROFILE);
      expect(analytics.getInventoryScience).toHaveBeenCalledWith("h", { withCost: true });
    }
  });
});
