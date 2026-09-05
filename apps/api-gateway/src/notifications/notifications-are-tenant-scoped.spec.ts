import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

/**
 * Notifications are scoped to the RESTAURANT, not just the user (Antalya night).
 *
 * Measured on main: a brand-new tenant that owned exactly ONE notification
 * rendered "20 unread", including a CRITICAL card naming seven wines belonging
 * to a different restaurant. Two halves, and either alone is enough:
 *
 *   - `apps/web/src/services/api/notifications.ts:81-102` sends `userId` and
 *     never the active restaurant;
 *   - `notifications.service.ts:807-811` filters by restaurant only when asked.
 *
 * One owner with two venues is the ordinary case, not an edge case, and the
 * inbox showed them one pile. The scope must come from the JWT the guard
 * already verified — a client-supplied `restaurantId` cannot be the only thing
 * standing between two tenants, because a client can send anything.
 */

type Row = Record<string, any>;

function makeController(overrides: Partial<NotificationsService> = {}) {
  const calls: Row[] = [];
  const service = {
    getNotifications: jest.fn(async (params: Row) => {
      calls.push({ method: "getNotifications", ...params });
      return { data: [], total: 0 };
    }),
    getUnreadNotifications: jest.fn(async (params: Row) => {
      calls.push({ method: "getUnreadNotifications", ...params });
      return [];
    }),
    getUnreadCount: jest.fn(async (params: Row) => {
      calls.push({ method: "getUnreadCount", ...params });
      return 0;
    }),
    ...overrides,
  } as unknown as NotificationsService;

  // The controller also takes NotificationProducersService (this branch) and an
  // optional LowStockAlertsService (main); neither is exercised by these cases.
  const controller = new NotificationsController(service, {} as never);
  return { controller, service, calls };
}

const req = (restaurantId: string | null, userId = "user-1") =>
  ({ user: { userId, restaurantId } }) as any;

describe("notification reads are scoped to the active restaurant", () => {
  it("passes the JWT's restaurantId to the list read", async () => {
    const { controller, calls } = makeController();

    await controller.getNotifications(
      { userId: "user-1" } as any,
      req("rest-antalya"),
    );

    expect(calls[0].restaurantId).toBe("rest-antalya");
  });

  it("passes it to the unread list", async () => {
    const { controller, calls } = makeController();

    await controller.getUnreadNotifications(
      { userId: "user-1" } as any,
      req("rest-antalya"),
    );

    expect(calls[0].restaurantId).toBe("rest-antalya");
  });

  it("passes it to the unread COUNT — the tile that read 20 over one row", async () => {
    const { controller, calls } = makeController();

    await controller.getUnreadCount(
      { userId: "user-1" } as any,
      req("rest-antalya"),
    );

    expect(calls[0].restaurantId).toBe("rest-antalya");
  });

  it("ignores a client-supplied restaurantId that contradicts the token", async () => {
    // The whole point: the query string is not a security boundary. An owner
    // of two venues could otherwise read either by editing a URL, and so could
    // anyone else who guessed a uuid.
    const { controller, calls } = makeController();

    await controller.getNotifications(
      { userId: "user-1", restaurantId: "rest-someone-else" } as any,
      req("rest-antalya"),
    );

    expect(calls[0].restaurantId).toBe("rest-antalya");
  });

  it("refuses the read when the token carries no restaurant, rather than returning everything", async () => {
    // Falling back to "no filter" is how this bug renders: an unscoped read
    // returns every notification the user has ever received, across tenants.
    const { controller, service } = makeController();

    await expect(
      controller.getNotifications({ userId: "user-1" } as any, req(null)),
    ).rejects.toThrow(/restaurant/i);
    expect(service.getNotifications).not.toHaveBeenCalled();
  });
});
