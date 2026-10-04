import { AnalyticsService } from "./analytics.service";

/**
 * "The 25 at the highest risk are listed."
 *
 * On Tuzlu (A-070) the restock register sorted its reorder list by stockout
 * probability alone and cut it at 25. Five wines shared 27% across rows 23–27:
 * the cut kept two of them — whichever two `loadInventory` happened to return
 * first — and the page said the 25 listed were the 25 at the highest risk.
 * ADR 0272: within a tie the order is the data's (cover, then bottles, then
 * name), never the database's; and a cut never splits a tie group.
 */

function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

interface Sku {
  id: string;
  sold: number;
  cover: number;
}

/**
 * Thirty wines below their reorder point, each with all its demand on one
 * day (Tuzlu's import-day shape, so risk is a function of cover alone):
 * 22 at distinct covers, then FIVE at 22.5 days — one risk, which floating
 * point returns in more than one bit pattern — then three at lower risk.
 */
function cellar(): Sku[] {
  const distinct = Array.from({ length: 22 }, (_, i) => ({
    id: `d${String(i).padStart(2, "0")}`,
    sold: 9,
    cover: i,
  }));
  const tied = [5, 7, 10, 11, 17].map((sold, i) => ({
    id: `tie${i}`,
    sold,
    cover: 22.5,
  }));
  const lower = [30, 35, 40].map((cover, i) => ({
    id: `low${i}`,
    sold: 9,
    cover,
  }));
  return [...distinct, ...tied, ...lower];
}

async function reorderList(skus: Sku[]) {
  const service = new AnalyticsService({ getClient: () => null } as any);
  jest.spyOn(service as any, "loadInventory").mockResolvedValue(
    skus.map((s) => ({
      id: s.id,
      name: `Wine ${s.id}`,
      type: "red",
      qty: (s.cover * s.sold) / 90,
      unitCost: 10,
      costBasis: "invoiced_lot",
      unitPrice: 30,
      thresholdMin: 0,
      reorderPoint: 0,
      masterWineId: `m-${s.id}`,
      inventoryValue: ((s.cover * s.sold) / 90) * 10,
    })),
  );
  jest.spyOn(service as any, "loadConsumption").mockResolvedValue(
    skus.map((s) => ({
      masterWineId: `m-${s.id}`,
      inventoryId: s.id,
      qty: s.sold,
      date: dayBack(30),
    })),
  );
  return service.getInventoryScience("r1");
}

describe("the restock cut keeps its ties (A-070, ADR 0272)", () => {
  it("lists every wine tied with the 25th, not two of five", async () => {
    const out = await reorderList(cellar());
    expect(out.reorderCount).toBe(30);
    const ids = out.reorderList.map((s: any) => s.id);
    expect(ids).toHaveLength(27);
    for (const t of ["tie0", "tie1", "tie2", "tie3", "tie4"])
      expect(ids).toContain(t);
    expect(ids).not.toContain("low0");
  });

  it("returns the same order whatever order the database returned", async () => {
    const forward = (await reorderList(cellar())).reorderList.map(
      (s: any) => s.id,
    );
    const shuffled = cellar();
    // A fixed permutation: reversed, then every other row rotated.
    shuffled.reverse();
    for (let i = 0; i + 1 < shuffled.length; i += 2)
      [shuffled[i], shuffled[i + 1]] = [shuffled[i + 1], shuffled[i]];
    const back = (await reorderList(shuffled)).reorderList.map(
      (s: any) => s.id,
    );
    expect(back).toEqual(forward);
  });
});
