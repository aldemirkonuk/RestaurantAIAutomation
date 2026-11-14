import { AnalyticsService } from "./analytics.service";
/** r36 reports audit, gap 1: the probe is a 2-a-day good in a 7-day-old house. */
import {
  MIN_PLAN_DAYS,
  MIN_RATE_DAYS,
  observedWindow,
  readFirstRecord,
  trimToObserved,
  windowWords,
} from "./observed-window";

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

function analytics(first: string | null | Error, n: number, onHand: number) {
  const svc = new AnalyticsService({
    getClient: () => firstLineClient(first),
  } as any);
  jest.spyOn(svc as any, "loadInventory").mockResolvedValue([
    {
      id: "inv-1",
      name: "House red",
      type: "red",
      qty: onHand,
      unitCost: 10,
      costBasis: "invoiced_lot",
      unitPrice: 30,
      thresholdMin: 0,
      reorderPoint: 0,
      masterWineId: "mw-1",
      inventoryValue: onHand * 10,
    },
  ]);
  jest.spyOn(svc as any, "loadConsumption").mockResolvedValue(lines(n, 2));
  return svc;
}

describe("observedWindow: a rate starts at the house's first record", () => {
  const today = day(0);

  it("a house older than the window keeps the whole window", () => {
    const w = observedWindow(90, today, { read: "read", day: day(200) });
    expect(w).toMatchObject({
      observedDays: 90,
      rateDays: 90,
      since: null,
      young: false,
    });
    expect(windowWords(w, "consumption line")).toBe("over 90d");
  });

  it("a 7-day-old house counts 7 days, and is too young to plan from", () => {
    const w = observedWindow(90, today, { read: "read", day: day(6) });
    expect(w).toMatchObject({
      observedDays: 7,
      rateDays: 7,
      since: day(6),
      young: true,
    });
    expect(windowWords(w, "consumption line")).toContain(
      `over 7 days since ${day(6)}`,
    );
  });

  it("a 3-day-old house divides by a week, never by less", () => {
    const w = observedWindow(90, today, { read: "read", day: day(2) });
    expect(w.observedDays).toBe(3);
    expect(w.rateDays).toBe(MIN_RATE_DAYS);
    expect(windowWords(w, "consumption line")).toContain(
      "never taken over less than a week",
    );
  });

  it(`${MIN_PLAN_DAYS} days is old enough to plan from; one fewer is not`, () => {
    expect(
      observedWindow(90, today, { read: "read", day: day(MIN_PLAN_DAYS - 1) })
        .young,
    ).toBe(false);
    expect(
      observedWindow(90, today, { read: "read", day: day(MIN_PLAN_DAYS - 2) })
        .young,
    ).toBe(true);
  });

  it("a house with no line at all keeps the whole window", () => {
    const w = observedWindow(90, today, { read: "read", day: null });
    expect(w).toMatchObject({ observedDays: 90, firstRecord: "none" });
  });

  it("an unreadable first line keeps the whole window and says the rate may run low", () => {
    const w = observedWindow(90, today, { read: "could_not_read", day: null });
    expect(w.observedDays).toBe(90);
    expect(windowWords(w, "consumption line")).toMatch(
      /^over 90d \(the house's first consumption line could not be read/,
    );
  });

  it("trims a dense series to the counted days", () => {
    const w = observedWindow(10, today, { read: "read", day: day(7) });
    const dates = Array.from({ length: 10 }, (_, i) => day(9 - i));
    const out = trimToObserved({ dates, values: dates.map((_, i) => i) }, w);
    expect(out.dates).toEqual(dates.slice(-8));
    expect(out.values).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("readFirstRecord", () => {
  it("reads the first line's day, none, or a failure it never throws", async () => {
    const read = (c: any) => readFirstRecord(c, "wine_consumption_log", RID);
    await expect(read(firstLineClient(day(4)))).resolves.toEqual({
      read: "read",
      day: day(4),
    });
    await expect(read(firstLineClient(null))).resolves.toEqual({
      read: "read",
      day: null,
    });
    await expect(
      read(firstLineClient(new Error("boom"))),
    ).resolves.toMatchObject({ read: "could_not_read", error: "boom" });
    await expect(read(null)).resolves.toMatchObject({ read: "could_not_read" });
  });
});

describe("restock in a 7-day-old house (the audit's probe)", () => {
  it("reads 2 bottles a day, a reorder point of 14 and cover of on hand ÷ 2", async () => {
    const out: any = await analytics(day(6), 7, 10).getInventoryScience(RID);
    const sku = out.skus[0];
    expect(sku.avgDailyDemand).toBeCloseTo(2, 9);
    expect(sku.reorderPoint).toBeCloseTo(14, 9);
    expect(sku.daysOfCover).toBeCloseTo(5, 9);
    expect(sku.needsReorder).toBe(true);
    expect(out.reorderList.map((s: any) => s.id)).toEqual(["inv-1"]);
    expect(out.observed).toMatchObject({ observedDays: 7, young: true });
    expect(out.basis.demand).toContain(`over 7 days since ${day(6)}`);
  });

  it("an established house still divides by the whole window", async () => {
    const out: any = await analytics(day(300), 7, 10).getInventoryScience(RID);
    expect(out.skus[0].avgDailyDemand).toBeCloseTo(14 / 90, 9);
    expect(out.basis.demand).toMatch(/^bottles\/day over 90d — /);
  });

  it("an unreadable first line falls back to the whole window and says so", async () => {
    const out: any = await analytics(
      new Error("down"),
      7,
      10,
    ).getInventoryScience(RID);
    expect(out.skus[0].avgDailyDemand).toBeCloseTo(14 / 90, 9);
    expect(out.basis.demand).toContain("could not be read");
  });
});

describe("the forecast in a young house", () => {
  it("draws only the days since the first line and projects nothing under two weeks", async () => {
    const out: any = await analytics(day(6), 7, 10).getDemandForecast(RID);
    expect(out.history.values).toHaveLength(7);
    expect(out.history.values.every((v: number) => v === 2)).toBe(true);
    expect(out.modelFitted).toBe(false);
    expect(out.totalForecastDemand).toBeNull();
    expect(out.accuracy).toBeNull();
    expect(out.basis.model).toContain("7 days of records");
  });

  it("projects once the house has 30 days, from those 30 days only", async () => {
    const out: any = await analytics(day(29), 30, 10).getDemandForecast(RID);
    expect(out.history.values).toHaveLength(30);
    expect(out.modelFitted).toBe(true);
    // Flat 2 a day projects about 2 a day, not a climb out of 90 zeros.
    expect(out.totalForecastDemand / out.horizon).toBeCloseTo(2, 0);
  });
});
