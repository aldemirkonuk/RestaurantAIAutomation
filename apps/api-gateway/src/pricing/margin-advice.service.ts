import {
  BadRequestException,
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
  type HouseMoneyTerms,
  type PriceAdvice,
  type PriceKind,
  adviseToTarget,
  fmtMoney,
  glassCostFrom,
} from "./margin-to-target";
import { readHouseMoney } from "../common/house-money";
import {
  confirmedPourFrom,
  confirmedWinePourFrom,
  readHouseTargetMargin,
  targetsFrom,
} from "./target-margin.service";
import { setHouseMenuPrice, type HousePriceResult } from "./house-menu-price";
import { type OpenLock, dayOf, lockIndex, readOpenLocks, readPeople } from "./price-locks";
import { readKitchenInventoryIds } from "../menus/menu-line-view";

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
 * `pour_unconfirmed`.
 *
 * A GLASS IS A WINE'S POUR (F-1171, coordinator's call, 2026-10-10). The
 * house's pour is a wine pour: a rakı, a whisky or a draft beer poured at
 * 150 ml was costed as a fifth of the bottle and offered a one-tap Raise.
 * Until a pour per kind exists, a row whose `kind` says it is not a wine
 * gets no glass advice (`pour_unconfirmed`, said in its own sentence) and so
 * nothing to accept. Its bottle advice is unchanged. Never the market average: neither of the wine library's
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
  /**
   * Where the bottle cost came from, in words. "no recorded cost" when unknown.
   * `last_paid_lot` (F-1172): no bottle on hand carries a cost, so the cost is
   * the last price paid, from the most recent costed lot of this wine.
   */
  costBasis: CostBasis | "last_paid_lot";
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
  /** restaurant_inventory.kind; a stated kind other than wine gets no glass advice (F-1171). */
  kind?: string | null;
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
  /**
   * The house's stated currency (`restaurants.currency`), the money its menu
   * prices are in; null = not stated. A cost in other money is not advised on
   * (F-343). Optional so a caller that never read it keeps the old reading.
   */
  currency?: string | null;
  /** The house's formats tag (`readHouseMoney`), for the money in a sentence (F-1174). */
  locale?: string | null;
}

/** The last price paid for a wine, from its most recent costed lot (F-1172). */
export interface LastPaid {
  unitCost: number;
  /** The lot's stated currency; null when it states none. */
  currency: string | null;
  receivedAt: string | null;
}

const INVENTORY_SELECT =
  "id, wine_name, kind, sale_type, menu_price_current, menu_price_glass, last_purchase_price, bottle_size_ml, pour_size_ml, pour_size_confirmed_by, pour_size_confirmed_at, master_wine_library(name, bottle_size_ml)";

// cost_currency / cost_currency_count (F-343): which money the WAC is in.
const ROLLUP_SELECT =
  "inventory_id, live_qty, wac, has_invoice_cost, wac_qty, cost_currency, cost_currency_count";

/** The no-cost sentence, when the cost exists but in another money (F-343). */
const OTHER_MONEY_SENTENCE =
  "Cannot advise: this wine was bought in a different currency from your menu prices, and nothing here converts one into the other.";

/** The glass sentence for a drink that is not a wine (F-1171). */
const NOT_A_WINE_GLASS_SENTENCE =
  "No glass advice for this drink yet: the house's pour is a wine pour, and a rakı, a spirit or a beer is poured in its own measure. Bottle advice is not affected.";

/** Label for the F-1172 fallback, beside `COST_BASIS_LABEL`. */
const LAST_PAID_LABEL = "last price paid (none on hand)";

/**
 * Each wine's last price paid, from its most recent costed lot -- one that
 * may hold no bottle now (F-1172). The lot rollup averages only bottles on
 * hand, so a sold-out wine whose invoices are on file read "no recorded
 * cost". Sample lots are free bottles, not evidence of a price, and are
 * skipped as the rollup skips them. A failed read is returned, never taken
 * for "nothing paid".
 */
