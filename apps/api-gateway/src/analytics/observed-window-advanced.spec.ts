import { AdvancedAnalyticsService } from "./advanced-analytics.service";
/** r36 reports audit, gap 1, second half: menu speed and the week's shape. */

const day = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString().substring(0, 10);
const RID = "r-young";

/** A client that answers only the first-record read. */
function firstLineClient(first: string | null | Error) {
  return {
    from: (table: string) => {
      if (table !== "wine_consumption_log")
        throw new Error(`unexpected read of ${table}`);
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.order = () => b;
      b.limit = async () =>
        first instanceof Error
          ? { data: null, error: { message: first.message } }
          : {
              data: first == null ? [] : [{ created_at: `${first}T19:00:00Z` }],
              error: null,
            };
      return b;
    },
  };
}

/** `n` days of `perDay` bottles of one good, the last day being today. */
function lines(n: number, perDay: number) {
  return Array.from({ length: n }, (_, i) => ({
    masterWineId: "mw-1",
    wineId: "mw-1",
    inventoryId: "inv-1",
    qty: perDay,
    how: "bottle",
    servings: perDay,
    volumeMl: perDay * 750,
    date: day(n - 1 - i),
  }));
}

function advanced(first: string | null, n: number) {
  const svc = new AdvancedAnalyticsService(
    { getClient: () => firstLineClient(first) } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  jest.spyOn(svc as any, "loadConsumption").mockResolvedValue(lines(n, 2));
  jest.spyOn(svc as any, "loadInventoryWithCost").mockResolvedValue([
    {
      id: "inv-1",
      name: "House red",
      type: "red",
      masterWineId: "mw-1",
      unitPrice: 30,
      unitCost: 10,
      costBasis: "invoiced_lot",
      marginPerBottle: 20,
    },
  ]);
  return svc;
}

describe("menu speed and the week's shape in a young house", () => {
  it("menu speed is sold ÷ the days since the first line", async () => {
    const out: any = await advanced(day(6), 7).getMenuEngineering(RID, 90);
    expect(out.items[0].velocityPerDay).toBeCloseTo(2, 9);
    expect(out.basis.velocity).toContain(`over 7 days since ${day(6)}`);
  });

  it("an established house's menu speed is still sold ÷ 90", async () => {
    const out: any = await advanced(day(300), 7).getMenuEngineering(RID, 90);
    expect(out.items[0].velocityPerDay).toBeCloseTo(14 / 90, 9);
    expect(out.basis.velocity).toMatch(/^bottles\/day over 90d — /);
  });

  it("flat sales in a 7-day house draw no trend, not +16% a day", async () => {
    const out: any = await seasonality(day(7), 7);
    expect(out.trendPerDayPct).toBeNull();
    expect(out.basis.trend).toContain("7 days of records");
    expect(out.observed).toMatchObject({ observedDays: 7, young: true });
  });

  it("flat sales over 30 days read a flat trend and a weekday mean of 2", async () => {
    const out: any = await seasonality(day(30), 30);
    expect(out.trendPerDayPct).toBeCloseTo(0, 9);
    for (const p of out.weekdayProfile) expect(p.mean).toBeCloseTo(2, 9);
  });
});

async function seasonality(first: string, n: number) {
  const client: any = firstLineClient(first);
  const inner = client.from;
  client.from = (t: string) => {
    if (t !== "restaurant_inventory") return inner(t);
    const b: any = {};
    b.select = () => b;
    b.eq = () => Promise.resolve({ data: [], error: null });
    return b;
  };
  const svc = new AdvancedAnalyticsService(
    { getClient: () => client } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  jest.spyOn(svc as any, "loadConsumption").mockResolvedValue(
    Array.from({ length: n }, (_, i) => ({
      wineId: "mw-1",
      inventoryId: "inv-1",
      qty: 2,
      how: "bottle",
      date: day(n - i),
    })),
  );
  return svc.getSeasonality(RID, 90);
}
