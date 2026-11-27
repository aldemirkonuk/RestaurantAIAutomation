import { InventoryService } from "./inventory.service";

/**
 * The list row carries the library's wine style, grape, drink kind, producer and vintage, read
 * from the library row the list already joins, so the page does not have to ask
 * the wine library a second time for them. A field the join did not select is
 * left off, never sent as null: null says "the library has none".
 */
describe("a list row carries what the page took from /wines", () => {
  const service = new InventoryService({} as any);
  const map = (row: Record<string, any>) =>
    (service as any).mapInventoryItem(row) as Record<string, any>;

  it("sends the three from the joined library row", () => {
    const m = map({
      id: "i1",
      master_wine_id: "w1",
      master_wine_library: { name: "Barolo", primary_type: "red", grape_variety: "Nebbiolo", beverage_kind: "wine", producer: "Cantina", vintage: 2016, display_name: "Barolo 2016" },
    });
    expect(m.libraryType).toBe("red");
    expect(m.libraryGrape).toBe("Nebbiolo");
    expect(m.libraryKind).toBe("wine");
    expect(m.libraryProducer).toBe("Cantina");
    expect(m.libraryVintage).toBe(2016);
    expect(m.libraryDisplayName).toBe("Barolo 2016");
  });

  it("sends null when the library was read and records none", () => {
    const m = map({
      id: "i2",
      master_wine_id: "w2",
      master_wine_library: { name: "X", primary_type: null, grape_variety: null, beverage_kind: null, producer: null, vintage: null, display_name: null },
    });
    expect(m.libraryType).toBeNull();
    expect(m.libraryGrape).toBeNull();
    expect(m.libraryKind).toBeNull();
    expect(m.libraryProducer).toBeNull();
    expect(m.libraryVintage).toBeNull();
  });

  it("leaves them off when the join did not select them, or there is no library row", () => {
    const narrow = map({ id: "i3", master_wine_library: { name: "X", bottle_size_ml: 750 } });
    const none = map({ id: "i4", display_name: "Flour", master_wine_library: null });
    for (const m of [narrow, none]) {
      expect(m).not.toHaveProperty("libraryType", null);
      expect(m.libraryType).toBeUndefined();
      expect(m.libraryGrape).toBeUndefined();
      expect(m.libraryKind).toBeUndefined();
      expect(m.libraryProducer).toBeUndefined();
      expect(m.libraryVintage).toBeUndefined();
    }
  });
});
