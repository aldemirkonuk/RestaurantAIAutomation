import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  ALLERGENS,
  basisFor,
  checkWrite,
  figureOrNull,
  type Allergen,
  type AllergenStatus,
  type Basis,
  type NutritionSource,
} from "./nutrition-figures";
import type { SaveItemNutritionDto } from "./dto/item-nutrition.dto";

export interface StoredFigures {
  basis: Basis;
  energyKcal: number | null;
  fatG: number | null;
  saturatesG: number | null;
  carbohydrateG: number | null;
  sugarsG: number | null;
  proteinG: number | null;
  saltG: number | null;
  abvPct: number | null;
  /** Energy was worked out from the ABV alone: alcohol only, sugar not counted. */
  energyFromAbv: boolean;
  source: NutritionSource;
  sourceRef: string | null;
  statedByName: string;
  statedAt: string;
}

export interface AllergenLine {
  allergen: Allergen;
  status: AllergenStatus | "not_stated";
  statedByName: string | null;
  statedAt: string | null;
}

/** GET /inventory/:rid/item/:id/nutrition. All 14 allergens, always; a missing one is not_stated. */
export interface ItemNutrition {
  item: { id: string; name: string; kind: string | null; uom: string | null };
  /** Per 100 g or 100 ml from the item's own unit; null when only a person can say. */
  suggestedBasis: Basis | null;
  /** null: nothing stated yet. Each figure inside is null when not known, never 0. */
  figures: StoredFigures | null;
  allergens: AllergenLine[];
  /**
   * Only on the answer to a save: what was saved but looks wrong (energy
   * against 4/4/9). Said, never refused; empty when nothing looks wrong.
   */
  warnings?: string[];
}

const FIGURE_COLUMNS =
  "basis, energy_kcal, fat_g, saturates_g, carbohydrate_g, sugars_g, protein_g, salt_g, abv_pct, energy_from_abv, source, source_ref, stated_by_name, stated_at";

const UNREAD =
  "What is in this item could not be read just now, so nothing is shown as known. Try again in a moment.";

/**
 * One item's nutrition and allergens (migration
 * 20270512091500_a_good_says_what_is_in_it). Every read and write names the
 * house: the item is read by id AND restaurant_id, and the write function
 * refuses an item of another house. A failed read is a 503 with a sentence,
 * never an empty card.
 */
@Injectable()
export class ItemNutritionService {
  private readonly logger = new Logger(ItemNutritionService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.supabase;
  }

  private failed(what: string, restaurantId: string, itemId: string, message: string): never {
    this.logger.error({ message: `item nutrition: ${what} failed`, restaurantId, itemId, error: message });
    throw new ServiceUnavailableException(UNREAD);
  }

