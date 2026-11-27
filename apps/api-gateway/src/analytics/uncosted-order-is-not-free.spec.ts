import { GoalsService } from "./goals.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { stateBookFrom } from "./insights/item-state";
import { UncostedOrdersError, orderCostOrNull } from "./order-cost";
import { cappedPostgrest } from "../common/testing/capped-postgrest";

/**
 * Readers lane r4: a delivered order with no recorded cost is unknown, never
 * $0. `purchase_spend` summed `o.total_cost || o.final_price || 0`, so an
 * uncosted order made a "keep purchases under" goal read lower than the truth,
 * and the insight feed drew a drop in spend and a smaller vendor share.
 */

const HOUSE = "house-1";

function order(
  i: number,
  cost: { total_cost?: unknown; final_price?: unknown },
  at = `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00Z`,
  provider = `v${i % 3}`,
) {
  return {
    id: `ord-${String(i).padStart(5, "0")}`,
    restaurant_id: HOUSE,
    status: "DELIVERED",
    provider_id: provider,
    providers: { name: `Vendor ${provider}` },
    bottles_total: 12,
    quantity: 12,
    total_cost: null,
    final_price: null,
    ...cost,
    created_at: at,
    delivered_at: at,
  };
}

const goalRead = (orders: any[]) =>
  (
    new GoalsService(
      { getClient: () => cappedPostgrest({ procurement_orders: orders }) } as any,
      { getStored: async () => [] } as any,
      { get: () => undefined } as any,
      {} as any,
      { record: () => {} } as any,
      {} as any,
    ) as any
  ).computeMetricWithSeries(HOUSE, "purchase_spend", "2026-01-01", "2026-09-30", "UTC", { withSales: true });

describe("orderCostOrNull", () => {
  it("reads total_cost first, then final_price", () => {
    expect(orderCostOrNull({ total_cost: 40, final_price: 30 })).toBe(40);
    expect(orderCostOrNull({ total_cost: null, final_price: 30 })).toBe(30);
    expect(orderCostOrNull({ total_cost: "12.50" })).toBe(12.5);
  });

  it("is null for no cost, a 0, a blank or a non-number: never $0", () => {
    expect(orderCostOrNull({})).toBeNull();
    expect(orderCostOrNull({ total_cost: 0, final_price: 0 })).toBeNull();
    expect(orderCostOrNull({ total_cost: "", final_price: null })).toBeNull();
    expect(orderCostOrNull({ total_cost: "n/a" })).toBeNull();
    expect(orderCostOrNull({ total_cost: -5 })).toBeNull();
  });
});

describe("a purchases goal never counts an uncosted order as $0", () => {
  it("refuses, naming how many of the window's orders wait on a cost", async () => {
    const orders = Array.from({ length: 1500 }, (_, i) =>
      order(i, i === 1400 || i === 7 ? {} : { total_cost: 10 }),
    );
    const err = await goalRead(orders).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UncostedOrdersError);
    expect((err as UncostedOrdersError).uncosted).toBe(2);
    expect((err as UncostedOrdersError).total).toBe(1500);
    expect((err as Error).message).toContain("2 of the 1500 delivered orders");
  });

  it("an order costed only by its settled price counts at that price", async () => {
    const orders = [order(1, { total_cost: 10 }), order(2, { final_price: 25 })];
    expect((await goalRead(orders)).current).toBe(35);
  });

  it("a window where every order is costed still sums whole past 1,000", async () => {
    const orders = Array.from({ length: 1500 }, (_, i) => order(i, { total_cost: 10 }));
    expect((await goalRead(orders)).current).toBe(15000);
  });
});

/** The insight bundle: orders through the capped double, the rest plain. */
function insightGenerator(orders: any[]) {
  const capped = cappedPostgrest({ procurement_orders: orders });
  const plain = (rows: any[]) => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "gt", "gte", "lt", "lte", "is", "or", "not", "order", "limit", "in", "delete", "insert"])
      b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    b.single = b.maybeSingle;
    b.then = (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej);
    return b;
  };
  const client = {
    from: (t: string) => (t === "procurement_orders" ? capped.from(t) : plain([])),
  };
  return new InsightGeneratorService(
    { getClient: () => client, supabase: client } as any,
    { load: async () => ({ dates: new Set(), readable: true, problem: null }) } as any,
    { readState: async () => ({ book: stateBookFrom([]), readable: true, problem: null }) } as any,
  );
}

const daysBack = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString().slice(0, 10) + "T10:00:00.000Z";

