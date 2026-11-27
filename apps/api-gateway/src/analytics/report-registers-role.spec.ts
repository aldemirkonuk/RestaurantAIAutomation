/**
 * Staff read no supplier, cost or purchasing-goal money on /reports (ADR 0348;
 * r107 walk finding 3). Figures of record (`financial`), spend pacing and
 * "Against ourselves" (`cashflow`) and a purchase-spend goal carried the whole
 * figure to any staff login. The routes stay open; a withheld register says
 * so and carries no figure. An owner and a manager read what they read.
 *
 * Tests marked [REVERT-FAILS] fail against the controller without the gate.
 */
import "reflect-metadata";

jest.mock("../common/house-day", () => ({
  ...jest.requireActual("../common/house-day"),
  readHouseZone: jest.fn().mockResolvedValue({ timezone: "UTC", zoneUnset: false }),
}));
import { AnalyticsController } from "./analytics.controller";
import { GoalsService } from "./goals.service";
import {
  goalMetricReadable,
  registerReadable,
  readerSees,
} from "./report-registers-role";

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIN = { inventoryValue: 41200, cogs: 18800, grossMargin: 0.62 };
const CASH = { spendLast30d: 9100, committedOpenOrders: 3300 };
const MENU = { items: [{ id: "w1", marginPerBottle: 31.77 }], medians: { marginPerBottle: 28.5 }, counts: {} };
const GOALS = [
  { id: "g1", name: "Spend under 8,000", metric_key: "purchase_spend", target_value: 8000 },
  { id: "g2", name: "Keep 20 days of stock", metric_key: "days_of_inventory", target_value: 20 },
  { id: "g3", name: "Mystery", metric_key: "something_new", target_value: 1 },
];

function controller() {
  const analyticsService = { getFinancialSummary: jest.fn().mockResolvedValue(FIN) };
  const advanced = {
    getCashflow: jest.fn().mockResolvedValue(CASH),
    getMenuEngineering: jest.fn().mockResolvedValue(MENU),
    getOverview: jest.fn().mockResolvedValue({ financial: FIN, cashflow: CASH, menuEngineering: { counts: {}, top: MENU.items }, insights: [], activeGoals: [] }),
  };
  const c = Object.create(AnalyticsController.prototype) as AnalyticsController;
  Object.assign(c, { analyticsService, advanced });
  return { c, analyticsService, advanced };
}

function goalsService(rows = GOALS) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    single: () => Promise.resolve({ data: rows[0], error: null }),
    then: (ok: (v: unknown) => unknown) => ok({ data: rows, error: null }),
  };
  const db = { getClient: () => ({ from: () => chain }) };
  const s = new (GoalsService as any)(db, {}) as GoalsService;
  return s;
}

describe("report registers: role rule", () => {
  it("staff, an absent role and an unknown role read no money register", () => {
    for (const role of ["staff", undefined, null, "waiter", "admin?"]) {
      expect(registerReadable("financial", readerSees({ role }))).toBe(false);
      expect(registerReadable("cashflow", readerSees({ role }))).toBe(false);
    }
    for (const role of ["owner", "manager"]) {
      expect(registerReadable("financial", readerSees({ role }))).toBe(true);
      expect(registerReadable("cashflow", readerSees({ role }))).toBe(true);
    }
  });

  it("[REVERT-FAILS] a register or metric key the table does not know fails closed for staff", () => {
    const staff = readerSees({ role: "staff" });
    const manager = readerSees({ role: "manager" });
    expect(registerReadable("a_new_register", staff)).toBe(false);
    expect(registerReadable("a_new_register", manager)).toBe(true);
    expect(goalMetricReadable("a_new_metric", staff)).toBe(false);
    expect(goalMetricReadable(undefined, staff)).toBe(false);
    expect(goalMetricReadable("purchase_spend", staff)).toBe(false);
    expect(goalMetricReadable("purchase_spend", manager)).toBe(true);
  });

  it.each(["wine_revenue", "avg_check", "checks", "bottles_sold", "wine_attach_rate"])(
    "[REVERT-FAILS] a goal read off the till (%s) is withheld from staff and read by a manager",
    (metric) => {
      expect(goalMetricReadable(metric, readerSees({ role: "staff" }))).toBe(false);
      expect(goalMetricReadable(metric, readerSees({ role: "manager" }))).toBe(true);
    },
  );

  it("a days-of-stock goal is the cellar's, which staff read", () => {
    expect(goalMetricReadable("days_of_inventory", readerSees({ role: "staff" }))).toBe(true);
  });
});

