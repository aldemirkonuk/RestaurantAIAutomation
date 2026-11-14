import { DishesService, ID_CHUNK, WAVE, inWaves } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { FLOUR, HOUSE_A, fakeDb, line, twoHouses, type Row } from "./dishes.testing";

/**
 * r36 recipes audit, gap 10: /dishes and /cocktails read their figures in
 * chunks of 20 ids, and read the chunks one after another. These pin the
 * waves: answers in chunk order, never more than WAVE reads at once, a failed
 * chunk fails the read, and a long list is figured exactly as before.
 */

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("inWaves", () => {
  it("answers in chunk order even when a later chunk answers first", async () => {
    const out = await inWaves([30, 10, 20, 0], async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 10, 20, 0]);
  });

  it("never has more than the width in flight, and uses all of it", async () => {
    let now = 0;
    let most = 0;
    await inWaves(Array.from({ length: 11 }, (_, i) => i), async () => {
      most = Math.max(most, ++now);
      await tick();
      now--;
    });
    expect(most).toBe(WAVE);
    expect(WAVE).toBe(4);
  });

  it("fails the whole read when one chunk fails", async () => {
    await expect(
      inWaves([1, 2, 3, 4, 5, 6], async (n) => {
        await tick();
        if (n === 5) throw new Error("chunk 5 failed");
        return n;
      }),
    ).rejects.toThrow("chunk 5 failed");
  });

  it("reads nothing for no chunks", async () => {
    const read = jest.fn();
    expect(await inWaves([], read)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});

/** 130 dishes, each with its own current version and one flour line. */
function manyDishes(n = 130): Record<string, Row[]> {
  const rows = twoHouses();
  const id = (p: string, i: number) => `${p}0000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  for (let i = 0; i < n; i++) {
    rows.dishes.push({ id: id("7", i), restaurant_id: HOUSE_A, name: `Plate ${String(i).padStart(3, "0")}`, menu_section: null, price: 10, deleted_at: null });
    rows.recipe_current_dish.push({ dish_id: id("7", i), version_id: id("8", i), restaurant_id: HOUSE_A });
    rows.recipe_versions.push({ id: id("8", i), restaurant_id: HOUSE_A, dish_id: id("7", i), owner_kind: "dish", version: 1, yield_serves: (i % 5) + 1, created_at: "2026-11-02" });
    rows.recipe_lines.push(line(id("9", i), id("8", i), HOUSE_A, 1, "Flour", FLOUR, { qty_entered: 100 + i, qty_base: (100 + i) * 1000 }));
  }
  return rows;
}

/** The real services over the fake, with every read held for a tick and the reads in flight counted per table. */
function slowServices(rows: Record<string, Row[]>) {
  const fake = fakeDb(rows);
  const client: any = fake.db.getClient();
  const base = client.from;
  const inFlight: Record<string, number> = {};
  const most: Record<string, number> = {};
  const count: Record<string, number> = {};
  client.from = (table: string) => {
    const q = base(table);
    const then = q.then;
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      inFlight[table] = (inFlight[table] ?? 0) + 1;
      count[table] = (count[table] ?? 0) + 1;
      most[table] = Math.max(most[table] ?? 0, inFlight[table]);
      return tick().then(() => {
        inFlight[table]--;
        return then(ok, bad);
      });
    };
    return q;
  };
  return { dishes: new DishesService(fake.db, new RecipesService(fake.db)), most, count };
}

describe("figures: a long list read in waves", () => {
  it("reads 130 dishes' pointers, versions and lines four chunks at a time", async () => {
    const { dishes, most, count } = slowServices(manyDishes());
    await dishes.listDishes(HOUSE_A, "staff");
    const chunks = Math.ceil(132 / ID_CHUNK); // the 130 plus the two live dishes of twoHouses
    expect(count.recipe_current_dish).toBe(chunks);
    expect(count.recipe_lines).toBe(chunks);
    expect(most.recipe_current_dish).toBe(WAVE);
    expect(most.recipe_versions).toBe(WAVE);
    expect(most.recipe_lines).toBe(WAVE);
  });

  it("figures every dish of a long list as its own, whichever chunk it was read in", async () => {
    const { dishes } = slowServices(manyDishes());
    const out = await dishes.listDishes(HOUSE_A, "owner");
    const plates = out.filter((d) => d.name.startsWith("Plate "));
    expect(plates).toHaveLength(130);
    plates.forEach((d) => {
      const i = Number(d.name.slice(6));
      expect([d.name, d.hasRecipe, d.yieldServes, d.lineCount]).toEqual([d.name, true, (i % 5) + 1, 1]);
      // Flour at 2 a kg: (100 + i) g over the yield, priced in full.
      expect([d.name, d.cost?.complete, d.cost?.perServeExact]).toEqual([d.name, true, expect.closeTo(((100 + i) / 1000) * 2 / ((i % 5) + 1), 6)]);
    });
  });
});
