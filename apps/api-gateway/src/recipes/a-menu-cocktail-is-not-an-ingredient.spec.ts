import { DishesService } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { HOUSE_A, fakeDb, twoHouses } from "./dishes.testing";

/**
 * A menu's cocktail is not an ingredient (r36 recipes audit, gap 3, slice 1).
 *
 * Making a menu current files each cocktail line as a house good of kind
 * cocktail, counted each, with no stock (#1392). The ingredient picker and
 * the paste match read every live good, so the Negroni was offered as an
 * ingredient of the Negroni, and a pasted line could link to it.
 */

const NEGRONI = "f0000000-0000-4000-8000-0000000000c1";
const SPRITZ = "f0000000-0000-4000-8000-0000000000c2";

function rows() {
  const r = twoHouses();
  r.restaurant_inventory.push(
    { id: NEGRONI, restaurant_id: HOUSE_A, display_name: "Negroni", kind: "cocktail", uom: "each", bottle_size_ml: null, is_active: true, deleted_at: null },
    { id: SPRITZ, restaurant_id: HOUSE_A, display_name: "Aperol Spritz", kind: "cocktail", uom: "each", bottle_size_ml: null, is_active: true, deleted_at: null },
  );
  return r;
}

describe("a menu's cocktail is not an ingredient", () => {
  it("the picker never offers a cocktail good, and offers every other kind", async () => {
    const fake = fakeDb(rows());
    const out = await new RecipesService(fake.db).shelf(HOUSE_A, undefined, 50);
    expect(out.map((x) => x.name)).not.toContain("Negroni");
    expect(out.map((x) => x.kind)).not.toContain("cocktail");
    expect(out.map((x) => x.name).sort()).toEqual(["Bread Flour", "Sugar", "Tonic  Water", "sugar"].sort());
  });

  it("a pasted line never links to a cocktail good, and others still link", async () => {
    const db = fakeDb(rows()).db;
    const out = await new DishesService(db, new RecipesService(db)).matchShelf(HOUSE_A, ["Negroni", "aperol spritz", "Bread flour"]);
    expect(out.map((m) => [m.item?.name ?? null, m.sameName])).toEqual([
      [null, 0],
      [null, 0],
      ["Bread Flour", 1],
    ]);
  });
});
