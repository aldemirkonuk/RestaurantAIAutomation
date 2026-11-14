import { AnalyticsService } from "./analytics.service";
import { addedWords, goodWindow } from "./good-window";
import { observedWindow } from "./observed-window";

/**
 * r36 reports audit, gap 1, the per-good half: a good added last week to a
 * house older than the window had its week of sales divided by 90 days.
 */
const day = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString().substring(0, 10);
const TODAY = day(0);
const OLD_HOUSE = observedWindow(90, TODAY, { read: "read", day: day(300) });
const YOUNG_HOUSE = observedWindow(90, TODAY, { read: "read", day: day(29) });

describe("goodWindow: a good is read from the day it was added", () => {
  it("a good with no added day keeps the house's window", () => {
    expect(goodWindow(OLD_HOUSE, TODAY, null, day(3))).toBe(OLD_HOUSE);
  });

  it("a good added inside an old house's window starts on its added day", () => {
    const w = goodWindow(OLD_HOUSE, TODAY, day(6), day(6));
    expect(w).toMatchObject({ since: day(6), observedDays: 7, rateDays: 7 });
  });

  it("a good added with no line yet still starts on its added day", () => {
    const w = goodWindow(OLD_HOUSE, TODAY, day(20), null);
    expect(w).toMatchObject({ since: day(20), observedDays: 21, rateDays: 21 });
  });

  it("a line before the added day means the row is younger than the good: the house's window stands", () => {
    expect(goodWindow(OLD_HOUSE, TODAY, day(6), day(7))).toBe(OLD_HOUSE);
  });

  it("a line on the added day itself is not before it", () => {
    expect(goodWindow(OLD_HOUSE, TODAY, day(6), day(6)).since).toBe(day(6));
  });

  it("a good added before the window began keeps the house's window", () => {
    expect(goodWindow(OLD_HOUSE, TODAY, day(120), day(80))).toBe(OLD_HOUSE);
  });

  it("in a young house, a good added on or before the house's first line keeps the house's window", () => {
    expect(goodWindow(YOUNG_HOUSE, TODAY, day(29), day(29))).toBe(YOUNG_HOUSE);
    expect(goodWindow(YOUNG_HOUSE, TODAY, day(40), day(20))).toBe(YOUNG_HOUSE);
  });

  it("in a young house, a good added after the house's first line starts later still", () => {
    expect(goodWindow(YOUNG_HOUSE, TODAY, day(10), day(9)).since).toBe(day(10));
  });

  it("a good added today still divides by a week", () => {
    const w = goodWindow(OLD_HOUSE, TODAY, TODAY, TODAY);
    expect(w).toMatchObject({ observedDays: 1, rateDays: 7 });
  });
});

describe("addedWords", () => {
  it("says nothing when no good was added inside the window", () => {
    expect(addedWords(0)).toBe("");
  });
  it("names one good in the singular", () => {
    expect(addedWords(1)).toBe(
      "; 1 good was added to the house's list inside the window and is read from the day it was added (skus[].demandSince), not over days it was not on it",
    );
  });
  it("names several in the plural", () => {
    expect(addedWords(2)).toBe(
      "; 2 goods were added to the house's list inside the window and are read from the day they were added (skus[].demandSince), not over days they were not on it",
    );
  });
});

/** `n` days of `perDay` bottles of good `mw`, the last day being today. */
function lines(mw: string, n: number, perDay: number, endAgo = 0) {
  return Array.from({ length: n }, (_, i) => ({
    masterWineId: mw,
    wineId: mw,
    inventoryId: `inv-${mw}`,
    qty: perDay,
    how: "bottle",
    servings: perDay,
    volumeMl: perDay * 750,
    date: day(endAgo + n - 1 - i),
  }));
}

function good(mw: string, onHand: number, addedAt: string | null | undefined) {
  return {
    id: `inv-${mw}`,
    name: mw,
    type: "red",
    qty: onHand,
    unitCost: 10,
    costBasis: "invoiced_lot",
    unitPrice: 30,
    thresholdMin: 0,
    reorderPoint: 0,
    masterWineId: mw,
    providerId: null,
    inventoryValue: onHand * 10,
    ...(addedAt === undefined ? {} : { addedAt }),
  };
}

/** A house whose first line was 300 days ago, older than the 90-day window. */
function oldHouse(inventory: unknown[], consumption: unknown[]) {
  const svc = new AnalyticsService({ getClient: () => ({}) } as any);
  jest.spyOn(svc as any, "loadInventory").mockResolvedValue(inventory);
  jest.spyOn(svc as any, "loadConsumption").mockResolvedValue(consumption);
  jest
    .spyOn(svc as any, "firstConsumption")
    .mockResolvedValue({ read: "read", day: day(300) });
  jest
    .spyOn(svc as any, "vendorLeadTimes")
    .mockResolvedValue({ read: true, byProvider: new Map() });
  return svc;
}

