import { makeStubDb, type StubDb } from "../team/testing/supabase-stub";
import { NotificationsService } from "./notifications.service";
import { LowStockAlertsService } from "./low-stock-alerts.service";
import { closeDeliveryItemToNameBookedElsewhere } from "../procurement/delivery-item-to-name";

/**
 * The bell tells the truth (wave15sim notifications-bell-truth.md).
 *
 *  * F-528 — the phone push honours each person's Push switch and quiet
 *    hours, on the house's own clock. The bell row is written either way.
 *  * F-530 — a push never carries the money a row's metadata holds.
 *  * F-526 — a line clears when the thing it reports is dealt with: the
 *    "Name the item" ask once the stock is booked elsewhere, and a low-stock
 *    line once none of its wines is below par.
 */

const HOUSE = "11111111-1111-1111-1111-111111111111";
const OWNER = "u-owner";
const COOK = "u-cook";

function seed(extra: Partial<Record<string, any[]>> = {}): StubDb {
  return makeStubDb({
    restaurants: [{ id: HOUSE, timezone: "Europe/Istanbul" }],
    user_restaurant_access: [
      { user_id: OWNER, restaurant_id: HOUSE, role: "owner", is_active: true },
      { user_id: COOK, restaurant_id: HOUSE, role: "staff", is_active: true },
    ],
    notifications: [],
    notification_preferences: [],
    ...extra,
  });
}

