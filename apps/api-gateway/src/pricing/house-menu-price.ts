import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one gateway writer of a house's own bottle and glass price (ADR 0193).
 *
 * The bottle price is `restaurant_inventory.menu_price_current` -- the column
 * every margin, valuation and POS path already reads -- and the glass price is
 * `menu_price_glass`. Both are written ONLY through the SQL function
 * `set_house_menu_price` (migration 20260921113200), which:
 *   - checks the item belongs to the house (P0002 otherwise, nothing written);
 *   - refuses a change dated before the price in effect ("stale"): the newest
 *     dated change wins, so a menu line scanned before a manager typed a price
 *     does not overwrite it;
 *   - skips a change that changes nothing ("unchanged");
 *   - otherwise writes the price, and the trigger on restaurant_inventory
 *     closes the open `menu_price_versions` row and opens a new one carrying
 *     `change_source` and `changed_by`.
 *
 * `changedBy` is `public.users.user_id` from the verified JWT and is required:
 * the function refuses a change that names nobody.
 *
 * LOCKS (ADR 0193 round 3; the founder, 2026-09-21: "add a section to that
 * where you can lock price"). A kind with an open lock in `house_price_locks`
 * is never written: the function writes the other kind if it was named, and
 * answers per kind. Overall `locked` means every named kind was held; `held`
 * names each lock whatever the overall outcome, so no caller can report
 * "changed" without the held kind beside it (L5).
 *
 * A plain function, not an injectable: the inventory and menu services call it
 * with the client they already hold, and their specs exercise it against the
 * same fake client rather than a mock of this function.
 */

export type HousePriceSource = "manual" | "agent_accepted" | "import";

export interface HousePriceChange {
  restaurantId: string;
  inventoryId: string;
  /** Omit to leave the bottle price as it is. `null` clears it. */
  bottle?: number | null;
  /** Omit to leave the glass price as it is. `null` clears it. */
  glass?: number | null;
  source: HousePriceSource;
  changedBy: string | null;
  /** When the change happened. Default: now. A menu line passes its own created_at. */
  effectiveFrom?: string | null;
  reason?: string | null;
  /** Cost of one BOTTLE in effect when this price took over, when known. */
  unitCost?: number | null;
  pricingAnalysisId?: string | null;
  /** The menu whose choice (or line) set this price, recorded on the version row (L11). */
  menuId?: string | null;
}

export type HousePriceOutcome = "changed" | "unchanged" | "stale" | "locked";

export type PriceKindName = "bottle" | "glass";

/** What happened to one named kind. */
export type KindOutcome = "changed" | "unchanged" | "stale" | "locked";

/** A kind this write did not touch because a lock holds it. */
export interface HeldKind {
  kind: PriceKindName;
  lockId: string;
  lockedPrice: number | null;
  lockedBy: string | null;
  lockedAt: string | null;
}

export interface HousePriceResult {
  outcome: HousePriceOutcome;
  bottlePrice: number | null;
  glassPrice: number | null;
  previousBottle: number | null;
  previousGlass: number | null;
  /** On "stale": when the price now in effect took over, and from where. */
  currentSince: string | null;
  currentSource: string | null;
  versionId: string | null;
  /** Every named kind a lock held, with the lock. Empty when none was held. */
  held: HeldKind[];
  /** Per named kind; null for a kind the change did not name. */
  kinds: { bottle: KindOutcome | null; glass: KindOutcome | null };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function setHouseMenuPrice(
  client: SupabaseClient,
  change: HousePriceChange,
): Promise<HousePriceResult> {
  const setBottle = change.bottle !== undefined;
  const setGlass = change.glass !== undefined;
  if (!setBottle && !setGlass) {
    throw new BadRequestException(
      "Neither the bottle nor the glass price was named. Nothing was changed.",
    );
  }

  const { data, error } = await client.rpc("set_house_menu_price", {
    p_restaurant_id: change.restaurantId,
    p_inventory_id: change.inventoryId,
    p_set_bottle: setBottle,
    p_bottle_price: setBottle ? change.bottle : null,
    p_set_glass: setGlass,
    p_glass_price: setGlass ? change.glass : null,
    p_change_source: change.source,
    p_changed_by: change.changedBy,
    p_effective_from: change.effectiveFrom ?? null,
    p_reason: change.reason ?? null,
    p_unit_cost: change.unitCost ?? null,
    p_pricing_analysis_id: change.pricingAnalysisId ?? null,
    p_menu_id: change.menuId ?? null,
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "P0002") {
      throw new NotFoundException(
        "No wine of this house by that id. Nothing was changed.",
      );
    }
    if (code === "22023") {
      throw new BadRequestException(`${error.message}`);
    }
    if (code === "HPL01") {
      // The database guard (a write that reached a locked column). This
      // function never aims at a held kind, so it is said, never swallowed.
      throw new ConflictException(`${error.message}`);
    }
    throw new InternalServerErrorException(
      `The price was not saved: ${error.message}`,
    );
  }

  const r = (data ?? {}) as Record<string, unknown>;
  const outcome = r.outcome;
  if (
    outcome !== "changed" &&
    outcome !== "unchanged" &&
    outcome !== "stale" &&
    outcome !== "locked"
  ) {
    // An answer this writer does not recognise is not a success.
    throw new InternalServerErrorException(
      "The price writer returned no outcome; whether the price changed is unknown.",
    );
  }
  const held = heldFrom(r.held);
  if (outcome === "locked" && held.length === 0) {
    // "Locked" with no lock named would be a hold nobody can see.
    throw new InternalServerErrorException(
      "The price writer said the price is locked but named no lock; whether the price changed is unknown.",
    );
  }
  const kinds = (r.kinds ?? {}) as Record<string, unknown>;
  const kindOf = (k: PriceKindName, named: boolean): KindOutcome | null => {
    if (!named) return null;
    const v = kinds[k];
    if (v === "changed" || v === "unchanged" || v === "stale" || v === "locked") return v;
    if (held.some((h) => h.kind === k)) return "locked";
    // An older answer without per-kind outcomes: the overall one applies.
    return outcome === "locked" ? "locked" : outcome;
  };
  return {
    outcome,
    bottlePrice: num(r.bottle_price),
    glassPrice: num(r.glass_price),
    previousBottle: num(r.previous_bottle),
    previousGlass: num(r.previous_glass),
    currentSince: typeof r.current_since === "string" ? r.current_since : null,
    currentSource: typeof r.current_source === "string" ? r.current_source : null,
    versionId: typeof r.version_id === "string" ? r.version_id : null,
    held,
    kinds: { bottle: kindOf("bottle", setBottle), glass: kindOf("glass", setGlass) },
  };
}

/** The `held` list as the SQL returns it; an entry that is not a lock is an error, never dropped. */
function heldFrom(raw: unknown): HeldKind[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new InternalServerErrorException(
      "The price writer returned a held list that is not a list; whether a lock held the price is unknown.",
    );
  }
  return raw.map((h) => {
    const e = (h ?? {}) as Record<string, unknown>;
    if ((e.kind !== "bottle" && e.kind !== "glass") || typeof e.lock_id !== "string") {
      throw new InternalServerErrorException(
        "The price writer named a held price without its kind or its lock; whether the price changed is unknown.",
      );
    }
    return {
      kind: e.kind,
      lockId: e.lock_id,
      lockedPrice: num(e.locked_price),
      lockedBy: typeof e.locked_by === "string" ? e.locked_by : null,
      lockedAt: typeof e.locked_at === "string" ? e.locked_at : null,
    };
  });
}

/** "the bottle price (locked at 95.00)" -- for a sentence that must name what a lock held. */
export function heldWords(held: HeldKind[]): string {
  return held
    .map((h) => `the ${h.kind} price (locked${h.lockedPrice === null ? "" : ` at ${h.lockedPrice.toFixed(2)}`})`)
    .join(" and ");
}
