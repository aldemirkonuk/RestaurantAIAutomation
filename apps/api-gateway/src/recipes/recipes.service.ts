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
import { mergeAgreedLotCost, mergeInvoiceLotCost, mergeLastKnownLotCost } from "../analytics/inventory-cost";
import { BaseUnit, CostItem, recipeCost } from "./recipe-cost";
import { PreviewCostDto, SaveRecipeDto, StateWeightsDto } from "./dto/recipes.dto";
import { FIGURE_KEYS, ItemFigures, ServeNutrition, serveNutrition } from "./recipe-nutrition";
import { shelfSearchPattern } from "./name-fold";

export const NOT_THIS_HOUSE = "This drink is not on this house's list.";
export const STALE_SAVE = "Someone saved this recipe after you opened it. Nothing was changed.";
export const READ_FAILED = "We could not read this recipe just now. Nothing is shown rather than a wrong one.";
export const SAVE_FAILED = "We could not save this recipe. Nothing was changed.";
const SHELF_FAILED = "We could not read the shelf just now.";
export const NOT_THIS_VERSION = "That version is not one of this drink's.";
export const DISH_NOT_THIS_HOUSE = "This dish is not on this house's list.";
export const NOT_THIS_DISH_VERSION = "That version is not one of this dish's.";

/** What a recipe belongs to (ADR 0366): a drink (`cocktails`) or a plate (`dishes`). */
export type OwnerKind = "cocktail" | "dish";
export interface RecipeOwner {
  kind: OwnerKind;
  id: string;
}
export const WHAT_IS_IN_UNREAD =
  "What is in a serve could not be read just now, so nothing about it is shown as known. The recipe and its cost are unaffected.";

/** item_nutrition column -> figure key. */
const FIGURE_COLUMN: Record<(typeof FIGURE_KEYS)[number], string> = {
  energyKcal: "energy_kcal",
  fatG: "fat_g",
  saturatesG: "saturates_g",
  carbohydrateG: "carbohydrate_g",
  sugarsG: "sugars_g",
  proteinG: "protein_g",
  saltG: "salt_g",
  // ABV is ml of pure alcohol per 100 ml (the column is per-volume only,
  // item_nutrition_abv_is_per_volume), so it sums like any per-100 figure.
  alcoholMl: "abv_pct",
};

/** A failed read of what is in a serve is said, and never hides the recipe (ADR 0067). */
export type WhatIsIn = ({ readable: true } & ServeNutrition) | { readable: false; sentence: string };

/**
 * The most one line may hold, in the unit typed, and the most serves one
 * recipe makes. The database stores a line as an integer in a base unit
 * (kg x 1,000,000 = mg) and the serves as an integer, so a number past these
 * used to reach it and come back as a 500 "bigint out of range". 100,000 is
 * 100 l or 100 kg on one line: well past any batch a bar makes.
 */
export const MAX_LINE_QTY = 100_000;
export const MAX_YIELD_SERVES = 1_000;

/**
 * The most a stated weight may be (r28 gap 7): one piece up to 50 kg (a whole
 * lamb, a wheel of cheese), one ml up to 5 g (honey is 1.4, syrups under 2).
 * A figure past these is a slip, such as grams per litre typed as grams per ml.
 */
export const MAX_PIECE_GRAMS = 50_000;
export const MAX_ML_GRAMS = 5;
export const WEIGHT_NOT_THIS_HOUSE = "That good is not on this house's shelf.";
export const WEIGHT_SAVE_FAILED = "We could not keep that weight just now. Nothing was changed.";

