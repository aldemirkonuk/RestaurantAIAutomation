import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { seesHouseAmounts } from "../dashboard/amounts-for-role";
import { BaseUnit, CostItem, recipeCost } from "./recipe-cost";
import { serveNutrition, type Allergen, type AllergenStatus } from "./recipe-nutrition";
import { CreateDishDto, UpdateDishDto } from "./dto/recipes.dto";
import { DISH_NOT_THIS_HOUSE, RecipesService } from "./recipes.service";
import { foldName } from "./name-fold";
import { readCurrentMenuLines } from "../menus/current-menu-lines";
import { menuIndex, menuPriceFor, type MenuLine } from "./menu-price-match";

export const DISHES_UNREAD = "Your dishes could not be read just now. Nothing is shown rather than a wrong list.";
export const DISH_USE_UNREAD = "Which dishes use this item could not be read just now.";
export const DRINK_USE_UNREAD = "Which drinks use this item could not be read just now.";
export const MENU_PRICES_UNREAD = "Your menu's prices could not be read just now, so none is shown beside your list.";
export const DRINK_FIGURES_UNREAD = "Your drinks' costs could not be read just now, so none is shown.";

/** Whose recipe: a dish (recipe_current_dish) or a house drink (recipe_current). */
export type RecipeOwner = "dish" | "cocktail";
export const SHELF_MATCH_UNREAD = "The shelf could not be read just now, so no line is linked for you.";
export const ITEM_NOT_THIS_HOUSE = "This item is not on this house's shelf.";
export const DISH_NAME_NEEDED = "A dish needs a name.";
export const DISH_NOT_SAVED = "The dish could not be saved. Nothing was changed.";
export const dishNameTaken = (name: string) => `A dish named "${name}" is already on your list.`;

/** PostgREST answers at most this many rows a request; every read here pages past it. */
export const PAGE = 1000;
/** Ids sent in one `in()` filter, so the URL stays short. 20 versions x 40 lines < PAGE. */
export const ID_CHUNK = 20;

/** A name as two people would agree it is "the same name" (Turkish-aware; see name-fold.ts). */
export { foldName };

const chunks = <T>(xs: T[], n = ID_CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * How many chunk reads run at once (r36 recipes audit, gap 10). /dishes and
 * /cocktails read their figures in chunks of 20 ids; one chunk after another,
 * 120 dishes were 6 pointer waves, then 6 version-and-line waves, then the
 * pricing, before the page showed one cost. Four at a time cuts that to two
 * and two, while one house's list never opens more than a handful of
 * connections at once.
 */
export const WAVE = 4;

/**
 * `read` over every chunk, at most `width` at once, the answers in chunk
 * order. The first failure rejects the whole read, as one failed chunk did
 * before: a list is never shown from part of its chunks.
 */
export async function inWaves<T, R>(xs: T[], read: (x: T) => Promise<R>, width = WAVE): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  const lane = async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await read(xs[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, xs.length) }, lane));
  return out;
}

/**
 * Item ids sent in one allergen read. An item states at most 14 allergens, so
 * 50 items are at most 700 rows, under the 1,000-row cap; the read pages anyway.
 */
export const ALLERGEN_CHUNK = 50;

/**
 * What a list row says of its allergens (r36 recipes audit, gap 8), by the
 * sheet's own rule (recipe-nutrition.ts): free only when every line, untracked
 * too, states it free, and the lines that leave any allergen unstated are
 * named. Not money: every role reads it. A failed read says so on the row
 * (readable false) and never reads as allergen-free.
 */
export type RowAllergens =
  | { readable: true; status: Record<Allergen, AllergenStatus>; unstatedBy: string[] }
  | { readable: false };

type Read = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

/** A dish's figures at today's prices: its current version, its yield and its cost a plate. */
export interface DishFigures {
  versionId: string;
  yieldServes: number;
  lineCount: number;
  /** Null for a role that does not see money. */
  cost: {
    perServe: number | null;
    perServeExact: number | null;
    priced: number;
    of: number;
    complete: boolean;
    partial: number;
  } | null;
  /** Only when the caller asked for allergens. */
  allergens?: RowAllergens;
}

