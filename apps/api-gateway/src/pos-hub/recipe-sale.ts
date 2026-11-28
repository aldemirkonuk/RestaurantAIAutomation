import {
  BaseUnit,
  RecipeLine,
  RecipeVersion,
  ShelfItem,
  drawArgs,
  planRecipeDraw,
} from "./recipe-draw";

/**
 * Recipe draw, slice 4 (inventory r28, gap 1): a till line whose button names a
 * drink recipe takes the recipe's goods off the shelf, and its void gives them
 * back. The plan is slice 1, the writers slices 3a-3c; this is their caller,
 * shared by the generic hub and Toast, with its reads and writes behind
 * `RecipeSaleIo` so a spec or a database proof can stand in for them.
 *
 * It never guesses: an unreadable recipe, an unconfirmed house, a plan that
 * waits and a short shelf all book NOTHING and return `queue` with the
 * sentence a reviewer reads (ADR 0020). The writer settles the carry and
 * re-checks the house under its own lock.
 */

/** The three things the branch needs from outside. */
export interface RecipeSaleIo {
  /** The house's current version of the cocktail, or null when it has none. */
  readRecipe(
    restaurantId: string,
    cocktailId: string,
  ): Promise<{ version: RecipeVersion | null; error: string | null }>;
  /** The house-scoped read of the shelf items a recipe names (ADR 0141). */
  readShelf(
    restaurantId: string,
    inventoryIds: string[],
  ): Promise<{ shelf: Map<string, ShelfItem>; error: string | null }>;
  rpc(
    fn: "record_recipe_draw" | "reverse_recipe_draw",
    args: Record<string, unknown>,
  ): Promise<{ data: any; error: { message?: string } | null }>;
}

/**
 * `unmapped` and `no_sale_volume` are the two reasons the review queue holds
 * (pos_unresolved_lines_reason_check). A recipe the house has not finished
 * linking is "unmapped"; every other reason a draw cannot be made is the
 * second, and `detail` says which.
 */
export type RecipeSaleOutcome =
  | { kind: "booked"; inventoryIds: string[] }
  | { kind: "replay" }
  | { kind: "queue"; reason: "unmapped" | "no_sale_volume"; detail: string }
  | { kind: "failed"; message: string };

export type RecipeVoidOutcome =
  | { kind: "returned"; inventoryIds: string[] }
  | { kind: "nothing" } // this house never booked the sale, or gave it back
  | { kind: "queue"; reason: "no_sale_volume"; detail: string }
  | { kind: "failed"; message: string };

const UNLINKED_REASONS = new Set(["unlinked", "not_this_house", "removed"]);

function reasonFor(reasons: string[]): "unmapped" | "no_sale_volume" {
  return reasons.some((r) => UNLINKED_REASONS.has(r)) ? "unmapped" : "no_sale_volume";
}

function ids(draws: unknown): string[] {
  return Array.isArray(draws)
    ? draws
        .map((d: any) => d?.inventory_id)
        .filter((x: unknown): x is string => typeof x === "string")
    : [];
}

type Wait = { inventory_id?: string; reason?: string };
const waitsOf = (v: unknown): Wait[] => (Array.isArray(v) ? (v as Wait[]) : []);

/** One sold line: plan it, then book it all or queue it. */
export async function sellRecipeLine(
  io: RecipeSaleIo,
  args: {
    restaurantId: string;
    cocktailId: string;
    saleKey: string;
    serves: number;
    occurredAt: string | null;
  },
): Promise<RecipeSaleOutcome> {
  const { restaurantId, cocktailId, saleKey, serves, occurredAt } = args;
  const recipe = await io.readRecipe(restaurantId, cocktailId);
  if (recipe.error) {
    return {
      kind: "queue",
      reason: "no_sale_volume",
      detail: `could not read the recipe this button sells, so no stock was moved: ${recipe.error}`,
    };
  }
  if (!recipe.version) {
    return {
      kind: "queue",
      reason: "unmapped",
      detail: "the recipe this button sells has no saved version, so no stock was moved",
    };
  }
  const stockedIds = [
    ...new Set(
      recipe.version.lines
        .filter((l) => l.role === "stocked" && l.inventoryId !== null)
        .map((l) => l.inventoryId as string),
    ),
  ];
  const shelfRead = stockedIds.length
    ? await io.readShelf(restaurantId, stockedIds)
    : { shelf: new Map<string, ShelfItem>(), error: null };
  if (shelfRead.error) {
    // A failed read cannot say yes (I5): nothing is booked.
    return {
      kind: "queue",
      reason: "no_sale_volume",
      detail: `could not confirm the shelf items of this recipe belong to this restaurant, so no stock was moved: ${shelfRead.error}`,
    };
  }
  const plan = planRecipeDraw(recipe.version, serves, shelfRead.shelf);
  if (plan.kind === "wait") {
    return {
      kind: "queue",
      reason: reasonFor(plan.waits.map((w) => w.reason)),
      detail: `the recipe cannot be drawn yet (${plan.waits
        .map((w) => `${w.label ?? "the recipe"}: ${w.reason}`)
        .join("; ")}), so no stock was moved`,
    };
  }
  if (plan.draws.length === 0) {
    // Only untracked lines (garnish, ice): nothing to draw, and not a wait.
    return { kind: "booked", inventoryIds: [] };
  }
  const { data, error } = await io.rpc(
    "record_recipe_draw",
    drawArgs(restaurantId, saleKey, cocktailId, plan, occurredAt),
  );
  if (error) return { kind: "failed", message: error.message ?? "no message" };
  switch (data?.status) {
    case "booked":
      return { kind: "booked", inventoryIds: ids(data.draws) };
    case "replay":
      return { kind: "replay" };
    case "wait": {
      const waits = waitsOf(data.waits);
      return {
        kind: "queue",
        reason: reasonFor(waits.map((w) => String(w.reason))),
        detail: `the database would not draw this recipe (${waits
          .map((w) => `${w.inventory_id}: ${w.reason}`)
          .join("; ")}), so no stock was moved`,
      };
    }
    case "short": {
      const short: Array<{ inventory_id?: string; need?: unknown; have?: unknown }> =
        Array.isArray(data.short) ? data.short : [];
      return {
        kind: "queue",
        reason: "no_sale_volume",
        detail: `the shelf is short for this recipe (${short
          .map((s) => `${s.inventory_id}: need ${s.need}, have ${s.have}`)
          .join("; ")}), so no stock was moved`,
      };
    }
    default:
      return {
        kind: "failed",
        message: `record_recipe_draw answered with an unknown status ${JSON.stringify(data?.status ?? null)}`,
      };
  }
}

