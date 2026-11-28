/**
 * r106 drinks-6: why 'What is in a serve' and the allergens read "Could not be
 * read" on the local seed. The drinks chain reads item_nutrition and
 * item_allergens, and the schema that creates them (596a8b968, PR #922) is not
 * in the chain's migrations, so on a database built from the chain the read
 * errors (42P01, relation does not exist). That is a schema gap, not a fault in
 * the read, and the read must stay honest about it: unread says it could not be
 * read and shows no figure; a seed that has the tables but no rows says nothing
 * is recorded, which is a different, readable answer; rows are counted.
 */
import { RecipesService } from "./recipes.service";
import { HOUSE_A, FLOUR, TART, fakeDb, twoHouses, type Row } from "./dishes.testing";

const MISSING = { code: "42P01", message: 'relation "public.item_nutrition" does not exist' };

function house(extra: Record<string, Row[]>): Record<string, Row[]> {
  const rows = twoHouses();
  rows.inventory_lot_agreed_cost = [];
  rows.inventory_lot_invoice_cost = [];
  return { ...rows, ...extra };
}

/** fakeDb, but a table in `absent` answers as Postgres does for a table the migrations never created. */
function dbWithout(rows: Record<string, Row[]>, absent: string[]) {
  const { db } = fakeDb(rows);
  const client = db.getClient() as any;
  const from = client.from.bind(client);
  client.from = (table: string) => {
    if (!absent.includes(table)) return from(table);
    const dead: any = { select: () => dead, eq: () => dead, in: () => dead, then: (ok: (v: unknown) => unknown) => ok({ data: null, error: MISSING }) };
    return dead;
  };
  return db;
}

const read = async (db: ReturnType<typeof fakeDb>["db"]) => (await new RecipesService(db).getDishRecipe(HOUSE_A, TART, "owner")) as any;

describe("a serve that cannot be read, and one that has nothing recorded", () => {
  it("tables the migrations never created: says it could not be read, shows no figure, and the cost is still read", async () => {
    const out = await read(dbWithout(house({}), ["item_nutrition", "item_allergens"]));
    expect(out.whatIsIn).toMatchObject({ readable: false });
    expect(String(out.whatIsIn.sentence)).toMatch(/could not be read/i);
    expect(out.whatIsIn).not.toHaveProperty("energyKcal");
    expect(out.cost).toMatchObject({ priced: expect.any(Number) });
  });

  it("tables present with no rows (a seed that stored nothing): readable, every figure unknown, never zero", async () => {
    const out = await read(fakeDb(house({ item_nutrition: [], item_allergens: [] })).db);
    expect(out.whatIsIn.readable).toBe(true);
    expect(out.whatIsIn.sentence).toBeUndefined();
    expect(JSON.stringify(out.whatIsIn)).not.toMatch(/"(energyKcal|kcal)":0\b/);
  });

  it("tables present with rows for the flour: the figures are counted and the read says it is readable", async () => {
    const nutrition = [{ restaurant_id: HOUSE_A, inventory_id: FLOUR, basis: "per_100g", energy_kcal: 364, fat_g: 1, saturates_g: 0.2, carbohydrate_g: 76, sugars_g: 0.3, protein_g: 10, salt_g: 0, abv_pct: null, energy_from_abv: false }];
    const out = await read(fakeDb(house({ item_nutrition: nutrition, item_allergens: [{ restaurant_id: HOUSE_A, inventory_id: FLOUR, allergen: "gluten", status: "contains" }] })).db);
    expect(out.whatIsIn.readable).toBe(true);
    expect(JSON.stringify(out.whatIsIn)).toMatch(/gluten/);
  });
});
