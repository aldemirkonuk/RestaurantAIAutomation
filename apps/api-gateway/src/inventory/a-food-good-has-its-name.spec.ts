import { InventoryService } from "./inventory.service";

/**
 * A good the house carries that is not a wine (flour, syrup) has no library
 * row and no alias: the name it was declared with lives in `display_name`,
 * which every row has. The list drew those goods as "Unnamed title" because
 * the row's name was read from the alias and the library only.
 */
describe("a good with only its declared name", () => {
  const service = new InventoryService({} as any);
  const map = (row: Record<string, any>) =>
    (service as any).mapInventoryItem(row) as Record<string, any>;

  it("is named by its declared name when it has no alias and no library row", () => {
    const m = map({ id: "i1", display_name: "Bread Flour", wine_name: null, master_wine_library: null });
    expect(m.wineName).toBe("Bread Flour");
    expect(m.wine_name).toBe("Bread Flour");
  });

  it("is not called an alias: houseAlias stays empty and libraryName stays null", () => {
    const m = map({ id: "i1", display_name: "Bread Flour", wine_name: null, master_wine_library: null });
    expect(m.houseAlias).toBeNull();
    expect(m.libraryName).toBeNull();
  });

  it("keeps the alias over the declared name, and the declared name over nothing", () => {
    const aliased = map({ id: "i2", display_name: "Wine X (declared)", wine_name: "Wine X", master_wine_library: { name: "1988 Wine X" } });
    expect(aliased.wineName).toBe("Wine X");
    const library = map({ id: "i3", display_name: "Declared", wine_name: null, master_wine_library: { name: "1988 Wine X" } });
    expect(library.wineName).toBe("1988 Wine X");
  });

  it("reads a blank declared name as no name", () => {
    const m = map({ id: "i4", display_name: "   ", wine_name: null, master_wine_library: null });
    expect(m.wineName).toBeNull();
  });
});
