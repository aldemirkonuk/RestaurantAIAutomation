import {
  routeForActionUrl,
  routeForNotificationData,
  openNotificationTap,
  deliveryToResolve,
} from "@/lib/notificationRoute";

describe("routeForActionUrl", () => {
  it("returns null for nothing", () => {
    expect(routeForActionUrl(null)).toBeNull();
    expect(routeForActionUrl(undefined)).toBeNull();
    expect(routeForActionUrl("")).toBeNull();
  });

  // Every literal below is an actionUrl the gateway actually writes —
  // grep `actionUrl:` across apps/api-gateway/src.
  it.each([
    ["/orders", "/supply"],
    ["/orders/1234", "/supply/1234"],
    ["/orders?order=abc", "/supply/abc"],
    ["/orders?highlight=xyz", "/supply/xyz"],
    ["/orders?order=abc&deal=1&urgent=1", "/supply/abc"],
    ["/orders?status=invoiced", "/supply"],
    ["/orders?tab=recurring", "/supply"],
    ["/inventory", "/cellar"],
    ["/inventory/wine-x", "/cellar/wine-x"],
    ["/inventory?filter=low-stock", "/cellar"],
    ["/inventory?highlight=item-9", "/cellar/item-9"],
    ["/inventory?verify=order-7", "/cellar/receive/order-7"],
    ["/team", "/team"],
    ["/team?shift=s1", "/team"],
    ["/team?schedule=s1&week=2026-08-24", "/team"],
    ["/reports?type=weekly", "/insights"],
    ["/notifications", "/notifications"],
    ["/settings", "/settings"],
  ])("maps %s to %s", (input, expected) => {
    expect(routeForActionUrl(input)).toBe(expected);
  });

  it("prefers the receiving flow over the wine detail when both could match", () => {
    expect(routeForActionUrl("/inventory?verify=o1&highlight=w1")).toBe(
      "/cellar/receive/o1",
    );
  });

  it("decodes percent-encoded ids", () => {
    expect(routeForActionUrl("/orders?order=a%2Fb")).toBe("/supply/a/b");
  });

  it("tolerates a trailing slash", () => {
    expect(routeForActionUrl("/orders/")).toBe("/supply");
  });

  it("returns null for surfaces mobile does not have", () => {
    for (const url of [
      "/promotions",
      "/promotions?tab=prospects",
      "/providers",
      "/vendor-prices",
      "/logs",
      "/admin",
    ]) {
      expect(routeForActionUrl(url)).toBeNull();
    }
  });
});

describe("routeForNotificationData", () => {
  it("sends an invoice to the receiving flow", () => {
    expect(
      routeForNotificationData({ type: "invoice_received", orderId: "o1" }),
    ).toBe("/cellar/receive/o1");
  });

  it("accepts snake_case ids from the server", () => {
    expect(routeForNotificationData({ order_id: "o2" })).toBe("/supply/o2");
    expect(routeForNotificationData({ inventory_id: "i2" })).toBe("/cellar/i2");
  });

  it("prefers a structured id over the web actionUrl", () => {
    expect(
      routeForNotificationData({ orderId: "o3", actionUrl: "/team" }),
    ).toBe("/supply/o3");
  });

  it("falls back to translating the actionUrl", () => {
    expect(routeForNotificationData({ actionUrl: "/team?shift=s1" })).toBe(
      "/team",
    );
  });

  // F-1572: the Team tab shows tonight's shift, never the week's note.
  it("opens a manager's week note in the inbox, where its words are", () => {
    expect(
      routeForNotificationData({ type: "team_note", actionUrl: "/team?week=2026-10-12" }),
    ).toBe("/notifications");
  });

  it("lands in the inbox rather than nowhere for an unmappable payload", () => {
    expect(routeForNotificationData({})).toBe("/notifications");
    expect(routeForNotificationData(null)).toBe("/notifications");
    expect(routeForNotificationData({ actionUrl: "/promotions" })).toBe(
      "/notifications",
    );
  });
});

