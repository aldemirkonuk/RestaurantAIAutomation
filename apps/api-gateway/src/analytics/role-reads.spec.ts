/**
 * Which money lenses each house role reads, and the overview that composes
 * two of them (ADR 0348 decision 3). Pure: ROLE_POLICY is the input.
 */
import { policyFor } from "../ask-readings/reading-data-classes";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { lensHidden, seesFor } from "./role-reads";

const STAFF = policyFor("staff").sees;
const OWNER = policyFor("owner").sees;

describe("lensHidden", () => {
  it("withholds every money lens from staff, and none from a manager", () => {
    expect(lensHidden("menuEngineering", STAFF)).toEqual(["money", "sales"]);
    expect(lensHidden("cashflow", STAFF)).toEqual(["money", "suppliers"]);
    expect(lensHidden("vendorScorecard", STAFF)).toEqual(["money", "suppliers"]);
    expect(lensHidden("wine360", STAFF)).toEqual(["money", "sales"]);
    const manager = seesFor({ role: "manager" });
    for (const lens of ["menuEngineering", "cashflow", "vendorScorecard", "wine360"] as const)
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
      { getStored: async () => [{ candidate_key: "wine.stockout_risk.peer_rank" }] } as never,
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
  });

  it("reads every lens for an owner, and for an internal caller that names no role", async () => {
    for (const sees of [OWNER, undefined]) {
      const { svc } = make();
      const o = await svc.getOverview("h", { withSales: true }, sees);
      expect(o.menuEngineering).toEqual({ counts: { star: 1 }, top: [{ name: "Rakı" }] });
      expect(o.cashflow).toEqual({ spendLast30d: 9330 });
    }
  });
});