  async read(restaurantId: string, itemId: string): Promise<ItemNutrition> {
    const { data: item, error: itemError } = await this.db
      .from("restaurant_inventory")
      .select("id, kind, uom, display_name")
      .eq("id", itemId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (itemError) this.failed("item read", restaurantId, itemId, itemError.message);
    if (!item) throw new NotFoundException("This item is not one of this house's items.");
    const it = item as { id: string; kind: string | null; uom: string | null; display_name: string | null };

    const [nut, alg] = await Promise.all([
      this.db
        .from("item_nutrition")
        .select(FIGURE_COLUMNS)
        .eq("restaurant_id", restaurantId)
        .eq("inventory_id", itemId)
        .maybeSingle(),
      this.db
        .from("item_allergens")
        .select("allergen, status, stated_by_name, stated_at")
        .eq("restaurant_id", restaurantId)
        .eq("inventory_id", itemId),
    ]);
    if (nut.error) this.failed("figures read", restaurantId, itemId, nut.error.message);
    if (alg.error) this.failed("allergens read", restaurantId, itemId, alg.error.message);

    const r = nut.data as Record<string, unknown> | null;
    const figures: StoredFigures | null = r
      ? {
          basis: r.basis as Basis,
          energyKcal: figureOrNull(r.energy_kcal, 1),
          fatG: figureOrNull(r.fat_g),
          saturatesG: figureOrNull(r.saturates_g),
          carbohydrateG: figureOrNull(r.carbohydrate_g),
          sugarsG: figureOrNull(r.sugars_g),
          proteinG: figureOrNull(r.protein_g),
          saltG: figureOrNull(r.salt_g),
          abvPct: figureOrNull(r.abv_pct, 1),
          energyFromAbv: r.energy_from_abv === true,
          source: r.source as NutritionSource,
          sourceRef: (r.source_ref as string | null) ?? null,
          statedByName: String(r.stated_by_name ?? ""),
          statedAt: String(r.stated_at ?? ""),
        }
      : null;

    const stated = new Map(
      ((alg.data ?? []) as Array<{ allergen: Allergen; status: AllergenStatus; stated_by_name: string; stated_at: string }>).map(
        (a) => [a.allergen, a],
      ),
    );
    const allergens: AllergenLine[] = ALLERGENS.map((a) => {
      const s = stated.get(a);
      return s
        ? { allergen: a, status: s.status, statedByName: s.stated_by_name, statedAt: s.stated_at }
        : { allergen: a, status: "not_stated", statedByName: null, statedAt: null };
    });

    return {
      item: { id: it.id, name: it.display_name ?? "Unnamed item", kind: it.kind, uom: it.uom },
      suggestedBasis: basisFor(it.kind, it.uom),
      figures,
      allergens,
    };
  }

  /**
   * Replace what the house states about this item: the figures (null removes
   * them) and the whole allergen set (one left out, or not_stated, has no row).
   * One transaction in save_item_nutrition(); the answer is the read after it.
   */
  async save(
    restaurantId: string,
    itemId: string,
    userId: string,
    userName: string,
    dto: SaveItemNutritionDto,
  ): Promise<ItemNutrition> {
    const name = (userName ?? "").trim();
    if (!name) {
      throw new BadRequestException("Your account has no name on file, so this cannot say who stated it. Nothing was saved.");
    }

    let row: Record<string, unknown> | null = null;
    let warnings: string[] = [];
    if (dto.figures) {
      const f = dto.figures;
      const checked = checkWrite({
        basis: f.basis as Basis,
        figures: {
          energyKcal: f.energyKcal ?? null,
          fatG: f.fatG ?? null,
          saturatesG: f.saturatesG ?? null,
          carbohydrateG: f.carbohydrateG ?? null,
          sugarsG: f.sugarsG ?? null,
          proteinG: f.proteinG ?? null,
          saltG: f.saltG ?? null,
          abvPct: f.abvPct ?? null,
        },
        source: f.source as NutritionSource,
        sourceRef: f.sourceRef ?? null,
      });
      if (!checked.ok) throw new BadRequestException(`${checked.why} Nothing was saved.`);
      row = checked.row;
      warnings = checked.warnings;
    }

    const seen = new Set<string>();
    const allergens: Array<{ allergen: string; status: string }> = [];
    for (const a of dto.allergens ?? []) {
      if (seen.has(a.allergen)) {
        throw new BadRequestException("An allergen is stated twice. Nothing was saved.");
      }
      seen.add(a.allergen);
      if (a.status !== "not_stated") allergens.push({ allergen: a.allergen, status: a.status });
    }

    const { error } = await this.db.rpc("save_item_nutrition", {
      p_restaurant_id: restaurantId,
      p_inventory_id: itemId,
      p_stated_by: userId,
      p_stated_by_name: name,
      p_nutrition: row,
      p_allergens: allergens,
    });
    if (error) {
      this.logger.error({ message: "item nutrition: save failed", restaurantId, itemId, error: error.message, code: error.code });
      if (error.code === "P0002") throw new NotFoundException("This item is not one of this house's items. Nothing was saved.");
      if (error.code === "23514") {
        throw new BadRequestException("These figures do not add up for this item, so they were not saved. Check each one against the pack.");
      }
      throw new ServiceUnavailableException("What is in this item could not be saved just now. Nothing was changed; try again.");
    }
    return { ...(await this.read(restaurantId, itemId)), warnings };
  }
}
