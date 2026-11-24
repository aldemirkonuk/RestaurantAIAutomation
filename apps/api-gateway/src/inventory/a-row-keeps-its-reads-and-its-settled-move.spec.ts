import { InventoryService } from "./inventory.service";

/**
 * mapInventoryItem takes (row, rollup, locations, analytics, reads, settled).
 * The G15 read flags are the fifth argument and the r104 g3 settled move the
 * sixth; a merge that swaps them silently drops one (a failed read would read
 * as 0 ml, or a price move would never reach the chip).
 */
describe("a list row keeps both what could not be read and the last two settled costs", () => {
  const service = new InventoryService({} as any);
  const map = (...args: unknown[]) =>
    (service as any).mapInventoryItem(...args) as Record<string, any>;
  const row = { id: "i1", master_wine_id: "w1" };

  it("a failed rollup read is no open-ml figure, and the settled move still travels", () => {
    const m = map(row, undefined, undefined, undefined, { rollup: false, locations: true }, { last: 11.2, previous: 10 });
    expect(m.openMl).toBeUndefined();
    expect(m.rollupReadable).toBe(false);
    expect(m.lastSettledCost).toBe(11.2);
    expect(m.previousSettledCost).toBe(10);
  });

  it("a read rollup and no settled move: zero ml, and no settled figures", () => {
    const m = map(row, undefined, undefined, undefined, { rollup: true, locations: true });
    expect(m.openMl).toBe(0);
    expect(m.rollupReadable).toBe(true);
    expect(m.lastSettledCost).toBeUndefined();
    expect(m.previousSettledCost).toBeUndefined();
  });
});
