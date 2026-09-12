import {
  routeForActionUrl,
  routeForNotificationData,
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

  it("lands in the inbox rather than nowhere for an unmappable payload", () => {
    expect(routeForNotificationData({})).toBe("/notifications");
    expect(routeForNotificationData(null)).toBe("/notifications");
    expect(routeForNotificationData({ actionUrl: "/promotions" })).toBe(
      "/notifications",
    );
  });
});
