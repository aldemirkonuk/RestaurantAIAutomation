/**
 * F-794 — the overview carries the house's active goals (baseline, current,
 * target). The goal routes refuse those figures to any role but owner and
 * manager (F-299, `assertMayReadGoals`); the overview must not hand them over
 * by another door. For any other role the key is left out of the payload, and
 * the rest of the overview still answers.
 */
import { AnalyticsController } from "./analytics.controller";

const OVERVIEW = {
  financial: { revenue: 1 },
  cashflow: { spendLast30d: 0 },
  insights: [],
  activeGoals: [
    {
      name: "Food cost",
      baseline_value: 34,
      current_value: 31,
      target_value: 28,
    },
  ],
};

function controller() {
  const advanced = {
    getOverview: jest.fn().mockResolvedValue({ ...OVERVIEW }),
  };
  const c = new (AnalyticsController as any)(
    {},
    advanced,
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
  ) as AnalyticsController;
  return { c, advanced };
}

describe("GET /analytics/overview — goals only for owners and managers (F-794)", () => {
  it.each(["owner", "manager", "Owner "])(
    "%s gets the active goals",
    async (role) => {
      const { c } = controller();
      const out: any = await c.getOverview("r1", { role });
      expect(out.activeGoals).toEqual(OVERVIEW.activeGoals);
    },
  );

  it.each(["staff", "chef", "admin", null, undefined])(
    "%s gets the overview without the goals key",
    async (role) => {
      const { c, advanced } = controller();
      const out: any = await c.getOverview("r1", { role });
      expect(advanced.getOverview).toHaveBeenCalledWith("r1");
      expect("activeGoals" in out).toBe(false);
      // The rest still answers — shaped for the role (F-203 strips the
      // money a staff reader may not see), never dropped.
      expect(out.financial).toBeDefined();
      expect(out.cashflow).toBeDefined();
    },
  );

  it("a request with no user at all gets no goals", async () => {
    const { c } = controller();
    const out: any = await c.getOverview("r1");
    expect("activeGoals" in out).toBe(false);
  });
});
