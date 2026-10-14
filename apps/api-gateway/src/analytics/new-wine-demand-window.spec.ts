import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";

/**
 * F-687 (wave-23 sim): a wine listed three days ago that sells two a day was
 * averaged over the whole 90-day window — 0.07/day, so "What to buy back"
 * missed exactly the new lines that sell fastest. Demand is now averaged over
 * the days since the wine was listed when that is fewer than the window.
 */

function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

async function science(
  listedAt: string | null,
  openedOn: string | null = null,
  saleDays: number[] = [0, 1, 2],
) {
  const service = new AnalyticsService({
    // The house's zone read (F-928) answers "no zone": days stay UTC's.
    getClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
  } as any);
  jest.spyOn(service as any, "loadInventory").mockResolvedValue([
    {
      id: "new",
      name: "SYNTHETIC Boğazkere",
      type: "red",
      qty: 4,
      unitCost: 10,
      costBasis: "invoiced_lot",
      unitPrice: 30,
      thresholdMin: 0,
      reorderPoint: 0,
      masterWineId: "m-new",
      listedAt,
      inventoryValue: 40,
    },
  ]);
  if (openedOn)
    jest
      .spyOn(service as any, "loadHouse")
      .mockResolvedValue({ currency: "EUR", openedOn });
  jest.spyOn(service as any, "loadConsumption").mockResolvedValue(
    saleDays.map((d) => ({
      masterWineId: "m-new",
      inventoryId: "new",
      qty: 2,
      how: "bottles",
      date: dayBack(d),
    })),
  );
  return service.getInventoryScience("r1");
}

describe("a new wine's demand is averaged over the days it has been listed (F-687)", () => {
  it("three days on the list: two a day, not six over ninety", async () => {
    // Two whole days to yesterday (F-1647); today's two are not yet a day.
    const out = await science(`${dayBack(2)}T18:00:00Z`);
    const sku = out.skus[0];
    expect(sku.demandDays).toBe(2);
    expect(sku.avgDailyDemand).toBeCloseTo(2, 9);
    expect(sku.needsReorder).toBe(true);
    expect(out.basis.demand).toContain("since the wine was listed");
  });

  it("an unknown listing date keeps the whole window (control)", async () => {
    const out = await science(null);
    expect(out.skus[0].demandDays).toBe(90);
    expect(out.skus[0].avgDailyDemand).toBeCloseTo(4 / 90, 9);
  });
});

/**
 * F-1516 (wave-49 sim, a new house's first 30 days): opening stock loaded 21
 * days ago, the till's first check two days ago. The wine was averaged over
 * 21 days for 2 days of sales. A house set up inside the window has its whole
 * record in it, so the first line there is its till's first.
 */
describe("demand starts no earlier than the house's first recorded sale (F-1516)", () => {
  it("stock loaded three weeks before the till: two days, not twenty-one", async () => {
    // The till's first check two days ago; days run to yesterday (F-1647).
    const out = await science(`${dayBack(20)}T09:00:00Z`, dayBack(24), [1, 2]);
    const sku = out.skus[0];
    expect(sku.demandDays).toBe(2);
    expect(sku.avgDailyDemand).toBeCloseTo(2, 9);
    expect(out.params.salesRecordedFrom).toBe(dayBack(2));
    expect(out.basis.demand).toContain("first recorded sale");
  });

  it("a house set up before the window keeps the wine's own days (control)", async () => {
    const out = await science(`${dayBack(20)}T09:00:00Z`, dayBack(200), [0, 1]);
    expect(out.skus[0].demandDays).toBe(20);
    expect(out.params.salesRecordedFrom).toBeNull();
  });
});

/**
 * F-1647 (wave-54 sim): the reorder register counted today's unfinished day
 * as a full day of demand, so at lunch a 9-day house read about 11% slow.
 * It now ends yesterday, as the forecast does since F-1533.
 */
describe("the reorder register's demand ends yesterday (F-1647)", () => {
  it("ten days on the list, two a day, and nothing sold yet this morning: two a day, not 18 over 10", async () => {
    // Two bottles on each of the nine whole days; today has not sold yet.
    const out = await science(
      `${dayBack(9)}T09:00:00Z`,
      null,
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
    const sku = out.skus[0];
    expect(sku.demandDays).toBe(9);
    expect(sku.avgDailyDemand).toBeCloseTo(2, 9);
    expect(out.basis.demand).toContain("ending yesterday");
  });
});

/**
 * F-1645 (wave-54 sim): margin against movement divided every wine's sales
 * by 90 days, so a 9-day house read ten times too slow and a wine listed
 * last week was filed a Puzzle or a Dog. It now reads each wine over the
 * reorder register's window: its days on the list, from the house's first
 * recorded sale, to yesterday.
 */
async function menu(
  wines: Array<{ id: string; listedAt: string | null; margin: number }>,
  sales: Array<{ id: string; days: number[] }>,
  openedOn: string | null = null,
) {
  const db = {
    getClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
  } as any;
  const advanced = new AdvancedAnalyticsService(
    db,
    {} as any,
    {} as any,
    {} as any,
  );
  jest
    .spyOn(advanced as any, "readHouseDays")
    .mockResolvedValue({ zone: null, openedOn });
  jest.spyOn(advanced as any, "loadInventoryWithCost").mockResolvedValue(
    wines.map((w) => ({
      id: w.id,
      name: `SYNTHETIC ${w.id}`,
      type: "red",
      qty: 6,
      unitCost: 10,
      costBasis: "invoiced_lot",
      unitPrice: 10 + w.margin,
      glassPrice: 0,
      bottleMl: 750,
      winePourMl: null,
      marginPerBottle: w.margin,
      listedAt: w.listedAt,
    })),
  );
  jest.spyOn(advanced as any, "loadConsumption").mockResolvedValue(
    sales.flatMap((s) =>
      s.days.map((d) => ({
        wineId: null,
        inventoryId: s.id,
        qty: 1,
        how: "bottle",
        date: dayBack(d),
      })),
    ),
  );
  return (await advanced.getMenuEngineering("r1")) as any;
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("margin against movement reads each wine over its own days (F-1645)", () => {
  it("a 9-day house: nine bottles in nine days is one a day, not 9/90", async () => {
    const out = await menu(
      [{ id: "a", listedAt: null, margin: 20 }],
      [{ id: "a", days: range(1, 9) }],
      dayBack(9),
    );
    const a = out.items.find((i: any) => i.id === "a");
    expect(a.velocityDays).toBe(9);
    expect(a.velocityPerDay).toBeCloseTo(1, 9);
    expect(out.basis.velocity).toContain("first recorded sale");
  });

  it("a wine listed three days ago has too few days for a quadrant, and is counted apart", async () => {
    const out = await menu(
      [
        { id: "old", listedAt: null, margin: 10 },
        { id: "mid", listedAt: null, margin: 20 },
        { id: "new", listedAt: `${dayBack(3)}T09:00:00Z`, margin: 30 },
      ],
      [
        { id: "old", days: range(1, 30) },
        { id: "mid", days: range(1, 10) },
        { id: "new", days: [1, 2, 3] },
      ],
    );
    const fresh = out.items.find((i: any) => i.id === "new");
    expect(fresh.velocityDays).toBe(3);
    expect(fresh.velocityPerDay).toBeCloseTo(1, 9);
    expect(fresh.quadrant).toBeNull();
    expect(fresh.action).toBeNull();
    expect(out.counts.tooFewDays).toBe(1);
    expect(out.items.find((i: any) => i.id === "old").quadrant).not.toBeNull();
  });
});
