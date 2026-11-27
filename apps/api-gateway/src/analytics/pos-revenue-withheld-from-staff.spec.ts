/**
 * GET pos-revenue/:restaurantId is the till: revenue, check count and a day
 * by day series, and with `compare=prior` a second window of the same. ADR 0348
 * withholds money from staff and the route carried no role gate, so a staff
 * login read 71,120 and the web's compare added the prior window to the leak
 * (WALK-reports-r105, Staff P0). The route stays open; the figures are
 * withheld and named withheld (ADR 0298 decision 9, the `salesGateFor` rule).
 *
 * Tests marked [REVERT-FAILS] fail against the controller without the gate.
 */
import "reflect-metadata";
import { AnalyticsController } from "./analytics.controller";

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WINDOW = {
  restaurantId: HOUSE,
  from: "2026-10-26",
  to: "2026-11-24",
  days: 30,
  timezone: "America/Detroit",
  zoneUnset: false,
  posConnected: true,
  revenue: 71120,
  checkCount: 410,
  dailySeries: [{ date: "2026-11-24", revenue: 2400 }],
  prior: { from: "2026-09-26", to: "2026-10-25", revenue: 72880, checkCount: 400, dailySeries: [] },
};

function controller() {
  const goalsService = { getPosRevenueWindow: jest.fn().mockResolvedValue(WINDOW) };
  const analyticsService = {
    getPosConsumptionBreakdown: jest.fn().mockResolvedValue([{ wine: "x", bottles: 3 }]),
  };
  const c = Object.create(AnalyticsController.prototype) as AnalyticsController;
  Object.assign(c, { goalsService, analyticsService });
  return { c, goalsService, analyticsService };
}

describe("pos-revenue money is withheld from staff", () => {
  it.each([["staff"], [undefined], [null], ["waiter"]])(
    "[REVERT-FAILS] role %p gets withheld figures and no read of the till",
    async (role) => {
      const { c, goalsService, analyticsService } = controller();
      const out: any = await c.getPosRevenue(HOUSE, "60", "prior", { role } as never);
      expect(out.salesWithheld).toBe(true);
      expect(out.revenue).toBeNull();
      expect(out.checkCount).toBeNull();
      expect(out.dailySeries).toBeNull();
      expect(out.consumption).toBeNull();
      expect(out.prior).toBeUndefined();
      expect(out.days).toBe(60);
      expect(JSON.stringify(out)).not.toMatch(/71120|72880|2400/);
      expect(goalsService.getPosRevenueWindow).not.toHaveBeenCalled();
      expect(analyticsService.getPosConsumptionBreakdown).not.toHaveBeenCalled();
    },
  );

  it.each([["owner"], ["manager"]])("%s still reads the till and its prior window", async (role) => {
    const { c, goalsService } = controller();
    const out: any = await c.getPosRevenue(HOUSE, "30", "prior", { role } as never);
    expect(out.revenue).toBe(71120);
    expect(out.prior.revenue).toBe(72880);
    expect(out.salesWithheld).toBeUndefined();
    expect(goalsService.getPosRevenueWindow).toHaveBeenCalledWith(HOUSE, 30, "prior");
  });
});
