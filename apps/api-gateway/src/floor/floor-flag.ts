/**
 * The floor's house switch (ADR 0345 E7): `restaurant_feature_flags.floor_checker`
 * on the house's settings row, default false, added by migration
 * `the_floor_keeps_its_own_record`.
 *
 * Read fails closed, as `communications/inbox/house-inbox-flag.ts` does: no
 * settings row, a read error or a thrown client all mean OFF. A floor that
 * cannot tell whether it is switched on stays dark.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SETTINGS_ROW_FLAG_NAME } from "../settings/feature-flag-registry";

export const FLOOR_FLAG = "floor_checker";

export async function isFloorCheckerEnabled(
  client: SupabaseClient,
  restaurantId: string,
): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("restaurant_feature_flags")
      .select(FLOOR_FLAG)
      .eq("restaurant_id", restaurantId)
      .eq("flag_name", SETTINGS_ROW_FLAG_NAME)
      .maybeSingle();
    if (error || !data) return false;
    return (data as Record<string, unknown>)[FLOOR_FLAG] === true;
  } catch {
    return false;
  }
}
