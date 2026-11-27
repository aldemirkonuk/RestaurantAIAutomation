import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { DishesService, ID_CHUNK, PAGE, inWaves } from "./dishes.service";
import { foldName } from "./name-fold";

export const LOOSE_LINES_UNREAD = "Your drinks' lines could not be read just now, so none is offered to link.";

type Read = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

/** One line as the recipe PUT takes it (SaveRecipeDto's RecipeLineDto), so a client can send it back unchanged. */
export interface SaveLine {
  role: string;
  componentId: string | null;
  inventoryId: string | null;
  label: string;
  qty: number;
  unit: string;
  usablePct: number | null;
}

/** A drink's whole current version, in the PUT's own shape plus the version it was read at. */
export interface LooseDrink {
  cocktailId: string;
  name: string;
  versionId: string;
  yieldServes: number;
  method: string | null;
  glass: string | null;
  garnish: string | null;
  lines: SaveLine[];
}

/** Every loose line of one folded name, with the one shelf good of that name when there is exactly one. */
export interface LooseGroup {
  key: string;
  label: string;
  /** Each line: its drink and its index in that drink's `lines`. */
  lines: Array<{ cocktailId: string; index: number }>;
  drinkCount: number;
  proposed: { id: string; name: string; kind: string | null; uom: string | null; bottleSizeMl: number | null } | null;
  /** How many live shelf goods have this name: 2 or more proposes none. */
  sameName: number;
}

