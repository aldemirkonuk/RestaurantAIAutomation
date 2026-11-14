/**
 * Spend pacing and the vendor scorecard read in the house's money: a window
 * or a vendor that holds an order not in house currency is withheld and
 * names it, never summed with it or without it (see order-cost.ts).
 */
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { HOUSE, NOW, db, house, order } from "./__fixtures__/order-money-db";

const advanced = (client: any) =>
  new AdvancedAnalyticsService(
    { getClient: () => client } as any,
    {} as any,
    {} as any,
    {} as any,
  );

describe("spend pacing and the vendor scorecard", () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it("withholds the window that holds a euro order and sums the other", async () => {
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: [
        order("a", 5, 300, "TRY"),
        order("e", 6, 840, "EUR"),
        order("b", 40, 200, "TRY"),
      ],
    });
    const out: any = await advanced(client).getCashflow(HOUSE);
    expect(out.spendLast30d).toBeNull();
    expect(out.spendPrev30d).toBe(200);
    expect(out.paceDeltaPct).toBeNull();
    expect(out.projectedNext4Weeks).toBeNull();
    expect(out.notInHouseCurrency.last30d).toEqual({ EUR: 1 });
    expect(out.notInHouseCurrency.prev30d).toEqual({});
    expect(out.unread.spendLast30d).toContain(
      "1 of the 2 delivered orders in this window is not in house currency (1 in EUR; the house keeps TRY)",
    );
    expect(out.unread.spendPrev30d).toBeNull();
  });

  it("an open order in other money is not a commitment in the house's", async () => {
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: [
        order("o", 2, 500, "EUR", { status: "CONFIRMED", delivered_at: null }),
      ],
    });
    const out: any = await advanced(client).getCashflow(HOUSE);
    expect(out.committedOpenOrders).toBeNull();
    expect(out.unread.committedOpenOrders).toContain(
      "1 of the 1 open order is not in house currency (1 in EUR; the house keeps TRY)",
    );
  });

  it("a vendor's spend and unit price never take a euro order", async () => {
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: [
        order("a", 5, 300, "TRY"),
        order("e", 6, 840, "EUR", {
          provider_id: "v2",
          providers: { name: "Vendor two" },
        }),
        order("f", 9, 100, "TRY", {
          provider_id: "v2",
          providers: { name: "Vendor two" },
        }),
      ],
    });
    const out: any = await advanced(client).getVendorScorecard(HOUSE);
    const one = out.vendors.find((v: any) => v.vendorId === "v1");
    const two = out.vendors.find((v: any) => v.vendorId === "v2");
    expect(one.spend).toBe(300);
    expect(two.spend).toBeNull();
    expect(two.notInHouseCurrency).toBe(1);
    expect(two.spendUnread).toContain(
      "1 of the 2 delivered orders in this window is not in house currency (1 in EUR",
    );
    // The unit price is the lira order's alone: 100 / 10, never 84 from euros.
    expect(two.unitPrice.mean).toBe(10);
    expect(out.concentration.hhi).toBeNull();
    expect(out.concentration.unread).toContain("not in house currency");
  });
});
