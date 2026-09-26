import { readFileSync } from "fs";
import { join } from "path";
import { AnalyticsController } from "../../analytics/analytics.controller";
import { RecommendationActionsService } from "../../analytics/recommendation-actions.service";
import { ReportCuttingReader } from "./report-cutting-reader.service";
import { EXPORTABLE_CUTTINGS, type ExportableCutting } from "./report-export-cuttings";

/**
 * OD-81 — an export reads a cutting the way the /reports page reads it.
 *
 * The founder's bar: an export is the same data the sheet shows, never figures
 * re-derived another way. So this spec builds the real `AnalyticsController`
 * the page calls and the real `ReportCuttingReader` the export calls, on the
 * SAME service doubles — each double answers with the arguments it was given —
 * and asserts the two answer identically for every cutting, using the query
 * string the page's catalogue sends. A horizon, window, limit or status that
 * drifts on either side changes an argument, and so the answer, and fails here.
 */

const RID = "11111111-1111-4111-8111-111111111111";

/** Each service method answers with its own name and arguments. */
function echo(name: string) {
  return jest.fn(async (...args: unknown[]) => ({ served: name, args }));
}

function build(stored: unknown[] | null = null) {
  const analytics = {
    getFinancialSummary: echo("getFinancialSummary"),
    getInventoryScience: echo("getInventoryScience"),
    getDemandForecast: echo("getDemandForecast"),
    getPosConsumptionBreakdown: echo("getPosConsumptionBreakdown"),
  };
  const advanced = {
    getOverview: echo("getOverview"),
    getCashflow: echo("getCashflow"),
    getSeasonality: echo("getSeasonality"),
    getMenuEngineering: echo("getMenuEngineering"),
  };
  const tables = {
    getTablePerformance: echo("getTablePerformance"),
    getWaiterPerformance: echo("getWaiterPerformance"),
  };
  const goals = {
    listGoalsWithProgress: echo("listGoalsWithProgress"),
    getPosRevenueWindow: jest.fn(async (rid: string, days: number) => ({
      served: "getPosRevenueWindow",
      args: [rid, days],
      posConnected: true,
      from: "2026-09-10",
      to: "2026-09-17",
    })),
  };
  // readStored answers the way the real one does: rows kept by the shared
  // item state (ADR 0191), how many were READ (a cache whose every row is
  // withheld is still an answer), what was withheld, and whether the state
  // could be read. The rows echo the arguments, as every other double does.
  const insights = {
    readStored: jest.fn(async (...args: unknown[]) => {
      const rows = stored ?? [{ served: "readStored", args }];
      return {
        rows,
        read: rows.length,
        withheld: { dismissed: 1, snoozed: 2, done: 3 },
        suppressionsReadable: true,
      };
    }),
    generate: echo("generate"),
  };
  // The REAL service: with no one looking (Nest's @CurrentUser() is undefined
  // on this direct call), viewFor never touches the database and hands the
  // house's rows back unchanged.
  const recommendationActions = new RecommendationActionsService(null as never);

  const controller = new AnalyticsController(
    analytics as never,
    advanced as never,
    null as never, // recommendations
    recommendationActions,
    tables as never,
    goals as never,
    null as never, // goal scenario requests
    null as never, // consultants
    insights as never,
    null as never, // scheduler
    null as never, // day exclusions
  );
  const reader = new ReportCuttingReader(
    analytics as never,
    advanced as never,
    goals as never,
    tables as never,
    insights as never,
  );
  return { controller, reader, insights };
}

/**
 * The page's request for each cutting, as `rp-registers-*.tsx` builds its path,
 * turned into the controller call Nest would make for it. The path strings are
 * asserted against the web source below, so this table cannot drift from them.
 */
const PAGE: Record<
  ExportableCutting,
  { path: string; call: (c: AnalyticsController, days: number) => Promise<unknown> }
> = {
  reading: { path: "`/analytics/insights/${rid}?limit=40`", call: (c) => c.getInsights(RID, undefined, undefined, "40") },
  till: { path: "`/analytics/pos-revenue/${rid}?days=${ctx.days}`", call: (c, d) => c.getPosRevenue(RID, String(d)) },
  goals: { path: "`/analytics/goals/${rid}/progress`", call: (c) => c.listGoalsWithProgress(RID, undefined) },
  bench: { path: "`/analytics/overview/${rid}`", call: (c) => c.getOverview(RID) },
  pacing: { path: "`/analytics/cashflow/${rid}`", call: (c) => c.getCashflow(RID) },
  week: { path: "`/analytics/seasonality/${rid}`", call: (c) => c.getSeasonality(RID) },
  ahead: { path: "`/analytics/forecast/${rid}?horizon=14`", call: (c) => c.getForecast(RID, undefined, "14") },
  quadrants: { path: "`/analytics/menu-engineering/${rid}`", call: (c) => c.getMenuEngineering(RID) },
  ledger: { path: "`/analytics/financial/${rid}`", call: (c) => c.getFinancial(RID, undefined) },
  seats: { path: "`/analytics/table-performance/${rid}?sinceDays=90`", call: (c) => c.getTablePerformance(RID, "90") },
  service: { path: "`/analytics/waiters/${rid}?sinceDays=90`", call: (c) => c.getWaiters(RID, "90") },
  restock: { path: "`/analytics/inventory-science/${rid}`", call: (c) => c.getInventoryScience(RID, undefined, undefined) },
};

