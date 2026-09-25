import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  COST_BASIS_LABEL,
  type CostBasis,
  resolveUnitCost,
} from "../analytics/inventory-cost";
import {
  type AdviceState,
  type PriceAdvice,
  type PriceKind,
  adviseToTarget,
  glassCostFrom,
} from "./margin-to-target";
import {
  confirmedPourFrom,
  confirmedWinePourFrom,
  readHouseTargetMargin,
  targetsFrom,
} from "./target-margin.service";
import { setHouseMenuPrice, type HousePriceResult } from "./house-menu-price";
import { type OpenLock, dayOf, lockIndex, readOpenLocks, readPeople } from "./price-locks";

/**
 * Per-wine price advice toward the house's own target margin, and the one tap
 * that applies it (ADR 0193).
 *
 * THE FOUNDER, 2026-09-21: "... advise the manager or owner to increase
 * decrease the prices so that the profit margin is where it's needed. We don't
 * want market average because that will be already shown in another column."
 *
 * Reads only: the house's bottle price (`menu_price_current`), glass price
 * (`menu_price_glass`), the recorded cost (`resolveUnitCost`: invoiced lot WAC,
 * then last purchase price, else UNKNOWN), the bottle size, the house's
 * CONFIRMED pour, and the house's target.
 *
 * THE POUR (founder, 2026-09-21, relayed: glass advice appears only after the
 * house confirms its pour size, once; bottle advice unaffected; and round 6c,
 * verbatim: "Yes, confirmed per wine"). A glass is priced on the WINE's own
 * pour when an owner or manager has confirmed it (`confirmedWinePourFrom`),
 * else on the house's confirmed pour (`restaurants.default_pour_ml` with
 * `pour_size_confirmed_at`), and on nothing else: the per-wine
 * `restaurant_inventory.pour_size_ml` carries a database DEFAULT of its own
 * and cannot be told from a typed value (ADR 0193 F7), so an unconfirmed one
 * is never read as a pour. With neither confirmed, the glass is
 * `pour_unconfirmed`. Never the market average: neither of the wine library's
 * market columns is selected here (CLAIMS row, ADR 0193).
 *
 * LOCKS (round 3, L22). A locked kind still gets its advice -- a true margin is
 * never hidden -- marked `locked` with who and when, and it cannot be
 * accepted (L7): `accept` checks the lock before it writes anything.
 *
 * Nothing here changes a price except `accept`, which a manager calls with
 * one tap, and which re-computes the advice server-side and refuses if it is
 * no longer what the manager saw.
 */

export const MARGIN_ADVICE_ENGINE = "margin-to-target/1";

/** Who holds a kind's price, when a lock does (L22). */
export interface LockMark {
  lockId: string;
  lockedPrice: number;
  lockedBy: string;
  lockedAt: string;
}

/** One kind's advice, and the lock that holds it, if any. */
export type KindAdvice = PriceAdvice & { locked: LockMark | null };

export interface WineAdvice {
  inventoryId: string;
  wineName: string | null;
  /** Where the bottle cost came from, in words. "no recorded cost" when unknown. */
  costBasis: CostBasis;
  costBasisLabel: string;
  bottleCost: number | null;
  /** Null when this wine is not sold by the bottle and has no bottle price. */
  bottle: KindAdvice | null;
  /** Null when this wine is not sold by the glass and has no glass price. */
  glass: KindAdvice | null;
  /**
   * The pour the glass advice used: the wine's own once confirmed, else the
   * house's confirmed one (round 6c answer 3); null when neither is.
   */
  pour: { ml: number | null; source: "wine" | "house" | null };
}

export interface HouseAdvice {
  restaurantId: string;
  generatedAt: string;
  target: {
    bottlePct: number | null;
    glassPct: number | null;
    /** "Close enough", a PERCENT of the advised price. */
    bandPct: number | null;
    /** True once an owner or manager has set at least one target. */
    set: boolean;
    /** True once an owner or manager has confirmed the house's pour. */
    pourConfirmed: boolean;
    /** The confirmed pour in ml; null until confirmed. */
    pourMl: number | null;
  };
  wines: WineAdvice[];
  /** Advice lines by state, bottle and glass together. */
  counts: Record<AdviceState, number>;
  /**
   * Whether the house's price locks could be read (L25). `false` means every
   * `locked` below is UNKNOWN, not "not locked", and accepting is refused.
   */
  locks: { readable: boolean; reason: string | null; held: number };
}