const chunk = <T>(xs: T[], n = ID_CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

const saveLine = (l: any): SaveLine => ({
  role: l.role,
  componentId: l.component_dish_id ?? null,
  inventoryId: l.inventory_id ?? null,
  label: l.label,
  qty: Number(l.qty_entered),
  unit: l.unit_code,
  usablePct: l.usable_pct == null ? null : Number(l.usable_pct),
});

/**
 * The queue of every counted line, across the house's drinks, that names no
 * shelf good (r108 drinks-g9). Only CURRENT versions count: an earlier
 * version is history and is never re-saved. Each affected drink comes back
 * whole, in the PUT's shape, with the version it was read at, so linking a
 * line is the one existing save (save_recipe_version, its 409 and its audit)
 * with only `inventoryId` changed: there is no second write path.
 *
 * Every read is house-scoped and paged past PostgREST's 1,000-row cap.
 * The proposal per group is `matchShelf`'s: one live good of the same folded
 * name, else none.
 */
@Injectable()
export class LooseLinesService {
  private readonly logger = new Logger(LooseLinesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly dishes: DishesService,
  ) {}

  private async all<T>(what: string, read: (from: number, to: number) => Read): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await read(from, from + PAGE - 1);
      if (error) {
        this.logger.error(`loose lines: ${what} failed: ${error.message}`);
        throw new ServiceUnavailableException(LOOSE_LINES_UNREAD);
      }
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async looseLines(restaurantId: string): Promise<{ lineCount: number; drinkCount: number; groups: LooseGroup[]; drinks: LooseDrink[] }> {
    const client = this.db.getClient();
    // 1. Every counted line with no good, in any version of this house.
    const loose = await this.all<any>("loose line read", (from, to) =>
      client
        .from("recipe_lines")
        .select("id, version_id")
        .eq("restaurant_id", restaurantId)
        .eq("role", "stocked")
        .is("inventory_id", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const versionIds = [...new Set(loose.map((l) => l.version_id as string))];
    if (!versionIds.length) return { lineCount: 0, drinkCount: 0, groups: [], drinks: [] };

    // 2. Which of those versions is a drink's current one.
    const pointers = (
      await inWaves(chunk(versionIds), (ids) =>
        this.all<any>("drink pointer read", (from, to) =>
          client
            .from("recipe_current")
            .select("cocktail_id, version_id")
            .eq("restaurant_id", restaurantId)
            .in("version_id", ids)
            .order("cocktail_id", { ascending: true })
            .range(from, to),
        ),
      )
    ).flat();
    const cocktailIds = [...new Set(pointers.map((p) => p.cocktail_id as string))];
    if (!cocktailIds.length) return { lineCount: 0, drinkCount: 0, groups: [], drinks: [] };

    // 3. The live drinks, their versions and every line of each (the PUT needs the whole version).
    const [cocktails, versionRows] = await Promise.all([
      inWaves(chunk(cocktailIds), (ids) =>
        this.all<any>("drink read", (from, to) =>
          client
            .from("cocktails")
            .select("id, name, display_name")
            .eq("restaurant_id", restaurantId)
            .is("deleted_at", null)
            .in("id", ids)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ),
      inWaves(chunk(pointers.map((p) => p.version_id as string)), (ids) =>
        Promise.all([
          this.all<any>("drink version read", (from, to) =>
            client
              .from("recipe_versions")
              .select("id, cocktail_id, yield_serves, method, glass, garnish")
              .eq("restaurant_id", restaurantId)
              .in("id", ids)
              .order("id", { ascending: true })
              .range(from, to),
          ),
          this.all<any>("drink line read", (from, to) =>
            client
              .from("recipe_lines")
              .select("id, version_id, position, role, inventory_id, component_dish_id, label, qty_entered, unit_code, usable_pct")
              .eq("restaurant_id", restaurantId)
              .in("version_id", ids)
              .order("id", { ascending: true })
              .range(from, to),
          ),
        ]),
      ),
    ]);
    const live = new Map<string, any>(cocktails.flat().map((c) => [c.id as string, c]));
    const versions = new Map<string, any>();
    const linesOf = new Map<string, any[]>();
    for (const [vs, ls] of versionRows) {
      for (const v of vs) versions.set(v.id, v);
      for (const l of ls) linesOf.set(l.version_id, [...(linesOf.get(l.version_id) ?? []), l]);
    }

    const drinks: LooseDrink[] = [];
    const places: Array<{ cocktailId: string; index: number; label: string }> = [];
    for (const p of pointers) {
      const c = live.get(p.cocktail_id);
      const v = versions.get(p.version_id);
      if (!c || !v || v.cocktail_id !== p.cocktail_id) continue;
      const rows = [...(linesOf.get(p.version_id) ?? [])].sort((a, b) => a.position - b.position);
      rows.forEach((l, index) => {
        if (l.role === "stocked" && !l.inventory_id) places.push({ cocktailId: p.cocktail_id, index, label: l.label });
      });
      drinks.push({
        cocktailId: p.cocktail_id,
        name: c.display_name || c.name,
        versionId: p.version_id,
        yieldServes: Number(v.yield_serves),
        method: v.method ?? null,
        glass: v.glass ?? null,
        garnish: v.garnish ?? null,
        lines: rows.map(saveLine),
      });
    }
    drinks.sort((a, b) => a.name.localeCompare(b.name) || a.cocktailId.localeCompare(b.cocktailId));
    const order = new Map(drinks.map((d, i) => [d.cocktailId, i]));
    places.sort((a, b) => (order.get(a.cocktailId) ?? 0) - (order.get(b.cocktailId) ?? 0) || a.index - b.index);

    // 4. Group by folded name, in drink order, and propose the one good of that name.
    const groups = new Map<string, LooseGroup>();
    for (const { cocktailId, index, label } of places) {
      const key = foldName(label);
      const g = groups.get(key) ?? { key, label, lines: [], drinkCount: 0, proposed: null, sameName: 0 };
      g.lines.push({ cocktailId, index });
      groups.set(key, g);
    }
    const list = [...groups.values()];
    const matches = list.length ? await this.dishes.matchShelf(restaurantId, list.map((g) => g.label)) : [];
    list.forEach((g, i) => {
      g.drinkCount = new Set(g.lines.map((l) => l.cocktailId)).size;
      g.proposed = matches[i]?.item ?? null;
      g.sameName = matches[i]?.sameName ?? 0;
    });
    list.sort((a, b) => b.lines.length - a.lines.length || a.key.localeCompare(b.key));
    const affected = new Set(places.map((p) => p.cocktailId));
    return {
      lineCount: places.length,
      drinkCount: affected.size,
      groups: list,
      drinks: drinks.filter((d) => affected.has(d.cocktailId)),
    };
  }
}
