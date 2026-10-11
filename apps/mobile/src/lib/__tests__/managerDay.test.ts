/**
 * The phone manager's day (integ14): a wine's last 14 days (F-1302), the
 * Insights goal bars (F-1304), and an order's quantity in its own unit
 * (F-1305). Screens are not rendered by this runner (jest.config.js), so the
 * screen guards read their source, as receiveQueueScreens.test.ts does.
 */
import fs from "fs";
import path from "path";
import { dailyDepletion } from "@/lib/wineActivity";
import { GOAL_NOT_READ, goalBars } from "@/lib/goalBars";

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");

describe("a wine's 'Last 14 days' (F-1302)", () => {
  it("draws what left the shelf, from the gateway's daily `out` key", () => {
    // The shape inventory.service.ts getItemActivity sends.
    const activity = {
      daily: [
        { date: "2026-10-09", out: 3, in: 0 },
        { date: "2026-10-10", out: 0, in: 12 },
        { date: "2026-10-11", out: 1.5, in: 0 },
      ],
    };
    expect(dailyDepletion(activity)).toEqual([3, 0, 1.5]);
  });

  it("is empty, not invented, when no series came back", () => {
    expect(dailyDepletion(undefined)).toEqual([]);
    expect(dailyDepletion({})).toEqual([]);
  });

  it("is what the wine screen draws", () => {
    expect(read("app/(tabs)/cellar/[id].tsx")).toContain("dailyDepletion(activity)");
  });
});

describe("Insights goal bars (F-1304)", () => {
  const goals = [
    { id: "g1", name: "Wine revenue", current_value: 0, target_value: 1000, direction: "at_least" },
    { id: "g2", name: "Waste", current_value: 0, target_value: 50, direction: "at_most" },
    { id: "g3", name: "Bottles sold", current_value: 40, target_value: 100 },
  ];
  const progress = {
    isLoading: false,
    isError: false,
    data: {
      goals: [
        { goal: { id: "g1", direction: "at_least" }, progressPct: 0.5, onTrack: true, daysLeft: 9 },
        { goal: { id: "g2", direction: "at_most" }, progressPct: 1.2, onTrack: false },
        { goal: { id: "g3" }, unreadable: true, reason: "boom" },
      ],
    },
  };

  it("draws the server's recomputed progress, not the stored current_value", () => {
    const [g1] = goalBars(goals, progress);
    expect(g1).toMatchObject({ kind: "bar", fill: 0.5, label: "50%", onTrack: true, daysLeft: 9 });
  });

  it("reads a 'keep at most' goal against its limit and says when it is over", () => {
    const [, g2] = goalBars(goals, progress);
    expect(g2).toMatchObject({ kind: "bar", fill: 1, over: true, label: "Over the limit (120%)" });
  });

  it("says a goal could not be read, never 0% or the stored 40%", () => {
    const [, , g3] = goalBars(goals, progress);
    expect(g3).toEqual({ id: "g3", name: "Bottles sold", kind: "unreadable", message: GOAL_NOT_READ });
    const failed = goalBars(goals, { isLoading: false, isError: true, data: undefined });
    expect(failed.every((g) => g.kind === "unreadable")).toBe(true);
  });

  it("is what the Insights screen draws, from the progress read", () => {
    const SCREEN = read("app/(tabs)/insights.tsx");
    expect(SCREEN).toContain("goalBars(activeGoals.slice(0, 3), goalsProgress)");
    expect(SCREEN).not.toMatch(/current_value/);
    expect(read("src/api/queries.ts")).toContain("`/analytics/goals/${restaurantId}/progress`");
  });
});

describe("an order's quantity is said in its own unit (F-1305)", () => {
  it("on the order screen and in the order list", () => {
    for (const rel of ["app/(tabs)/supply/[id].tsx", "src/components/supply/OrderRow.tsx"]) {
      const src = read(rel);
      expect(src).toContain("orderUnitWords(order.unitType, order.quantity)");
      expect(src).not.toMatch(/\$\{order\.quantity\} (bottles|btl)/);
    }
  });
});
