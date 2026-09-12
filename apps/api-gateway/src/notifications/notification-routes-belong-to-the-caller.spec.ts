import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

/**
 * Every notification route answers for the user and the restaurant on the
 * VERIFIED token, never for ids the client names.
 *
 * Found 2026-09-12. After GET and PATCH /notifications/preferences were scoped,
 * the adversarial pass showed the siblings had the same shape:
 * - push/subscribe upserted any user's push subscription, so a caller could
 *   point a victim's alerts at their own browser;
 * - push/unsubscribe switched them off;
 * - history read any user's notifications across every restaurant;
 * - read/all took both ids from the query;
 * - test sent to any id;
 * - POST / wrote a row for any user and restaurant;
 * - low-stock/held/:restaurantId read any restaurant;
 * - every :id route matched on the notification id alone.
 *
 * A client id that names the caller still passes, because the web client
 * sends its own id (apps/web/src/services/api/notifications.ts).
 */

const OWN = "11111111-1111-4111-8111-111111111111";
const VICTIM = "22222222-2222-4222-8222-222222222222";
const HOUSE = "33333333-3333-4333-8333-333333333333";
const OTHER_HOUSE = "44444444-4444-4444-8444-444444444444";

const req = (
  userId: string | null = OWN,
  restaurantId: string | null = HOUSE,
) => ({ user: { userId, restaurantId } }) as any;

function makeController() {
  const fn = () => jest.fn(async (..._args: any[]) => ({ ok: true }));
  const service = {
    getNotifications: fn(),
    getUnreadNotifications: fn(),
    getUnreadCount: jest.fn(async () => 0),
    getNotificationHistory: fn(),
    markAllAsRead: jest.fn(async () => 0),
    markBulkAsRead: jest.fn(async () => 0),
    markAsRead: fn(),
    markAsUnread: fn(),
    archiveNotification: fn(),
    deleteNotification: fn(),
    deleteBulk: jest.fn(async () => 0),
    deleteAllRead: jest.fn(async () => 0),
    registerPushSubscription: fn(),
    unregisterPushSubscription: fn(),
    sendToUser: fn(),
    createNotification: fn(),
  } as unknown as NotificationsService & Record<string, jest.Mock>;
  const lowStock = { listHeldCrossings: jest.fn(async () => []) };
  const controller = new NotificationsController(
    service,
    {} as never,
    lowStock as never,
  );
  return { controller, service, lowStock };
}