describe("financial and cashflow routes", () => {
  it.each([["staff"], [undefined], [null], ["waiter"]])(
    "[REVERT-FAILS] role %p gets withheld registers and no read of the books",
    async (role) => {
      const { c, analyticsService, advanced } = controller();
      const fin: any = await c.getFinancial(HOUSE, undefined, { role } as never);
      const cash: any = await c.getCashflow(HOUSE, { role } as never);
      expect(fin).toEqual({ withheldForRole: true, register: "financial" });
      expect(cash).toEqual({ withheldForRole: true, register: "cashflow" });
      expect(JSON.stringify([fin, cash])).not.toMatch(/41200|18800|9100|3300/);
      expect(analyticsService.getFinancialSummary).not.toHaveBeenCalled();
      expect(advanced.getCashflow).not.toHaveBeenCalled();
    },
  );

  it.each([["manager"], ["owner"]])("role %p still reads both registers", async (role) => {
    const { c } = controller();
    expect(await c.getFinancial(HOUSE, undefined, { role } as never)).toEqual(FIN);
    expect(await c.getCashflow(HOUSE, { role } as never)).toEqual(CASH);
  });

  it.each([["staff"], [undefined], ["waiter"]])(
    "[REVERT-FAILS] role %p is told menu-engineering is withheld: no margin per bottle, no read",
    async (role) => {
      const { c, advanced } = controller();
      const out = await c.getMenuEngineering(HOUSE, { role } as never);
      expect(out).toEqual({ withheldForRole: true, register: "menu-engineering" });
      expect(JSON.stringify(out)).not.toMatch(/31\.77|28\.5|marginPerBottle/);
      expect(advanced.getMenuEngineering).not.toHaveBeenCalled();
    },
  );

  it.each([["manager"], ["owner"]])("role %p still reads menu-engineering", async (role) => {
    const { c } = controller();
    expect(await c.getMenuEngineering(HOUSE, { role } as never)).toEqual(MENU);
  });

  it("[REVERT-FAILS] the overview carries neither register to staff, and both to a manager", async () => {
    const staff: any = await controller().c.getOverview(HOUSE, { role: "staff" } as never);
    expect(staff.financial).toEqual({ withheldForRole: true, register: "financial" });
    expect(staff.cashflow).toEqual({ withheldForRole: true, register: "cashflow" });
    expect(staff.menuEngineering).toEqual({ withheldForRole: true, register: "menu-engineering" });
    const mgr: any = await controller().c.getOverview(HOUSE, { role: "manager" } as never);
    expect(mgr.financial).toEqual(FIN);
    expect(mgr.cashflow).toEqual(CASH);
    expect(mgr.menuEngineering.top).toEqual(MENU.items);
  });
});

describe("goals", () => {
  it("[REVERT-FAILS] staff get a purchasing goal and an unknown one as stubs with no name or target", async () => {
    const c = controller().c as any;
    c.goalsService = goalsService();
    const out: any[] = await c.listGoals(HOUSE, "active", { role: "staff" });
    const byId = Object.fromEntries(out.map((g) => [g.id, g]));
    expect(byId.g1).toEqual({ id: "g1", withheldForRole: true });
    expect(byId.g3).toEqual({ id: "g3", withheldForRole: true });
    expect(byId.g2.name).toBe("Keep 20 days of stock");
    expect(JSON.stringify(out)).not.toMatch(/8000|8,000/);
  });

  it("a manager reads every goal as it was", async () => {
    const c = controller().c as any;
    c.goalsService = goalsService();
    const out: any[] = await c.listGoals(HOUSE, "active", { role: "manager" });
    expect(out).toEqual(GOALS);
  });

  it("[REVERT-FAILS] a withheld goal is never computed and is counted; a manager's list is computed in full", async () => {
    const s: any = goalsService();
    const spy = jest
      .spyOn(s, "getGoalProgress")
      .mockImplementation(async (_r: string, id: string) => ({ goal: { id }, progress: 1 }) as never);
    const staff: any = await s.listGoalsWithProgress(HOUSE, "active", {
      goalSees: readerSees({ role: "staff" }),
    });
    expect(spy.mock.calls.map((c) => c[1])).toEqual(["g2"]);
    expect(staff.withheldForRole).toBe(2);
    expect(staff.goals.filter((g: any) => g.withheldForRole).map((g: any) => g.goal.id)).toEqual(["g1", "g3"]);
    expect(JSON.stringify(staff)).not.toMatch(/Spend under|8000/);
    spy.mockClear();
    const mgr: any = await s.listGoalsWithProgress(HOUSE, "active", {
      goalSees: readerSees({ role: "manager" }),
    });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(mgr.withheldForRole).toBeUndefined();
  });

  it("[REVERT-FAILS] one goal's progress for staff is withheld before it is computed", async () => {
    const s: any = goalsService([GOALS[0]]);
    const out: any = await s.getGoalProgress(HOUSE, "g1", { timezone: "UTC" }, {
      goalSees: readerSees({ role: "staff" }),
    });
    expect(out).toEqual({ goal: { id: "g1", withheldForRole: true }, withheldForRole: true });
  });
});
