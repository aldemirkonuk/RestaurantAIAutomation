/**
 * A purchasing figure is in the house's money: an order in another currency
 * is never added to it, never converted, and never dropped from it in
 * silence. It is counted and named as "not in house currency", and the
 * figure it would have joined is withheld with that sentence.
 *
 * Before: `purchase_spend` summed `procurement_orders.total_cost` with no
 * currency filter, so a lira house with one euro order read lira plus euros
 * as lira (r22 gateway-message-money, left list).
 */
import { GoalsService } from "./goals.service";
import {
  HouseMoneyUnreadError,
  UncostedOrdersError,
  orderCurrency,
  orderHouseCostOrNull,
  orderInOtherMoney,
  unsummedOrdersSentence,
} from "./order-cost";
import { HOUSE, db, house, order } from "./__fixtures__/order-money-db";

describe("an order's money", () => {
  it("reads the order's own code, or none", () => {
    expect(orderCurrency({ currency: "EUR" })).toBe("EUR");
    expect(orderCurrency({ currency: " try " })).toBe("TRY");
    expect(orderCurrency({ currency: null })).toBeNull();
    expect(orderCurrency({ currency: "euro" })).toBeNull();
    expect(orderCurrency({})).toBeNull();
  });

  it("an order in the house's code, or naming none, is the house's money", () => {
    expect(orderInOtherMoney({ currency: "TRY" }, "TRY")).toBeNull();
    expect(orderInOtherMoney({ currency: null }, "TRY")).toBeNull();
    expect(orderInOtherMoney({ currency: "EUR" }, "TRY")).toBe("EUR");
    // A house that names no currency: an order that names one is not in it.
    expect(orderInOtherMoney({ currency: "EUR" }, null)).toBe("EUR");
    expect(orderInOtherMoney({ currency: null }, null)).toBeNull();
  });

  it("an order in other money has no house cost; never converted", () => {
    expect(
      orderHouseCostOrNull({ total_cost: 840, currency: "EUR" }, "TRY"),
    ).toBeNull();
    expect(
      orderHouseCostOrNull({ total_cost: 840, currency: "TRY" }, "TRY"),
    ).toBe(840);
    expect(
      orderHouseCostOrNull({ total_cost: 840, currency: null }, "TRY"),
    ).toBe(840);
  });

  it("the sentence counts and names what is not in house currency", () => {
    expect(unsummedOrdersSentence(0, 5)).toBeNull();
    expect(unsummedOrdersSentence(0, 5, { EUR: 1 }, "TRY")).toBe(
      "Purchasing spend could not be summed: 1 of the 5 delivered orders in this window is not in house currency (1 in EUR; the house keeps TRY), and nothing here converts one currency into another, so a total would mix two monies or leave that order out.",
    );
    expect(unsummedOrdersSentence(2, 9, { USD: 1, EUR: 3 }, "TRY")).toContain(
      "4 of the 9 delivered orders in this window are not in house currency (3 in EUR and 1 in USD; the house keeps TRY)",
    );
    expect(unsummedOrdersSentence(2, 9, { EUR: 3 }, "TRY")).toContain(
      "2 carry no recorded cost",
    );
    expect(unsummedOrdersSentence(0, 2, { EUR: 1 }, null)).toContain(
      "the house has not named its currency in Settings",
    );
    expect(unsummedOrdersSentence(0, 2, { EUR: 1 }, null, true)).toContain(
      "the house's own currency could not be read",
    );
    // The uncosted-only sentence is the one the goal already said.
    expect(new UncostedOrdersError(2, 1500).message).toBe(
      "Purchasing spend could not be summed: 2 of the 1500 delivered orders in this window carry no recorded cost, so a total would be short rather than true. Record what those orders cost to read it.",
    );
  });
});

const goals = (client: any) =>
  new GoalsService(
    { getClient: () => client } as any,
    { getStored: async () => [] } as any,
    { get: () => undefined } as any,
    {} as any,
    { record: () => {} } as any,
    {} as any,
  ) as any;

const goalRead = (client: any) =>
  goals(client).computeMetricWithSeries(
    HOUSE,
    "purchase_spend",
    "2026-10-01",
    "2026-11-12",
    "UTC",
    { withSales: true },
  );

describe("a purchases goal is read in the house's money", () => {
  it("sums the house's orders and the orders that name no currency", async () => {
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: [order("a", 5, 100, "TRY"), order("b", 6, 50, null)],
    });
    expect((await goalRead(client)).current).toBe(150);
  });

  it("refuses a window that holds a euro order in a lira house, naming it", async () => {
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: [
        order("a", 5, 100, "TRY"),
        order("b", 6, 50, null),
        order("c", 7, 840, "EUR"),
      ],
    });
    const err = await goalRead(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UncostedOrdersError);
    expect((err as UncostedOrdersError).otherMoney).toEqual({ EUR: 1 });
    expect((err as UncostedOrdersError).uncosted).toBe(0);
    expect((err as Error).message).toContain(
      "1 of the 3 delivered orders in this window is not in house currency (1 in EUR; the house keeps TRY)",
    );
  });

  it("an unreadable house currency refuses the reading, never sums it as 0", async () => {
    const client = db(
      {
        restaurants: house("TRY"),
        procurement_orders: [order("a", 5, 100, "TRY")],
      },
      new Set(["restaurants"]),
    );
    const err = await goalRead(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HouseMoneyUnreadError);
  });

  it("does not read the house's currency when no order names one", async () => {
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: [order("a", 5, 100, null)],
    });
    expect((await goalRead(client)).current).toBe(100);
    expect(client.reads.restaurants ?? 0).toBe(0);
  });

  it("a stored goal reads 'could not be read' with the sentence", async () => {
    const client = db({
      restaurants: house("TRY"),
      procurement_orders: [order("c", 7, 840, "EUR")],
    });
    const svc = goals(client);
    svc.getGoalProgress = async () => {
      await goalRead(client);
    };
    svc.listGoals = async () => [{ id: "g1", metric_key: "purchase_spend" }];
    const out = await svc.listGoalsWithProgress(HOUSE);
    expect(out.goals[0].unreadable).toBe(true);
    expect(out.goals[0].reason).toContain("not in house currency (1 in EUR");
  });
});
