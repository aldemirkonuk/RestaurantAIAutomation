/**
 * The financial summary, the risk profile and the insight feed read
 * purchasing in the house's money: an order not in house currency withholds
 * the figure and is named, never summed or converted (see order-cost.ts).
 */
import { AnalyticsService } from "./analytics.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { stateBookFrom } from "./insights/item-state";
import { HOUSE, NOW, db, house, order } from "./__fixtures__/order-money-db";

describe("the financial summary and risk profile", () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it("leaves delivered purchases blank, naming the euro order", async () => {
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: [
        order("a", 5, 300, "TRY"),
        order("e", 6, 840, "EUR"),
      ],
    });
    const out: any = await new AnalyticsService({
      getClient: () => client,
    } as any).getFinancialSummary(HOUSE);
    expect(out.deliveredPurchases).toBeNull();
    expect(out.basis.deliveredPurchases).toContain(
      "1 of 2 delivered orders is not in house currency (1 in EUR)",
    );
  });

  it("sums a lira-only year", async () => {
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: [order("a", 5, 300, "TRY"), order("b", 6, 40, null)],
    });
    const out: any = await new AnalyticsService({
      getClient: () => client,
    } as any).getFinancialSummary(HOUSE);
    expect(out.deliveredPurchases).toBe(340);
  });

  it("the loader gives a euro order no house cost and names its money", async () => {
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: [
        order("a", 5, 300, "TRY"),
        order("e", 6, 840, "EUR"),
      ],
    });
    const rows = await (
      new AnalyticsService({ getClient: () => client } as any) as any
    ).loadDeliveredOrders(HOUSE, 365);
    const byCost = rows.map((r: any) => [r.cost, r.otherMoney]);
    expect(byCost).toEqual(
      expect.arrayContaining([
        [300, null],
        [null, "EUR"],
      ]),
    );
  });

  it("does not draw vendor shares over a euro order", async () => {
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: [
        order("a", 5, 300, "TRY"),
        order("e", 6, 840, "EUR", { provider_id: "v2" }),
      ],
    });
    const out: any = await new AnalyticsService({
      getClient: () => client,
    } as any).getRiskProfile(HOUSE);
    expect(out.vendorConcentration.hhi).toBeNull();
    expect(out.vendorConcentration.cr4).toBeNull();
    expect(out.vendorConcentration.interpretation).toContain(
      "not in house currency",
    );
  });
});

describe("the insight feed's purchasing family", () => {
  const generator = (client: any) =>
    new InsightGeneratorService(
      { getClient: () => client, supabase: client } as any,
      {
        load: async () => ({ dates: new Set(), readable: true, problem: null }),
      } as any,
      {
        readState: async () => ({
          book: stateBookFrom([]),
          readable: true,
          problem: null,
        }),
      } as any,
    );

  it("holds spend back while an order is not in house currency, and says so", async () => {
    const orders = Array.from({ length: 20 }, (_, i) =>
      order(`a${i}`, i + 1, 100, "TRY"),
    );
    orders.push(order("e", 3, 840, "EUR"));
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: orders,
    });
    const out: any = await generator(client).generate(HOUSE, {
      persist: false,
      maxPerCategory: 1000,
    });
    expect(out.spendWithheld.vendorShare).toMatchObject({
      uncostedOrders: 0,
      notInHouseCurrency: { EUR: 1 },
      orders: 21,
    });
    expect(out.spendWithheld.trend.reason).toContain(
      "not in house currency (1 in EUR; the house keeps TRY)",
    );
  });

  it("the bundle gives a euro order no house cost", async () => {
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: [
        order("a", 5, 300, "TRY"),
        order("e", 6, 840, "EUR"),
      ],
    });
    const bundle = await (generator(client) as any).loadBundle(HOUSE);
    expect(bundle.orders.map((o: any) => [o.cost, o.otherMoney])).toEqual(
      expect.arrayContaining([
        [300, null],
        [null, "EUR"],
      ]),
    );
  });

  it("holds nothing back when every order is the house's", async () => {
    const orders = Array.from({ length: 20 }, (_, i) =>
      order(`a${i}`, i + 1, 100, i % 2 ? "TRY" : null),
    );
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: orders,
    });
    const out: any = await generator(client).generate(HOUSE, {
      persist: false,
      maxPerCategory: 1000,
    });
    expect(out.spendWithheld).toBeNull();
  });
});
