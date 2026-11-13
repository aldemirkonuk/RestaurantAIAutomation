import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { CreateHouseItemDto } from "./dto/house-item.dto";

// restaurant_inventory_kind_check / _uom_check (the_house_item_is_the_ledgers_key).
export const HOUSE_ITEM_KINDS = [
  "beer", "whiskey", "spirit", "liqueur", "cocktail", "sake", "cider",
  "non_alcoholic", "soft_drink", "food", "supply", "other",
] as const;
export const HOUSE_ITEM_UOMS = [
  "bottle", "case", "keg", "pack", "each", "glass", "shot", "ml", "mg", "g",
] as const;
// ADR 0070: integer quantities in the smallest unit (proposal K6).
const BIG_UNIT: Record<string, string> = { kg: "store it in g", l: "store it in ml" };
// r21 D2: what one container holds. Only a bottle or a keg has a size that
// recipe-cost.ts (CONTAINERS) reads; a case or pack is counted by the bottle
// inside it. Bottle bounds are the item edit's own (inventory.dto.ts
// bottleSizeMl, 50-18000), so a size carried here can be edited there; a keg
// runs from a 1 l mini keg to a 58.7 l US half barrel.
export const CONTAINER_ML: Record<string, { min: number; max: number }> = {
  bottle: { min: 50, max: 18000 },
  keg: { min: 1000, max: 60000 },
};

@Injectable()
export class HouseItemService {
  constructor(private readonly db: DatabaseService) {}

  async carry(restaurantId: string, dto: CreateHouseItemDto) {
    if (dto.kind === "wine") {
      throw new BadRequestException("Wine is not carried here: add a wine from the library.");
    }
    if (!(HOUSE_ITEM_KINDS as readonly string[]).includes(dto.kind)) {
      throw new BadRequestException(`"${dto.kind}" is not a kind of item. Use one of: ${HOUSE_ITEM_KINDS.join(", ")}.`);
    }
    if (BIG_UNIT[dto.uom]) {
      throw new BadRequestException(`Stock is kept in whole small units: ${BIG_UNIT[dto.uom]}.`);
    }
    if (!(HOUSE_ITEM_UOMS as readonly string[]).includes(dto.uom)) {
      throw new BadRequestException(`"${dto.uom}" is not a unit. Use one of: ${HOUSE_ITEM_UOMS.join(", ")}.`);
    }
    const name = (dto.displayName ?? "").trim();
    if (name.length < 1 || name.length > 120) {
      throw new BadRequestException("Give the item a name of 1 to 120 characters.");
    }
    const size = dto.bottleSizeMl ?? null;
    if (size !== null) {
      const band = CONTAINER_ML[dto.uom];
      if (!band) {
        throw new BadRequestException(
          `A size is what one bottle or keg holds; a good kept in ${dto.uom} has none. Nothing was added.`,
        );
      }
      if (!Number.isInteger(size) || size < band.min || size > band.max) {
        throw new BadRequestException(
          `A ${dto.uom} holds a whole number of ml from ${band.min} to ${band.max}; ${String(size)} is not one. Nothing was added.`,
        );
      }
    }

    const client = this.db.supabase;
    const { data, error } = await client
      .from("restaurant_inventory")
      .insert({
        restaurant_id: restaurantId,
        master_wine_id: null,
        beverage_id: null,
        kind: dto.kind,
        uom: dto.uom,
        display_name: name,
        // The list names a row by wine_name (inventory.service mapInventoryItem).
        wine_name: name,
        identity_provenance: "house_declared",
        // Absent par is 0, no par; never the column's DEFAULT 3 (#801).
        threshold_min: dto.thresholdMin ?? 0,
        // The paper's own size, or NULL: unknown, never the 750 a wine read
        // falls back to (r21 D2). A 200 ml tonic costs per ml by 200.
        bottle_size_ml: size,
        is_active: true,
        // stock_live is left to its DEFAULT 0: stock arrives only as a lot.
      })
      .select("id, kind, uom, display_name, threshold_min, bottle_size_ml")
      .single();

    if (error?.code === "23505") {
      // restaurant_inventory_house_declared_uidx: (restaurant_id, lower(display_name)).
      const existing = await client
        .from("restaurant_inventory")
        .select("id, display_name")
        .eq("restaurant_id", restaurantId)
        .is("master_wine_id", null)
        .is("beverage_id", null)
        .is("deleted_at", null);
      const hit = existing.error
        ? undefined
        : ((existing.data ?? []) as Array<{ id: string; display_name: string | null }>).find(
            (r) => (r.display_name ?? "").toLowerCase() === name.toLowerCase(),
          );
      throw new ConflictException({
        statusCode: 409,
        message: `This house already carries ${name}`,
        existingId: hit?.id ?? null,
      });
    }
    if (error || !data) {
      throw new InternalServerErrorException(
        `${name} could not be added (${error?.message ?? "no row came back"}). Nothing was added.`,
      );
    }
    return {
      id: data.id,
      kind: data.kind,
      uom: data.uom,
      displayName: data.display_name,
      thresholdMin: data.threshold_min,
      bottleSizeMl: data.bottle_size_ml ?? null,
    };
  }
}
