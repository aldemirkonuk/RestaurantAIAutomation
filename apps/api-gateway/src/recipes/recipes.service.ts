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
import { SaveRecipeDto } from "./dto/recipes.dto";

export const NOT_THIS_HOUSE = "This drink is not on this house's list.";
export const STALE_SAVE = "Someone saved this recipe after you opened it. Nothing was changed.";
export const READ_FAILED = "We could not read this recipe just now. Nothing is shown rather than a wrong one.";
export const SAVE_FAILED = "We could not save this recipe. Nothing was changed.";
const SHELF_FAILED = "We could not read the shelf just now.";

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

  async getRecipe(restaurantId: string, cocktailId: string, role: string | null | undefined) {
    const money = seesHouseAmounts(role);
    const client = this.db.getClient();
    const cocktail = await this.houseCocktail(restaurantId, cocktailId);

    const [pointer, count, legacy] = await Promise.all([
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
    const versionId = (pointer.data as { version_id?: string } | null)?.version_id;
    if (versionId) {
      const [version, lines] = await Promise.all([
        client
          .from("recipe_versions")
          .select("id, version, yield_serves, method, glass, garnish, created_at")
          .eq("id", versionId)
          .eq("restaurant_id", restaurantId)
          .maybeSingle(),
        client
          .from("recipe_lines")
          .select("id, position, role, inventory_id, label, qty_entered, unit_code, qty_base, base_unit")
          .eq("version_id", versionId)
          .eq("restaurant_id", restaurantId)
          .order("position", { ascending: true }),
      ]);
      if (version.error || !version.data) this.failed("version read", version.error ?? "pointer names no version");
      if (lines.error) this.failed("line read", lines.error);
      const rows = (lines.data ?? []) as any[];
      const ids = [...new Set(rows.map((l) => l.inventory_id).filter(Boolean))] as string[];

      const items = new Map<string, any>();
      const lots = new Map<string, any>();
      if (ids.length) {
        // Two literal column lists, so the read-columns guard can check both;
        // a role without money never reads the price.
        const itemQuery = money
          ? client.from("restaurant_inventory").select("id, display_name, kind, uom, bottle_size_ml, last_purchase_price")
          : client.from("restaurant_inventory").select("id, display_name, kind, uom, bottle_size_ml");
        const [itemRead, lotRead] = await Promise.all([
          itemQuery.eq("restaurant_id", restaurantId).in("id", ids),
          money
            ? client
                .from("inventory_lot_rollup")
                .select("inventory_id, live_qty, wac, has_invoice_cost, wac_qty")
                .eq("restaurant_id", restaurantId)
                .in("inventory_id", ids)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (itemRead.error) this.failed("item read", itemRead.error);
        if (lotRead.error) this.failed("lot read", lotRead.error);
        for (const i of (itemRead.data ?? []) as any[]) items.set(i.id, i);
        for (const l of (lotRead.data ?? []) as any[]) lots.set(l.inventory_id, l);
      }

      const v = version.data as Record<string, any>;
      const priced = recipeCost(
        rows.map((l) => ({
          role: l.role,
          inventoryId: l.inventory_id,
          qtyBase: Number(l.qty_base),
          baseUnit: l.base_unit as BaseUnit,
          item: (l.inventory_id && (items.get(l.inventory_id) as CostItem)) || null,
          lot: (l.inventory_id && lots.get(l.inventory_id)) || null,
        })),
        Number(v.yield_serves),
      );
      current = {
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
            qtyEntered: Number(l.qty_entered),
            unitCode: l.unit_code,
            qtyBase: Number(l.qty_base),
            baseUnit: l.base_unit,
            status: priced.lines[i].status,
            costPerServe: money ? priced.lines[i].costPerServe : null,
            costBasis: money ? priced.lines[i].costBasis : null,
          };
        }),
      };
      if (money) cost = { perServe: priced.perServe, priced: priced.priced, of: priced.of, complete: priced.complete };
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
      versionCount: count.count ?? 0,
      legacyLines,
    };
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
    return ((data ?? []) as any[]).map((v) => ({
      versionId: v.id,
      version: v.version,
      createdAt: v.created_at,
      author: v.author ?? null,
      lineCount: Number(v.recipe_lines?.[0]?.count ?? 0),
    }));
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
      })),
    });
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
    const term = (search ?? "").trim();
    if (term) q = q.ilike("display_name", `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
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
}