describe("ReportCuttingReader reads what the /reports page reads (OD-81)", () => {
  it("covers every exportable cutting, with the path the page's catalogue actually requests", () => {
    expect(Object.keys(PAGE).sort()).toEqual([...EXPORTABLE_CUTTINGS].sort());
    const web = ["trade", "house", "bench", "goals"]
      .map((f) =>
        readFileSync(
          join(__dirname, `../../../../web/src/pages/reports/next/rp-registers-${f}.tsx`),
          "utf8",
        ),
      )
      .join("\n");
    for (const [id, p] of Object.entries(PAGE))
      expect([id, web.includes(`path: (rid${id === "till" ? ", ctx" : ""}) => ${p.path}`)]).toEqual([id, true]);
  });

  for (const id of EXPORTABLE_CUTTINGS) {
    it(`${id}: answers exactly what the page's endpoint answers`, async () => {
      const days = 7;
      const { controller, reader } = build();
      const fromPage = (await PAGE[id].call(controller, days)) as Record<string, unknown>;
      const fromExport = await reader.read(RID, id, id === "till" ? days : null);
      if (id === "till") {
        // The endpoint also attaches a per-wine consumption breakdown that the
        // till cutting never reads; everything else must match.
        const { consumption, ...rest } = fromPage;
        expect(consumption).toBeDefined();
        expect(fromExport).toEqual(rest);
      } else if (id === "reading") {
        // The page's last step is the person's own snoozes (ADR 0191 round 3);
        // with no one looking it drops nothing and says it read no one's. The
        // export is the house's answer: everything before that step, equal.
        const { hiddenForYou, personalSnoozesReadable, ...rest } = fromPage;
        expect(hiddenForYou).toBe(0);
        expect(personalSnoozesReadable).toBe(false);
        expect(fromExport).toEqual(rest);
        expect((fromExport as { withheld?: unknown }).withheld).toEqual({ dismissed: 1, snoozed: 2, done: 3 });
      } else {
        expect(fromExport).toEqual(fromPage);
      }
    });
  }

  it("reading: on a cold start both compute once, live, and persist — the same call", async () => {
    const page = build([]);
    const exp = build([]);
    const fromPage = await page.controller.getInsights(RID, undefined, undefined, "40");
    const fromExport = await exp.reader.read(RID, "reading", null);
    expect(fromExport).toEqual(fromPage);
    expect(exp.insights.generate).toHaveBeenCalledWith(RID, { categories: undefined, persist: true });
  });

  it("reading: a cache whose every row is withheld is an answer — neither side recomputes", async () => {
    const page = build();
    const exp = build();
    const allWithheld = async () => ({
      rows: [],
      read: 3,
      withheld: { dismissed: 2, snoozed: 1, done: 0 },
      suppressionsReadable: true,
    });
    page.insights.readStored.mockImplementation(allWithheld);
    exp.insights.readStored.mockImplementation(allWithheld);
    const fromPage = (await page.controller.getInsights(RID, undefined, undefined, "40")) as Record<string, unknown>;
    const fromExport = await exp.reader.read(RID, "reading", null);
    const { hiddenForYou, personalSnoozesReadable, ...rest } = fromPage;
    expect(fromExport).toEqual(rest);
    expect(fromExport).toEqual({
      source: "stored",
      insights: [],
      suppressed: 2,
      withheld: { dismissed: 2, snoozed: 1, done: 0 },
      suppressionsReadable: true,
    });
    expect(page.insights.generate).not.toHaveBeenCalled();
    expect(exp.insights.generate).not.toHaveBeenCalled();
    expect(exp.insights.readStored).toHaveBeenCalledWith(RID, { categories: undefined, limit: 40 });
  });

  it("does not swallow a register that throws: the export service fails the export with it", async () => {
    const { reader } = build();
    const broken = new ReportCuttingReader(
      { getFinancialSummary: jest.fn(async () => { throw new Error("boom"); }) } as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    await expect(broken.read(RID, "ledger", null)).rejects.toThrow("boom");
    await expect(reader.read(RID, "ledger", null)).resolves.toBeDefined();
  });
});