async function readLastPaid(
  client: DatabaseService["client"],
  restaurantId: string,
  inventoryIds: string[],
): Promise<{ byId: Map<string, LastPaid>; error: string | null }> {
  const byId = new Map<string, LastPaid>();
  if (inventoryIds.length === 0) return { byId, error: null };
  const { data, error } = await client
    .from("inventory_lots")
    .select(
      "inventory_id, unit_cost, unit_cost_currency, cost_provenance, received_at",
    )
    .eq("restaurant_id", restaurantId)
    .eq("stock_state", "live")
    .in("inventory_id", inventoryIds)
    .not("unit_cost", "is", null)
    .order("received_at", { ascending: false });
  if (error) return { byId, error: error.message ?? String(error) };
  const rows = ((data ?? []) as Array<Record<string, unknown>>)
    .slice()
    .sort((a, b) =>
      String(b.received_at ?? "").localeCompare(String(a.received_at ?? "")),
    );
  for (const r of rows) {
    const id = String(r.inventory_id);
    if (byId.has(id) || r.cost_provenance === "sample") continue;
    const cost = n(r.unit_cost);
    if (cost === null || cost <= 0) continue;
    byId.set(id, {
      unitCost: cost,
      currency:
        typeof r.unit_cost_currency === "string" ? r.unit_cost_currency : null,
      receivedAt: typeof r.received_at === "string" ? r.received_at : null,
    });
  }
  return { byId, error: null };
}

