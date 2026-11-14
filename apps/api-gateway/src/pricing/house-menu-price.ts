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
 * `set_house_menu_price` (migration 20260922230400), which:
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

  if (error) throw housePriceError(error);
  return housePriceResultOf(data, setBottle, setGlass);
}

/** The writer's refusal as the exception every caller has always seen. */
export function housePriceError(error: { code?: string | null; message?: string | null }) {
  const code = error.code ?? undefined;
  const message = error.message ?? "no reason was given";
  if (code === "P0002") {
    return new NotFoundException(
      "No wine of this house by that id. Nothing was changed.",
    );
  }
  if (code === "22023") {
    return new BadRequestException(`${message}`);
  }
  if (code === "HPL01") {
    // The database guard (a write that reached a locked column). This
    // function never aims at a held kind, so it is said, never swallowed.
    return new ConflictException(`${message}`);
  }
  return new InternalServerErrorException(
    `The price was not saved: ${message}`,
  );
}

/**
 * One answer of `set_house_menu_price`, read the one way: an outcome this
 * writer does not recognise, or a lock it does not name, is an error, never a
 * success.
 */
export function housePriceResultOf(
  data: unknown,
  setBottle: boolean,
  setGlass: boolean,
): HousePriceResult {
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

/** One wine's price change inside a batch; `key` is the caller's own name for it (a menu line id). */
export interface HousePriceRow {
  key: string;
  inventoryId: string;
  /** Omit to leave the bottle price as it is. */
  bottle?: number | null;
  /** Omit to leave the glass price as it is. */
  glass?: number | null;
}

/** What one row of a batch did: the writer's answer, or the sentence for why it did not write. */
export type HousePriceRowAnswer =
  | { ok: true; result: HousePriceResult }
  | { ok: false; error: string };

/** Rows per call: one statement each, so a long menu stays well inside a statement timeout. */
export const HOUSE_PRICE_BATCH = 250;

/**
 * Many price changes of one house in one call per HOUSE_PRICE_BATCH rows
 * (r28 G1). A menu of 485 priced lines was 485 round trips of about a third
 * of a second each, past the page's 30 s limit, AFTER the switch had already
 * committed. `set_house_menu_prices` (migration 20270913140000) runs
 * `set_house_menu_price` -- still the one lock-holding writer (L4, L27) -- for
 * each row in order inside the database, each row in its own savepoint, so
 * one refusal fails its own row and never the rest.
 *
 * Answers `null` when the batch writer is not in this database yet (the
 * gateway deployed before the migration): the caller writes per row as
 * before. Any other refusal of the call fails every row of that call, said on
 * each. An answer that cannot be read leaves each row "unknown", never
 * "changed".
 */
export async function setHouseMenuPrices(
  client: SupabaseClient,
  common: Pick<HousePriceChange, "restaurantId" | "source" | "changedBy" | "effectiveFrom" | "reason" | "menuId">,
  rows: HousePriceRow[],
): Promise<Map<string, HousePriceRowAnswer> | null> {
  const answers = new Map<string, HousePriceRowAnswer>();
  for (let at = 0; at < rows.length; at += HOUSE_PRICE_BATCH) {
    const chunk = rows.slice(at, at + HOUSE_PRICE_BATCH);
    const { data, error } = await client.rpc("set_house_menu_prices", {
      p_restaurant_id: common.restaurantId,
      p_rows: chunk.map((r) => ({
        id: r.key,
        inventory_id: r.inventoryId,
        ...(r.bottle !== undefined ? { bottle: r.bottle } : {}),
        ...(r.glass !== undefined ? { glass: r.glass } : {}),
      })),
      p_change_source: common.source,
      p_changed_by: common.changedBy,
      p_effective_from: common.effectiveFrom ?? null,
      p_reason: common.reason ?? null,
      p_menu_id: common.menuId ?? null,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      // PostgREST's "no such function" (PGRST202) or Postgres's (42883): only
      // the FIRST call can meet it, so nothing was written by this writer yet.
      if (at === 0 && (code === "PGRST202" || code === "42883")) return null;
      const why = `The price was not saved: ${(error as { message?: string }).message ?? "no reason was given"}`;
      for (const r of chunk) answers.set(r.key, { ok: false, error: why });
      continue;
    }
    const byKey = new Map<string, unknown>();
    if (Array.isArray(data)) {
      for (const e of data as Array<Record<string, unknown>>) {
        if (e && typeof e.id === "string") byKey.set(e.id, e.result);
      }
    }
    for (const r of chunk) {
      if (!byKey.has(r.key)) {
        answers.set(r.key, {
          ok: false,
          error: "The price writer's answer did not name this line; whether its price changed is unknown.",
        });
        continue;
      }
      const res = (byKey.get(r.key) ?? {}) as Record<string, unknown>;
      if (res.outcome === "failed") {
        answers.set(r.key, {
          ok: false,
          error: housePriceError({
            code: typeof res.code === "string" ? res.code : null,
            message: typeof res.error === "string" ? res.error : null,
          }).message,
        });
        continue;
      }
      try {
        answers.set(r.key, {
          ok: true,
          result: housePriceResultOf(res, r.bottle !== undefined, r.glass !== undefined),
        });
      } catch (err) {
        answers.set(r.key, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return answers;
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