/** A stated weight from the database (numeric arrives as a string), or null. */
function grams(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A cocktail's recipe: the current version, its lines linked to house items,
 * and its cost per serve at today's prices (ADR 0360). Writes go through ONE
 * rpc, `save_recipe_version`, which is the whole save in one transaction.
 * Every read error is said, never read as "no recipe" (ADR 0020). A role that
 * does not see money gets no price and no cost (the dashboard's rule).
 */
@Injectable()
export class RecipesService {
  private readonly logger = new Logger(RecipesService.name);

  constructor(private readonly db: DatabaseService) {}

  private failed(what: string, error: unknown, sentence = READ_FAILED): never {
    this.logger.error(`recipes: ${what} failed: ${(error as { message?: string })?.message ?? String(error)}`);
    throw new ServiceUnavailableException(sentence);
  }

  private async houseCocktail(restaurantId: string, cocktailId: string) {
    const { data, error } = await this.db
      .getClient()
      .from("cocktails")
      .select("id, name, display_name, price, glass, garnish, method, description")
      .eq("id", cocktailId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) this.failed("cocktail read", error);
    if (!data) throw new NotFoundException(NOT_THIS_HOUSE);
    return data as Record<string, any>;
  }

  /** A live dish of this house, or 404 (ADR 0366); another house's dish is simply not found. */
  async houseDish(restaurantId: string, dishId: string) {
    const { data, error } = await this.db
      .getClient()
      .from("dishes")
      .select("id, name, menu_section, price, description")
      .eq("id", dishId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) this.failed("dish read", error);
    if (!data) throw new NotFoundException(DISH_NOT_THIS_HOUSE);
    return data as Record<string, any>;
  }

  /**
   * A dish's current recipe, its lines, its cost a plate at today's prices and
   * what is in a plate (ADR 0366): the drink's read, for a plate. A dish has
   * no old recipe box, so `legacyLines` is always empty.
   */
  async getDishRecipe(restaurantId: string, dishId: string, role: string | null | undefined) {
    const money = seesHouseAmounts(role);
    const client = this.db.getClient();
    // The house check and the pointer reads go at once (gap 17). Both reads
    // name the house, and the check's 404 is the answer when it refuses.
    const [dish, pointer, count] = await Promise.all([
      this.houseDish(restaurantId, dishId),
      client
        .from("recipe_current_dish")
        .select("version_id")
        .eq("dish_id", dishId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle(),
      client
        .from("recipe_versions")
        .select("id", { count: "exact", head: true })
        .eq("dish_id", dishId)
        .eq("restaurant_id", restaurantId),
    ]);
    if (pointer.error) this.failed("current pointer read", pointer.error);
    if (count.error) this.failed("version count read", count.error);

    let current: Record<string, unknown> | null = null;
    let cost: Record<string, unknown> | null = null;
    let whatIsIn: WhatIsIn | null = null;
    const versionId = (pointer.data as { version_id?: string } | null)?.version_id;
    if (versionId) {
      const body = await this.versionBody(restaurantId, versionId, money, true);
      current = body.version;
      cost = body.cost;
      whatIsIn = body.whatIsIn;
    }
    return {
      dish: {
        id: dish.id,
        name: dish.name,
        section: dish.menu_section ?? null,
        price: money && dish.price != null ? Number(dish.price) : null,
        description: dish.description ?? null,
      },
      current,
      cost,
      whatIsIn,
      versionCount: count.count ?? 0,
      legacyLines: [],
    };
  }

  async getRecipe(restaurantId: string, cocktailId: string, role: string | null | undefined) {
    const money = seesHouseAmounts(role);
    const client = this.db.getClient();
    // The house check and the pointer reads go at once (gap 17). When the
    // check refuses another house's drink, what the other reads found is
    // dropped with the 404 and never answered.
    const [cocktail, pointer, count, legacy] = await Promise.all([
      this.houseCocktail(restaurantId, cocktailId),
      client
        .from("recipe_current")
        .select("version_id")
        .eq("cocktail_id", cocktailId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle(),
      client
        .from("recipe_versions")
        .select("id", { count: "exact", head: true })
        .eq("cocktail_id", cocktailId)
        .eq("restaurant_id", restaurantId),
      client
        .from("cocktail_ingredients")
        .select("free_text, quantity, unit, sort_order, beverages(name), master_wine_library(name)")
        .eq("cocktail_id", cocktailId)
        .order("sort_order", { ascending: true }),
    ]);
    if (pointer.error) this.failed("current pointer read", pointer.error);
    if (count.error) this.failed("version count read", count.error);
    if (legacy.error) this.failed("legacy ingredient read", legacy.error);

    const legacyLines = ((legacy.data ?? []) as any[]).map((r) => ({
      label: r.free_text ?? r.beverages?.name ?? r.master_wine_library?.name ?? null,
      quantity: r.quantity == null ? null : Number(r.quantity),
      unit: r.unit ?? null,
    }));

    let current: Record<string, unknown> | null = null;
    let cost: Record<string, unknown> | null = null;
    let whatIsIn: WhatIsIn | null = null;
    const versionId = (pointer.data as { version_id?: string } | null)?.version_id;
    if (versionId) {
      const body = await this.versionBody(restaurantId, versionId, money, true);
      current = body.version;
      cost = body.cost;
      whatIsIn = body.whatIsIn;
    }

    return {
      cocktail: {
        id: cocktail.id,
        name: cocktail.display_name || cocktail.name,
        price: money && cocktail.price != null ? Number(cocktail.price) : null,
        glass: cocktail.glass ?? null,
        garnish: cocktail.garnish ?? null,
        method: cocktail.method ?? null,
        description: cocktail.description ?? null,
      },
      current,
      cost,
      whatIsIn,
      versionCount: count.count ?? 0,
      legacyLines,
    };
  }

  /**
   * The shelf items and their lot costs a set of lines is priced from. ONE
   * read for the saved version and for a draft, so the two can never price
   * differently. Scoped to the house on both tables: an id that is not this
   * house's is simply not found, and its line reads as an unknown item.
   *
   * What a unit of a good costs now is the inventory list's answer, not a
   * second one (r23 walk: flour read ₺1,20 a kg in the drawer and "no price
   * yet" on the dish). Both hand `resolveUnitCost` the rollup row with the
   * settled cost from `inventory_lot_agreed_cost` merged in by
   * `mergeAgreedLotCost`, and the invoice figures from
   * `inventory_lot_invoice_cost` by `mergeInvoiceLotCost`, so the invoiced
   * cost averages invoices only (r28 gap 3): invoiced lot WAC, then a cost settled without an
   * invoice (a price the house entered, or one agreed at delivery), then what
   * the good was last bought at when nothing on hand is priced
   * (`inventory_lot_last_known_cost`, r36 gap 1: a sold-out good keeps its
   * price), then the last purchase price, else unknown. Before this the recipe read the rollup
   * alone, so a good costed only by hand read as unknown here and only here.
   */
  async readPricing(restaurantId: string, ids: string[], money: boolean) {
    const client = this.db.getClient();
    const items = new Map<string, any>();
    const lots = new Map<string, any>();
    if (ids.length) {
      // Literal column lists, so the read-columns guard can check each; a
      // role without money never reads the price or either cost view.
      const itemQuery = money
        ? client
            .from("restaurant_inventory")
            .select("id, display_name, kind, uom, bottle_size_ml, piece_grams, ml_grams, last_purchase_price, is_active, deleted_at")
        : client
            .from("restaurant_inventory")
            .select("id, display_name, kind, uom, bottle_size_ml, piece_grams, ml_grams, is_active, deleted_at");
      const none = Promise.resolve({ data: [], error: null });
      const [itemRead, lotRead, agreedRead, invoiceRead, lastRead] = await Promise.all([
        itemQuery.eq("restaurant_id", restaurantId).in("id", ids),
        money
          ? client
              .from("inventory_lot_rollup")
              .select("inventory_id, live_qty, wac, has_invoice_cost, wac_qty")
              .eq("restaurant_id", restaurantId)
              .in("inventory_id", ids)
          : none,
        // The same columns as AGREED_LOT_COST_SELECT, which the inventory
        // list reads; written out for the guard.
        money
          ? client
              .from("inventory_lot_agreed_cost")
              .select("inventory_id, has_agreed_cost, agreed_wac")
              .eq("restaurant_id", restaurantId)
              .in("inventory_id", ids)
          : none,
        // The invoice cost from invoices only: the rollup's `wac` averages
        // estimated lots in and calls the result an invoice (r28 gap 3).
        money
          ? client
              .from("inventory_lot_invoice_cost")
              .select("inventory_id, invoice_wac, invoice_qty, settled_qty, stock_qty")
              .eq("restaurant_id", restaurantId)
              .in("inventory_id", ids)
          : none,
        // What the good was last bought at, used up or not: the live views
        // above read stock on hand only, so a sold-out good would read
        // "no price yet" the moment its last unit is poured (r36 gap 1).
        money
          ? client
              .from("inventory_lot_last_known_cost")
              .select("inventory_id, last_unit_cost, last_received_at")
              .eq("restaurant_id", restaurantId)
              .in("inventory_id", ids)
          : none,
      ]);
      if (itemRead.error) this.failed("item read", itemRead.error);
      if (lotRead.error) this.failed("lot read", lotRead.error);
      // A failed read of the settled cost refuses like the rollup's: priced
      // without it, a hand-costed good would read "no price yet" as if true.
      if (agreedRead.error) this.failed("agreed cost read", agreedRead.error);
      // Refused like the others: priced without it, the serve would fall back
      // to nothing for a good whose only cost is on an invoice.
      if (invoiceRead.error) this.failed("invoice cost read", invoiceRead.error);
      // Refused like the others: priced without it, a sold-out good would
      // read "no price yet" as if nothing had ever been paid for it.
      if (lastRead.error) this.failed("last known cost read", lastRead.error);
      for (const i of (itemRead.data ?? []) as any[]) items.set(i.id, i);
      for (const l of (lotRead.data ?? []) as any[]) lots.set(l.inventory_id, l);
      mergeAgreedLotCost(lots, agreedRead.data as Array<Record<string, unknown>> | null);
      mergeLastKnownLotCost(lots, lastRead.data as Array<Record<string, unknown>> | null);
      if (money) mergeInvoiceLotCost(lots, ids, invoiceRead.data as Array<Record<string, unknown>> | null);
    }
    return { items, lots };
  }

  /**
   * One saved version as the sheet reads it: its lines linked to the house's
   * items, each line's cost at today's prices, and (for the current version)
   * what is in a serve. The version is read by its id AND the house, so a
   * pointer or a path naming another house's version is unreadable, not shown.
   *
   * A line linked to an item the house has since archived or deleted keeps
   * its link and its cost, and says so (`itemGone`, round 17 D9): a save of
   * that line is refused by the database until it is linked again.
   */
  private async versionBody(
    restaurantId: string,
    versionId: string,
    money: boolean,
    withWhatIsIn: boolean,
    owner?: RecipeOwner,
  ): Promise<{ version: Record<string, unknown>; cost: Record<string, unknown> | null; whatIsIn: WhatIsIn | null }> {
    const client = this.db.getClient();
    let versionQuery = client
      .from("recipe_versions")
      .select("id, version, yield_serves, method, glass, garnish, created_at")
      .eq("id", versionId)
      .eq("restaurant_id", restaurantId);
    if (owner?.kind === "cocktail") versionQuery = versionQuery.eq("cocktail_id", owner.id);
    if (owner?.kind === "dish") versionQuery = versionQuery.eq("dish_id", owner.id);
    const [version, lines] = await Promise.all([
      versionQuery.maybeSingle(),
      client
        .from("recipe_lines")
        .select("id, position, role, inventory_id, label, qty_entered, unit_code, qty_base, base_unit, usable_pct")
        .eq("version_id", versionId)
        .eq("restaurant_id", restaurantId)
        .order("position", { ascending: true }),
    ]);
    if (version.error) this.failed("version read", version.error);
    if (!version.data) {
      if (owner) throw new NotFoundException(owner.kind === "dish" ? NOT_THIS_DISH_VERSION : NOT_THIS_VERSION);
      this.failed("version read", "pointer names no version");
    }
    if (lines.error) this.failed("line read", lines.error);
    const rows = (lines.data ?? []) as any[];
    const ids = [...new Set(rows.map((l) => l.inventory_id).filter(Boolean))] as string[];

    // The prices and what is in a serve are read at once: neither needs the
    // other (r28 recipes audit, gap 17). whatIsIn never throws; a failed
    // pricing read still fails the whole sheet.
    const v = version.data as Record<string, any>;
    const [{ items, lots }, whatIsIn] = await Promise.all([
      this.readPricing(restaurantId, ids, money),
      withWhatIsIn ? this.whatIsIn(restaurantId, ids, rows, Number(v.yield_serves)) : Promise.resolve(null),
    ]);
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
      Number(v.yield_serves),
    );
    const body = {
      versionId: v.id,
      version: v.version,
      yieldServes: v.yield_serves,
      method: v.method ?? null,
      glass: v.glass ?? null,
      garnish: v.garnish ?? null,
      createdAt: v.created_at,
      lines: rows.map((l, i) => {
        const item = l.inventory_id ? items.get(l.inventory_id) : null;
        return {
          id: l.id,
          position: l.position,
          role: l.role,
          inventoryId: l.inventory_id ?? null,
          label: l.label,
          itemName: item?.display_name ?? null,
          itemKind: item?.kind ?? null,
          itemUom: item?.uom ?? null,
          itemGone: !item ? null : item.deleted_at ? "deleted" : item.is_active === false ? "archived" : null,
          // The weights the house stated for the good (r28 gap 7), so the
          // sheet can show them and offer the one a line waits for.
          itemPieceGrams: grams(item?.piece_grams),
          itemMlGrams: grams(item?.ml_grams),
          qtyEntered: Number(l.qty_entered),
          unitCode: l.unit_code,
          // How much of what is bought the amount is (r28 recipes gap 5); null is all of it.
          usablePct: l.usable_pct == null ? null : Number(l.usable_pct),
          qtyBase: Number(l.qty_base),
          baseUnit: l.base_unit,
          status: priced.lines[i].status,
          costPerServe: money ? priced.lines[i].costPerServe : null,
          costPerServeExact: money ? priced.lines[i].costPerServeExact : null,
          costBasis: money ? priced.lines[i].costBasis : null,
          needs: money ? (priced.lines[i].needs ?? null) : null,
          // The stated weight this line's price went through, so a mistyped
          // one is seen beside the price it made and can be changed.
          weighed: money ? (priced.lines[i].weighed ?? null) : null,
          // When the lot a sold-out good is priced from came in (r36 gap 1).
          boughtAt: money ? (priced.lines[i].boughtAt ?? null) : null,
        };
      }),
    };
    const cost = money
      ? {
          perServe: priced.perServe,
          perServeExact: priced.perServeExact,
          priced: priced.priced,
          of: priced.of,
          complete: priced.complete,
          partial: priced.partial,
          lastBought: priced.lastBought,
        }
      : null;
    return { version: body, cost, whatIsIn };
  }

  /**
   * One earlier version of a drink's recipe, its lines and what it would cost
   * at today's prices (round 17 D8). Read-only: putting it back is a new save
   * of its lines, so history is never rewritten.
   */
  async readVersion(restaurantId: string, cocktailId: string, versionId: string, role: string | null | undefined) {
    const money = seesHouseAmounts(role);
    await this.houseCocktail(restaurantId, cocktailId);
    const { version, cost } = await this.versionBody(restaurantId, versionId, money, false, { kind: "cocktail", id: cocktailId });
    return { version, cost };
  }

  /** One earlier version of a dish's recipe (ADR 0366), as `readVersion` reads a drink's. */
  async readDishVersion(restaurantId: string, dishId: string, versionId: string, role: string | null | undefined) {
    const money = seesHouseAmounts(role);
    await this.houseDish(restaurantId, dishId);
    const { version, cost } = await this.versionBody(restaurantId, versionId, money, false, { kind: "dish", id: dishId });
    return { version, cost };
  }

  /**
   * What an UNSAVED draft would cost per serve at today's prices (a manager
   * editing lines sees the cost of the edit before saving). Writes nothing.
   * Quantities become base units through the database's own
   * `recipe_qty_base`, once per distinct (qty, unit), so no second table of
   * unit factors exists in code. Items and lots are read by `readPricing`,
   * exactly as a saved version's are. Unknown stays null, never 0 (ADR 0051).
   */
  async previewCost(restaurantId: string, cocktailId: string, dto: PreviewCostDto) {
    await this.houseCocktail(restaurantId, cocktailId);
    return this.previewLines(restaurantId, dto);
  }

  /** What an unsaved dish draft would cost a plate (ADR 0366); the drink's preview, for a dish. */
  async previewDishCost(restaurantId: string, dishId: string, dto: PreviewCostDto) {
    await this.houseDish(restaurantId, dishId);
    return this.previewLines(restaurantId, dto);
  }

  private async previewLines(restaurantId: string, dto: PreviewCostDto) {
    const client = this.db.getClient();

    const stocked = dto.lines.filter((l) => l.role === "stocked");
    const pairs = new Map<string, { qty: number; unit: string }>();
    for (const l of stocked) pairs.set(`${l.qtyEntered}|${l.unitCode}`, { qty: l.qtyEntered, unit: l.unitCode });
    const converted = new Map<string, { qtyBase: number; baseUnit: BaseUnit } | null>();
    const ids = [...new Set(stocked.map((l) => l.inventoryId).filter(Boolean))] as string[];
    // The conversions and the prices are read at once (r28 gap 17): the
    // prices need only the linked items, never a converted quantity.
    const [, { items, lots }] = await Promise.all([
      Promise.all(
        [...pairs.entries()].map(async ([k, p]) => {
          const { data, error } = await client.rpc("recipe_qty_base", { p_qty: p.qty, p_unit: p.unit });
          if (error) this.failed("quantity conversion", error);
          const row = (Array.isArray(data) ? data[0] : data) as { qty_base?: unknown; base_unit?: unknown } | null;
          converted.set(
            k,
            row && row.qty_base != null && row.base_unit != null
              ? { qtyBase: Number(row.qty_base), baseUnit: row.base_unit as BaseUnit }
              : null,
          );
        }),
      ),
      this.readPricing(restaurantId, ids, true),
    ]);

    const priced = recipeCost(
      dto.lines.map((l) => {
        const inventoryId = l.role === "stocked" ? (l.inventoryId ?? null) : null;
        const q = l.role === "stocked" ? converted.get(`${l.qtyEntered}|${l.unitCode}`) : null;
        return {
          role: l.role,
          inventoryId,
          // A unit the database does not know has no base quantity: NaN prices
          // the line as unknown, never as free.
          qtyBase: q ? q.qtyBase : Number.NaN,
          baseUnit: q ? q.baseUnit : ("ml10" as BaseUnit),
          item: (inventoryId && (items.get(inventoryId) as CostItem)) || null,
          lot: (inventoryId && lots.get(inventoryId)) || null,
          usablePct: l.role === "stocked" ? (l.usablePct ?? null) : null,
        };
      }),
      dto.yieldServes,
    );
    return {
      perServe: priced.perServe,
      perServeExact: priced.perServeExact,
      priced: priced.priced,
      of: priced.of,
      complete: priced.complete,
      partial: priced.partial,
      lastBought: priced.lastBought,
      lines: priced.lines.map((l) => ({
        status: l.status,
        costPerServe: l.costPerServe,
        costBasis: l.costBasis,
        needs: l.needs ?? null,
        weighed: l.weighed ?? null,
        boughtAt: l.boughtAt ?? null,
      })),
    };
  }

  /**
   * What is in one serve. Its own reads: a failure is said and the recipe still
   * shows. <= 40 lines a version, so one page each, under the 1,000-row cap.
   */
  private async whatIsIn(restaurantId: string, ids: string[], rows: any[], yieldServes: number): Promise<WhatIsIn> {
    const figuresById = new Map<string, ItemFigures>();
    const allergensById = new Map<string, Array<{ allergen: string; status: string }>>();
    const weightsById = new Map<string, { pieceGrams: number | null; mlGrams: number | null }>();
    if (ids.length) {
      const client = this.db.getClient();
      // The weights the house stated join a piece or a volume to figures per
      // 100 g, and a weight to figures per 100 ml (r28 gap 7). Read beside
      // the figures, so the sheet keeps its three round trips.
      const [nutrition, allergens, weights] = await Promise.all([
        client
          .from("item_nutrition")
          .select("inventory_id, basis, energy_kcal, fat_g, saturates_g, carbohydrate_g, sugars_g, protein_g, salt_g, abv_pct, energy_from_abv")
          .eq("restaurant_id", restaurantId)
          .in("inventory_id", ids),
        client
          .from("item_allergens")
          .select("inventory_id, allergen, status")
          .eq("restaurant_id", restaurantId)
          .in("inventory_id", ids),
        client
          .from("restaurant_inventory")
          .select("id, piece_grams, ml_grams")
          .eq("restaurant_id", restaurantId)
          .in("id", ids),
      ]);
      const error = nutrition.error ?? allergens.error ?? weights.error;
      if (error) {
        this.logger.error(`recipes: what-is-in read failed: ${error.message}`);
        return { readable: false, sentence: WHAT_IS_IN_UNREAD };
      }
      for (const r of (nutrition.data ?? []) as any[]) {
        const f = { basis: r.basis, energyFromAbv: Boolean(r.energy_from_abv) } as ItemFigures;
        for (const k of FIGURE_KEYS) {
          const raw = r[FIGURE_COLUMN[k]];
          f[k] = raw === null || raw === undefined ? null : Number(raw);
        }
        figuresById.set(r.inventory_id, f);
      }
      for (const w of (weights.data ?? []) as any[]) {
        weightsById.set(w.id, { pieceGrams: grams(w.piece_grams), mlGrams: grams(w.ml_grams) });
      }
      for (const a of (allergens.data ?? []) as any[]) {
        const list = allergensById.get(a.inventory_id) ?? [];
        list.push({ allergen: a.allergen, status: a.status });
        allergensById.set(a.inventory_id, list);
      }
    }
    const sum = serveNutrition(
      rows.map((l) => ({
        label: l.label,
        role: l.role,
        inventoryId: l.inventory_id ?? null,
        qtyBase: Number(l.qty_base),
        baseUnit: l.base_unit,
        figures: (l.inventory_id && figuresById.get(l.inventory_id)) || null,
        pieceGrams: (l.inventory_id && weightsById.get(l.inventory_id)?.pieceGrams) ?? null,
        mlGrams: (l.inventory_id && weightsById.get(l.inventory_id)?.mlGrams) ?? null,
        allergens: (l.inventory_id && allergensById.get(l.inventory_id)) || [],
      })),
      yieldServes,
    );
    return { readable: true, ...sum };
  }

  async listVersions(restaurantId: string, cocktailId: string) {
    await this.houseCocktail(restaurantId, cocktailId);
    const { data, error } = await this.db
      .getClient()
      .from("recipe_versions")
      .select("id, version, created_at, author, recipe_lines(count)")
      .eq("cocktail_id", cocktailId)
      .eq("restaurant_id", restaurantId)
      .order("version", { ascending: false });
    if (error) this.failed("version list read", error);
    return this.versionSummaries((data ?? []) as any[]);
  }

  /** Every saved version of a dish's recipe, newest first (ADR 0366). */
  async listDishVersions(restaurantId: string, dishId: string) {
    await this.houseDish(restaurantId, dishId);
    const { data, error } = await this.db
      .getClient()
      .from("recipe_versions")
      .select("id, version, created_at, author, recipe_lines(count)")
      .eq("dish_id", dishId)
      .eq("restaurant_id", restaurantId)
      .order("version", { ascending: false });
    if (error) this.failed("version list read", error);
    return this.versionSummaries((data ?? []) as any[]);
  }

  private async versionSummaries(data: any[]) {
    const rows = (data ?? []) as any[];
    const names = await this.authorNames(rows.map((v) => v.author).filter(Boolean));
    return rows.map((v) => ({
      versionId: v.id,
      version: v.version,
      createdAt: v.created_at,
      author: v.author ?? null,
      authorName: v.author ? names.get(v.author) ?? null : null,
      lineCount: Number(v.recipe_lines?.[0]?.count ?? 0),
    }));
  }

  /**
   * Who saved each version, by name. The ids come from this house's own
   * versions only. A failed read leaves the names unsaid (null), never a
   * wrong name; the list itself is still true.
   */
  private async authorNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(ids)];
    if (!unique.length) return out;
    const { data, error } = await this.db.getClient().from("users").select("user_id, name").in("user_id", unique);
    if (error) {
      this.logger.error(`recipes: author name read failed: ${error.message}`);
      return out;
    }
    for (const u of (data ?? []) as any[]) {
      const name = typeof u.name === "string" ? u.name.trim() : "";
      if (name) out.set(u.user_id, name);
    }
    return out;
  }

  /**
   * Numbers the DTO lets through (any finite number) but the database cannot
   * hold, refused here with a sentence. Done in the service, not as a DTO
   * `@Max`, because ValidationPipe prefixes a nested line's message with its
   * path ("lines.0.") and the founder's rule is a plain sentence.
   */
  private assertSavable(dto: SaveRecipeDto) {
    if (dto.yieldServes > MAX_YIELD_SERVES) {
      throw new BadRequestException(`A recipe makes at most ${MAX_YIELD_SERVES.toLocaleString("en-US")} serves.`);
    }
    dto.lines.forEach((l, i) => {
      // JavaScript's trim takes every Unicode space, a no-break space included;
      // the database's btrim takes only the plain one (round 14).
      const label = (l.label ?? "").trim();
      if (!label) throw new BadRequestException(`Ingredient ${i + 1} needs a name.`);
      l.label = label;
      if (l.usablePct !== undefined && l.usablePct !== null) {
        const u = l.usablePct;
        if (!(u >= 1 && u <= 100) || Math.abs(Math.round(u * 100) - u * 100) > 1e-6) {
          throw new BadRequestException(
            `Ingredient ${i + 1} (${l.label}): the usable share is a number of percent, from 1 to 100.`,
          );
        }
        if (l.role === "untracked" && u !== 100) {
          throw new BadRequestException(`Ingredient ${i + 1} (${l.label}) is not counted, so it has no usable share.`);
        }
      }
      if (l.qty > MAX_LINE_QTY) {
        throw new BadRequestException(
          `Ingredient ${i + 1} (${l.label}) is more than one line can hold. ` +
            `The most is ${MAX_LINE_QTY.toLocaleString("en-US")} ${l.unit}.`,
        );
      }
    });
  }

  async saveRecipe(restaurantId: string, cocktailId: string, author: string | null, dto: SaveRecipeDto) {
    this.assertSavable(dto);
    const { data, error } = await this.db.getClient().rpc("save_recipe_version", {
      p_restaurant: restaurantId,
      p_cocktail: cocktailId,
      p_expected_version: dto.expectedVersionId ?? null,
      p_yield_serves: dto.yieldServes,
      p_method: dto.method ?? null,
      p_glass: dto.glass ?? null,
      p_garnish: dto.garnish ?? null,
      p_author: author,
      p_lines: dto.lines.map((l) => ({
        role: l.role,
        inventoryId: l.inventoryId ?? null,
        label: l.label,
        qty: l.qty,
        unit: l.unit,
        usablePct: l.usablePct ?? null,
      })),
    });
    return this.saved(data, error);
  }

  /**
   * Save a new version of a dish's recipe (ADR 0366) through its one RPC,
   * `save_dish_recipe_version`. A plate has no glass: one sent is not stored.
   */
  async saveDishRecipe(restaurantId: string, dishId: string, author: string | null, dto: SaveRecipeDto) {
    this.assertSavable(dto);
    const { data, error } = await this.db.getClient().rpc("save_dish_recipe_version", {
      p_restaurant: restaurantId,
      p_dish: dishId,
      p_expected_version: dto.expectedVersionId ?? null,
      p_yield_serves: dto.yieldServes,
      p_method: dto.method ?? null,
      p_garnish: dto.garnish ?? null,
      p_author: author,
      p_lines: dto.lines.map((l) => ({
        role: l.role,
        inventoryId: l.inventoryId ?? null,
        label: l.label,
        qty: l.qty,
        unit: l.unit,
        usablePct: l.usablePct ?? null,
      })),
    });
    return this.saved(data, error);
  }

  private saved(data: unknown, error: { code?: string; message: string } | null) {
    if (error) {
      if (error.code === "RCP09") throw new ConflictException(STALE_SAVE);
      if (error.code === "RCP00") throw new BadRequestException(error.message);
      this.logger.error(`recipes: save failed: ${error.message}`);
      throw new InternalServerErrorException(SAVE_FAILED);
    }
    const out = data as { version_id?: string; version?: number; lines?: unknown[] } | null;
    if (!out?.version_id) {
      this.logger.error("recipes: save returned no version");
      throw new InternalServerErrorException(SAVE_FAILED);
    }
    return { versionId: out.version_id, version: out.version, lines: out.lines ?? [] };
  }

  async shelf(restaurantId: string, search: string | undefined, limit: number | undefined) {
    let q = this.db
      .getClient()
      .from("restaurant_inventory")
      .select("id, display_name, kind, uom, bottle_size_ml")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .is("deleted_at", null);
    // A term is read under foldName's rules (r28 gap 14): "RAKI", "raki" and
    // "rakı" all find "Rakı", and "seker" finds "Şeker". Each folded letter is
    // sent as the class of every way it is written, both cases, so the answer
    // does not lean on the database's own case rules for I and İ.
    const pattern = shelfSearchPattern(search ?? "");
    if (pattern) q = q.filter("display_name", "imatch", pattern);
    const { data, error } = await q
      .order("display_name", { ascending: true })
      .limit(Math.min(Math.max(limit ?? 50, 1), 50));
    if (error) this.failed("shelf read", error, SHELF_FAILED);
    return ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      name: r.display_name,
      kind: r.kind,
      uom: r.uom,
      bottleSizeMl: r.bottle_size_ml == null ? null : Number(r.bottle_size_ml),
    }));
  }

  /**
   * Keep what one piece of a good weighs, and what one ml of it weighs, as the
   * house states them (r28 gap 7). A recipe line measured another way than
   * the good is kept is priced and counted through these and nothing else.
   * A field left out is kept; null takes the statement off. House-scoped: a
   * good of another house is not found. The cost views are untouched: the
   * weights change no lot's cost, only how a line meets it.
   */
  async stateWeights(restaurantId: string, itemId: string, dto: StateWeightsDto) {
    const patch: Record<string, number | null> = {};
    // The smallest step each column keeps (numeric(10,3), numeric(8,4)): a
    // figure below it would be stored as 0, which the database refuses.
    if (dto.pieceGrams !== undefined) patch.piece_grams = this.weight(dto.pieceGrams, 0.001, MAX_PIECE_GRAMS, "One piece");
    if (dto.mlGrams !== undefined) patch.ml_grams = this.weight(dto.mlGrams, 0.0001, MAX_ML_GRAMS, "One ml");
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException("Say what one piece weighs, what one ml weighs, or both.");
    }
    const { data, error } = await this.db
      .getClient()
      .from("restaurant_inventory")
      .update(patch)
      .eq("id", itemId)
      .eq("restaurant_id", restaurantId)
      .select("id, piece_grams, ml_grams")
      .maybeSingle();
    if (error) {
      this.logger.error(`recipes: weight save failed: ${error.message}`);
      throw new InternalServerErrorException(WEIGHT_SAVE_FAILED);
    }
    if (!data) throw new NotFoundException(WEIGHT_NOT_THIS_HOUSE);
    const row = data as { id: string; piece_grams: unknown; ml_grams: unknown };
    return { id: row.id, pieceGrams: grams(row.piece_grams), mlGrams: grams(row.ml_grams) };
  }

  private weight(v: number | null, min: number, max: number, what: string): number | null {
    if (v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min) {
      throw new BadRequestException(`${what} must weigh more than 0 g.`);
    }
    if (v > max) throw new BadRequestException(`${what} can weigh at most ${max} g. Check the figure.`);
    return v;
  }
}