describe("push subscriptions belong to the caller", () => {
  it("[REVERT-FAILS] refuses to subscribe another user's push, and writes nothing", async () => {
    const { controller, service } = makeController();
    await expect(
      controller.subscribeToPush(
        { userId: VICTIM, subscription: { endpoint: "https://evil" } } as any,
        req(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.registerPushSubscription).not.toHaveBeenCalled();
  });

  it("subscribes the caller from the token when the body names no one", async () => {
    const { controller, service } = makeController();
    await controller.subscribeToPush(
      { subscription: { endpoint: "e" } } as any,
      req(),
    );
    expect(service.registerPushSubscription).toHaveBeenCalledWith(OWN, {
      endpoint: "e",
    });
  });

  it("[REVERT-FAILS] refuses to unsubscribe another user", async () => {
    const { controller, service } = makeController();
    await expect(
      controller.unsubscribeFromPush({ userId: VICTIM } as any, req()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.unregisterPushSubscription).not.toHaveBeenCalled();
  });

  it("refuses a session with no user rather than using the client's id", async () => {
    const { controller, service } = makeController();
    await expect(
      controller.unsubscribeFromPush({ userId: OWN } as any, req(null)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.unregisterPushSubscription).not.toHaveBeenCalled();
  });
});

describe("reads answer for the caller's user and house", () => {
  it("[REVERT-FAILS] history refuses another user's id", async () => {
    const { controller, service } = makeController();
    await expect(
      controller.getNotificationHistory(
        { userId: VICTIM, days: 30 } as any,
        req(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getNotificationHistory).not.toHaveBeenCalled();
  });

  it("history is scoped to the token's restaurant as well", async () => {
    const { controller, service } = makeController();
    await controller.getNotificationHistory(
      { userId: OWN, days: 7 } as any,
      req(),
    );
    expect(service.getNotificationHistory).toHaveBeenCalledWith(OWN, 7, HOUSE);
  });

  it("[REVERT-FAILS] the list refuses another user's id", async () => {
    const { controller, service } = makeController();
    await expect(
      controller.getNotifications({ userId: VICTIM } as any, req()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getNotifications).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] the unread count refuses another user's id", async () => {
    const { controller, service } = makeController();
    await expect(
      controller.getUnreadCount({ userId: VICTIM } as any, req()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getUnreadCount).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] held low-stock crossings refuse another restaurant", async () => {
    const { controller, lowStock } = makeController();
    await expect(
      controller.getHeldLowStock(OTHER_HOUSE, req()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(lowStock.listHeldCrossings).not.toHaveBeenCalled();
  });
});

describe("writes answer for the caller only", () => {
  it("[REVERT-FAILS] read/all refuses a restaurant id that is not the token's", async () => {
    const { controller, service } = makeController();
    await expect(
      controller.markAllAsRead(
        { userId: OWN, restaurantId: OTHER_HOUSE } as any,
        req(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.markAllAsRead).not.toHaveBeenCalled();
  });

  it("read/all uses both ids from the token", async () => {
    const { controller, service } = makeController();
    await controller.markAllAsRead({ userId: OWN } as any, req());
    expect(service.markAllAsRead).toHaveBeenCalledWith({
      userId: OWN,
      restaurantId: HOUSE,
    });
  });

  it("[REVERT-FAILS] deleting all read refuses another user", async () => {
    const { controller, service } = makeController();
    await expect(
      controller.deleteAllRead({ userId: VICTIM } as any, req()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.deleteAllRead).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] a test notification goes only to the caller", async () => {
    const { controller, service } = makeController();
    await expect(
      controller.sendTestNotification({ userId: VICTIM }, req()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.sendToUser).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] creating a notification refuses another user or house", async () => {
    const { controller, service } = makeController();
    const body = { type: "t", title: "t", message: "m" } as any;
    await expect(
      controller.createNotification(
        { ...body, userId: VICTIM, restaurantId: HOUSE },
        req(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.createNotification(
        { ...body, userId: OWN, restaurantId: OTHER_HOUSE },
        req(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.createNotification).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] every :id route hands the service the caller's user id", async () => {
    const { controller, service } = makeController();
    await controller.markAsRead("n1", req());
    await controller.markAsUnread("n1", req());
    await controller.archiveNotification("n1", req());
    await controller.deleteNotification("n1", req());
    await controller.markBulkAsRead({ ids: ["n1"] } as any, req());
    await controller.deleteBulk({ ids: ["n1"] } as any, req());
    expect(service.markAsRead).toHaveBeenCalledWith("n1", OWN);
    expect(service.markAsUnread).toHaveBeenCalledWith("n1", OWN);
    expect(service.archiveNotification).toHaveBeenCalledWith("n1", OWN);
    expect(service.deleteNotification).toHaveBeenCalledWith("n1", OWN);
    expect(service.markBulkAsRead).toHaveBeenCalledWith(["n1"], OWN);
    expect(service.deleteBulk).toHaveBeenCalledWith(["n1"], OWN);
  });

  it("a refusal from the service reaches the caller as itself, not as a 500", async () => {
    const { controller, service } = makeController();
    (service.markAsRead as unknown as jest.Mock).mockRejectedValueOnce(
      new NotFoundException("Notification not found"),
    );
    await expect(controller.markAsRead("n1", req())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("the service matches a notification by its id AND its owner", () => {
  function chain(result: any) {
    const calls: Array<[string, ...any[]]> = [];
    const q: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") return (resolve: any) => resolve(result);
          return (...args: any[]) => {
            calls.push([prop, ...args]);
            return q;
          };
        },
      },
    );
    return { q, calls };
  }

  it("[REVERT-FAILS] markAsRead filters on user_id, and a row that is not the caller's is a 404", async () => {
    const { q, calls } = chain({ data: null, error: null });
    const service = Object.create(NotificationsService.prototype);
    service.databaseService = { supabase: { from: () => q } };
    service.logger = { error: () => undefined };
    await expect(service.markAsRead("n1", OWN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(calls).toContainEqual(["eq", "user_id", OWN]);
  });

  it("[REVERT-FAILS] deleteNotification filters on user_id, and deleting nothing is a 404", async () => {
    const { q, calls } = chain({ data: [], error: null });
    const service = Object.create(NotificationsService.prototype);
    service.databaseService = { supabase: { from: () => q } };
    service.logger = { error: () => undefined };
    await expect(service.deleteNotification("n1", OWN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(calls).toContainEqual(["eq", "user_id", OWN]);
  });
});
