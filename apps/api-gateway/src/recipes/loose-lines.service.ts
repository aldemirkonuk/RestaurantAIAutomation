import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { DishesService, ID_CHUNK, PAGE, inWaves } from "./dishes.service";
import { foldName } from "./name-fold";

export const LOOSE_LINES_UNREAD = "Your drinks' lines could not be read just now, so none is offered to link.";
export const LOOSE_DISH_LINES_UNREAD = "Your dishes' lines could not be read just now, so none is offered to add.";

/** Whose lines: a house drink's (the default, every current caller) or a dish's (r109 inventory g4). */
export type LooseKind = "drink" | "dish";

/** Where each kind keeps its current pointer and its owner row (ADR 0360 drinks, ADR 0366 dishes). */
const OWNER = {
  drink: { current: "recipe_current", key: "cocktail_id", owners: "cocktails", cols: "id, name, display_name", unread: LOOSE_LINES_UNREAD },
  dish: { current: "recipe_current_dish", key: "dish_id", owners: "dishes", cols: "id, name", unread: LOOSE_DISH_LINES_UNREAD },
} as const;

/** A line's base unit, as the good's own unit family: mg is weighed (g), ml10 poured (ml), each_milli counted. */
const FAMILY: Record<string, "g" | "ml" | "each"> = { mg: "g", ml10: "ml", each_milli: "each" };

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

/** A dish's whole current version, in the PUT's own shape plus the version it was read at. */
export interface LooseDish extends Omit<LooseDrink, "cocktailId"> {
  dishId: string;
}

/**
 * Every loose line of one folded name across the dishes. `proposed` is the
 * unit a new good would be kept in, only when every line shares one base
 * family (g, ml or each), else null. `shelf` is the one live good of that name
 * when there is exactly one (the line may only need linking), with `sameName`.
 */
export interface LooseDishGroup {
  key: string;
  label: string;
  lines: Array<{ dishId: string; index: number }>;
  dishCount: number;
  proposed: "g" | "ml" | "each" | null;
  shelf: LooseGroup["proposed"];
  sameName: number;
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

/** One owner (drink or dish) as read, before its id is named for its kind. */
type Owned = Omit<LooseDrink, "cocktailId"> & { ownerId: string };
type Grouped = {
  key: string;
  label: string;
  lines: Array<{ ownerId: string; index: number }>;
  ownerCount: number;
  shelf: LooseGroup["proposed"];
  sameName: number;
  families: Set<"g" | "ml" | "each" | null>;
};

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

  private async all<T>(what: string, read: (from: number, to: number) => Read, unread = LOOSE_LINES_UNREAD): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await read(from, from + PAGE - 1);
      if (error) {
        this.logger.error(`loose lines: ${what} failed: ${error.message}`);
        throw new ServiceUnavailableException(unread);
      }
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async looseLines(restaurantId: string): Promise<{ lineCount: number; drinkCount: number; groups: LooseGroup[]; drinks: LooseDrink[] }> {
    const r = await this.read(restaurantId, "drink");
    const drinks = r.owners.map(({ ownerId, ...d }) => ({ cocktailId: ownerId, ...d }));
    return {
      lineCount: r.lineCount,
      drinkCount: r.ownerCount,
      groups: r.groups.map((g) => ({
        key: g.key,
        label: g.label,
        lines: g.lines.map((l) => ({ cocktailId: l.ownerId, index: l.index })),
        drinkCount: g.ownerCount,
        proposed: g.shelf,
        sameName: g.sameName,
      })),
      drinks,
    };
  }

  /**
   * The same queue across the house's dishes (r109 inventory g4): each dish
   * recipe line that names a food with no good behind it. Read through
   * recipe_current_dish, the dishes' own pointer; the shape matches the drinks'
   * so the one dish PUT re-saves each dish with only `inventoryId` changed.
   */
  async looseDishLines(restaurantId: string): Promise<{ lineCount: number; dishCount: number; groups: LooseDishGroup[]; dishes: LooseDish[] }> {
    const r = await this.read(restaurantId, "dish");
    return {
      lineCount: r.lineCount,
      dishCount: r.ownerCount,
      groups: r.groups.map((g) => ({
        key: g.key,
        label: g.label,
        lines: g.lines.map((l) => ({ dishId: l.ownerId, index: l.index })),
        dishCount: g.ownerCount,
        proposed: g.families.size === 1 && !g.families.has(null) ? ([...g.families][0] as "g" | "ml" | "each") : null,
        shelf: g.shelf,
        sameName: g.sameName,
      })),
      dishes: r.owners.map(({ ownerId, ...d }) => ({ dishId: ownerId, ...d })),
    };
  }

