import type { BaseUnit } from "./recipe-cost";
import { FIGURE_COLUMN, FIGURE_KEYS, serveNutrition, type ItemFigures, type MadeComponent, type NutritionLineInput } from "./recipe-nutrition";

/**
 * What a made line's component holds (r110 g2), for the recipe sheet
 * (whatIsIn) and the list's allergen column: one helper, so they agree.
 * Reads each component's current lines, then the components those draw, at
 * most MADE_DEPTH levels with a visited set; then what each linked good
 * states. This house's rows only, chunked and paged past the 1,000-row cap.
 * A batch is summed whole (yield 1); a loop or a component too deep has
 * `batch: null`, so its line is not counted and nothing reads free. A failed
 * read throws; the caller says it.
 */
export const MADE_DEPTH = 3;
const PAGE = 1000;
const CHUNK = 20;

interface Client {
  from(table: string): any;
}

type Row = Record<string, any>;

const chunks = <T>(xs: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Every page of one read ordered by a unique key; throws on a failed page. */
async function all(read: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function byChunks(ids: string[], read: (ids: string[]) => (from: number, to: number) => PromiseLike<any>): Promise<Row[]> {
  return (await Promise.all(chunks(ids).map((part) => all(read(part))))).flat();
}

const grams = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Each component's batch; `figures: false` reads allergens only (the list column). */
export async function madeLineNutrition(
  client: Client,
  restaurantId: string,
  componentIds: string[],
  opts: { figures: boolean },
): Promise<Map<string, MadeComponent>> {
  const info = new Map<string, { name: string; yieldQtyBase: number | null; yieldBaseUnit: BaseUnit | null; lines: Row[] }>();
  let frontier = [...new Set(componentIds)];
  const visited = new Set(frontier);
  for (let level = 1; level <= MADE_DEPTH && frontier.length; level++) {
    const [dishes, pointers] = await Promise.all([
      byChunks(frontier, (ids) => (from, to) =>
        client
          .from("dishes")
          .select("id, name, yield_qty_base, yield_base_unit")
          .eq("restaurant_id", restaurantId)
          .is("deleted_at", null)
          .in("id", ids)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      byChunks(frontier, (ids) => (from, to) =>
        client
          .from("recipe_current_dish")
          .select("dish_id, version_id")
          .eq("restaurant_id", restaurantId)
          .in("dish_id", ids)
          .order("dish_id", { ascending: true })
          .range(from, to),
      ),
    ]);
    const versionOf = new Map(pointers.map((p) => [p.version_id as string, p.dish_id as string]));
    const lines = await byChunks([...versionOf.keys()], (ids) => (from, to) =>
      client
        .from("recipe_lines")
        .select("id, version_id, position, label, role, inventory_id, component_dish_id, qty_base, base_unit")
        .eq("restaurant_id", restaurantId)
        .in("version_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const d of dishes) {
      info.set(d.id, {
        name: d.name,
        yieldQtyBase: d.yield_qty_base == null ? null : Number(d.yield_qty_base),
        yieldBaseUnit: (d.yield_base_unit ?? null) as BaseUnit | null,
        lines: [],
      });
    }
    const next: string[] = [];
    for (const l of lines) {
      const owner = info.get(versionOf.get(l.version_id) ?? "");
      if (!owner) continue;
      owner.lines.push(l);
      if (l.component_dish_id && !visited.has(l.component_dish_id)) {
        visited.add(l.component_dish_id);
        next.push(l.component_dish_id);
      }
    }
    frontier = next;
  }

  const itemIds = [...new Set([...info.values()].flatMap((c) => c.lines.map((l) => l.inventory_id).filter(Boolean)))] as string[];
  const [allergenRows, nutritionRows, weightRows] = await Promise.all([
    byChunks(itemIds, (ids) => (from, to) =>
      client
        .from("item_allergens")
        .select("id, inventory_id, allergen, status")
        .eq("restaurant_id", restaurantId)
        .in("inventory_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    opts.figures
      ? byChunks(itemIds, (ids) => (from, to) =>
          client
            .from("item_nutrition")
            .select("inventory_id, basis, energy_kcal, fat_g, saturates_g, carbohydrate_g, sugars_g, protein_g, salt_g, abv_pct, energy_from_abv")
            .eq("restaurant_id", restaurantId)
            .in("inventory_id", ids)
            .order("inventory_id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve([] as Row[]),
    opts.figures
      ? byChunks(itemIds, (ids) => (from, to) =>
          client
            .from("restaurant_inventory")
            .select("id, piece_grams, ml_grams")
            .eq("restaurant_id", restaurantId)
            .in("id", ids)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve([] as Row[]),
  ]);
  const allergens = new Map<string, Array<{ allergen: string; status: string }>>();
  for (const a of allergenRows) allergens.set(a.inventory_id, [...(allergens.get(a.inventory_id) ?? []), { allergen: a.allergen, status: a.status }]);
  const figures = new Map<string, ItemFigures>();
  for (const r of nutritionRows) {
    const f = { basis: r.basis, energyFromAbv: Boolean(r.energy_from_abv) } as ItemFigures;
    for (const k of FIGURE_KEYS) {
      const raw = r[FIGURE_COLUMN[k]];
      f[k] = raw === null || raw === undefined ? null : Number(raw);
    }
    figures.set(r.inventory_id, f);
  }
  const weights = new Map(weightRows.map((w) => [w.id as string, { pieceGrams: grams(w.piece_grams), mlGrams: grams(w.ml_grams) }]));

  const memo = new Map<string, MadeComponent | null>();
  const busy = new Set<string>();
  const build = (id: string): MadeComponent | null => {
    if (memo.has(id)) return memo.get(id)!;
    const c = info.get(id);
    if (!c) return null; // another house's, gone, or too deep
    if (busy.has(id)) return { name: c.name, batch: null, yieldQtyBase: c.yieldQtyBase, yieldBaseUnit: c.yieldBaseUnit };
    busy.add(id);
    const batch = serveNutrition(
      [...c.lines].sort((a, b) => a.position - b.position).map((l) => toInput(l, figures, weights, allergens, build)),
      1,
    );
    busy.delete(id);
    const out: MadeComponent = { name: c.name, batch, yieldQtyBase: c.yieldQtyBase, yieldBaseUnit: c.yieldBaseUnit };
    memo.set(id, out);
    return out;
  };
  const out = new Map<string, MadeComponent>();
  for (const id of new Set(componentIds)) {
    const c = build(id);
    if (c) out.set(id, c);
  }
  return out;
}

/** One recipe line as serveNutrition takes it. */
export function toInput(
  l: Row,
  figures: Map<string, ItemFigures>,
  weights: Map<string, { pieceGrams: number | null; mlGrams: number | null }>,
  allergens: Map<string, Array<{ allergen: string; status: string }>>,
  component: (id: string) => MadeComponent | null,
): NutritionLineInput {
  const id = l.inventory_id ?? null;
  return {
    label: l.label ?? "",
    role: l.role,
    inventoryId: id,
    qtyBase: Number(l.qty_base),
    baseUnit: l.base_unit as BaseUnit,
    figures: (id && figures.get(id)) || null,
    pieceGrams: (id && weights.get(id)?.pieceGrams) ?? null,
    mlGrams: (id && weights.get(id)?.mlGrams) ?? null,
    allergens: (id && allergens.get(id)) || [],
    component: l.role === "made" && l.component_dish_id ? component(l.component_dish_id) : null,
  };
}