/**
 * Dishes (ADR 0366): the list a house keeps of its plates, the figures each
 * one has at today's prices, which dishes and which house drinks use a shelf
 * item (each with the same figures), and the exact-name shelf lookup a pasted
 * recipe line proposes its link from.
 *
 * Every read is scoped to the house in the path and pages past PostgREST's
 * 1,000-row cap; a failed read is a 503 with a sentence, never an empty list
 * (ADR 0020). A role that does not see money gets no price and no cost.
 */
@Injectable()
export class DishesService {
  private readonly logger = new Logger(DishesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly recipes: RecipesService,
  ) {}

  private failed(what: string, error: unknown, sentence: string): never {
    this.logger.error(`dishes: ${what} failed: ${(error as { message?: string })?.message ?? String(error)}`);
    throw new ServiceUnavailableException(sentence);
  }

  /** Every row of a read, page by page. `read(from, to)` must order by a unique key. */
  private async all<T>(what: string, sentence: string, read: (from: number, to: number) => Read): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await read(from, from + PAGE - 1);
      if (error) this.failed(what, error, sentence);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async listDishes(restaurantId: string, role: string | null | undefined) {
    const money = seesHouseAmounts(role);
    const client = this.db.getClient();
    const dishes = await this.all<any>("dish list read", DISHES_UNREAD, (from, to) =>
      client
        .from("dishes")
        .select("id, name, menu_section, price")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const figures = await this.figures(restaurantId, dishes.map((d) => d.id), money, DISHES_UNREAD, "dish", { allergens: true });
    return dishes
      .map((d) => ({
        id: d.id,
        name: d.name,
        section: d.menu_section ?? null,
        price: money && d.price != null ? Number(d.price) : null,
        ...this.figureFields(figures.get(d.id)),
        allergens: figures.get(d.id)?.allergens ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private figureFields(f: DishFigures | undefined) {
    return {
      hasRecipe: Boolean(f),
      yieldServes: f?.yieldServes ?? null,
      lineCount: f?.lineCount ?? 0,
      cost: f?.cost ?? null,
    };
  }

  /**
   * The figures of each dish (or drink) that has a current recipe, at today's
   * prices. One read per table (chunked by id), never one read per recipe.
   * A drink is priced exactly as a dish is, so the drawer's drink cards and
   * its dish cards can never price one good two ways.
   */
  async figures(
    restaurantId: string,
    ownerIds: string[],
    money: boolean,
    sentence: string,
    owner: RecipeOwner = "dish",
    opts: { allergens?: boolean } = {},
  ): Promise<Map<string, DishFigures>> {
    const client = this.db.getClient();
    const out = new Map<string, DishFigures>();
    if (!ownerIds.length) return out;

    // Two literal column lists per table, so the read-columns guard checks each.
    const pointers: Array<{ ownerId: string; versionId: string }> = [];
    const pointerReads = await inWaves(chunks(ownerIds), (ids) =>
      owner === "dish"
        ? this.all<any>("dish pointer read", sentence, (from, to) =>
            client
              .from("recipe_current_dish")
              .select("dish_id, version_id")
              .eq("restaurant_id", restaurantId)
              .in("dish_id", ids)
              .order("dish_id", { ascending: true })
              .range(from, to),
          )
        : this.all<any>("drink pointer read", sentence, (from, to) =>
            client
              .from("recipe_current")
              .select("cocktail_id, version_id")
              .eq("restaurant_id", restaurantId)
              .in("cocktail_id", ids)
              .order("cocktail_id", { ascending: true })
              .range(from, to),
          ),
    );
    for (const rows of pointerReads) {
      for (const r of rows) pointers.push({ ownerId: owner === "dish" ? r.dish_id : r.cocktail_id, versionId: r.version_id });
    }
    const versionIds = pointers.map((p) => p.versionId);
    const versions = new Map<string, { ownerId: string; yieldServes: number }>();
    const lines = new Map<string, any[]>();
    const versionReads = await inWaves(chunks(versionIds), (ids) =>
      Promise.all([
        owner === "dish"
          ? this.all<any>("dish version read", sentence, (from, to) =>
              client
                .from("recipe_versions")
                .select("id, dish_id, yield_serves")
                .eq("restaurant_id", restaurantId)
                .in("id", ids)
                .order("id", { ascending: true })
                .range(from, to),
            )
          : this.all<any>("drink version read", sentence, (from, to) =>
              client
                .from("recipe_versions")
                .select("id, cocktail_id, yield_serves")
                .eq("restaurant_id", restaurantId)
                .in("id", ids)
                .order("id", { ascending: true })
                .range(from, to),
            ),
        this.all<any>("recipe line read", sentence, (from, to) =>
          client
            .from("recipe_lines")
            .select("id, version_id, position, label, role, inventory_id, qty_base, base_unit, usable_pct")
            .eq("restaurant_id", restaurantId)
            .in("version_id", ids)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ]),
    );
    for (const [v, l] of versionReads) {
      for (const r of v) {
        versions.set(r.id, { ownerId: owner === "dish" ? r.dish_id : r.cocktail_id, yieldServes: Number(r.yield_serves) });
      }
      for (const r of l) lines.set(r.version_id, [...(lines.get(r.version_id) ?? []), r]);
    }

    const items = new Map<string, any>();
    const lots = new Map<string, any>();
    const itemIds = [...new Set([...lines.values()].flat().map((l) => l.inventory_id).filter(Boolean))] as string[];
    // The allergens are read beside the pricing, never after it.
    const allergenRead = opts.allergens ? this.allergensOf(restaurantId, itemIds, sentence) : Promise.resolve(null);
    if (money) {
      let reads: Array<{ items: Map<string, any>; lots: Map<string, any> }>;
      try {
        reads = await inWaves(chunks(itemIds, 100), (ids) => this.recipes.readPricing(restaurantId, ids, true));
      } catch (e) {
        await allergenRead;
        this.failed(`${owner} pricing read`, e, sentence);
      }
      for (const read of reads) {
        read.items.forEach((v, k) => items.set(k, v));
        read.lots.forEach((v, k) => lots.set(k, v));
      }
    }
    const allergenRows = await allergenRead;

    for (const p of pointers) {
      const v = versions.get(p.versionId);
      // A pointer whose version is not this house's, or not this owner's, is not read as a recipe.
      if (!v || v.ownerId !== p.ownerId) continue;
      const rows = [...(lines.get(p.versionId) ?? [])].sort((a, b) => a.position - b.position);
      const yieldServes = v.yieldServes;
      let cost: DishFigures["cost"] = null;
      if (money) {
        const priced = recipeCost(
          rows.map((l) => ({
            role: l.role,
            inventoryId: l.inventory_id,
            qtyBase: Number(l.qty_base),
            baseUnit: l.base_unit as BaseUnit,
            item: (l.inventory_id && (items.get(l.inventory_id) as CostItem)) || null,
            lot: (l.inventory_id && lots.get(l.inventory_id)) || null,
            usablePct: l.usable_pct ?? null,
          })),
          yieldServes,
        );
        cost = {
          perServe: priced.perServe,
          perServeExact: priced.perServeExact,
          priced: priced.priced,
          of: priced.of,
          complete: priced.complete,
          partial: priced.partial,
        };
      }
      const figures: DishFigures = { versionId: p.versionId, yieldServes, lineCount: rows.length, cost };
      if (opts.allergens) figures.allergens = rowAllergens(rows, yieldServes, allergenRows);
      out.set(p.ownerId, figures);
    }
    return out;
  }

  /**
   * The allergens each item states, by item id, or null when the read failed
   * (logged; the row then says it could not be read). Chunked, at most WAVE
   * chunks at once, each paged past the 1,000-row cap.
   */
  private async allergensOf(
    restaurantId: string,
    itemIds: string[],
    sentence: string,
  ): Promise<Map<string, Array<{ allergen: string; status: string }>> | null> {
    const client = this.db.getClient();
    try {
      const reads = await inWaves(chunks(itemIds, ALLERGEN_CHUNK), (ids) =>
        this.all<any>("item allergen read", sentence, (from, to) =>
          client
            .from("item_allergens")
            .select("id, inventory_id, allergen, status")
            .eq("restaurant_id", restaurantId)
            .in("inventory_id", ids)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      );
      const out = new Map<string, Array<{ allergen: string; status: string }>>();
      for (const rows of reads) {
        for (const a of rows) out.set(a.inventory_id, [...(out.get(a.inventory_id) ?? []), { allergen: a.allergen, status: a.status }]);
      }
      return out;
    } catch {
      return null;
    }
  }

  /**
   * The item's lines in recipes, and which CURRENT recipe each belongs to:
   * the dish (or drink) of every current version that links the item. An
   * earlier version that used the item does not count: the drawer says what
   * the house makes now. Throws 404 for another house's item.
   */
  private async currentUses(restaurantId: string, itemId: string, owner: RecipeOwner, sentence: string) {
    const client = this.db.getClient();
    const item = await client
      .from("restaurant_inventory")
      .select("id")
      .eq("id", itemId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (item.error) this.failed("item read", item.error, sentence);
    if (!item.data) throw new NotFoundException(ITEM_NOT_THIS_HOUSE);

    const used = await this.all<any>("item line read", sentence, (from, to) =>
      client
        .from("recipe_lines")
        .select("id, version_id, position, label, qty_entered, unit_code")
        .eq("restaurant_id", restaurantId)
        .eq("inventory_id", itemId)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const versionIds = [...new Set(used.map((l) => l.version_id as string))];
    const current = new Map<string, string>(); // version -> owner
    for (const ids of chunks(versionIds)) {
      const rows =
        owner === "dish"
          ? await this.all<any>("dish pointer read", sentence, (from, to) =>
              client
                .from("recipe_current_dish")
                .select("dish_id, version_id")
                .eq("restaurant_id", restaurantId)
                .in("version_id", ids)
                .order("dish_id", { ascending: true })
                .range(from, to),
            )
          : await this.all<any>("drink pointer read", sentence, (from, to) =>
              client
                .from("recipe_current")
                .select("cocktail_id, version_id")
                .eq("restaurant_id", restaurantId)
                .in("version_id", ids)
                .order("cocktail_id", { ascending: true })
                .range(from, to),
            );
      for (const r of rows) current.set(r.version_id, owner === "dish" ? r.dish_id : r.cocktail_id);
    }
    return { used, ownerIds: [...new Set(current.values())] };
  }

  /** This item's own lines in one owner's current version, in recipe order. */
  private usesIn(used: any[], f: DishFigures | undefined) {
    return used
      .filter((l) => f && l.version_id === f.versionId)
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ label: l.label, qtyEntered: Number(l.qty_entered), unitCode: l.unit_code }));
  }

  /**
   * The dishes whose CURRENT recipe links this item (ADR 0366 item 5), each
   * with its figures and the item's own lines in it.
   */
  async dishesUsingItem(restaurantId: string, itemId: string, role: string | null | undefined) {
    const money = seesHouseAmounts(role);
    const client = this.db.getClient();
    const { used, ownerIds } = await this.currentUses(restaurantId, itemId, "dish", DISH_USE_UNREAD);
    if (!ownerIds.length) return { dishes: [] };

    const dishes: any[] = [];
    for (const ids of chunks(ownerIds)) {
      dishes.push(
        ...(await this.all<any>("dish read", DISH_USE_UNREAD, (from, to) =>
          client
            .from("dishes")
            .select("id, name, menu_section, price")
            .eq("restaurant_id", restaurantId)
            .is("deleted_at", null)
            .in("id", ids)
            .order("id", { ascending: true })
            .range(from, to),
        )),
      );
    }
    const figures = await this.figures(restaurantId, dishes.map((d) => d.id), money, DISH_USE_UNREAD);
    return {
      dishes: dishes
        .map((d) => {
          const f = figures.get(d.id);
          return {
            dishId: d.id,
            name: d.name,
            section: d.menu_section ?? null,
            price: money && d.price != null ? Number(d.price) : null,
            ...this.figureFields(f),
            uses: this.usesIn(used, f),
          };
        })
        // A pointer that moved since the lines were read leaves a dish with no line of this item: not listed.
        .filter((d) => d.uses.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /**
   * The house's drinks whose CURRENT recipe links this item, each with the
   * same figures a dish has (cost a serve, price) and the item's own lines in
   * it, so the drawer gives a drink the cards it gives a dish. A catalogue
   * cocktail (no restaurant_id) or a deleted one is not this house's drink.
   */
  async drinksUsingItem(restaurantId: string, itemId: string, role: string | null | undefined) {
    const money = seesHouseAmounts(role);
    const client = this.db.getClient();
    const { used, ownerIds } = await this.currentUses(restaurantId, itemId, "cocktail", DRINK_USE_UNREAD);
    if (!ownerIds.length) return { drinks: [] };

    const drinks: any[] = [];
    for (const ids of chunks(ownerIds)) {
      drinks.push(
        ...(await this.all<any>("drink read", DRINK_USE_UNREAD, (from, to) =>
          client
            .from("cocktails")
            .select("id, name, display_name, menu_section, price")
            .eq("restaurant_id", restaurantId)
            .is("deleted_at", null)
            .in("id", ids)
            .order("id", { ascending: true })
            .range(from, to),
        )),
      );
    }
    const figures = await this.figures(restaurantId, drinks.map((d) => d.id), money, DRINK_USE_UNREAD, "cocktail");
    return {
      drinks: drinks
        .map((d) => {
          const f = figures.get(d.id);
          return {
            cocktailId: d.id,
            name: (d.display_name as string | null)?.trim() || d.name,
            section: d.menu_section ?? null,
            price: money && d.price != null ? Number(d.price) : null,
            ...this.figureFields(f),
            uses: this.usesIn(used, f),
          };
        })
        .filter((d) => d.uses.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /**
   * Every drink on the house's list with its figures at today's prices, for
   * the cost and pour cost columns of /cocktails (r28 recipes audit, gap 9).
   * The same `figures` as the drawer's drink cards, so a drink is never priced
   * two ways. One read of the list (paged), then one per table, never one per
   * drink. A role that does not see money gets no price and no cost.
   */
  async drinkFigures(restaurantId: string, role: string | null | undefined) {
    const money = seesHouseAmounts(role);
    const client = this.db.getClient();
    const drinks = await this.all<any>("drink list read", DRINK_FIGURES_UNREAD, (from, to) =>
      client
        .from("cocktails")
        .select("id, price")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const figures = await this.figures(restaurantId, drinks.map((d) => d.id), money, DRINK_FIGURES_UNREAD, "cocktail", {
      allergens: true,
    });
    return {
      drinks: drinks.map((d) => ({
        cocktailId: d.id,
        price: money && d.price != null ? Number(d.price) : null,
        ...this.figureFields(figures.get(d.id)),
        allergens: figures.get(d.id)?.allergens ?? null,
      })),
    };
  }

  /**
   * The price the house's current menu gives each dish and each drink of the
   * same name, beside the row's own price (r28 recipes audit, gap 2, slice 1;
   * the rule is in menu-price-match.ts). Reads only; nothing is linked. The
   * lists and the menu are read at once, each paged past the 1,000-row cap.
   * A role that does not see money reads nothing and is told so. A failed
   * read is a 503 with a sentence, never an empty answer.
   */
  async menuPrices(restaurantId: string, role: string | null | undefined) {
    if (!seesHouseAmounts(role)) return { amountsWithheld: true, currentMenus: null, dishes: [], drinks: [] };
    const client = this.db.getClient();
    const [dishes, drinks, menu] = await Promise.all([
      this.all<any>("dish list read", MENU_PRICES_UNREAD, (from, to) =>
        client
          .from("dishes")
          .select("id, name, price")
          .eq("restaurant_id", restaurantId)
          .is("deleted_at", null)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      this.all<any>("drink list read", MENU_PRICES_UNREAD, (from, to) =>
        client
          .from("cocktails")
          .select("id, name, display_name, price")
          .eq("restaurant_id", restaurantId)
          .is("deleted_at", null)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      readCurrentMenuLines(client, restaurantId).catch((e: unknown) => this.failed("current menu read", e, MENU_PRICES_UNREAD)),
    ]);
    if (menu.currentMenus === 0) return { amountsWithheld: false, currentMenus: 0, dishes: [], drinks: [] };
    const index = menuIndex(menu.rows as unknown as MenuLine[]);
    return {
      amountsWithheld: false,
      currentMenus: menu.currentMenus,
      dishes: dishes.map((d) => ({ dishId: d.id, menu: menuPriceFor([d.name], "dish", d.price, index) })),
      drinks: drinks.map((d) => ({ cocktailId: d.id, menu: menuPriceFor([d.display_name, d.name], "drink", d.price, index) })),
    };
  }

  /**
   * Each pasted label's shelf item, when exactly one live item of this house
   * has the same folded name (ADR 0366 item 7). Two or more is no match, and
   * says how many: guessing between them would cost the recipe wrong.
   */
  async matchShelf(restaurantId: string, labels: string[]) {
    const client = this.db.getClient();
    const shelf = await this.all<any>("shelf read", SHELF_MATCH_UNREAD, (from, to) =>
      client
        .from("restaurant_inventory")
        .select("id, display_name, kind, uom, bottle_size_ml")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const byName = new Map<string, any[]>();
    for (const r of shelf) {
      if (typeof r.display_name !== "string" || !r.display_name.trim()) continue;
      const k = foldName(r.display_name);
      byName.set(k, [...(byName.get(k) ?? []), r]);
    }
    return labels.map((label) => {
      const hits = byName.get(foldName(label)) ?? [];
      const r = hits.length === 1 ? hits[0] : null;
      return {
        label,
        item: r
          ? {
              id: r.id,
              name: r.display_name,
              kind: r.kind,
              uom: r.uom,
              bottleSizeMl: r.bottle_size_ml == null ? null : Number(r.bottle_size_ml),
            }
          : null,
        sameName: hits.length,
      };
    });
  }

  private dishOut(r: any) {
    return {
      id: r.id,
      name: r.name,
      section: r.menu_section ?? null,
      price: r.price == null ? null : Number(r.price),
      description: r.description ?? null,
    };
  }

  private writeFailed(error: { code?: string; message: string }, name: string | undefined): never {
    if (error.code === "23505") throw new ConflictException(dishNameTaken(name ?? ""));
    if (error.code === "23514") throw new BadRequestException(DISH_NOT_SAVED);
    this.logger.error(`dishes: write failed: ${error.message}`);
    throw new InternalServerErrorException(DISH_NOT_SAVED);
  }

  private static text(v: string | null | undefined): string | null {
    if (v === undefined || v === null) return null;
    const t = v.trim();
    return t ? t : null;
  }

  async createDish(restaurantId: string, dto: CreateDishDto) {
    const name = (dto.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) throw new BadRequestException(DISH_NAME_NEEDED);
    const { data, error } = await this.db
      .getClient()
      .from("dishes")
      .insert({
        restaurant_id: restaurantId,
        name,
        menu_section: DishesService.text(dto.section),
        price: dto.price ?? null,
        description: DishesService.text(dto.description),
      })
      .select("id, name, menu_section, price, description")
      .single();
    if (error) this.writeFailed(error, name);
    return this.dishOut(data);
  }

  async updateDish(restaurantId: string, dishId: string, dto: UpdateDishDto) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    let name: string | undefined;
    if (dto.name !== undefined) {
      name = (dto.name ?? "").trim().replace(/\s+/g, " ");
      if (!name) throw new BadRequestException(DISH_NAME_NEEDED);
      patch.name = name;
    }
    if (dto.section !== undefined) patch.menu_section = DishesService.text(dto.section);
    if (dto.price !== undefined) patch.price = dto.price;
    if (dto.description !== undefined) patch.description = DishesService.text(dto.description);
    const { data, error } = await this.db
      .getClient()
      .from("dishes")
      .update(patch)
      .eq("id", dishId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .select("id, name, menu_section, price, description")
      .maybeSingle();
    if (error) this.writeFailed(error, name);
    if (!data) throw new NotFoundException(DISH_NOT_THIS_HOUSE);
    return this.dishOut(data);
  }
}

/**
 * A recipe's allergens by the sheet's rule, from its lines (in recipe order)
 * and what each linked item states. Null rows: the read failed, so nothing is
 * said rather than something false.
 */
export function rowAllergens(
  rows: any[],
  yieldServes: number,
  stated: Map<string, Array<{ allergen: string; status: string }>> | null,
): RowAllergens {
  if (!stated) return { readable: false };
  const sum = serveNutrition(
    rows.map((l) => ({
      label: l.label ?? "",
      role: l.role,
      inventoryId: l.inventory_id ?? null,
      qtyBase: Number(l.qty_base),
      baseUnit: l.base_unit as BaseUnit,
      figures: null,
      allergens: (l.inventory_id && stated.get(l.inventory_id)) || [],
    })),
    yieldServes,
  );
  return { readable: true, status: sum.allergens, unstatedBy: sum.allergensUnstatedBy };
}
