import {
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A till button's drink recipe (inventory r28 audit, gap 1, slice 2 of 4).
 *
 * `pos_item_mappings.cocktail_id` names the house's cocktail a button sells.
 * Migration 20271015100000 lets a mapping name AT MOST ONE thing it draws, a
 * shelf item (`inventory_id`) or a recipe (`cocktail_id`), and this file holds
 * the writer's two checks:
 *
 * - `cocktailIdOf` reads the body's `cocktail_id`: a uuid, or null/absent for
 *   none. Anything else is a caller's bug, refused in words (400). A mapping
 *   that names both an item and a recipe is refused too, before the database
 *   refuses it with a constraint name nobody can read.
 * - `assertCocktailBelongsToRestaurant` refuses a recipe that is not the
 *   caller's house's: another house's (403), an unattributed reference row
 *   (`restaurant_id` NULL, the corpus 20260817090000 loaded; 403), one the
 *   house removed (`deleted_at` set; 403), and a read
 *   that failed (422; a failed read is not a permission, ADR 0141's rule).
 *
 * Nothing reads the link yet: until the recipe-draw writer lands (slices 3-4),
 * a recipe button moves no stock, as every non-wine button does today.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cocktailIdOf(mapping: Record<string, unknown>): string | null {
  const raw = mapping.cocktail_id ?? null;
  if (raw === null) return null;
  if (typeof raw !== "string" || !UUID.test(raw.trim())) {
    throw new BadRequestException(
      `cocktail_id must be the id of one of this house's drink recipes, or null — got ${JSON.stringify(raw)}`,
    );
  }
  const id = raw.trim().toLowerCase();
  if (mapping.inventory_id) {
    throw new BadRequestException(
      "A till button draws either one shelf item or one drink recipe, not both: send inventory_id or cocktail_id, and null for the other.",
    );
  }
  if (mapping.is_wine === true) {
    throw new BadRequestException(
      "A drink recipe is not a wine pour: send is_wine false with a cocktail_id.",
    );
  }
  return id;
}

export async function assertCocktailBelongsToRestaurant(
  client: SupabaseClient,
  restaurantId: string,
  cocktailId: string,
  logger?: { error: (m: string) => void; warn: (m: string) => void },
): Promise<void> {
  const { data, error } = await client
    .from("cocktails")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("id", cocktailId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    logger?.error(`upsertItemMapping cocktail check failed for ${cocktailId}: ${error.message}`);
    throw new UnprocessableEntityException(
      `Could not confirm that drink recipe ${cocktailId} belongs to this restaurant, so the till button was not mapped: ${error.message}`,
    );
  }
  if (!data) {
    logger?.warn(`upsertItemMapping rejected a cocktail not of this house: ${cocktailId}`);
    throw new ForbiddenException(
      `Drink recipe ${cocktailId} is not one of this restaurant's recipes, so the till button was not mapped.`,
    );
  }
}
