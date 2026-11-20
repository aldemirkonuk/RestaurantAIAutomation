/**
 * QA round 4 B3 (2026-11-07): "Delete all read" filtered on the user alone,
 * so an owner of two venues clearing venue A's read alerts erased venue B's
 * too, with no undo. Run through the real service over the in-memory Supabase
 * that applies its filters. The route half is in
 * `notification-routes-belong-to-the-caller.spec.ts`.
 */
import { makeStubDb, asDatabaseService } from "../team/testing/supabase-stub";
import { NotificationsService } from "./notifications.service";

const HOUSE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const GM = "u-gm";
const COOK = "u-cook";

describe("B3 — Delete all read clears one house", () => {
  it("leaves the caller's read alerts in their other venue, and their unread ones here", async () => {
    const db = makeStubDb({
      notifications: [
        { id: "a-read", user_id: GM, restaurant_id: HOUSE, status: "read" },
        { id: "a-unread", user_id: GM, restaurant_id: HOUSE, status: "unread" },
        { id: "b-read", user_id: GM, restaurant_id: OTHER, status: "read" },
        {
          id: "cook-read",
          user_id: COOK,
          restaurant_id: HOUSE,
          status: "read",
        },
      ],
    });
    const svc = new NotificationsService(
      { server: { to: () => ({ emit: () => undefined }) } } as never,
      { get: () => undefined } as never,
      asDatabaseService(db),
    );
    const count = await svc.deleteAllRead(GM, HOUSE);
    expect(count).toBe(1);
    expect(db.tables.notifications.map((r) => r.id).sort()).toEqual(
      ["a-unread", "b-read", "cook-read"].sort(),
    );
  });

  it("refuses to run with no house rather than clearing every one", async () => {
    const db = makeStubDb({ notifications: [] });
    const svc = new NotificationsService(
      { server: { to: () => ({ emit: () => undefined }) } } as never,
      { get: () => undefined } as never,
      asDatabaseService(db),
    );
    await expect(svc.deleteAllRead(GM, "")).rejects.toThrow(/needs the house/);
  });
});
