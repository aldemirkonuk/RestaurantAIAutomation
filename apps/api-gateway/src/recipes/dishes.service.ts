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
import { BASE_UNIT_WORDS, BaseUnit, CostItem, recipeCost } from "./recipe-cost";
import { servesFromStock, type StockItem } from "./serves-from-stock";
import { serveNutrition, type Allergen, type AllergenStatus } from "./recipe-nutrition";
import { CreateDishDto, SetYieldDto, UpdateDishDto } from "./dto/recipes.dto";
import { DISH_NOT_THIS_HOUSE, MAX_LINE_QTY, RecipesService } from "./recipes.service";
import { foldName } from "./name-fold";
import { readCurrentMenuLines } from "../menus/current-menu-lines";
import { menuIndex, menuPriceFor, type MenuLine } from "./menu-price-match";

export const DISHES_UNREAD = "Your dishes could not be read just now. Nothing is shown rather than a wrong list.";
export const DISH_USE_UNREAD = "Which dishes use this item could not be read just now.";
export const DRINK_USE_UNREAD = "Which drinks use this item could not be read just now.";
export const MENU_PRICES_UNREAD = "Your menu's prices could not be read just now, so none is shown beside your list.";
export const DRINK_FIGURES_UNREAD = "Your drinks' costs could not be read just now, so none is shown.";
export const DISH_FIGURES_UNREAD = "Your dishes' costs and allergens could not be read just now, so none is shown.";