describe("the insight feed's purchasing family", () => {
  // Two vendors, one holding most of the spend, over 60 days: enough for the
  // vendor-share insight to fire when every order is costed.
  const costed = Array.from({ length: 60 }, (_, i) =>
    order(i, { total_cost: i % 4 === 0 ? 50 : 400 }, daysBack(i + 1), i % 4 === 0 ? "small" : "big"),
  );

  it("fires on costed orders (the control: the fixture can fire)", async () => {
    const out: any = await insightGenerator(costed).generate(HOUSE, { persist: false, maxPerCategory: 1000 });
    expect(out.spendWithheld).toBeNull();
    expect(out.insights.some((i: any) => String(i.type ?? i.candidateKey).includes("purchase_spend"))).toBe(true);
  });

  it("says nothing about spend while an order waits on a cost, and says why", async () => {
    const withOne = [...costed, order(999, {}, daysBack(3), "big")];
    const out: any = await insightGenerator(withOne).generate(HOUSE, { persist: false, maxPerCategory: 1000 });
    expect(out.spendWithheld.trend).toMatchObject({ uncostedOrders: 1, orders: 61 });
    expect(out.spendWithheld.vendorShare).toMatchObject({ uncostedOrders: 1, orders: 61 });
    expect(out.spendWithheld.trend.reason).toContain("1 of the 61 delivered orders");
    expect(out.insights.some((i: any) => String(i.type ?? i.candidateKey).includes("purchase_spend"))).toBe(false);
  });

  it("reads the orders past 1,000", async () => {
    const many = Array.from({ length: 1200 }, (_, i) =>
      order(i, { total_cost: 10 }, daysBack(1 + (i % 150))),
    );
    // One uncosted order sitting past the first thousand rows: an unranged
    // read never saw it and fired on the rest.
    many.push(order(5000, {}, daysBack(2)));
    const out: any = await insightGenerator(many).generate(HOUSE, { persist: false, maxPerCategory: 1000 });
    expect(out.spendWithheld.vendorShare).toMatchObject({ uncostedOrders: 1, orders: 1201 });
  });

  // Fix round: each insight is held back only by an uncosted order inside the
  // window it reads, not by one anywhere in the bundle's 180 days.
  it("an uncosted order older than the trend's 90 days holds back only the vendor share", async () => {
    const withOld = [...costed, order(998, {}, daysBack(120), "big")];
    const out: any = await insightGenerator(withOld).generate(HOUSE, { persist: false, maxPerCategory: 1000 });
    expect(out.spendWithheld.trend).toBeNull();
    expect(out.spendWithheld.vendorShare).toMatchObject({ uncostedOrders: 1, orders: 61 });
    const types = out.insights.map((i: any) => String(i.type ?? i.candidateKey));
    expect(types.some((t: string) => t.includes("concentration"))).toBe(false);
    expect(types.some((t: string) => t.includes("purchase_spend") && !t.includes("concentration"))).toBe(true);
  });

  it("an uncosted order dated today is on neither the trend nor held against it", async () => {
    const withToday = [...costed, order(997, {}, new Date().toISOString(), "big")];
    const out: any = await insightGenerator(withToday).generate(HOUSE, { persist: false, maxPerCategory: 1000 });
    expect(out.spendWithheld.trend).toBeNull();
    expect(out.spendWithheld.vendorShare).toMatchObject({ uncostedOrders: 1 });
  });
});

/** A goals service that can create a purchases goal over `orders`. */
function goalCreator(orders: any[], seen: { patch: Record<string, unknown> }) {
  const capped = cappedPostgrest({ procurement_orders: orders });
  const house: any = {
    select: () => house,
    eq: () => house,
    maybeSingle: async () => ({ data: { timezone: "UTC", country: "US" }, error: null }),
  };
  const goals: any = {
    insert: (patch: Record<string, unknown>) => ((seen.patch = patch), goals),
    select: () => goals,
    single: async () => ({ data: { id: "g1", ...seen.patch }, error: null }),
  };
  const client = {
    from: (t: string) =>
      t === "procurement_orders" ? capped.from(t) : t === "restaurants" ? house : goals,
  };
  return new GoalsService(
    { getClient: () => client } as any,
    { getStored: async () => [] } as any,
    { get: () => undefined } as any,
    {} as any,
    { record: () => {} } as any,
    {} as any,
  );
}

describe("creating a purchases goal over an uncosted order", () => {
  const input = { name: "Keep purchases under $25k", metricKey: "purchase_spend", targetValue: 25000, direction: "at_most" as const };

  it("creates the goal with its baseline unread and the reason, never a $0 baseline", async () => {
    const seen = { patch: {} as Record<string, unknown> };
    const orders = [order(1, { total_cost: 400 }, daysBack(5)), order(2, {}, daysBack(4))];
    const goal: any = await goalCreator(orders, seen).createGoal(HOUSE, input, { withSales: true });
    expect(goal.id).toBe("g1");
    expect(seen.patch.baseline_value).toBeNull();
    expect(seen.patch.current_value).toBeNull();
    expect(String(seen.patch.current_unread)).toContain("1 of the 2 delivered orders");
    expect(GoalsService.presentStoredReading(goal).current_value).toBeNull();
  });

  it("a fully costed window stores the measured baseline and no refusal", async () => {
    const seen = { patch: {} as Record<string, unknown> };
    const orders = [order(1, { total_cost: 400 }, daysBack(5)), order(2, { final_price: 100 }, daysBack(4))];
    await goalCreator(orders, seen).createGoal(HOUSE, input, { withSales: true });
    expect(seen.patch.baseline_value).toBe(500);
    expect(seen.patch.current_unread).toBeNull();
  });

  it("a read that failed still refuses the goal (only the uncosted case is stored unread)", async () => {
    const seen = { patch: {} as Record<string, unknown> };
    const svc: any = goalCreator([], seen);
    svc.computeMetric = async () => {
      throw new Error("The delivered orders could not be read");
    };
    await expect(svc.createGoal(HOUSE, input, { withSales: true })).rejects.toThrow(/could not be read/);
    expect(seen.patch).toEqual({});
  });
});
