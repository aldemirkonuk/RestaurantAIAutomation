import { InternalServerErrorException, NotFoundException } from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readPeople } from "./price-locks";

/**
 * When, by whom and from where one good's house price changed (r36 menu
 * audit N6).
 *
 * Every change of a house price closes the open `menu_price_versions` row and
 * opens a new one with who changed it and from where (the trigger and
 * `set_house_menu_price`), but nothing read the closed rows back: on day 30 an
 * owner could not see when, or by whom, Chianti went from 48 to 52. This is
 * that read, newest first.
 *
 * Scoped to the house twice: the good must be this house's (another house's
 * id is the same 404 as an unknown one), and the versions are read with the
 * house's id as well as the good's. The newest `limit` rows are returned, and
 * `more` says when older ones exist. A failed read throws; who changed a price
 * that cannot be named is said (`namesReadable: false`), never left blank.
 */

export type PriceChangeSource = "manual" | "agent_accepted" | "import" | "backfill";

export interface HousePriceVersion {
  bottle: number | null;
  glass: number | null;
  /** When this price took over. */
  from: string;
  /** When it was replaced; null while it is the price now. */
  to: string | null;
  source: PriceChangeSource | string;
  by: { userId: string | null; name: string | null };
  reason: string | null;
}

export interface HousePriceHistory {
  inventoryId: string;
  goodName: string | null;
  versions: HousePriceVersion[];
  /** Older changes exist beyond these. */
  more: boolean;
  namesReadable: boolean;
  namesReason: string | null;
}

/** The newest changes read at once: a page, not the whole life of a good. */
export const HISTORY_LIMIT = 30;

/** The columns read, a module-level const so the read-column guard checks them. */
export const HISTORY_COLUMNS = "bottle_price, glass_price, effective_from, effective_to, change_source, changed_by, reason";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function readHousePriceHistory(
  client: SupabaseClient,
  restaurantId: string,
  inventoryId: string,
  limit = HISTORY_LIMIT,
): Promise<HousePriceHistory> {
  const { data: good, error: goodErr } = await client
    .from("restaurant_inventory")
    .select("id, wine_name, display_name")
    .eq("id", inventoryId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (goodErr) {
    throw new InternalServerErrorException(`The good could not be read, so its price history is not shown: ${goodErr.message}.`);
  }
  if (!good) throw new NotFoundException("No good of this house by that id.");

  const { data, error } = await client
    .from("menu_price_versions")
    .select(HISTORY_COLUMNS)
    .eq("inventory_id", inventoryId)
    .eq("restaurant_id", restaurantId)
    .order("effective_from", { ascending: false })
    .limit(limit + 1);
  if (error) {
    throw new InternalServerErrorException(`The price history could not be read: ${error.message}.`);
  }
  const rows = ((data ?? []) as Array<Record<string, unknown>>).slice(0, limit);
  const { people, error: namesError } = await readPeople(
    client,
    rows.map((r) => (typeof r.changed_by === "string" ? r.changed_by : null)),
  );
  const g = good as Record<string, unknown>;
  return {
    inventoryId,
    goodName: (g.display_name as string | null) ?? (g.wine_name as string | null) ?? null,
    versions: rows.map((r) => {
      const userId = typeof r.changed_by === "string" ? r.changed_by : null;
      return {
        bottle: num(r.bottle_price),
        glass: num(r.glass_price),
        from: String(r.effective_from),
        to: r.effective_to ? String(r.effective_to) : null,
        source: String(r.change_source ?? "manual"),
        by: { userId, name: userId ? (people.get(userId)?.name ?? null) : null },
        reason: typeof r.reason === "string" && r.reason.trim() ? r.reason : null,
      };
    }),
    more: (data ?? []).length > limit,
    namesReadable: namesError === null,
    namesReason: namesError === null ? null : `who changed these prices could not be named: ${namesError}`,
  };
}