export interface InventoryPriceRow {
  id: string;
  wine_name: string | null;
  sale_type: string | null;
  menu_price_current: number | string | null;
  menu_price_glass: number | string | null;
  last_purchase_price: number | string | null;
  bottle_size_ml: number | null;
  pour_size_ml?: number | string | null;
  pour_size_confirmed_by?: string | null;
  pour_size_confirmed_at?: string | null;
  master_wine_library?: { name?: string | null; bottle_size_ml?: number | null } | null;
}

/** What the advice needs from the house row besides the targets. */
interface HouseTerms {
  bottlePct: number | null;
  glassPct: number | null;
  bandPct: number | null;
  /** The confirmed pour, ml; null = not confirmed, so no glass advice. */
  pourMl: number | null;
}

const INVENTORY_SELECT =
  "id, wine_name, sale_type, menu_price_current, menu_price_glass, last_purchase_price, bottle_size_ml, pour_size_ml, pour_size_confirmed_by, pour_size_confirmed_at, master_wine_library(name, bottle_size_ml)";

const ROLLUP_SELECT = "inventory_id, live_qty, wac, has_invoice_cost, wac_qty";

function n(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function emptyCounts(): Record<AdviceState, number> {
  return {
    no_target: 0,
    pour_unconfirmed: 0,
    no_price: 0,
    no_cost: 0,
    on_target: 0,
    raise: 0,
    lower: 0,
  };
}

@Injectable()
export class MarginAdviceService {
  private readonly logger = new Logger(MarginAdviceService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /** Every active wine's advice. A failed read throws; it is never an empty list. */
  async adviseHouse(restaurantId: string): Promise<HouseAdvice> {
    const client = this.databaseService.client;
    const [targets, inv, rollup, lockRead] = await Promise.all([
      readHouseTargetMargin(client, restaurantId),
      client
        .from("restaurant_inventory")
        .select(INVENTORY_SELECT)
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true),
      client.from("inventory_lot_rollup").select(ROLLUP_SELECT).eq("restaurant_id", restaurantId),
      readOpenLocks(client, restaurantId),
    ]);
    if (targets.error !== null) {
      throw new InternalServerErrorException(
        `The house's target margin could not be read, so no advice was computed: ${targets.error}`,
      );
    }
    if (inv.error) {
      throw new InternalServerErrorException(
        `The house's wines could not be read, so no advice was computed: ${inv.error.message}`,
      );
    }
    if (rollup.error) {
      // Cost comes from here. Advising without it would call every wine
      // "no recorded cost" when the truth is "cost could not be read".
      throw new InternalServerErrorException(
        `The recorded costs could not be read, so no advice was computed: ${rollup.error.message}`,
      );
    }

    const t: HouseTerms = { ...targetsFrom(targets.row), pourMl: confirmedPourFrom(targets.row) };
    const lots = new Map<string, Record<string, unknown>>();
    for (const r of (rollup.data ?? []) as Array<Record<string, unknown>>) {
      lots.set(String(r.inventory_id), r);
    }

    // A failed lock read is said (locks.readable false), never taken for "no
    // lock" (L25): every `locked` is then unknown and accept refuses.
    const byKind = lockIndex(lockRead.locks);
    const counts = emptyCounts();
    let held = 0;
    const wines = ((inv.data ?? []) as unknown as InventoryPriceRow[]).map((row) => {
      const w = this.adviseWine(row, lots.get(row.id) ?? null, t, byKind);
      if (w.bottle) counts[w.bottle.state] += 1;
      if (w.glass) counts[w.glass.state] += 1;
      if (w.bottle?.locked) held += 1;
      if (w.glass?.locked) held += 1;
      return w;
    });

    return {
      restaurantId,
      generatedAt: new Date().toISOString(),
      target: {
        bottlePct: t.bottlePct,
        glassPct: t.glassPct,
        bandPct: t.bandPct,
        set: t.bottlePct !== null || t.glassPct !== null,
        pourConfirmed: t.pourMl !== null,
        pourMl: t.pourMl,
      },
      wines,
      counts,
      locks: {
        readable: lockRead.error === null,
        reason:
          lockRead.error === null
            ? null
            : `Whether any price is locked could not be read (${lockRead.error}); accepting advice is refused until it can.`,
        held,
      },
    };
  }

  adviseWine(
    row: InventoryPriceRow,
    lot: Record<string, unknown> | null,
    t: HouseTerms,
    locks: Map<string, OpenLock> = new Map(),
  ): WineAdvice {
    const { unitCost, costBasis } = resolveUnitCost(
      { last_purchase_price: row.last_purchase_price },
      lot,
    );
    const bottlePrice = n(row.menu_price_current);
    const glassPrice = n(row.menu_price_glass);
    const saleType = row.sale_type ?? "bottle";
    const sellsBottle = saleType === "bottle" || saleType === "both" || bottlePrice !== null;
    const sellsGlass = saleType === "glass" || saleType === "both" || glassPrice !== null;

    const bottleMl = n(row.bottle_size_ml) ?? n(row.master_wine_library?.bottle_size_ml);
    // The wine's own pour once an owner or manager confirmed it, else the
    // house's confirmed pour (round 6c answer 3). An unconfirmed per-wine
    // pour is never read as one.
    const winePour = confirmedWinePourFrom(row);
    const pourMl = winePour ?? t.pourMl;
    const mark = (kind: PriceKind): LockMark | null => {
      const l = locks.get(`${row.id}:${kind}`);
      return l ? { lockId: l.lockId, lockedPrice: l.lockedPrice, lockedBy: l.lockedBy, lockedAt: l.lockedAt } : null;
    };

    return {
      inventoryId: row.id,
      wineName: row.wine_name || row.master_wine_library?.name || null,
      costBasis,
      costBasisLabel: COST_BASIS_LABEL[costBasis],
      bottleCost: unitCost,
      bottle: sellsBottle
        ? {
            ...adviseToTarget({
              kind: "bottle",
              price: bottlePrice,
              unitCost,
              targetPct: t.bottlePct,
              bandPct: t.bandPct,
            }),
            locked: mark("bottle"),
          }
        : null,
      glass: sellsGlass
        ? {
            ...adviseToTarget({
              kind: "glass",
              price: glassPrice,
              unitCost: glassCostFrom(unitCost, pourMl, bottleMl),
              targetPct: t.glassPct,
              bandPct: t.bandPct,
              pourConfirmed: pourMl !== null,
            }),
            locked: mark("glass"),
          }
        : null,
      pour: { ml: pourMl, source: winePour !== null ? "wine" : t.pourMl !== null ? "house" : null },
    };
  }

  /**
   * One tap: apply the advice the manager saw. Re-computed here, never taken
   * from the body -- the body says only WHICH advice (kind) and the price the
   * manager saw, so a stale screen cannot apply a number the rule no longer
   * gives. Writes one `pricing_analyses` row (the why) and the price through
   * `set_house_menu_price` with change_source 'agent_accepted'.
   */
  async accept(
    restaurantId: string,
    inventoryId: string,
    kind: PriceKind,
    seenPrice: number,
    userId: string,
  ): Promise<{
    outcome: HousePriceResult["outcome"];
    kind: PriceKind;
    price: number;
    previousPrice: number | null;
    pricingAnalysisId: string;
  }> {
    const client = this.databaseService.client;
    const [targets, inv, rollup] = await Promise.all([
      readHouseTargetMargin(client, restaurantId),
      client
        .from("restaurant_inventory")
        .select(INVENTORY_SELECT)
        .eq("restaurant_id", restaurantId)
        .eq("id", inventoryId)
        .maybeSingle(),
      client
        .from("inventory_lot_rollup")
        .select(ROLLUP_SELECT)
        .eq("restaurant_id", restaurantId)
        .eq("inventory_id", inventoryId)
        .maybeSingle(),
    ]);
    if (targets.error !== null)
      throw new InternalServerErrorException(
        `The target margin could not be read; nothing was changed. ${targets.error}`,
      );
    if (inv.error)
      throw new InternalServerErrorException(
        `The wine could not be read; nothing was changed. ${inv.error.message}`,
      );
    if (!inv.data) throw new NotFoundException("No wine of this house by that id. Nothing was changed.");
    if (rollup.error)
      throw new InternalServerErrorException(
        `The recorded cost could not be read; nothing was changed. ${rollup.error.message}`,
      );

    // L7: a locked kind cannot be accepted. Checked BEFORE anything is
    // written, so no pricing_analyses row is left behind; a lock that cannot
    // be read is a refusal too, never "not locked" (L25).
    const held = await readOpenLocks(client, restaurantId, { inventoryId, kind });
    if (held.error !== null) {
      throw new InternalServerErrorException(
        `Whether the ${kind} price is locked could not be read, so nothing was changed: ${held.error}`,
      );
    }
    if (held.locks.length > 0) {
      throw new ConflictException(await this.lockedSentence(held.locks[0], kind));
    }

    const t: HouseTerms = { ...targetsFrom(targets.row), pourMl: confirmedPourFrom(targets.row) };
    const wine = this.adviseWine(
      inv.data as unknown as InventoryPriceRow,
      (rollup.data as Record<string, unknown> | null) ?? null,
      t,
    );
    const advice = kind === "bottle" ? wine.bottle : wine.glass;
    if (!advice || (advice.state !== "raise" && advice.state !== "lower") || advice.advisedPrice === null) {
      throw new ConflictException(
        `There is no ${kind} advice to accept for this wine now: ${advice?.sentence ?? `it is not sold by the ${kind}.`} Nothing was changed.`,
      );
    }
    if (Math.abs(advice.advisedPrice - seenPrice) >= 0.005) {
      throw new ConflictException(
        `The advice changed since it was shown: it is now ${advice.advisedPrice.toFixed(2)}, not ${seenPrice.toFixed(2)}. Nothing was changed.`,
      );
    }

    const { data: analysis, error: analysisErr } = await client
      .from("pricing_analyses")
      .insert({
        restaurant_id: restaurantId,
        inventory_id: inventoryId,
        trigger: "manual",
        current_price: advice.price,
        unit_cost: advice.unitCost,
        current_margin_pct: advice.currentMarginPct === null ? null : advice.currentMarginPct / 100,
        recommended_price: advice.advisedPrice,
        projected_margin_pct: (advice.targetPct as number) / 100,
        // The house's target, as a fraction like the engine's own column.
        margin_floor_pct: (advice.targetPct as number) / 100,
        margin_flagged: advice.state === "raise",
        elasticity_method: null,
        observation_count: 0,
        confidence: null,
        price_kind: kind,
        band_pct: advice.bandPct,
        engine_version: MARGIN_ADVICE_ENGINE,
        inputs: {
          rule: "price = cost / (1 - target)",
          kind,
          price: advice.price,
          unitCost: advice.unitCost,
          bottleCost: wine.bottleCost,
          costBasis: wine.costBasis,
          targetPct: advice.targetPct,
          bandPct: advice.bandPct,
          gapPct: advice.gapPct,
          pourMl: kind === "glass" ? wine.pour.ml : null,
          pourSource: kind === "glass" ? wine.pour.source : null,
          state: advice.state,
          acceptedBy: userId,
        },
      })
      .select("id")
      .single();
    if (analysisErr || !analysis) {
      throw new InternalServerErrorException(
        `The advice could not be recorded, so the price was not changed: ${analysisErr?.message ?? "no row returned"}`,
      );
    }
    const pricingAnalysisId = String((analysis as { id: string }).id);

    const result = await setHouseMenuPrice(client, {
      restaurantId,
      inventoryId,
      ...(kind === "bottle" ? { bottle: advice.advisedPrice } : { glass: advice.advisedPrice }),
      source: "agent_accepted",
      changedBy: userId,
      reason: `Accepted advice: ${advice.state} the ${kind} to ${advice.advisedPrice.toFixed(2)} for a ${advice.targetPct}% target margin`,
      unitCost: wine.bottleCost,
      pricingAnalysisId,
    });

    this.logger.log(
      `price advice accepted: ${restaurantId}/${inventoryId} ${kind} -> ${advice.advisedPrice} (${result.outcome})`,
    );
    if (result.outcome === "locked") {
      // A lock landed between the check above and the write (L7's race). The
      // analysis row stays unapplied: no version row points at it.
      const lock = result.held[0];
      throw new ConflictException(
        `The ${kind} price was locked a moment ago${lock?.lockedPrice == null ? "" : ` at ${lock.lockedPrice.toFixed(2)}`}, so it was not changed. The advice is recorded (${pricingAnalysisId}) and not applied.`,
      );
    }

    return {
      outcome: result.outcome,
      kind,
      price: advice.advisedPrice,
      previousPrice: advice.price,
      pricingAnalysisId,
    };
  }

  /** "The glass price is locked at 14.00 by Ayse since 2026-09-21. ..." -- who, never a blank. */
  private async lockedSentence(lock: OpenLock, kind: PriceKind): Promise<string> {
    const people = await readPeople(this.databaseService.client, [lock.lockedBy]);
    const who =
      people.error !== null
        ? `by a person whose name could not be read (${people.error})`
        : `by ${people.people.get(lock.lockedBy)?.name ?? "a person with no name on record"}`;
    return `The ${kind} price is locked at ${lock.lockedPrice.toFixed(2)} ${who} since ${dayOf(lock.lockedAt)}. Nothing was changed. An owner or a manager can change it and keep it locked, or release the lock, on Menu, under Locked prices.`;
  }
}
