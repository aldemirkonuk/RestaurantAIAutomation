/**
 * F-542: each feed collector did `.catch(() => [])`, so a failed read built a
 * feed with `counts.total = 0`, `getTodayPulse` sent `pendingDecisions: 0`, and
 * the phone's Today strip said "All clear" with orders waiting. A failed
 * collector now fails the feed, and the pulse says the count is unknown (null).
 */
import { MobileService } from "./mobile.service";

function build(opts: { ordersFail?: boolean }) {
  const procurement = {
    listPendingOrders: jest.fn(() =>
      opts.ordersFail
        ? Promise.reject(new Error("orders read failed"))
        : Promise.resolve([]),
    ),
  };
  const conversations = {
    getPendingConversations: jest.fn().mockResolvedValue([]),
  };
  const notifications = {
    getUnreadNotifications: jest.fn().mockResolvedValue([]),
  };
  const toast = {
    getSalesData: jest
      .fn()
      .mockResolvedValue({ totalRevenue: 4210, total: 62 }),
  };
  const db = {
    supabase: {
      from: () => ({
        select: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    },
  };
  return new MobileService(
    db as never,
    procurement as never,
    conversations as never,
    notifications as never,
    toast as never,
  );
}

describe("mobile feed read failures (F-542)", () => {
  it("fails the feed instead of returning an empty one when a collector fails", async () => {
    await expect(
      build({ ordersFail: true }).getFeed("u-1", "r-1"),
    ).rejects.toThrow(/could not be read in full \(orders\)/);
  });

  it("sends an unknown decision count, not 0, to the Today strip", async () => {
    const pulse = await build({ ordersFail: true }).getTodayPulse("u-1", "r-1");

    expect(pulse.revenueToday).toBe(4210);
    expect(pulse.pendingDecisions).toBeNull();
    expect(pulse.criticalCount).toBeNull();
  });

  it("still sends a genuine zero when every collector answered", async () => {
    const pulse = await build({}).getTodayPulse("u-1", "r-1");

    expect(pulse.pendingDecisions).toBe(0);
    expect(pulse.criticalCount).toBe(0);
  });
});