  private async read(restaurantId: string, kind: LooseKind) {
    const o = OWNER[kind];
    const all = <T>(what: string, read: (from: number, to: number) => Read) => this.all<T>(what, read, o.unread);
    const client = this.db.getClient();
    // 1. Every counted line with no good, in any version of this house.
    const loose = await all<any>("loose line read", (from, to) =>
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
    const none = { lineCount: 0, ownerCount: 0, groups: [] as Grouped[], owners: [] as Owned[] };
    if (!versionIds.length) return none;

    // 2. Which of those versions is a drink's current one.
    const pointers = (
      await inWaves(chunk(versionIds), (ids) =>
        all<any>(`${kind} pointer read`, (from, to) =>
          client
            .from(o.current)
            .select(`${o.key}, version_id`)
            .eq("restaurant_id", restaurantId)
            .in("version_id", ids)
            .order(o.key, { ascending: true })
            .range(from, to),
        ),
      )
    ).flat()
      .map((p) => ({ ownerId: p[o.key] as string, version_id: p.version_id as string }));
    const cocktailIds = [...new Set(pointers.map((p) => p.ownerId))];
    if (!cocktailIds.length) return none;

    // 3. The live drinks, their versions and every line of each (the PUT needs the whole version).
    const [cocktails, versionRows] = await Promise.all([
      inWaves(chunk(cocktailIds), (ids) =>
        all<any>(`${kind} read`, (from, to) =>
          client
            .from(o.owners)
            .select(o.cols)
            .eq("restaurant_id", restaurantId)
            .is("deleted_at", null)
            .in("id", ids)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ),
      inWaves(chunk(pointers.map((p) => p.version_id as string)), (ids) =>
        Promise.all([
          all<any>(`${kind} version read`, (from, to) =>
            client
              .from("recipe_versions")
              .select(`id, ${o.key}, yield_serves, method, glass, garnish`)
              .eq("restaurant_id", restaurantId)
              .in("id", ids)
              .order("id", { ascending: true })
              .range(from, to),
          ),
          all<any>(`${kind} line read`, (from, to) =>
            client
              .from("recipe_lines")
              .select("id, version_id, position, role, inventory_id, component_dish_id, label, qty_entered, unit_code, base_unit, usable_pct")
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

    const drinks: Owned[] = [];
    const places: Array<{ ownerId: string; index: number; label: string; family: "g" | "ml" | "each" | null }> = [];
    for (const p of pointers) {
      const c = live.get(p.ownerId);
      const v = versions.get(p.version_id);
      if (!c || !v || v[o.key] !== p.ownerId) continue;
      const rows = [...(linesOf.get(p.version_id) ?? [])].sort((a, b) => a.position - b.position);
      rows.forEach((l, index) => {
        if (l.role === "stocked" && !l.inventory_id) {
          places.push({ ownerId: p.ownerId, index, label: l.label, family: FAMILY[l.base_unit] ?? null });
        }
      });
      drinks.push({
        ownerId: p.ownerId,
        name: c.display_name || c.name,
        versionId: p.version_id,
        yieldServes: Number(v.yield_serves),
        method: v.method ?? null,
        glass: v.glass ?? null,
        garnish: v.garnish ?? null,
        lines: rows.map(saveLine),
      });
    }
    drinks.sort((a, b) => a.name.localeCompare(b.name) || a.ownerId.localeCompare(b.ownerId));
    const order = new Map(drinks.map((d, i) => [d.ownerId, i]));
    places.sort((a, b) => (order.get(a.ownerId) ?? 0) - (order.get(b.ownerId) ?? 0) || a.index - b.index);

    // 4. Group by folded name, in drink order, and propose the one good of that name.
    const groups = new Map<string, Grouped>();
    for (const { ownerId, index, label, family } of places) {
      const key = foldName(label);
      const g = groups.get(key) ?? { key, label, lines: [], ownerCount: 0, shelf: null, sameName: 0, families: new Set() };
      g.lines.push({ ownerId, index });
      g.families.add(family);
      groups.set(key, g);
    }
    const list = [...groups.values()];
    const matches = list.length ? await this.dishes.matchShelf(restaurantId, list.map((g) => g.label)) : [];
    list.forEach((g, i) => {
      g.ownerCount = new Set(g.lines.map((l) => l.ownerId)).size;
      g.shelf = matches[i]?.item ?? null;
      g.sameName = matches[i]?.sameName ?? 0;
    });
    list.sort((a, b) => b.lines.length - a.lines.length || a.key.localeCompare(b.key));
    const affected = new Set(places.map((p) => p.ownerId));
    return {
      lineCount: places.length,
      ownerCount: affected.size,
      groups: list,
      owners: drinks.filter((d) => affected.has(d.ownerId)),
    };
  }
}