describe("openNotificationTap (F-523)", () => {
  const deps = (currentHouse: string | null, moved = true) => {
    const calls: string[] = [];
    return {
      calls,
      d: {
        currentHouse,
        chooseHouse: jest.fn(async (h: string) => {
          calls.push(`switch:${h}`);
          return moved;
        }),
        navigate: jest.fn((r: string) => void calls.push(`open:${r}`)),
        refused: jest.fn((m: string) => void calls.push(`refused:${m}`)),
      },
    };
  };

  it("opens a push of this house where it points, with no switch", async () => {
    const { d, calls } = deps("house-b");
    await openNotificationTap({ orderId: "o1", restaurantId: "house-b" }, d);
    expect(calls).toEqual(["open:/supply/o1"]);
  });

  it("moves to the push's house BEFORE opening its order", async () => {
    const { d, calls } = deps("house-b");
    await openNotificationTap({ orderId: "o1", restaurantId: "house-a" }, d);
    expect(calls).toEqual(["switch:house-a", "open:/supply/o1"]);
  });

  it("opens nothing, and says so, when the move is refused", async () => {
    const { d, calls } = deps("house-b", false);
    await openNotificationTap({ orderId: "o1", restaurantId: "house-a" }, d);
    expect(calls[0]).toBe("switch:house-a");
    expect(d.navigate).not.toHaveBeenCalled();
    expect(d.refused).toHaveBeenCalledWith(expect.stringMatching(/another of your restaurants/));
  });

  it("opens a push that names no house as before", async () => {
    const { d, calls } = deps("house-b");
    await openNotificationTap({ orderId: "o1" }, d);
    expect(calls).toEqual(["open:/supply/o1"]);
  });
});

describe("name-the-item and delivery pushes open the place they name (F-1309)", () => {
  it("opens the receive screen for 'Name the item', not the order page", () => {
    expect(
      routeForNotificationData({
        type: "delivery_item_to_name",
        orderId: "o1",
        actionUrl: "/inventory?name-delivery=o1",
      }),
    ).toBe("/cellar/receive/o1");
    expect(routeForActionUrl("/inventory?name-delivery=o1")).toBe("/cellar/receive/o1");
  });

  it("asks for a delivery's order only when the push carries none", () => {
    expect(
      deliveryToResolve({ deliveryId: "d1", actionUrl: "/deliveries/d1" }),
    ).toBe("d1");
    expect(
      deliveryToResolve({ deliveryId: "d1", orderId: "o1", actionUrl: "/deliveries/d1" }),
    ).toBeNull();
    expect(deliveryToResolve({ orderId: "o1", actionUrl: "/orders?order=o1" })).toBeNull();
  });

  const tapDeps = (order: string | null | Error) => {
    const calls: string[] = [];
    return {
      calls,
      d: {
        currentHouse: "house-a",
        chooseHouse: jest.fn(async () => true),
        navigate: jest.fn((r: string) => void calls.push(`open:${r}`)),
        refused: jest.fn(),
        deliveryOrder: jest.fn(async (id: string) => {
          calls.push(`read:${id}`);
          if (order instanceof Error) throw order;
          return order;
        }),
      },
    };
  };

  it("opens the order a delivery clock push belongs to", async () => {
    const { d, calls } = tapDeps("o9");
    await openNotificationTap(
      { type: "delivery_clock", deliveryId: "d1", actionUrl: "/deliveries/d1" },
      d,
    );
    expect(calls).toEqual(["read:d1", "open:/supply/o9"]);
  });

  it("stays on the inbox when the delivery has no order or its read fails", async () => {
    for (const answer of [null, new Error("offline")]) {
      const { d, calls } = tapDeps(answer);
      await openNotificationTap(
        { type: "delivery_proposal", deliveryId: "d1", actionUrl: "/deliveries/d1" },
        d,
      );
      expect(calls).toEqual(["read:d1", "open:/notifications"]);
    }
  });
});
