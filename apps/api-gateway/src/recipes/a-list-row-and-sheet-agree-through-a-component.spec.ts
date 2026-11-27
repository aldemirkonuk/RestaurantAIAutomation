/**
 * r104 drinks gap 1 (ADR 0397): the list figures price a made line through its
 * component, as the sheet does. The list built its cost inputs with no `made`,
 * so a row read "not known, 1 of 2 priced" where the drawer read the cost.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { DishesService } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { HOUSE_A, TART, fakeDb } from "./dishes.testing";
import { partlyInvoiced, withSyrup } from "./made.testing";

const services = (rows: ReturnType<typeof withSyrup>) => {
  const { db } = fakeDb(rows);
  const recipes = new RecipesService(db);
  return { recipes, dishes: new DishesService(db, recipes) };
};

describe("a list row and its sheet read one cost through a made line", () => {
  it("prices the made line in the list, to the figure the sheet shows", async () => {
    const { recipes, dishes } = services(withSyrup());
    const sheet = (await recipes.getDishRecipe(HOUSE_A, TART, "owner")) as any;
    const list = await dishes.dishFigures(HOUSE_A, "owner");
    const row = list.dishes.find((d) => d.dishId === TART)!;
    expect(sheet.cost).toMatchObject({ complete: true, perServeExact: 0.057143 });
    expect(row.cost).toMatchObject({ complete: true, priced: 1, of: 1, perServeExact: sheet.cost.perServeExact });
  });

  it("carries the invoice-only hedge into the list too", async () => {
    const { dishes } = services(partlyInvoiced(withSyrup()));
    const row = (await dishes.dishFigures(HOUSE_A, "owner")).dishes.find((d) => d.dishId === TART)!;
    expect(row.cost).toMatchObject({ complete: true, partial: 1 });
  });

  it("says nothing of money to a role that does not see it", async () => {
    const { dishes } = services(withSyrup());
    const row = (await dishes.dishFigures(HOUSE_A, "staff")).dishes.find((d) => d.dishId === TART)!;
    expect(row.cost).toBeNull();
  });
});

// jest does not typecheck, so a second componentRates read for the list (the same fix
// landed by #2102 in another place) would pass every behaviour test above while tsc fails
// with TS2451 on the doubled `components`. The list reads a made component's rate once.
describe("the list reads a made component's rate in one place", () => {
  it("declares `components` once and calls componentRates once in dishes.service", () => {
    const src = readFileSync(join(__dirname, "dishes.service.ts"), "utf8");
    expect(src.match(/\blet components\b/g)).toHaveLength(1);
    expect(src.match(/\.componentRates\(/g)).toHaveLength(1);
  });
});
