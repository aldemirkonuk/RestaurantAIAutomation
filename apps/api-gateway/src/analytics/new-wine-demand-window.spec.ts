import { AnalyticsService } from "./analytics.service";

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
    const out = await science(`${dayBack(2)}T18:00:00Z`);
    const sku = out.skus[0];
    expect(sku.demandDays).toBe(3);
    expect(sku.avgDailyDemand).toBeCloseTo(2, 9);
    expect(sku.needsReorder).toBe(true);
    expect(out.basis.demand).toContain("since the wine was listed");
  });

  it("an unknown listing date keeps the whole window (control)", async () => {
    const out = await science(null);
    expect(out.skus[0].demandDays).toBe(90);
    expect(out.skus[0].avgDailyDemand).toBeCloseTo(6 / 90, 9);
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
    const out = await science(`${dayBack(20)}T09:00:00Z`, dayBack(24), [0, 1]);
    const sku = out.skus[0];
    expect(sku.demandDays).toBe(2);
    expect(sku.avgDailyDemand).toBeCloseTo(2, 9);
    expect(out.params.salesRecordedFrom).toBe(dayBack(1));
    expect(out.basis.demand).toContain("first recorded sale");
  });

  it("a house set up before the window keeps the wine's own days (control)", async () => {
    const out = await science(`${dayBack(20)}T09:00:00Z`, dayBack(200), [0, 1]);
    expect(out.skus[0].demandDays).toBe(21);
    expect(out.params.salesRecordedFrom).toBeNull();
  });
});
