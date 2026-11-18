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
import { CreateDishDto, UpdateDishDto } from "./dto/recipes.dto";
import { DISH_NOT_THIS_HOUSE, RecipesService } from "./recipes.service";

export const DISHES_UNREAD = "Your dishes could not be read just now. Nothing is shown rather than a wrong list.";
export const DISH_USE_UNREAD = "Which dishes use this item could not be read just now.";
export const SHELF_MATCH_UNREAD = "The shelf could not be read just now, so no line is linked for you.";
export const ITEM_NOT_THIS_HOUSE = "This item is not on this house's shelf.";
export const DISH_NAME_NEEDED = "A dish needs a name.";
export const DISH_NOT_SAVED = "The dish could not be saved. Nothing was changed.";
export const dishNameTaken = (name: string) => `A dish named "${name}" is already on your list.`;

/** PostgREST answers at most this many rows a request; every read here pages past it. */
export const PAGE = 1000;
/** Ids sent in one `in()` filter, so the URL stays short. 20 versions x 40 lines < PAGE. */
export const ID_CHUNK = 20;

/** A name as two people would agree it is "the same name": spaces and case folded, nothing else. */
export const foldName = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

const chunks = <T>(xs: T[], n = ID_CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

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
}

/**
 * Dishes (ADR 0366): the list a house keeps of its plates, the figures each
 * one has at today's prices, which dishes use a shelf item, and the exact-name
 * shelf lookup a pasted recipe line proposes its link from.
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
    const figures = await this.figures(restaurantId, dishes.map((d) => d.id), money, DISHES_UNREAD);
    return dishes
      .map((d) => ({
        id: d.id,
        name: d.name,
        section: d.menu_section ?? null,
        price: money && d.price != null ? Number(d.price) : null,
        ...this.figureFields(figures.get(d.id)),
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
   * The figures of each dish that has a current recipe, at today's prices.
   * One read per table (chunked by id), never one read per dish.
   */
  async figures(restaurantId: string, dishIds: string[], money: boolean, sentence: string): Promise<Map<string, DishFigures>> {
    const client = this.db.getClient();
    const out = new Map<string, DishFigures>();
    if (!dishIds.length) return out;

    const pointers: any[] = [];
    for (const ids of chunks(dishIds)) {
      pointers.push(
        ...(await this.all<any>("dish pointer read", sentence, (from, to) =>
          client
            .from("recipe_current_dish")
            .select("dish_id, version_id")
            .eq("restaurant_id", restaurantId)
            .in("dish_id", ids)
            .order("dish_id", { ascending: true })
            .range(from, to),
        )),
      );
    }
    const versionIds = pointers.map((p) => p.version_id as string);
    const versions = new Map<string, any>();
    const lines = new Map<string, any[]>();
    for (const ids of chunks(versionIds)) {
      const [v, l] = await Promise.all([
        this.all<any>("dish version read", sentence, (from, to) =>
          client
            .from("recipe_versions")
            .select("id, dish_id, yield_serves")
            .eq("restaurant_id", restaurantId)
            .in("id", ids)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        this.all<any>("dish line read", sentence, (from, to) =>
          client
            .from("recipe_lines")
            .select("id, version_id, position, role, inventory_id, qty_base, base_unit")
            .eq("restaurant_id", restaurantId)
            .in("version_id", ids)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ]);
      for (const r of v) versions.set(r.id, r);
      for (const r of l) lines.set(r.version_id, [...(lines.get(r.version_id) ?? []), r]);
    }

    const items = new Map<string, any>();
    const lots = new Map<string, any>();
    if (money) {
      const itemIds = [...new Set([...lines.values()].flat().map((l) => l.inventory_id).filter(Boolean))] as string[];
      for (const ids of chunks(itemIds, 100)) {
        let read: { items: Map<string, any>; lots: Map<string, any> };
        try {
          read = await this.recipes.readPricing(restaurantId, ids, true);
        } catch (e) {
          this.failed("dish pricing read", e, sentence);
        }
        read.items.forEach((v, k) => items.set(k, v));
        read.lots.forEach((v, k) => lots.set(k, v));
      }
    }

    for (const p of pointers) {
      const v = versions.get(p.version_id);
      // A pointer whose version is not this house's, or not this dish's, is not read as a recipe.
      if (!v || v.dish_id !== p.dish_id) continue;
      const rows = [...(lines.get(p.version_id) ?? [])].sort((a, b) => a.position - b.position);
      const yieldServes = Number(v.yield_serves);
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
      out.set(p.dish_id, { versionId: p.version_id, yieldServes, lineCount: rows.length, cost });
    }
    return out;
  }

  /**
   * The dishes whose CURRENT recipe links this item (ADR 0366 item 5), each
   * with its figures and the item's own lines in it. An earlier version that
   * used the item does not count: the drawer says what the kitchen makes now.
   */
  async dishesUsingItem(restaurantId: string, itemId: string, role: string | null | undefined) {
    const money = seesHouseAmounts(role);
    const client = this.db.getClient();
    const item = await client
      .from("restaurant_inventory")
      .select("id")
      .eq("id", itemId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (item.error) this.failed("item read", item.error, DISH_USE_UNREAD);
    if (!item.data) throw new NotFoundException(ITEM_NOT_THIS_HOUSE);

    const used = await this.all<any>("item line read", DISH_USE_UNREAD, (from, to) =>
      client
        .from("recipe_lines")
        .select("id, version_id, position, label, qty_entered, unit_code")
        .eq("restaurant_id", restaurantId)
        .eq("inventory_id", itemId)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const versionIds = [...new Set(used.map((l) => l.version_id as string))];
    const current = new Map<string, string>(); // version -> dish
    for (const ids of chunks(versionIds)) {
      const rows = await this.all<any>("dish pointer read", DISH_USE_UNREAD, (from, to) =>
        client
          .from("recipe_current_dish")
          .select("dish_id, version_id")
          .eq("restaurant_id", restaurantId)
          .in("version_id", ids)
          .order("dish_id", { ascending: true })
          .range(from, to),
      );
      for (const r of rows) current.set(r.version_id, r.dish_id);
    }
    const dishIds = [...new Set(current.values())];
    if (!dishIds.length) return { dishes: [] };

    const dishes: any[] = [];
    for (const ids of chunks(dishIds)) {
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
          const uses = used
            .filter((l) => f && l.version_id === f.versionId)
            .sort((a, b) => a.position - b.position)
            .map((l) => ({ label: l.label, qtyEntered: Number(l.qty_entered), unitCode: l.unit_code }));
          return {
            dishId: d.id,
            name: d.name,
            section: d.menu_section ?? null,
            price: money && d.price != null ? Number(d.price) : null,
            ...this.figureFields(f),
            uses,
          };
        })
        // A pointer that moved since the lines were read leaves a dish with no line of this item: not listed.
        .filter((d) => d.uses.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
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
