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
export const DISH_NAME_NEEDED = "A dish needs a name.";
export const DISH_NOT_SAVED = "The dish could not be saved. Nothing was changed.";
export const dishNameTaken = (name: string) => `A dish named "${name}" is already on your list.`;

/** PostgREST answers at most this many rows a request; every read here pages past it. */
export const PAGE = 1000;
/** Ids sent in one `in()` filter, so the URL stays short. 20 versions x 40 lines < PAGE. */
export const ID_CHUNK = 20;

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
 * Dishes (ADR 0366): the list a house keeps of its plates and the figures
 * each one has at today's prices.
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
