import { InventoryService } from "./inventory.service";

/** r104 finding: a server that caps a response below the page size must not end the settled-price read at page 1. */
function service(total: number, cap: number) {
  const all = Array.from({ length: total }, (_, i) => ({
    inventory_id: "g1",
    source_order_id: `o${i}`,
    new_unit_cost: 10 + i,
    new_cost_provenance: "invoice",
    created_at: new Date(Date.UTC(2026, 0, 1) - i * 86_400_000).toISOString(),
  }));
  let reads = 0;
  const client = {
    from: (table: string) => {
      let lo = 0;
      let hi = 0;
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        range: (a: number, b: number) => ((lo = a), (hi = b), chain),
        then: (res: any) => {
          if (table !== "inventory_lot_revaluations") return res({ data: [], error: null });
          reads += 1;
          const data = all.slice(lo, Math.min(hi + 1, lo + cap));
          return res({ data, error: null, count: total });
        },
      };
      return chain;
    },
  };
  const db: any = { getClient: () => client, getRestaurantInventory: jest.fn().mockResolvedValue([{ id: "g1" }]) };
  return { svc: new InventoryService(db), reads: () => reads };
}

describe("the settled-price read ends on the count, not on a short page", () => {
  it("keeps reading when the server returns fewer rows than a page", async () => {
    const { svc, reads } = service(2500, 400);
    const [row]: any[] = await svc.getRestaurantInventory("r1");
    expect(reads()).toBeGreaterThan(1);
    expect(row.settledCostsCapped).toBe(true);
  });

  it("says nothing was left out when every row was read", async () => {
    const { svc } = service(1500, 1000);
    const [row]: any[] = await svc.getRestaurantInventory("r1");
    expect(row.settledCostsCapped).toBe(false);
    expect(row.lastSettledCost).toBe(10);
  });
});
