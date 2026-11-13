import { GoalsService } from "./goals.service";
import {
  SALES_GATED_GOAL_METRICS,
  isSalesGatedGoal,
} from "./sales-gated-goals";

describe("sales-gated goal metrics (ADR 0298 decision 9)", () => {
  it("every sales-gated key is a goal metric createGoal accepts and stores", () => {
    // createGoal refuses a key outside SUPPORTED_METRICS and stores the one
    // it accepts as metric_key, so a renamed key fails here, not in silence.
    const supported = Object.keys(GoalsService.SUPPORTED_METRICS);
    expect(SALES_GATED_GOAL_METRICS.size).toBeGreaterThan(0);
    for (const key of SALES_GATED_GOAL_METRICS)
      expect(supported).toContain(key);
  });

  it("a goal read without its metric_key counts as gated", () => {
    for (const k of [undefined, null, ""])
      expect(isSalesGatedGoal(k)).toBe(true);
    expect(isSalesGatedGoal("days_of_inventory")).toBe(true);
    expect(isSalesGatedGoal("bottles_sold")).toBe(false);
  });
});
