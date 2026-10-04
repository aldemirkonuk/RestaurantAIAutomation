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
 * Thirty wines below their reorder point, each with its demand spread evenly
 * over the 14 days a risk needs (ADR 0299), so risk is a function of cover
 * alone: 22 at distinct covers, then FIVE at 9 days — one risk, about 37%,
 * which floating point returns in more than one bit pattern — then three at
 * lower risk. Every cover is below the 17.2 days the reorder point covers.
 *
 * (ADR 0272 wrote these on Tuzlu's one-import-day shape, covers 2.5× these;
 * ADR 0299 gives such a series no risk at all, so the shape moved, not the
 * assertions.)
 */
function cellar(): Sku[] {
  const distinct = Array.from({ length: 22 }, (_, i) => ({
    id: `d${String(i).padStart(2, "0")}`,
    sold: 9,
    cover: i * 0.4,
  }));
  const tied = [5, 7, 10, 11, 17].map((sold, i) => ({
    id: `tie${i}`,
    sold,
    cover: 9,
  }));
  const lower = [12, 14, 16].map((cover, i) => ({
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
      bottles: (s.cover * s.sold) / 90,
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
    // A wine that sold nothing has no consumption row at all. The rest sold
    // on 14 days, the fewest a measured risk needs (ADR 0299).
    skus
      .filter((s) => s.sold > 0)
      .flatMap((s) =>
        Array.from({ length: 14 }, (_, d) => ({
          masterWineId: `m-${s.id}`,
          inventoryId: s.id,
          qty: s.sold / 14,
          date: dayBack(20 + d),
        })),
      ),
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

  it("does not list the whole 0% group when the 25th row falls in it (fork 3 bound)", async () => {
    // The lane verifier's probe: 5 wines with demand below their reorder
    // point, and 40 that sold nothing and hold nothing, "below" a reorder
    // point of 0 at exactly 0% risk. Extending the cut through that tie
    // listed all 45; the code before ADR 0272 listed 25. [ADR 0299: a wine
    // with no sale in the window has no measured swing, so the 40 now carry
    // no risk (null) rather than 0% — still a group the cut does not extend
    // through, and still listed after every wine with a risk.]
    const withDemand = [0, 1, 2, 3, 4].map((cover, i) => ({
      id: `d${i}`,
      sold: 9,
      cover: cover * 0.4,
    }));
    const none = Array.from({ length: 40 }, (_, i) => ({
      id: `z${String(i).padStart(2, "0")}`,
      sold: 0,
      cover: 0,
    }));
    const out = await reorderList([...none, ...withDemand]);
    expect(out.reorderCount).toBe(45);
    const ids = out.reorderList.map((s: any) => s.id);
    expect(ids).toHaveLength(25);
    // Every wine at risk is listed, first; the 0% fill is in name order,
    // whatever order the database returned.
    expect(ids.slice(0, 5)).toEqual(["d0", "d1", "d2", "d3", "d4"]);
    expect(ids.slice(5)).toEqual(none.slice(0, 20).map((s) => s.id));
    const reversed = await reorderList([...withDemand, ...none].reverse());
    expect(reversed.reorderList.map((s: any) => s.id)).toEqual(ids);
  });

  it("does not call two risks that merely print alike a tie (control: passes before ADR 0272 too)", async () => {
    // 24 distinct risks, then two wines whose risks differ in the third
    // decimal and print as the same whole percent (34%), straddling row 25.
    const distinct = Array.from({ length: 24 }, (_, i) => ({
      id: `d${String(i).padStart(2, "0")}`,
      sold: 9,
      cover: i * 0.4,
    }));
    const near = [
      { id: "pa", sold: 9, cover: 9.6 },
      { id: "pb", sold: 9, cover: 9.62 },
    ];
    const out = await reorderList([...distinct, ...near]);
    const risk = (id: string) =>
      out.skus.find((s: any) => s.id === id)!.stockoutProbability as number;
    expect(Math.round(risk("pa") * 100)).toBe(Math.round(risk("pb") * 100));
    expect(risk("pa")).not.toBe(risk("pb"));
    const ids = out.reorderList.map((s: any) => s.id);
    expect(ids).toHaveLength(25);
    expect(ids[24]).toBe("pa");
  });
});
