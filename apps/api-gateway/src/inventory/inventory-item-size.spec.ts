import { InventoryService } from "./inventory.service";

/**
 * r21 D2: the inventory read says a good's size is unknown instead of filling
 * in a wine bottle's 750. The POS sale-size answer reads this field as the
 * good's container, so a guessed 750 moved stock and cost.
 */
const svc = new InventoryService({} as any);
const map = (row: Record<string, unknown>) => (svc as any).mapInventoryItem(row);
const house = { restaurants: { default_pour_ml: 150 }, master_wine_id: null, master_wine_library: null };

describe("inventory read: a good's size (r21 D2)", () => {
  it("a house good with no size reads null, not 750, and has no glasses per bottle", () => {
    const out = map({ ...house, id: "tonik", bottle_size_ml: null, pour_size_ml: null });
    expect(out.bottleSizeMl).toBeNull();
    expect(out.bottleSizeOz).toBeNull();
    expect(out.glassesPerBottle).toBeUndefined();
  });

  it("a house good reads its own size: 200 ml tonic is 200, one glass of 150", () => {
    const out = map({ ...house, id: "tonik", bottle_size_ml: 200, pour_size_ml: null });
    expect(out.bottleSizeMl).toBe(200);
    expect(out.bottleSizeOz).toBe(6.8);
    expect(out.glassesPerBottle).toBe(1);
  });

  it("a size of 0 is no size", () => {
    expect(map({ ...house, id: "x", bottle_size_ml: 0 }).bottleSizeMl).toBeNull();
  });

  it("a library wine still falls back to its library bottle, then the 750 stand-in (ADR 0297)", () => {
    const magnum = map({
      id: "w1",
      master_wine_id: "mw1",
      master_wine_library: { bottle_size_ml: 1500 },
      restaurants: { default_pour_ml: 150 },
      bottle_size_ml: null,
    });
    expect(magnum.bottleSizeMl).toBe(1500);
    expect(magnum.glassesPerBottle).toBe(10);
    const unsized = map({ id: "w2", master_wine_id: "mw2", master_wine_library: null, bottle_size_ml: null });
    expect(unsized.bottleSizeMl).toBe(750);
    expect(unsized.glassesPerBottle).toBe(5);
  });
});
