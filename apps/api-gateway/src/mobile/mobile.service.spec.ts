import { MobileService } from "./mobile.service";

/**
 * F-341: the mobile feed's order card printed "$1,240" for every house. The
 * amount is now in the house's own money (`restaurants.currency`), and with
 * no symbol when none is recorded.
 */
function serviceFor(currency: string | null) {
  const rows: Record<string, any[]> = {
    providers: [{ id: "p1", name: "Acme Wines" }],
    restaurants: [{ currency }],
  };
  const supabase = {
    from: (table: string) => {
      const b: any = {};
      for (const m of ["select", "eq", "in", "limit"]) b[m] = () => b;
      b.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows[table] ?? [], error: null }).then(
          resolve,
          reject,
        );
      return b;
    },
  };
  return new MobileService(
    { supabase } as any,
    {
      listPendingOrders: async () => [
        {
          id: "o1",
          orderNumber: "PO-1",
          wineName: "Barolo",
          providerId: "p1",
          quantity: 2,
          unitType: "case",
          totalCost: 1240,
          requestedAt: "2026-10-08T10:00:00.000Z",
        },
      ],
    } as any,
    { getPendingConversations: async () => [] } as any,
    { getUnreadNotifications: async () => [] } as any,
    {} as any,
  );
}

describe("MobileService feed — an order's amount in the house's money", () => {
  it("prints a pound house's order in pounds", async () => {
    const feed = await serviceFor("GBP").getFeed("u1", "r1");
    expect(feed.items[0].subtitle).toBe("2 cases · Acme Wines · £1,240");
  });

  it("prints a house with no recorded currency with no symbol, never a dollar", async () => {
    const feed = await serviceFor(null).getFeed("u1", "r1");
    expect(feed.items[0].subtitle).toBe("2 cases · Acme Wines · 1,240");
  });
});
