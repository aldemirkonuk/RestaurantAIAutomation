/**
 * r104 drinks gap 1 (ADR 0397): the components' lines are read in chunks. One
 * query over every component's current lines held 40 lines a version for N
 * versions with no paging, so 26 full components came to 1,040 rows and the
 * 1,000-row cap cut the last one: it was priced over the lines that came back,
 * a smaller cost with no word (ADR 0051).
 */
import { RecipesService } from "./recipes.service";
import { FAKE_PAGE, FLOUR, HOUSE_A, TART, V_TART_2, fakeDb, line, type Row } from "./dishes.testing";
import { partlyInvoiced, withSyrup } from "./made.testing";

const N = 26;
const id = (kind: "d" | "e", i: number) => `${kind}0000000-0000-4000-8000-0000000c${String(i).padStart(4, "0")}`;

function manyFullComponents(): Record<string, Row[]> {
  const rows = partlyInvoiced(withSyrup());
  rows.recipe_lines = [];
  for (let i = 1; i <= N; i++) {
    rows.dishes.push({ id: id("d", i), restaurant_id: HOUSE_A, name: `Batch ${i}`, yield_qty_base: 7000, yield_base_unit: "ml10", deleted_at: null });
    rows.recipe_current_dish.push({ dish_id: id("d", i), version_id: id("e", i), restaurant_id: HOUSE_A });
    rows.recipe_versions.push({ id: id("e", i), restaurant_id: HOUSE_A, dish_id: id("d", i), owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" });
    for (let p = 1; p <= 40; p++) rows.recipe_lines.push(line(`c${i}-${p}`, id("e", i), HOUSE_A, p, "Sugar", FLOUR, { qty_entered: 1, qty_base: 1000 }));
    // The tart is one serve and takes 40 ml of every batch.
  }
  return rows;
}

describe("a component is never priced over a cut read", () => {
  it(`prices ${N} components of 40 lines (more than ${FAKE_PAGE} rows) alike, each over all its lines`, async () => {
    const rows = manyFullComponents();
    expect(rows.recipe_lines.length).toBeGreaterThan(FAKE_PAGE);
    // The tart's own version: 26 made lines, one for each batch (a sheet holds at most 40).
    for (let i = 1; i <= N; i++) {
      rows.recipe_lines.push(line(`t${i}`, V_TART_2, HOUSE_A, i, `Batch ${i}`, null, { role: "made", component_dish_id: id("d", i), qty_entered: 40, unit_code: "ml", qty_base: 400, base_unit: "ml10" }));
    }
    const out = (await new RecipesService(fakeDb(rows).db).getDishRecipe(HOUSE_A, TART, "owner")) as any;
    const made = out.current.lines.filter((l: any) => l.role === "made");
    expect(made).toHaveLength(N);
    const costs = new Set(made.map((l: any) => l.costPerServe));
    expect(costs.size).toBe(1);
    expect(made[0].costPerServe).not.toBeNull();
    expect(out.cost).toMatchObject({ complete: true, priced: N, of: N });
  });
});
