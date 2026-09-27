import { ScheduledTasksService } from "./scheduled-tasks.service";

/**
 * `getEffectiveCategoryMode` (D5, 2026-09-19) — the orders/reports delivery
 * mode read from `notification_preferences`. No spec covered this method
 * before this file: it is reached only through `ScheduledTasksService`'s
 * cron entry points, whose harness would need mocking five unrelated
 * dependencies to reach one query. Tested directly (a private method,
 * reached via a cast) instead, against a minimal Supabase-shaped stub that
 * records the `.eq()` calls made against `notification_preferences` so a
 * test can assert restaurant scoping without needing a filtering fake.
 */
function makeDbMock(rows: any[]) {
  const eqCalls: Array<[string, any]> = [];
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: any) => {
      eqCalls.push([col, val]);
      return chain;
    },
    in: () => chain,
    then: (resolve: any) => resolve({ data: rows, error: null }),
  };
  return {
    databaseService: {
      getRestaurantMemberIds: jest.fn().mockResolvedValue(["user-1"]),
      getClient: () => ({ from: () => chain }),
    },
    eqCalls,
  };
}

function build(rows: any[]) {
  const { databaseService, eqCalls } = makeDbMock(rows);
  const service = new ScheduledTasksService(
    {} as any, // configService
    {} as any, // communicationsService
    databaseService as any,
    {} as any, // gmailService
    {} as any, // recipientResolver
    {} as any, // tenants
  );
  return { service, eqCalls };
}

describe("ScheduledTasksService.getEffectiveCategoryMode", () => {
  it("(D5, 2026-09-19) scopes the notification_preferences read to this restaurant", async () => {
    // notification_preferences is per (restaurant_id, user_id) since ADR 0149
    // row 39 -- this read used to be `.in("user_id", …)` with no
    // restaurant_id filter, so a member of two houses had the OTHER house's
    // orders_mode/reports_mode mixed into this restaurant's aggregate.
    const { service, eqCalls } = build([{ orders_mode: "off" }]);

    await (service as any).getEffectiveCategoryMode("r1", "orders");

    expect(eqCalls).toContainEqual(["restaurant_id", "r1"]);
  });

  it("still returns the default (on, email) when nobody has a preference row", async () => {
    const { service } = build([]);
    const mode = await (service as any).getEffectiveCategoryMode(
      "r1",
      "orders",
    );
    expect(mode).toEqual({ enabled: true, email: true });
  });
});