/** True unless both moneys are stated and differ (as `resolveUnitCost` reads a lot). */
function sameMoney(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = (a ?? "").trim().toUpperCase();
  const y = (b ?? "").trim().toUpperCase();
  return !x || !y || x === y;
}

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
    const [targets, inv, rollup, lockRead, kitchenRead, money] =
      await Promise.all([
      readHouseTargetMargin(client, restaurantId),
      client
        .from("restaurant_inventory")
        .select(INVENTORY_SELECT)
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true),
      client.from("inventory_lot_rollup").select(ROLLUP_SELECT).eq("restaurant_id", restaurantId),
      readOpenLocks(client, restaurantId),
        readKitchenInventoryIds(client, restaurantId),
        readHouseMoney(client, restaurantId),
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
    if (kitchenRead.error !== null) {
      // Without it a food row would be advised on as a drink (F-1170).
      throw new InternalServerErrorException(
        `The menu's kitchen lines could not be read, so no advice was computed: ${kitchenRead.error}`,
      );
    }

    const t: HouseTerms = {
      ...targetsFrom(targets.row),
      pourMl: confirmedPourFrom(targets.row),
      currency: targets.row?.currency ?? null,
      locale: money.locale,
    };
    const lots = new Map<string, Record<string, unknown>>();
    for (const r of (rollup.data ?? []) as Array<Record<string, unknown>>) {
      lots.set(String(r.inventory_id), r);
    }
    // A row only kitchen lines link to is set aside, as the menu sets the
    // line aside: no margin advice for food until a food model exists
    // (F-1170, OD-113).
    const rows = ((inv.data ?? []) as unknown as InventoryPriceRow[]).filter(
      (row) => !kitchenRead.ids.has(row.id),
    );
    // Only the wines with no cost on hand need their last price paid (F-1172).
    const uncosted = rows
      .filter(
        (row) =>
          resolveUnitCost(
            { last_purchase_price: row.last_purchase_price },
            lots.get(row.id) ?? null,
            t.currency,
          ).costBasis === "unknown",
      )
      .map((row) => row.id);
    const lastPaid = await readLastPaid(client, restaurantId, uncosted);
    if (lastPaid.error !== null) {
      // As with the rollup: "no recorded cost" would be untrue when the truth
      // is that the last price paid could not be read.
      throw new InternalServerErrorException(
        `The last prices paid could not be read, so no advice was computed: ${lastPaid.error}`,
      );
    }

    // A failed lock read is said (locks.readable false), never taken for "no
    // lock" (L25): every `locked` is then unknown and accept refuses.
    const byKind = lockIndex(lockRead.locks);
    const counts = emptyCounts();
    let held = 0;
    const wines = rows.map((row) => {
      const w = this.adviseWine(
        row,
        lots.get(row.id) ?? null,
        t,
        byKind,
        lastPaid.byId.get(row.id) ?? null,
      );
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
    lastPaid: LastPaid | null = null,
  ): WineAdvice {
    const resolved = resolveUnitCost(
      { last_purchase_price: row.last_purchase_price },
      lot,
      t.currency,
    );
    // F-1172: no cost on hand, but a price was paid -- the last one is the
    // cost, and the sentence says so. Never a lot in other money.
    const fromLastPaid =
      resolved.costBasis === "unknown" &&
      lastPaid !== null &&
      sameMoney(lastPaid.currency, t.currency);
    const unitCost = fromLastPaid
      ? (lastPaid as LastPaid).unitCost
      : resolved.unitCost;
    const costBasis: WineAdvice["costBasis"] = fromLastPaid
      ? "last_paid_lot"
      : resolved.costBasis;
    const money: HouseMoneyTerms = {
      currency: t.currency ?? null,
      locale: t.locale ?? null,
    };
    const lastPaidNote = fromLastPaid
      ? ` The cost is the last price paid, ${fmtMoney(unitCost as number, money)}${lastPaid?.receivedAt ? ` on ${lastPaid.receivedAt.slice(0, 10)}` : ""}; none is on hand now.`
      : "";
    // "No recorded cost" would be untrue when the cost is there in other money.
    const said = (a: PriceAdvice): PriceAdvice =>
      costBasis === "other_currency" && a.state === "no_cost"
        ? { ...a, sentence: OTHER_MONEY_SENTENCE }
        : lastPaidNote && a.gapPct !== null
          ? { ...a, sentence: `${a.sentence}${lastPaidNote}` }
          : a;
    const bottlePrice = n(row.menu_price_current);
    const glassPrice = n(row.menu_price_glass);
    const saleType = row.sale_type ?? "bottle";
    const sellsBottle = saleType === "bottle" || saleType === "both" || bottlePrice !== null;
    const sellsGlass = saleType === "glass" || saleType === "both" || glassPrice !== null;

    const bottleMl = n(row.bottle_size_ml) ?? n(row.master_wine_library?.bottle_size_ml);
    // The wine's own pour once an owner or manager confirmed it, else the
    // house's confirmed pour (round 6c answer 3). An unconfirmed per-wine
    // pour is never read as one.
    // F-1171: the house's pour is a wine's; a stated other kind has none yet.
    const isWine = row.kind == null || row.kind === "wine";
    const winePour = confirmedWinePourFrom(row);
    const pourMl = isWine ? (winePour ?? t.pourMl) : null;
    // Said in its own words, not "waits for the house's pour" -- confirming
    // the house's pour would not bring it.
    const notAWine = (a: PriceAdvice): PriceAdvice =>
      !isWine && a.state === "pour_unconfirmed"
        ? { ...a, sentence: NOT_A_WINE_GLASS_SENTENCE }
        : a;
    const mark = (kind: PriceKind): LockMark | null => {
      const l = locks.get(`${row.id}:${kind}`);
      return l ? { lockId: l.lockId, lockedPrice: l.lockedPrice, lockedBy: l.lockedBy, lockedAt: l.lockedAt } : null;
    };

    return {
      inventoryId: row.id,
      wineName: row.wine_name || row.master_wine_library?.name || null,
      costBasis,
      costBasisLabel:
        costBasis === "last_paid_lot"
          ? LAST_PAID_LABEL
          : COST_BASIS_LABEL[costBasis],
      bottleCost: unitCost,
      bottle: sellsBottle
        ? {
            ...said(
              adviseToTarget({
                kind: "bottle",
                price: bottlePrice,
                unitCost,
                targetPct: t.bottlePct,
                bandPct: t.bandPct,
                money,
              }),
            ),
            locked: mark("bottle"),
          }
        : null,
      glass: sellsGlass
        ? {
            ...notAWine(
              said(
                adviseToTarget({
                  kind: "glass",
                  price: glassPrice,
                  unitCost: glassCostFrom(unitCost, pourMl, bottleMl),
                  targetPct: t.glassPct,
                  bandPct: t.bandPct,
                  pourConfirmed: pourMl !== null,
                  money,
                }),
              ),
            ),
            locked: mark("glass"),
          }
        : null,
      pour: {
        ml: pourMl,
        source: pourMl === null ? null : winePour !== null ? "wine" : "house",
      },
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
    const [targets, inv, rollup, money, kitchenRead] = await Promise.all([
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
      readHouseMoney(client, restaurantId),
      readKitchenInventoryIds(client, restaurantId),
    ]);
    const house: HouseMoneyTerms = {
      currency: targets.row?.currency ?? null,
      locale: money.locale,
    };
    const say = (v: number) => fmtMoney(v, house);
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
    // The house's advice leaves out a row only kitchen lines link to
    // (F-1170), so accept refuses it too: a direct call could otherwise
    // price a dish by a wine's rule (F-1234). Unreadable is a refusal.
    if (kitchenRead.error !== null)
      throw new InternalServerErrorException(
        `Whether this is a kitchen item could not be read; nothing was changed. ${kitchenRead.error}`,
      );
    if (kitchenRead.ids.has(inventoryId))
      throw new BadRequestException(
        "This is a kitchen item on the menu, and price advice is for drinks only. Nothing was changed.",
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
      throw new ConflictException(
        await this.lockedSentence(held.locks[0], kind, house),
      );
    }

    const t: HouseTerms = {
      ...targetsFrom(targets.row),
      pourMl: confirmedPourFrom(targets.row),
      currency: targets.row?.currency ?? null,
      locale: money.locale,
    };
    // The same last price paid the advice read (F-1172), or accept would
    // refuse the very advice it showed.
    const lastPaid = await readLastPaid(client, restaurantId, [inventoryId]);
    if (lastPaid.error !== null)
      throw new InternalServerErrorException(
        `The last price paid could not be read; nothing was changed. ${lastPaid.error}`,
      );
    const wine = this.adviseWine(
      inv.data as unknown as InventoryPriceRow,
      (rollup.data as Record<string, unknown> | null) ?? null,
      t,
      new Map(),
      lastPaid.byId.get(inventoryId) ?? null,
    );
    const advice = kind === "bottle" ? wine.bottle : wine.glass;
    if (!advice || (advice.state !== "raise" && advice.state !== "lower") || advice.advisedPrice === null) {
      throw new ConflictException(
        `There is no ${kind} advice to accept for this wine now: ${advice?.sentence ?? `it is not sold by the ${kind}.`} Nothing was changed.`,
      );
    }
    if (Math.abs(advice.advisedPrice - seenPrice) >= 0.005) {
      throw new ConflictException(
        `The advice changed since it was shown: it is now ${say(advice.advisedPrice)}, not ${say(seenPrice)}. Nothing was changed.`,
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
      reason: `Accepted advice: ${advice.state} the ${kind} to ${say(advice.advisedPrice)} for a ${advice.targetPct}% target margin`,
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
        `The ${kind} price was locked a moment ago${lock?.lockedPrice == null ? "" : ` at ${say(lock.lockedPrice)}`}, so it was not changed. The advice is recorded (${pricingAnalysisId}) and not applied.`,
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

  /** "The glass price is locked at ₺14,00 by Ayse since 2026-09-21. ..." -- who, never a blank. */
  private async lockedSentence(
    lock: OpenLock,
    kind: PriceKind,
    money: HouseMoneyTerms,
  ): Promise<string> {
    const people = await readPeople(this.databaseService.client, [lock.lockedBy]);
    const who =
      people.error !== null
        ? `by a person whose name could not be read (${people.error})`
        : `by ${people.people.get(lock.lockedBy)?.name ?? "a person with no name on record"}`;
    return `The ${kind} price is locked at ${fmtMoney(lock.lockedPrice, money)} ${who} since ${dayOf(lock.lockedAt)}. Nothing was changed. An owner or a manager can change it and keep it locked, or release the lock, on Menu, under Locked prices.`;
  }
}