describe("restock: a good added last week to an old house", () => {
  it("reads 2 a day over its own week and goes on the reorder list", async () => {
    const out: any = await oldHouse(
      [good("mw-new", 10, day(6))],
      lines("mw-new", 7, 2),
    ).getInventoryScience("r-old");
    const sku = out.skus[0];
    expect(sku.avgDailyDemand).toBeCloseTo(2, 9);
    expect(sku.reorderPoint).toBeCloseTo(14, 9);
    expect(sku.daysOfCover).toBeCloseTo(5, 9);
    expect(sku.needsReorder).toBe(true);
    expect(sku.demandSince).toBe(day(6));
    expect(out.reorderList.map((s: any) => s.id)).toEqual(["inv-mw-new"]);
    expect(out.basis.demand).toMatch(/^bottles\/day over 90d — /);
    expect(out.basis.demand).toContain(
      "; 1 good was added to the house's list inside the window",
    );
  });

  it("with no added day it reads as before: diluted over 90 days, and the basis says nothing new", async () => {
    const out: any = await oldHouse(
      [good("mw-new", 10, undefined)],
      lines("mw-new", 7, 2),
    ).getInventoryScience("r-old");
    expect(out.skus[0].avgDailyDemand).toBeCloseTo(14 / 90, 9);
    expect(out.skus[0].demandSince).toBeNull();
    expect(out.basis.demand).not.toContain("added to the house's list");
  });

  it("a line older than the added day keeps the house's window (a re-created row)", async () => {
    const out: any = await oldHouse(
      [good("mw-new", 10, day(6))],
      [...lines("mw-new", 1, 2, 20), ...lines("mw-new", 7, 2)],
    ).getInventoryScience("r-old");
    expect(out.skus[0].avgDailyDemand).toBeCloseTo(16 / 90, 9);
    expect(out.skus[0].demandSince).toBeNull();
  });

  it("an older good beside it keeps the whole window, and only the new one is counted", async () => {
    const out: any = await oldHouse(
      [good("mw-new", 10, day(6)), good("mw-old", 10, day(200))],
      [...lines("mw-new", 7, 2), ...lines("mw-old", 7, 2)],
    ).getInventoryScience("r-old");
    const by = new Map(out.skus.map((s: any) => [s.id, s]));
    expect((by.get("inv-mw-old") as any).avgDailyDemand).toBeCloseTo(
      14 / 90,
      9,
    );
    expect((by.get("inv-mw-old") as any).demandSince).toBeNull();
    expect((by.get("inv-mw-new") as any).avgDailyDemand).toBeCloseTo(2, 9);
    expect(out.basis.demand).toContain("; 1 good was added");
  });
});

describe("restock: a young house's goods keep the house's start", () => {
  it("a good with no added day in a young house names no start of its own", async () => {
    const svc = oldHouse([good("mw-a", 10, null)], lines("mw-a", 30, 1));
    jest
      .spyOn(svc as any, "firstConsumption")
      .mockResolvedValue({ read: "read", day: day(29) });
    const out: any = await svc.getInventoryScience("r-young");
    expect(out.observed.since).toBe(day(29));
    expect(out.skus[0].avgDailyDemand).toBeCloseTo(1, 9);
    expect(out.skus[0].demandSince).toBeNull();
    expect(out.basis.demand).not.toContain("added to the house's list");
  });
});

describe("loadInventory carries the day a good was added", () => {
  /** PostgREST returns only the columns the select names. */
  function client(row: Record<string, unknown>) {
    return {
      from: (table: string) => {
        const b: any = {};
        let cols: string[] = [];
        b.select = (c: string) => {
          cols = c.split(",").map((x) => x.trim().split("(")[0]);
          return b;
        };
        b.eq = () => b;
        b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(
            table === "restaurant_inventory"
              ? {
                  data: [
                    Object.fromEntries(
                      Object.entries(row).filter(([k]) => cols.includes(k)),
                    ),
                  ],
                  error: null,
                }
              : { data: [], error: null },
          ).then(res, rej);
        return b;
      },
    };
  }

  it("reads created_at and dates it as consumption lines are dated", async () => {
    const svc = new AnalyticsService({
      getClient: () =>
        client({
          id: "inv-1",
          wine_name: "House red",
          stock_live: 4,
          master_wine_id: "mw-1",
          created_at: "2026-11-08T22:15:00+00:00",
        }),
    } as any);
    const [row]: any[] = await (svc as any).loadInventory("r-1");
    expect(row.addedAt).toBe("2026-11-08");
  });

  it("a row with no created_at has no added day", async () => {
    const svc = new AnalyticsService({
      getClient: () =>
        client({ id: "inv-1", wine_name: "House red", stock_live: 4 }),
    } as any);
    const [row]: any[] = await (svc as any).loadInventory("r-1");
    expect(row.addedAt).toBeNull();
  });
});
