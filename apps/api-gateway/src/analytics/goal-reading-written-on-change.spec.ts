import { GoalsService } from "./goals.service";

/**
 * A goal's reading is stored when it changes, or once per heartbeat, not on
 * every read of the goal (r41 reports gap 6). Every viewer's load or return to
 * the tab reads each goal; an UPDATE per goal that changed nothing made the
 * answer wait on writes.
 */

const verdicts = { record: () => {}, recordForEvent: () => {} } as any;
const NOW = Date.parse("2026-11-17T12:00:00Z");

const GOAL = {
  id: "g1",
  restaurant_id: "r1",
  name: "Days of stock under 30",
  metric_key: "days_of_inventory",
  direction: "at_most",
  target_value: 30,
  baseline_value: 45,
  current_value: 28,
  current_read_at: "2026-11-17T11:58:00Z",
  current_unread: null as string | null,
  deadline: null,
  created_at: "2026-10-01T10:00:00Z",
};

function harness(stored: Record<string, unknown>, dio = 28) {
  const updates: Array<Record<string, unknown>> = [];
  const from = () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      update: (p: Record<string, unknown>) => {
        updates.push(p);
        return chain;
      },
      single: async () => ({ data: stored, error: null }),
      maybeSingle: async () => ({ data: { timezone: "America/Detroit", country: "US" }, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve({ error: null, data: [] }).then(resolve, reject),
    };
    return chain;
  };
  const service = new GoalsService(
    { getClient: () => ({ from }) } as any,
    { getStored: async () => [] } as any,
    { get: () => undefined } as any,
    {} as any,
    verdicts,
    { getFinancialSummary: async () => ({ daysInventoryOutstanding: dio, inventoryValue: 900 }) } as any,
  );
  return { service, updates };
}

describe("a goal's reading is written when it changes", () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ["nextTick", "setImmediate", "setTimeout", "queueMicrotask"],
    });
  });
  afterEach(() => jest.useRealTimers());

  it("the same number stored two minutes ago is not written again, and the answer is the same", async () => {
    const { service, updates } = harness(GOAL);
    const out = await service.getGoalProgress("r1", "g1", undefined, { withSales: true });
    expect(out.current).toBe(28);
    expect(out.met).toBe(true);
    expect(updates).toHaveLength(0);
  });

  it("a different number is written", async () => {
    const { service, updates } = harness(GOAL, 27);
    await service.getGoalProgress("r1", "g1", undefined, { withSales: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ current_value: 27, current_unread: null });
  });

  it("the same number is stamped again once the heartbeat has passed", async () => {
    const { service, updates } = harness({ ...GOAL, current_read_at: "2026-11-17T11:40:00Z" });
    await service.getGoalProgress("r1", "g1", undefined, { withSales: true });
    expect(updates).toHaveLength(1);
  });

  it("a stored refusal is cleared by a good reading even when the old number matches", async () => {
    const { service, updates } = harness({ ...GOAL, current_unread: "no time zone is set" });
    await service.getGoalProgress("r1", "g1", undefined, { withSales: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ current_unread: null });
  });

  it("a row with no stamp is written", async () => {
    const { service, updates } = harness({ ...GOAL, current_read_at: null });
    await service.getGoalProgress("r1", "g1", undefined, { withSales: true });
    expect(updates).toHaveLength(1);
  });
});
