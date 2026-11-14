import { HOUSE_ZONE_UNSET } from "../common/house-day";
import { WholeReadError } from "../common/read-whole-window";
import { UncostedOrdersError } from "./order-cost";
import {
  GOAL_UNREAD_ON_OUR_SIDE,
  GoalReadingRefused,
  goalUnreadInWords,
} from "./goal-unread";
import { GoalsService } from "./goals.service";

/**
 * r34 walk w3, R-F7: with a table missing, the goal card and the bench said
 * "This goal could not be scored (PGRST205 Could not find the table
 * 'public.wine_consumption_log' in the schema cache)". A goal that cannot be
 * read says why in the house's words, on the list and on the stored row.
 */

const RAW =
  "PGRST205 Could not find the table 'public.wine_consumption_log' in the schema cache";

const GOAL = {
  id: "g1",
  restaurant_id: "r1",
  name: "Days of stock under 30",
  metric_key: "days_of_inventory",
  direction: "at_most",
  target_value: 30,
  baseline_value: 45,
  current_value: 31,
  current_read_at: "2026-11-01T10:00:00Z",
  current_unread: null,
  deadline: null,
  created_at: "2026-10-01T10:00:00Z",
};

function harness(financial: () => Promise<unknown>) {
  const updates: Array<Record<string, unknown>> = [];
  const from = () => {
    let patch: Record<string, unknown> | null = null;
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      update: (p: Record<string, unknown>) => {
        patch = p;
        updates.push(p);
        return chain;
      },
      single: async () => ({ data: GOAL, error: null }),
      maybeSingle: async () => ({
        data: { timezone: "America/Detroit", country: "US" },
        error: null,
      }),
      then: (resolve: any, reject: any) =>
        Promise.resolve(
          patch ? { error: null } : { data: [GOAL], error: null },
        ).then(resolve, reject),
    };
    return chain;
  };
  const service = new GoalsService(
    { getClient: () => ({ from }) } as any,
    { getStored: async () => [] } as any,
    { get: () => undefined } as any,
    {} as any,
    { record: () => {}, recordForEvent: () => {} } as any,
    { getFinancialSummary: financial } as any,
  );
  return { service, updates };
}

describe("a goal that cannot be read says why in the house's words (R-F7)", () => {
  it("a raw database error never reaches the list or the stored row", async () => {
    const { service, updates } = harness(async () => {
      throw new Error(RAW);
    });
    const out: any = await service.listGoalsWithProgress("r1", "active", {
      withSales: true,
    });
    expect(out.goals[0].unreadable).toBe(true);
    expect(out.goals[0].reason).toBe(GOAL_UNREAD_ON_OUR_SIDE);
    expect(out.goals[0].reason).not.toMatch(/PGRST|public\.|schema cache/);
    expect(out.goals[0].zoneUnset).toBe(false);
    expect(updates).toHaveLength(1);
    expect(updates[0].current_unread).toBe(GOAL_UNREAD_ON_OUR_SIDE);
  });

  it("a refusal written for the house is said as written", async () => {
    const { service, updates } = harness(async () => ({
      daysInventoryOutstanding: null,
      inventoryValue: null,
    }));
    const out: any = await service.listGoalsWithProgress("r1", "active", {
      withSales: true,
    });
    expect(out.goals[0].reason).toMatch(/^Days of stock cannot be read/);
    expect(updates[0].current_unread).toMatch(/^Days of stock cannot be read/);
  });
});

describe("goalUnreadInWords", () => {
  it("keeps what a whole read refused and why, and drops the database's detail", () => {
    const err = new WholeReadError(
      "The POS checks in this window",
      "read_failed",
      0,
      null,
      `page 1: ${RAW}`,
    );
    const said = goalUnreadInWords(err);
    expect(said).toBe(
      "The POS checks in this window could not be read whole: the database refused one of its pages. Nothing is reported from part of it.",
    );
    expect(said).not.toMatch(/PGRST|page 1/);
  });

  it("keeps the house's own refusals: no zone, an uncosted order, a stated reason", () => {
    expect(goalUnreadInWords(new Error(HOUSE_ZONE_UNSET))).toBe(HOUSE_ZONE_UNSET);
    const uncosted = new UncostedOrdersError(2, 9);
    expect(goalUnreadInWords(uncosted)).toBe(uncosted.message);
    expect(goalUnreadInWords(new GoalReadingRefused("Said for the house."))).toBe(
      "Said for the house.",
    );
  });

  it("anything else is a failure on Mudavym's side, never its own text", () => {
    for (const err of [
      new Error(RAW),
      new TypeError("Cannot read properties of undefined (reading 'items')"),
      "fetch failed",
      undefined,
    ])
      expect(goalUnreadInWords(err)).toBe(GOAL_UNREAD_ON_OUR_SIDE);
  });
});
