import { AnalyticsService } from "./analytics.service";

/**
 * The reorder lens without cost (ADR 0348 decision 3, slice 4). Staff restock
 * from "What to buy back", so the lens stays open to them; what it says about
 * money does not reach them: unit cost, value at cost, the order quantity
 * (EOQ reads the unit cost back out) and the ABC class (a rank by value).
 * The rows are ranked by bottles on hand, never by value.
 */

function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

// Three wrapped goods, all priced: the dearest holds the fewest bottles, so a
// rank by value and a rank by bottles disagree.
const CELLAR = [
  { id: "a", name: "Öküzgözü", qty: 2, unitCost: 900 },
  { id: "b", name: "Rakı", qty: 6, unitCost: 40 },
  { id: "c", name: "Ayran", qty: 6, unitCost: 5 },
];

async function lens(opts: { withCost?: boolean } = {}) {
  const service = new AnalyticsService({ getClient: () => null } as any);
  jest.spyOn(service as any, "loadInventory").mockResolvedValue(
    CELLAR.map((g) => ({
      id: g.id,
      name: g.name,
      type: "red",
      qty: g.qty,
      unitCost: g.unitCost,
      costBasis: "invoiced_lot",
      unitPrice: g.unitCost * 3,
      thresholdMin: 0,
      reorderPoint: 0,
      masterWineId: `m-${g.id}`,
      inventoryValue: g.qty * g.unitCost,
    })),
  );
  jest.spyOn(service as any, "loadConsumption").mockResolvedValue(
    CELLAR.flatMap((g) =>
      [1, 2, 3, 4].map((d) => ({
        masterWineId: `m-${g.id}`,
        inventoryId: g.id,
        qty: 3 + (d % 2),
        date: dayBack(d),
      })),
    ),
  );
  return service.getInventoryScience("r1", opts);
}

describe("the reorder lens without cost", () => {
  it("[REVERT-FAILS] carries no unit cost, value, order quantity or ABC class, and says so", async () => {
    const out = await lens({ withCost: false });
    expect(out.costWithheld).toBe(true);
    for (const row of [...out.skus, ...out.reorderList]) {
      expect(row.unitCost).toBeNull();
      expect(row.inventoryValue).toBeNull();
      expect(row.eoq).toBeNull();
      expect(row.abcClass).toBeNull();
    }
    expect(JSON.stringify(out)).not.toMatch(/"(unitCost|inventoryValue|eoq)":\d/);
    expect(out.basis.costDerived).toMatch(/withheld for this reader's role/);
  });

  it("[REVERT-FAILS] ranks the goods by bottles on hand, then name, never by value", async () => {
    const out = await lens({ withCost: false });
    expect(out.skus.map((s: any) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("keeps what restocking needs: on hand, cover, reorder point and risk", async () => {
    const withheld = await lens({ withCost: false });
    const whole = await lens();
    const byId = (rows: any[]) => new Map(rows.map((r) => [r.id, r]));
    const w = byId(withheld.skus);
    for (const row of whole.skus) {
      const kept = w.get(row.id);
      for (const k of ["onHand", "daysOfCover", "reorderPoint", "safetyStock", "stockoutProbability", "needsReorder", "xyzClass"])
        expect(kept[k]).toEqual(row[k]);
    }
    expect(withheld.reorderCount).toBe(whole.reorderCount);
  });

  it("an internal caller that names nothing reads the cost, the value and the ABC class", async () => {
    const out = await lens();
    expect(out.costWithheld).toBe(false);
    const a = out.skus.find((s: any) => s.id === "a");
    expect(a.unitCost).toBe(900);
    expect(a.inventoryValue).toBe(1800);
    expect(a.abcClass).not.toBeNull();
    // Ranked by value: the dearest first.
    expect(out.skus.map((s: any) => s.id)).toEqual(["a", "b", "c"]);
  });
});
