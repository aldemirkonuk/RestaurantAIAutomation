import { makeStubDb, type StubDb } from "../team/testing/supabase-stub";
import { NotificationsService } from "./notifications.service";
import { LowStockAlertsService } from "./low-stock-alerts.service";
import { closeDeliveryItemToNameBookedElsewhere } from "../procurement/delivery-item-to-name";
import * as pushHold from "./push-hold";

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
  const pushes: Array<{
    ids: string[];
    data: Record<string, unknown>;
    house?: string;
    body?: string;
  }> = [];
  const socket = { server: { to: () => ({ emit: () => undefined }) } };
  const expo = {
    sendToUsers: async (
      ids: string[],
      msg: { data: Record<string, unknown>; house?: string; body?: string },
    ) =>
      void pushes.push({
        ids,
        data: msg.data,
        house: msg.house,
        body: msg.body,
      }),
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
  (svc as any).logger = {
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
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
    jest.useFakeTimers({
      now: ONE_AM_ISTANBUL,
      doNotFake: ["nextTick", "setImmediate"],
    });
    const db = seed({ notification_preferences: [quiet(OWNER)] });
    const { svc, pushes } = funnel(db);

    const out = await svc.persistForRestaurant(HOUSE, LINE);

    expect(out.inserted).toBe(2);
    expect(db.tables.notifications.map((r) => r.user_id).sort()).toEqual(
      [COOK, OWNER].sort(),
    );
    expect(pushes.map((p) => p.ids)).toEqual([[COOK]]);
  });

  it("the window is read on the HOUSE's clock: noon in Istanbul pushes the same person", async () => {
    jest.useFakeTimers({
      now: NOON_ISTANBUL,
      doNotFake: ["nextTick", "setImmediate"],
    });
    const db = seed({ notification_preferences: [quiet(OWNER)] });
    const { svc, pushes } = funnel(db);

    await svc.persistForRestaurant(HOUSE, LINE);

    expect(pushes.map((p) => p.ids)).toEqual([[OWNER, COOK]]);
  });

  it("a person who switched Push off is never pushed, at any hour", async () => {
    jest.useFakeTimers({
      now: NOON_ISTANBUL,
      doNotFake: ["nextTick", "setImmediate"],
    });
    const db = seed({
      notification_preferences: [
        { ...quiet(COOK), push_enabled: false, quiet_hours_enabled: false },
      ],
    });
    const { svc, pushes } = funnel(db);

    await svc.persistForRestaurant(HOUSE, LINE);

    expect(pushes.map((p) => p.ids)).toEqual([[OWNER]]);
  });

  // F-1340, the founder's F-540 ruling (2026-10-11): a push the team sends
  // one another (a shift offer) may arrive inside quiet hours, and is logged.
  it("[REVERT-FAILS] a team push reaches a person inside quiet hours, keeps Push off, and logs it (F-1340)", async () => {
    jest.useFakeTimers({
      now: ONE_AM_ISTANBUL,
      doNotFake: ["nextTick", "setImmediate"],
    });
    const db = seed({
      notification_preferences: [
        quiet(OWNER),
        { ...quiet(COOK), push_enabled: false },
      ],
    });
    const { svc, pushes } = funnel(db);
    const lines: string[] = [];
    (svc as any).logger.log = (l: string) => void lines.push(l);

    await svc.persistForRestaurant(HOUSE, LINE, {
      teamPush: { what: "shift_offer", by: "u-manager" },
    });

    expect(pushes.map((p) => p.ids)).toEqual([[OWNER]]);
    const quietLines = lines.filter((l) =>
      l.startsWith("TEAM_PUSH_IN_QUIET_HOURS"),
    );
    expect(quietLines).toHaveLength(1);
    expect(quietLines[0]).toContain(`to=${OWNER}`);
    expect(quietLines[0]).toContain("by=u-manager");
    expect(quietLines[0]).toContain("what=shift_offer");
  });

  it("preferences that cannot be read push everyone, as before they were read", async () => {
    jest.useFakeTimers({
      now: ONE_AM_ISTANBUL,
      doNotFake: ["nextTick", "setImmediate"],
    });
    const db = seed({ notification_preferences: [quiet(OWNER)] });
    db.errors["notification_preferences:select"] = { message: "offline" };
    const { svc, pushes } = funnel(db);

    await svc.persistForRestaurant(HOUSE, LINE);

    expect(pushes.map((p) => p.ids)).toEqual([[OWNER, COOK]]);
  });

  // F-835: the funnel and sendToUser (F-539) used to carry two copies of this
  // rule. The funnel now asks `pushHolds`, so one implementation decides.
  it("[REVERT-FAILS] the funnel asks pushHolds, and holds whoever it names", async () => {
    const spy = jest
      .spyOn(pushHold, "pushHolds")
      .mockResolvedValue(new Map([[OWNER, "push_off"]]));
    try {
      const db = seed();
      const { svc, pushes } = funnel(db);

      await svc.persistForRestaurant(HOUSE, LINE);

      expect(spy).toHaveBeenCalledWith(
        db.supabase,
        HOUSE,
        [OWNER, COOK],
        expect.any(Function),
      );
      expect(pushes.map((p) => p.ids)).toEqual([[COOK]]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("F-530 — a push never carries house money", () => {
  it("credit due, landed cost and prices in a row's metadata stay off the phone", async () => {
    const db = seed();
    const { svc, pushes } = funnel(db);

    await svc.persistForRestaurant(HOUSE, {
      ...LINE,
      metadata: {
        orderId: "o1",
        creditDue: 120,
        effectiveUnitCost: 18.5,
        price: 22,
        matchStatus: "qty_short",
      },
    });

    expect(pushes).toHaveLength(1);
    expect(pushes[0].data).toEqual({
      type: "inventory_low_stock",
      actionUrl: null,
      orderId: "o1",
      // F-523: the house it belongs to rides last, and carries no money.
      // F-1696: nothing but route ids rides from metadata (`matchStatus` too).
      restaurantId: HOUSE,
    });
    // The row itself keeps them, for the people the writer addressed.
    expect(db.tables.notifications[0].metadata.creditDue).toBe(120);
  });

  it("a day's takings and an invoice's tie-out gap stay off the phone (F-1121)", async () => {
    const db = seed();
    const { svc, pushes } = funnel(db);

    await svc.persistForRestaurant(HOUSE, {
      ...LINE,
      metadata: { documentId: "d1", revenue: 4210.5, tieOutDelta: 12.4 },
    });

    expect(pushes).toHaveLength(1);
    expect(pushes[0].data).not.toHaveProperty("revenue");
    expect(pushes[0].data).not.toHaveProperty("tieOutDelta");
  });

  it("a digest naming every low wine pushes its route only, inside Expo's 4096 bytes (F-1696)", async () => {
    const db = seed();
    const { svc, pushes } = funnel(db);
    const wines = Array.from({ length: 46 }, (_, i) => ({
      inventoryId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      wineId: `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`,
      name: `Kavaklıdere Yakut Öküzgözü Boğazkere ${i}`,
      stock: 1,
      par: 6,
      severity: "critical",
    }));

    await svc.persistForRestaurant(HOUSE, {
      ...LINE,
      actionUrl: "/inventory?filter=low",
      metadata: { digest: true, wines, inventoryId: "inv-1" },
    });

    expect(pushes).toHaveLength(1);
    expect(pushes[0].data).toEqual({
      type: "inventory_low_stock",
      actionUrl: "/inventory?filter=low",
      inventoryId: "inv-1",
      restaurantId: HOUSE,
    });
    const message = {
      title: LINE.title,
      body: LINE.message,
      data: pushes[0].data,
    };
    expect(Buffer.byteLength(JSON.stringify(message))).toBeLessThan(4096);
    // The row keeps the list for the bell.
    expect(db.tables.notifications[0].metadata.wines).toHaveLength(46);
  });

  it("a writer's pushBody is the push's body; the bell row keeps the whole message (F-1709)", async () => {
    const db = seed();
    const { svc, pushes } = funnel(db);
    const message = `Just crossed below par: ${Array.from(
      { length: 120 },
      (_, i) => `Kavaklıdere Yakut Öküzgözü Boğazkere ${i} (1/6)`,
    ).join(", ")}`;

    await svc.persistForRestaurant(
      HOUSE,
      { ...LINE, message },
      { pushBody: "Just crossed below par: A (1/6) and 119 more" },
    );

    expect(pushes).toHaveLength(1);
    expect(pushes[0].body).toBe("Just crossed below par: A (1/6) and 119 more");
    expect(
      Buffer.byteLength(
        JSON.stringify({
          title: LINE.title,
          body: pushes[0].body,
          data: pushes[0].data,
        }),
      ),
    ).toBeLessThan(4096);
    expect(db.tables.notifications[0].message).toBe(message);
  });

  it("names its house, so an owner of two houses tells their pushes apart (F-1630)", async () => {
    const db = seed();
    const { svc, pushes } = funnel(db);

    await svc.persistForRestaurant(HOUSE, LINE);

    expect(pushes).toHaveLength(1);
    // ExpoPushService puts the house's name in the title when `house` is set.
    expect(pushes[0].house).toBe(HOUSE);
  });

  it("names its house on the one-person path too: approvals, counter-offers (F-1630)", async () => {
    const db = seed();
    const { svc, pushes } = funnel(db);

    await svc.sendToUser(
      OWNER,
      { type: "order_approval", title: "Approve order", body: "Narince x6" },
      HOUSE,
    );

    expect(pushes).toHaveLength(1);
    expect(pushes[0].house).toBe(HOUSE);
  });

  it("a push with no house pushes as before, unnamed (F-1630)", async () => {
    const db = seed();
    const { svc, pushes } = funnel(db);

    await svc.sendToUser(
      OWNER,
      { type: "order_approval", title: "Approve order", body: "Narince x6" },
      null,
    );

    expect(pushes).toHaveLength(1);
    expect(pushes[0].house).toBeUndefined();
  });
});

describe("F-526 — a line clears when its thing is dealt with", () => {
  it("the receiving door books the order: the 'Name the item' line clears for every owner and manager", async () => {
    const db = seed({
      delivery_item_to_name: [
        { id: "ask-1", restaurant_id: HOUSE, order_id: "o1", status: "open" },
      ],
      notifications: [
        {
          id: "n1",
          restaurant_id: HOUSE,
          user_id: OWNER,
          status: "unread",
          group_key: "delivery_item_to_name:o1",
        },
        {
          id: "n2",
          restaurant_id: HOUSE,
          user_id: COOK,
          status: "unread",
          group_key: "delivery_item_to_name:o1",
        },
        {
          id: "n3",
          restaurant_id: HOUSE,
          user_id: OWNER,
          status: "unread",
          group_key: "delivery_item_to_name:o2",
        },
      ],
    });

    const out = await closeDeliveryItemToNameBookedElsewhere(db.supabase, {
      restaurantId: HOUSE,
      orderId: "o1",
      via: "receiving_door",
    });

    expect(out).toEqual({ ok: true, closed: true });
    const status = Object.fromEntries(
      db.tables.notifications.map((r) => [r.id, r.status]),
    );
    expect(status).toEqual({ n1: "read", n2: "read", n3: "unread" });
  });

  function lowStock(
    db: StubDb,
    low: Array<{ id: string; wine_id: string }>,
    readFails = false,
  ) {
    // The low list is a stub table, so the read pages the way PostgREST
    // answers it, `max_rows` included (F-1122).
    db.tables.v_low_stock_items = low.map((r) => ({
      ...r,
      restaurant_id: HOUSE,
      stock_live: 1,
      threshold_min: 6,
      wine_name: "Narince",
    }));
    if (readFails)
      db.errors["v_low_stock_items:select"] = { message: "view offline" };
    const supabase = db.supabase;
    const svc = new LowStockAlertsService(
      { supabase } as any,
      {
        persistForRestaurant: jest
          .fn()
          .mockResolvedValue({ inserted: 0, ids: [] }),
      } as any,
      { get: () => undefined } as any,
      {} as any,
      {} as any,
    );
    (svc as any).logger = {
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
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
        lowLine("recovered", [
          { inventoryId: "inv-narince", wineId: "w-narince" },
        ]),
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

    const status = Object.fromEntries(
      db.tables.notifications.map((r) => [r.id, r.status]),
    );
    expect(status).toEqual({
      recovered: "read",
      partly: "unread",
      "old-shape": "read",
    });
  });

  it("a failed low-stock read clears nothing: an empty answer is not 'nothing is low'", async () => {
    const db = seed({
      notifications: [
        lowLine("recovered", [
          { inventoryId: "inv-narince", wineId: "w-narince" },
        ]),
      ],
    });
    const svc = lowStock(db, [], true);

    await svc.runEdgeSweep();

    expect(db.tables.notifications[0].status).toBe("unread");
    // Nor is any wine's alert level reset, or it would alert again (F-1122).
    expect((svc as any).reconcileRecoveries).not.toHaveBeenCalled();
  });

  it("past PostgREST's 1000-row cap, a wine that is still low keeps its line (F-1122)", async () => {
    const low = Array.from({ length: 1001 }, (_, i) => {
      const n = String(i).padStart(4, "0");
      return { id: `inv-${n}`, wine_id: `w-${n}` };
    });
    const db = seed({
      notifications: [
        lowLine("past-the-cap", [
          { inventoryId: "inv-1000", wineId: "w-1000" },
        ]),
        lowLine("recovered", [{ inventoryId: "inv-gone", wineId: "w-gone" }]),
      ],
    });
    db.rowCap = { v_low_stock_items: 1000 };
    const svc = lowStock(db, low);

    await svc.runEdgeSweep();

    const status = Object.fromEntries(
      db.tables.notifications.map((r) => [r.id, r.status]),
    );
    expect(status).toEqual({ "past-the-cap": "unread", recovered: "read" });
    const seen: Map<string, unknown[]> = (svc as any).reconcileRecoveries.mock
      .calls[0][0];
    expect(seen.get(HOUSE)).toHaveLength(1001);
  });
});