/** Whose recipe: a dish (recipe_current_dish) or a house drink (recipe_current). */
export type RecipeOwner = "dish" | "cocktail";
export const SHELF_MATCH_UNREAD = "The shelf could not be read just now, so no line is linked for you.";
export const ITEM_NOT_THIS_HOUSE = "This item is not on this house's shelf.";
export const TAKE_PRICES_UNREAD = "The menu or the dishes could not be read just now. No price was changed.";
export const TAKE_OFF_UNREAD = "The menu or the dishes could not be read just now. No dish was taken off.";
export const DISH_NAME_NEEDED = "A dish needs a name.";
export const DISH_NOT_SAVED = "The dish could not be saved. Nothing was changed.";
export const DISH_NOT_REMOVED = "The dish could not be taken off your list. Nothing was changed.";
export const YIELD_NEEDS_AMOUNT = "A batch makes an amount above zero.";
export const YIELD_UNKNOWN_UNIT = "That unit is not one we know. Use ml, cl, l, oz, tsp, tbsp, dash, barspoon, g, kg or each.";
export const YIELD_TOO_SMALL = "That is too small an amount to measure.";
export const YIELD_UNREAD = "The dish or the recipes that draw it could not be read just now. Nothing was changed.";
export const yieldTooBig = (unit: string) => `A batch makes at most ${MAX_LINE_QTY.toLocaleString("en-US")} ${unit}.`;
export const yieldUnitInUse = (made: string) =>
  `This is made in ${made}, and a recipe in use draws it in ${made}. Take it out of those recipes before changing what kind of unit it is made in. Nothing was changed.`;
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

  /**
   * The house's dishes by name: one paged read of `dishes`, nothing priced.
   * The figures (cost a plate, allergens) are `dishFigures`, read beside it,
   * so the names show after one database round trip instead of after every
   * line of every dish is priced, and a failed pricing read never takes the
   * names away (r41 recipes audit, gaps 2 and 3; /cocktails already reads
   * its names and its figures apart).
   */
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
    return dishes
      .map((d) => ({
        id: d.id as string,
        name: d.name as string,
        section: (d.menu_section ?? null) as string | null,
        price: money && d.price != null ? Number(d.price) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Every dish on the house's list with its figures at today's prices and its
   * allergens, for the cost, food cost and allergen columns of /dishes. The
   * same `figures` as the drawer's dish cards and the drinks' figures.
   *
   * A failed pricing read does not fail the answer: every row's cost is null,
   * `costsUnread` is true and the page says the costs could not be read,
   * while each dish still says whether it has a recipe and what allergens it
   * states (staff never read prices, so never meet this). Any other failed
   * read is a 503 with a sentence; the names, read apart, still show.
   */
  async dishFigures(restaurantId: string, role: string | null | undefined) {
    const money = seesHouseAmounts(role);
    const client = this.db.getClient();
    const dishes = await this.all<any>("dish figures list read", DISH_FIGURES_UNREAD, (from, to) =>
      client
        .from("dishes")
        .select("id, price")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    let costsUnread = false;
    const figures = await this.figures(restaurantId, dishes.map((d) => d.id), money, DISH_FIGURES_UNREAD, "dish", {
      allergens: true,
      pricingUnread: () => {
        costsUnread = true;
      },
    });
    return {
      costsUnread,
      dishes: dishes.map((d) => ({
        dishId: d.id as string,
        price: money && d.price != null ? Number(d.price) : null,
        ...this.figureFields(figures.get(d.id)),
        allergens: figures.get(d.id)?.allergens ?? null,
      })),
    };
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
    opts: {
      allergens?: boolean;
      /**
       * Given, a failed pricing read is not thrown: it is logged, this is
       * called, and every figure's cost is null. Absent, the read is a 503.
       */
      pricingUnread?: () => void;
    } = {},
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
            .select("id, version_id, position, label, role, inventory_id, component_dish_id, qty_base, base_unit, usable_pct")
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
    let priced = money;
    if (money) {
      let reads: Array<{ items: Map<string, any>; lots: Map<string, any> }> = [];
      try {
        reads = await inWaves(chunks(itemIds, 100), (ids) => this.recipes.readPricing(restaurantId, ids, true));
      } catch (e) {
        if (!opts.pricingUnread) {
          await allergenRead;
          this.failed(`${owner} pricing read`, e, sentence);
        }
        this.logger.error(`dishes: ${owner} pricing read failed, costs left unread: ${(e as { message?: string })?.message ?? String(e)}`);
        opts.pricingUnread();
        priced = false;
      }
      for (const read of reads) {
        read.items.forEach((v, k) => items.set(k, v));
        read.lots.forEach((v, k) => lots.set(k, v));
      }
    }
    const allergenRows = await allergenRead;
    // A made line is priced through its component, by the same read the drawer uses,
    // so the list and the drawer name one cost for one drink.
    const madeIds = [...new Set([...lines.values()].flat().map((l) => l.component_dish_id).filter(Boolean))] as string[];
    let components = new Map<string, { name: string; perBase: number | null }>();
    if (priced && madeIds.length) {
      try {
        components = await this.recipes.componentRates(restaurantId, madeIds, money, 1);
      } catch (e) {
        if (!opts.pricingUnread) this.failed(`${owner} component read`, e, sentence);
        this.logger.error(`dishes: ${owner} component read failed, costs left unread: ${(e as { message?: string })?.message ?? String(e)}`);
        opts.pricingUnread();
        priced = false;
      }
    }

    for (const p of pointers) {
      const v = versions.get(p.versionId);
      // A pointer whose version is not this house's, or not this owner's, is not read as a recipe.
      if (!v || v.ownerId !== p.ownerId) continue;
      const rows = [...(lines.get(p.versionId) ?? [])].sort((a, b) => a.position - b.position);
      const yieldServes = v.yieldServes;
      let cost: DishFigures["cost"] = null;
      if (priced) {
        const figured = recipeCost(
          rows.map((l) => ({
            role: l.role,
            made: l.component_dish_id ? (components.get(l.component_dish_id) ?? null) : null,
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
          perServe: figured.perServe,
          perServeExact: figured.perServeExact,
          priced: figured.priced,
          of: figured.of,
          complete: figured.complete,
          partial: figured.partial,
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
      .select("id, uom, bottle_size_ml, piece_grams, ml_grams, stock_live")
      .eq("id", itemId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (item.error) this.failed("item read", item.error, sentence);
    if (!item.data) throw new NotFoundException(ITEM_NOT_THIS_HOUSE);

    const used = await this.all<any>("item line read", sentence, (from, to) =>
      client
        .from("recipe_lines")
        .select("id, version_id, position, label, qty_entered, unit_code, qty_base, base_unit, usable_pct")
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
    return { item: item.data as StockItem, used, ownerIds: [...new Set(current.values())] };
  }

  /**
   * How many serves the stock on hand makes of one owner's current recipe
   * (r108 g11), from this item's own lines in it. Not money: every role.
   */
  private servesIn(item: StockItem, used: any[], f: DishFigures | undefined) {
    if (!f) return { servesFromStock: null, servesWhy: null };
    const lines = used
      .filter((l) => l.version_id === f.versionId)
      .map((l) => ({ qtyBase: l.qty_base, baseUnit: l.base_unit as BaseUnit, usablePct: l.usable_pct ?? null }));
    return servesFromStock(item, lines, f.yieldServes);
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
    const { item, used, ownerIds } = await this.currentUses(restaurantId, itemId, "dish", DISH_USE_UNREAD);
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
            ...this.servesIn(item, used, f),
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
    const { item, used, ownerIds } = await this.currentUses(restaurantId, itemId, "cocktail", DRINK_USE_UNREAD);
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
            ...this.servesIn(item, used, f),
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
   *
   * As for the dishes, a failed pricing read does not fail the answer: every
   * cost is null, `costsUnread` is true and the page says so, while each drink
   * still says whether it has a recipe and what allergens it states. Any other
   * failed read is a 503 with a sentence.
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
    let costsUnread = false;
    const figures = await this.figures(restaurantId, drinks.map((d) => d.id), money, DRINK_FIGURES_UNREAD, "cocktail", {
      allergens: true,
      pricingUnread: () => {
        costsUnread = true;
      },
    });
    return {
      costsUnread,
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
   * Set each named dish's price to the one price the house's current menu
   * gives its name, after the manager confirmed the list (g1 menu gap: a
   * re-uploaded menu never moved a price, and each dish needed its own confirm).
   *
   * The menu is read again here, by the same match the Menu column uses, so a
   * stale page can never write a price the menu no longer states. Only a dish
   * with ONE line and ONE price that differs from its own is written; every
   * other dish is left, with the reason in words. Every id must be a live dish
   * of this house, or nothing is written at all (404). Drinks are not touched.
   */
  async takeMenuPrices(restaurantId: string, ids: string[]) {
    const wanted = [...new Set(ids)];
    const client = this.db.getClient();
    const found = (
      await inWaves(chunks(wanted, ID_CHUNK), async (part) => {
        const { data, error } = await client
          .from("dishes")
          .select("id, name, price")
          .eq("restaurant_id", restaurantId)
          .is("deleted_at", null)
          .in("id", part);
        if (error) this.failed("dish read", error, TAKE_PRICES_UNREAD);
        return (data ?? []) as any[];
      })
    ).flat();
    const byId = new Map(found.map((d) => [d.id as string, d]));
    if (wanted.some((id) => !byId.has(id))) throw new NotFoundException(DISH_NOT_THIS_HOUSE);
    const menu = await readCurrentMenuLines(client, restaurantId).catch((e: unknown) => this.failed("current menu read", e, TAKE_PRICES_UNREAD));
    const index = menuIndex(menu.rows as unknown as MenuLine[]);
    const changed: Array<{ id: string; name: string; from: number | null; to: number }> = [];
    const skipped: Array<{ id: string; name: string; why: string }> = [];
    const toWrite: Array<{ id: string; name: string; from: number | null; to: number }> = [];
    for (const id of wanted) {
      const d = byId.get(id)!;
      const own = d.price == null ? null : Number(d.price);
      const m = menu.currentMenus === 0 ? null : menuPriceFor([d.name], "dish", own, index);
      const left = (why: string) => skipped.push({ id, name: d.name, why });
      if (!m) left("The house has no current menu.");
      else if (m.found === "none") left("No line of that name is on the current menu.");
      else if (m.found === "several") left("Lines of that name on the current menu state different prices.");
      else if (m.prices.length === 0) left("The menu line of that name states no price.");
      else if (m.prices.length > 1) left("The menu line of that name states more than one price; open the dish to choose one.");
      else if (own !== null && Math.abs(own - m.prices[0]) < 0.005) left("Its price is already the menu's.");
      else toWrite.push({ id, name: d.name, from: own, to: m.prices[0] });
    }
    const now = new Date().toISOString();
    await inWaves(toWrite, async (w) => {
      const { data, error } = await client
        .from("dishes")
        .update({ price: w.to, updated_at: now })
        .eq("id", w.id)
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .select("id")
        .maybeSingle();
      if (error) {
        this.logger.error(`dishes: take menu price failed: ${error.message}`);
        skipped.push({ id: w.id, name: w.name, why: "It could not be saved just now. Nothing was changed on it." });
      } else if (!data) {
        skipped.push({ id: w.id, name: w.name, why: "It was taken off your list while this ran." });
      } else {
        changed.push(w);
      }
    });
    const order = (x: { id: string }) => wanted.indexOf(x.id);
    return { changed: changed.sort((a, b) => order(a) - order(b)), skipped: skipped.sort((a, b) => order(a) - order(b)) };
  }

  /**
   * Take the named dishes off the list when the house's current menu prints
   * no line of their name (g2 menu gap: a re-uploaded menu left every dish it
   * dropped live on /dishes, with nothing saying so).
   *
   * The menu is read again here, by the same match the Menu column uses, so a
   * stale page can never take off a dish the menu now prints; a dish with any
   * line of its name (even lines that disagree on the price) stays, and every
   * dish left says why. A house with no current menu takes nothing off. The
   * take-off is the one-dish take-off's own: soft, recipe versions kept. Every
   * id must be a live dish of this house, or nothing is touched at all (404).
   */
  async takeOffMenu(restaurantId: string, ids: string[]) {
    const wanted = [...new Set(ids)];
    const client = this.db.getClient();
    const found = (
      await inWaves(chunks(wanted, ID_CHUNK), async (part) => {
        const { data, error } = await client
          .from("dishes")
          .select("id, name, price")
          .eq("restaurant_id", restaurantId)
          .is("deleted_at", null)
          .in("id", part);
        if (error) this.failed("dish read", error, TAKE_OFF_UNREAD);
        return (data ?? []) as any[];
      })
    ).flat();
    const byId = new Map(found.map((d) => [d.id as string, d]));
    if (wanted.some((id) => !byId.has(id))) throw new NotFoundException(DISH_NOT_THIS_HOUSE);
    const menu = await readCurrentMenuLines(client, restaurantId).catch((e: unknown) => this.failed("current menu read", e, TAKE_OFF_UNREAD));
    const index = menuIndex(menu.rows as unknown as MenuLine[]);
    const removed: Array<{ id: string; name: string }> = [];
    const skipped: Array<{ id: string; name: string; why: string }> = [];
    const toRemove: Array<{ id: string; name: string }> = [];
    for (const id of wanted) {
      const d = byId.get(id)!;
      const own = d.price == null ? null : Number(d.price);
      if (menu.currentMenus === 0) skipped.push({ id, name: d.name, why: "The house has no current menu." });
      else if (menuPriceFor([d.name], "dish", own, index).found !== "none") skipped.push({ id, name: d.name, why: "A line of that name is on the current menu." });
      else toRemove.push({ id, name: d.name });
    }
    const now = new Date().toISOString();
    await inWaves(toRemove, async (w) => {
      const { data, error } = await client
        .from("dishes")
        .update({ deleted_at: now, updated_at: now })
        .eq("id", w.id)
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .select("id")
        .maybeSingle();
      if (error) {
        this.logger.error(`dishes: take off menu failed: ${error.message}`);
        skipped.push({ ...w, why: "It could not be taken off just now. It is still on your list." });
      } else if (!data) {
        skipped.push({ ...w, why: "It was already off your list." });
      } else {
        removed.push(w);
      }
    });
    const order = (x: { id: string }) => wanted.indexOf(x.id);
    return { removed: removed.sort((a, b) => order(a) - order(b)), skipped: skipped.sort((a, b) => order(a) - order(b)) };
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

  /**
   * Say what one batch of a house-made component makes (ADR 0397), stored in the
   * unit's base (700 ml is 7000 ml10). Every price that draws the component is
   * read from this figure at the moment it is asked for, so the change prices
   * every parent again with nothing else to write. It touches no recipe line, so
   * the chain a component may sit in (no cycle, at most three deep) is exactly
   * as it was. The kind of unit is not changed silently: a component some
   * current recipe draws in millilitres is never turned into grams (the
   * database refuses that line), so that change is refused while it is drawn.
   */
  async setYield(restaurantId: string, dishId: string, dto: SetYieldDto) {
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException(YIELD_NEEDS_AMOUNT);
    if (amount > MAX_LINE_QTY) throw new BadRequestException(yieldTooBig(dto.unit));
    const client = this.db.getClient();

    const dish = await client
      .from("dishes")
      .select("id, name, yield_base_unit")
      .eq("id", dishId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (dish.error) this.failed("yield dish read", dish.error, YIELD_UNREAD);
    if (!dish.data) throw new NotFoundException(DISH_NOT_THIS_HOUSE);

    const conv = await client.rpc("recipe_qty_base", { p_qty: amount, p_unit: dto.unit });
    if (conv.error) this.failed("yield conversion", conv.error, YIELD_UNREAD);
    const row = (Array.isArray(conv.data) ? conv.data[0] : conv.data) as { qty_base?: unknown; base_unit?: unknown } | null;
    if (!row || row.qty_base == null || row.base_unit == null) throw new BadRequestException(YIELD_UNKNOWN_UNIT);
    const qtyBase = Number(row.qty_base);
    const baseUnit = row.base_unit as BaseUnit;
    if (!(qtyBase >= 1)) throw new BadRequestException(YIELD_TOO_SMALL);

    const was = (dish.data as { yield_base_unit: BaseUnit | null }).yield_base_unit;
    if (was && was !== baseUnit && (await this.isDrawn(restaurantId, dishId))) {
      throw new BadRequestException(yieldUnitInUse(BASE_UNIT_WORDS[was]));
    }

    const { data, error } = await client
      .from("dishes")
      .update({ yield_qty_base: qtyBase, yield_base_unit: baseUnit, updated_at: new Date().toISOString() })
      .eq("id", dishId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .select("id, name, yield_qty_base, yield_base_unit")
      .maybeSingle();
    if (error) this.writeFailed(error, undefined);
    if (!data) throw new NotFoundException(DISH_NOT_THIS_HOUSE);
    return {
      id: data.id,
      name: data.name,
      yield: { amount, unit: dto.unit, qtyBase: Number(data.yield_qty_base), baseUnit: data.yield_base_unit as BaseUnit },
    };
  }

  /** Does a current recipe (a drink's or a dish's) draw this component? Old versions do not count. */
  private async isDrawn(restaurantId: string, dishId: string): Promise<boolean> {
    const lines = await this.all<{ version_id: string }>("yield drawn read", YIELD_UNREAD, (from, to) =>
      this.db
        .getClient()
        .from("recipe_lines")
        .select("id, version_id")
        .eq("restaurant_id", restaurantId)
        .eq("component_dish_id", dishId)
        .order("id")
        .range(from, to),
    );
    const versions = [...new Set(lines.map((l) => l.version_id))];
    for (const part of chunks(versions)) {
      for (const table of ["recipe_current_dish", "recipe_current"]) {
        const { data, error } = await this.db.getClient().from(table).select("version_id").eq("restaurant_id", restaurantId).in("version_id", part);
        if (error) this.failed("yield drawn read", error, YIELD_UNREAD);
        if ((data ?? []).length) return true;
      }
    }
    return false;
  }

  /**
   * Take a dish off the house's list. A soft delete, like a cocktail's: its
   * recipe versions stay (they are append-only, ADR 0360) and the drawer and
   * the list stop reading it, since both filter `deleted_at`. The name is free
   * again, because the unique index covers live dishes only.
   */
  async removeDish(restaurantId: string, dishId: string) {
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .getClient()
      .from("dishes")
      .update({ deleted_at: now, updated_at: now })
      .eq("id", dishId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .select("id, name")
      .maybeSingle();
    if (error) {
      this.logger.error(`dishes: remove failed: ${error.message}`);
      throw new InternalServerErrorException(DISH_NOT_REMOVED);
    }
    if (!data) throw new NotFoundException(DISH_NOT_THIS_HOUSE);
    return { id: data.id, name: data.name, removed: true };
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