/** A void gives back what the sale booked, never a re-exploded recipe (I3). */
export async function voidRecipeLine(
  io: RecipeSaleIo,
  args: { restaurantId: string; saleKey: string; occurredAt: string | null },
): Promise<RecipeVoidOutcome> {
  const { data, error } = await io.rpc("reverse_recipe_draw", {
    p_restaurant: args.restaurantId,
    p_sale_key: args.saleKey,
    p_occurred_at: args.occurredAt,
  });
  if (error) return { kind: "failed", message: error.message ?? "no message" };
  switch (data?.status) {
    case "returned":
      return { kind: "returned", inventoryIds: ids(data.draws) };
    case "replay":
    case "nothing_booked":
      return { kind: "nothing" };
    case "wait":
      return {
        kind: "queue",
        reason: "no_sale_volume",
        detail: `the void could not give the recipe's stock back (${waitsOf(data.waits)
          .map((w) => `${w.inventory_id}: ${w.reason}`)
          .join("; ")}), so nothing was returned`,
      };
    default:
      return {
        kind: "failed",
        message: `reverse_recipe_draw answered with an unknown status ${JSON.stringify(data?.status ?? null)}`,
      };
  }
}

/** The supabase-backed reads. The database re-checks the house under its lock. */
export function supabaseRecipeIo(client: any): RecipeSaleIo {
  return {
    async readRecipe(restaurantId, cocktailId) {
      const cur = await client
        .from("recipe_current")
        .select("version_id")
        .eq("restaurant_id", restaurantId)
        .eq("cocktail_id", cocktailId)
        .maybeSingle();
      if (cur.error) return { version: null, error: `recipe_current: ${cur.error.message}` };
      if (!cur.data) return { version: null, error: null };
      const versionId = cur.data.version_id as string;
      const ver = await client
        .from("recipe_versions")
        .select("id, yield_serves")
        .eq("id", versionId)
        .maybeSingle();
      if (ver.error) return { version: null, error: `recipe_versions: ${ver.error.message}` };
      if (!ver.data) return { version: null, error: null };
      const lines = await client
        .from("recipe_lines")
        .select("position, role, inventory_id, label, qty_base, base_unit")
        .eq("version_id", versionId)
        .order("position", { ascending: true });
      if (lines.error) return { version: null, error: `recipe_lines: ${lines.error.message}` };
      const mapped: RecipeLine[] = (lines.data ?? []).map((l: any) => ({
        position: Number(l.position),
        role: l.role,
        inventoryId: l.inventory_id ?? null,
        label: String(l.label),
        qtyBase: Number(l.qty_base),
        baseUnit: l.base_unit as BaseUnit,
      }));
      return {
        version: { id: versionId, yieldServes: Number(ver.data.yield_serves), lines: mapped },
        error: null,
      };
    },
    async readShelf(restaurantId, inventoryIds) {
      const { data, error } = await client
        .from("restaurant_inventory")
        .select("id, uom, bottle_size_ml")
        .eq("restaurant_id", restaurantId)
        .in("id", inventoryIds);
      const shelf = new Map<string, ShelfItem>();
      if (error) return { shelf, error: `restaurant_inventory: ${error.message}` };
      for (const r of data ?? []) {
        shelf.set(r.id, {
          uom: r.uom ?? null,
          bottleSizeMl: r.bottle_size_ml == null ? null : Number(r.bottle_size_ml),
        });
      }
      return { shelf, error: null };
    },
    async rpc(fn, args) {
      const { data, error } = await client.rpc(fn, args);
      return { data, error };
    },
  };
}
