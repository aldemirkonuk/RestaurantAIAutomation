import { portionFactsOf } from "./portion-facts";
import { InventoryService } from "./inventory.service";

/**
 * r24 pos-portions: the inventory read carries only the facts a POS sale size
 * may stand on. A stand-in (the library's 750, the 150 pour default) is never
 * one of them.
 */
const confirmed = { pour_size_confirmed_by: "u1", pour_size_confirmed_at: "2026-11-01T00:00:00Z" };

describe("portionFactsOf", () => {
  it("a soda carried from a paper: its own kind, unit and size; no pour", () => {
    expect(
      portionFactsOf({ kind: "soft_drink", uom: "bottle", bottle_size_ml: 200, pour_size_ml: 150 }),
    ).toEqual({ kind: "soft_drink", uom: "bottle", bottleMl: 200, pourMl: null });
  });

  it("a library wine with no own size has no size, even though the library says 750", () => {
    const f = portionFactsOf({
      kind: "wine",
      uom: "bottle",
      master_wine_id: "mw1",
      master_wine_library: { bottle_size_ml: 750, beverage_kind: "wine" },
      bottle_size_ml: null,
    });
    expect(f.bottleMl).toBeNull();
    expect(f.kind).toBe("wine");
  });

  it("a pour counts only when it was confirmed", () => {
    expect(portionFactsOf({ kind: "wine", pour_size_ml: 150 }).pourMl).toBeNull();
    expect(portionFactsOf({ kind: "wine", pour_size_ml: 125, ...confirmed }).pourMl).toBe(125);
  });

  it("a library spirit inserted as the default 'wine' reads as a spirit", () => {
    const f = portionFactsOf({
      kind: "wine",
      master_wine_id: "g1",
      master_wine_library: { beverage_kind: "spirit" },
    });
    expect(f.kind).toBe("spirit");
  });

  it("a kind the house chose stays, and an unknown library kind changes nothing", () => {
    expect(
      portionFactsOf({ kind: "whiskey", master_wine_library: { beverage_kind: "spirit" } }).kind,
    ).toBe("whiskey");
    expect(
      portionFactsOf({ kind: "wine", master_wine_library: { beverage_kind: "unknown" } }).kind,
    ).toBe("wine");
  });

  it("a size of 0 or a word is no size; a missing kind on a library row reads wine", () => {
    expect(portionFactsOf({ bottle_size_ml: 0 }).bottleMl).toBeNull();
    expect(portionFactsOf({ bottle_size_ml: "abc" }).bottleMl).toBeNull();
    expect(portionFactsOf({ master_wine_id: "mw" }).kind).toBe("wine");
    expect(portionFactsOf({}).kind).toBeNull();
  });

  it("the inventory read carries the facts beside its display size", () => {
    const svc = new InventoryService({} as any);
    const out = (svc as any).mapInventoryItem({
      id: "w",
      kind: "wine",
      uom: "bottle",
      master_wine_id: "mw",
      master_wine_library: { bottle_size_ml: 750, beverage_kind: "wine" },
      restaurants: { default_pour_ml: 150 },
      bottle_size_ml: null,
    });
    // The display keeps ADR 0297's stand-in; the POS facts do not.
    expect(out.bottleSizeMl).toBe(750);
    expect(out.portionFacts).toEqual({ kind: "wine", uom: "bottle", bottleMl: null, pourMl: null });
  });
});
