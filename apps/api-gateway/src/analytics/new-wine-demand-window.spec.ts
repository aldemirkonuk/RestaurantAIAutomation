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

async function science(listedAt: string | null) {
  const service = new AnalyticsService({ getClient: () => null } as any);
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
  jest.spyOn(service as any, "loadConsumption").mockResolvedValue(
    [0, 1, 2].map((d) => ({
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