function funnel(db: StubDb) {
  const pushes: Array<{ ids: string[]; data: Record<string, unknown> }> = [];
  const socket = { server: { to: () => ({ emit: () => undefined }) } };
  const expo = {
    sendToUsers: async (ids: string[], msg: { data: Record<string, unknown> }) =>
      void pushes.push({ ids, data: msg.data }),
  };
  const database = {
    supabase: db.supabase,
    client: db.supabase,
    getClient: () => db.supabase,
    getRestaurantMemberIds: async () => [OWNER, COOK],
  };
  const svc = new NotificationsService(
    socket as never,
    { get: () => undefined } as never,
    database as never,
    undefined,
    expo as never,
  );
  (svc as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  return { svc, pushes };
}

const LINE = {
  type: "inventory_low_stock",
  title: "Critical: Narince",
  message: "Only 1 bottle remaining (par: 6)",
  priority: "critical" as const,
};

/** 01:00 in Istanbul (UTC+3) is 22:00 UTC the evening before. */
const ONE_AM_ISTANBUL = new Date("2026-10-08T22:00:00.000Z");
const NOON_ISTANBUL = new Date("2026-10-09T09:00:00.000Z");

describe("F-528 — the phone push honours quiet hours and the Push switch", () => {
  afterEach(() => jest.useRealTimers());

  const quiet = (userId: string) => ({
    user_id: userId,
    restaurant_id: HOUSE,
    push_enabled: true,
    quiet_hours_enabled: true,
    quiet_hours_start: "23:00",
    quiet_hours_end: "08:00",
  });

  it("at 01:00 house time, a person inside 23:00-08:00 is not pushed; the bell row is still written", async () => {
    jest.useFakeTimers({ now: ONE_AM_ISTANBUL, doNotFake: ["nextTick", "setImmediate"] });
    const db = seed({ notification_preferences: [quiet(OWNER)] });
    const { svc, pushes } = funnel(db);

    const out = await svc.persistForRestaurant(HOUSE, LINE);

    expect(out.inserted).toBe(2);
    expect(db.tables.notifications.map((r) => r.user_id).sort()).toEqual([COOK, OWNER].sort());
    expect(pushes.map((p) => p.ids)).toEqual([[COOK]]);
  });

  it("the window is read on the HOUSE's clock: noon in Istanbul pushes the same person", async () => {
    jest.useFakeTimers({ now: NOON_ISTANBUL, doNotFake: ["nextTick", "setImmediate"] });
    const db = seed({ notification_preferences: [quiet(OWNER)] });
    const { svc, pushes } = funnel(db);

    await svc.persistForRestaurant(HOUSE, LINE);

    expect(pushes.map((p) => p.ids)).toEqual([[OWNER, COOK]]);
  });

  it("a person who switched Push off is never pushed, at any hour", async () => {
    jest.useFakeTimers({ now: NOON_ISTANBUL, doNotFake: ["nextTick", "setImmediate"] });
    const db = seed({
      notification_preferences: [{ ...quiet(COOK), push_enabled: false, quiet_hours_enabled: false }],
    });
    const { svc, pushes } = funnel(db);

    await svc.persistForRestaurant(HOUSE, LINE);

    expect(pushes.map((p) => p.ids)).toEqual([[OWNER]]);
  });

  it("preferences that cannot be read push everyone, as before they were read", async () => {
    jest.useFakeTimers({ now: ONE_AM_ISTANBUL, doNotFake: ["nextTick", "setImmediate"] });
    const db = seed({ notification_preferences: [quiet(OWNER)] });
    db.errors["notification_preferences:select"] = { message: "offline" };
    const { svc, pushes } = funnel(db);

    await svc.persistForRestaurant(HOUSE, LINE);

    expect(pushes.map((p) => p.ids)).toEqual([[OWNER, COOK]]);
  });
});

describe("F-530 — a push never carries house money", () => {
  it("credit due, landed cost and prices in a row's metadata stay off the phone", async () => {
    const db = seed();
    const { svc, pushes } = funnel(db);

    await svc.persistForRestaurant(HOUSE, {
      ...LINE,
      metadata: { orderId: "o1", creditDue: 120, effectiveUnitCost: 18.5, price: 22, matchStatus: "qty_short" },
    });

    expect(pushes).toHaveLength(1);
    expect(pushes[0].data).toEqual({
      type: "inventory_low_stock",
      actionUrl: null,
      orderId: "o1",
      matchStatus: "qty_short",
      // F-523: the house it belongs to rides last, and carries no money.
      restaurantId: HOUSE,
    });
    // The row itself keeps them, for the people the writer addressed.
    expect(db.tables.notifications[0].metadata.creditDue).toBe(120);
  });
});

describe("F-526 — a line clears when its thing is dealt with", () => {
  it("the receiving door books the order: the 'Name the item' line clears for every owner and manager", async () => {
    const db = seed({
      delivery_item_to_name: [{ id: "ask-1", restaurant_id: HOUSE, order_id: "o1", status: "open" }],
      notifications: [
        { id: "n1", restaurant_id: HOUSE, user_id: OWNER, status: "unread", group_key: "delivery_item_to_name:o1" },
        { id: "n2", restaurant_id: HOUSE, user_id: COOK, status: "unread", group_key: "delivery_item_to_name:o1" },
        { id: "n3", restaurant_id: HOUSE, user_id: OWNER, status: "unread", group_key: "delivery_item_to_name:o2" },
      ],
    });

    const out = await closeDeliveryItemToNameBookedElsewhere(db.supabase, {
      restaurantId: HOUSE,
      orderId: "o1",
      via: "receiving_door",
    });

    expect(out).toEqual({ ok: true, closed: true });
    const status = Object.fromEntries(db.tables.notifications.map((r) => [r.id, r.status]));
    expect(status).toEqual({ n1: "read", n2: "read", n3: "unread" });
  });

  function lowStock(db: StubDb, low: Array<{ id: string; wine_id: string }>, readFails = false) {
    const supabase = {
      from: (table: string) =>
        table === "v_low_stock_items"
          ? {
              select: async () =>
                readFails
                  ? { data: null, error: { message: "view offline" } }
                  : {
                      data: low.map((r) => ({
                        ...r,
                        restaurant_id: HOUSE,
                        stock_live: 1,
                        threshold_min: 6,
                        wine_name: "Narince",
                      })),
                      error: null,
                    },
            }
          : db.supabase.from(table),
    };
    const svc = new LowStockAlertsService(
      { supabase } as any,
      { persistForRestaurant: jest.fn().mockResolvedValue({ inserted: 0, ids: [] }) } as any,
      { get: () => undefined } as any,
      {} as any,
      {} as any,
    );
    (svc as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    (svc as any).evaluateRestaurant = jest.fn();
    (svc as any).getRestaurantNames = jest.fn().mockResolvedValue(new Map());
    (svc as any).reconcileRecoveries = jest.fn();
    return svc;
  }

  const lowLine = (id: string, wines: Array<Record<string, string>>) => ({
    id,
    restaurant_id: HOUSE,
    user_id: OWNER,
    type: "inventory_low_stock",
    status: "unread",
    metadata: { wines },
  });

  it("a restock clears the line whose wines are all back at par, and keeps the one still partly true", async () => {
    const db = seed({
      notifications: [
        lowLine("recovered", [{ inventoryId: "inv-narince", wineId: "w-narince" }]),
        lowLine("partly", [
          { inventoryId: "inv-narince", wineId: "w-narince" },
          { inventoryId: "inv-yakut", wineId: "w-yakut" },
        ]),
        // Written before lines carried inventoryId: matched on wineId.
        lowLine("old-shape", [{ wineId: "w-kalecik" }]),
      ],
    });
    const svc = lowStock(db, [{ id: "inv-yakut", wine_id: "w-yakut" }]);

    await svc.runEdgeSweep();

    const status = Object.fromEntries(db.tables.notifications.map((r) => [r.id, r.status]));
    expect(status).toEqual({ recovered: "read", partly: "unread", "old-shape": "read" });
  });

  it("a failed low-stock read clears nothing: an empty answer is not 'nothing is low'", async () => {
    const db = seed({
      notifications: [lowLine("recovered", [{ inventoryId: "inv-narince", wineId: "w-narince" }])],
    });
    const svc = lowStock(db, [], true);

    await svc.runEdgeSweep();

    expect(db.tables.notifications[0].status).toBe("unread");
  });
});
