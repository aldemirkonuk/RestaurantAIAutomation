/**
 * Price advice toward the house's own target margin (ADR 0193).
 *
 * THE FOUNDER, 2026-09-21, verbatim: "... make sure that endpoint exists that
 * we will ask or recommend or advise the manager or owner to increase decrease
 * the prices so that the profit margin is where it's needed. We don't want
 * market average because that will be already shown in another column" -- and
 * after research he picked "Advise to target margin".
 *
 * THE RULE, and all of it:
 *
 *     margin      = (price - cost) / price
 *     target price = cost / (1 - target)          (priceForMargin, pricing-agility.ts)
 *
 * A wine within `band` margin points of the target is on target and gets no
 * advice. Otherwise the advice is the exact target price: "raise to X" when it
 * is above today's price, "lower to Y" when below. Nothing here changes a
 * price; a manager accepting the advice does (MarginAdviceService.accept).
 *
 * WHAT THIS DOES NOT USE, ON PURPOSE:
 *   - the market average (the wine library's retail-average and reference
 *     price columns). The founder: "We don't want market average". A CLAIMS
 *     row (ADR 0193) fails the build if any non-spec file in this folder
 *     names either column.
 *   - demand elasticity. `analyzePricing` (pricing-agility.ts) maximises profit
 *     from an assumed elasticity of -1.3 when there is no price history, which
 *     is every house today, and would tell a manager to RAISE a wine already at
 *     his target (cost 20, price 60, target 65 % -> "raise to 69"). Only its
 *     `priceForMargin` is used.
 *
 * WHAT IT REFUSES TO GUESS: a missing target, band, price or cost is a named
 * state ("no target set", "cannot advise: no recorded cost"), never a healthy
 * margin and never a default (ADR 0020, ADR 0051).
 */
import { priceForMargin } from "../analytics/engine/pricing-agility";

export type PriceKind = "bottle" | "glass";

export type AdviceState =
  | "no_target"
  | "no_price"
  | "no_cost"
  | "on_target"
  | "raise"
  | "lower";

export interface AdviceInput {
  kind: PriceKind;
  /** The house's current price for this kind; null when none is set. */
  price: number | null;
  /** Cost of ONE unit of this kind (a bottle, or one pour); null when unknown. */
  unitCost: number | null;
  /** Target gross margin in PERCENT (65 = 65 %); null when the house set none. */
  targetPct: number | null;
  /** "Close enough", in margin points; null when the house set none. */
  bandPts: number | null;
}

export interface PriceAdvice {
  kind: PriceKind;
  state: AdviceState;
  price: number | null;
  unitCost: number | null;
  /** Margin in percent at today's price; null when price or cost is unknown. */
  currentMarginPct: number | null;
  targetPct: number | null;
  bandPts: number | null;
  /** The exact price that reaches the target; set only for raise / lower. */
  advisedPrice: number | null;
  /** One plain sentence a manager can read. No currency symbol: the page adds the house's. */
  sentence: string;
}

/** Rounds to cents. The advice is a menu price, and a menu has no fractions of a cent. */
export function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function pct(n: number): string {
  return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)}%`;
}

/**
 * Cost of one pour: bottle cost x pour ml / bottle ml. Null when any of the
 * three is missing or not positive -- a pour of an unknown size has no cost.
 */
export function glassCostFrom(
  bottleCost: number | null,
  pourMl: number | null,
  bottleMl: number | null,
): number | null {
  if (bottleCost === null || !Number.isFinite(bottleCost)) return null;
  if (pourMl === null || !Number.isFinite(pourMl) || pourMl <= 0) return null;
  if (bottleMl === null || !Number.isFinite(bottleMl) || bottleMl <= 0) return null;
  return (bottleCost * pourMl) / bottleMl;
}

export function adviseToTarget(input: AdviceInput): PriceAdvice {
  const { kind, price, unitCost, targetPct, bandPts } = input;
  const base: PriceAdvice = {
    kind,
    state: "no_target",
    price,
    unitCost,
    currentMarginPct: null,
    targetPct,
    bandPts,
    advisedPrice: null,
    sentence: "",
  };

  const known =
    price !== null && Number.isFinite(price) && price > 0 &&
    unitCost !== null && Number.isFinite(unitCost);
  if (known) {
    base.currentMarginPct = ((price - unitCost) / price) * 100;
  }

  if (targetPct === null || bandPts === null) {
    return {
      ...base,
      state: "no_target",
      sentence: `No target margin is set for a ${kind}, so there is no advice. Set one in Settings.`,
    };
  }
  if (price === null || !Number.isFinite(price) || price <= 0) {
    return {
      ...base,
      state: "no_price",
      sentence:
        price === 0
          ? `Cannot advise: the ${kind} price is 0, and a price of 0 carries no margin.`
          : `Cannot advise: this house has no ${kind} price for this wine.`,
    };
  }
  if (unitCost === null || !Number.isFinite(unitCost) || unitCost <= 0) {
    return {
      ...base,
      state: "no_cost",
      sentence:
        unitCost === null
          ? `Cannot advise: no recorded cost for this wine${kind === "glass" ? " (or no pour and bottle size to split it by)" : ""}.`
          : `Cannot advise: the recorded cost is ${fmt(unitCost)}, and a target margin cannot price a free ${kind}.`,
    };
  }

  const margin = base.currentMarginPct as number;
  const target = priceForMargin(unitCost, targetPct / 100);
  if (target === null) {
    // priceForMargin refuses only cost <= 0 or a target outside [0, 1); both
    // are excluded above and by the database's CHECK, so this is unreachable
    // on real data. Said rather than assumed.
    return {
      ...base,
      state: "no_target",
      sentence: `No usable target margin for a ${kind}.`,
    };
  }
  const advised = toCents(target);

  if (Math.abs(margin - targetPct) <= bandPts || advised === toCents(price)) {
    return {
      ...base,
      state: "on_target",
      sentence: `On target: ${pct(toCents(margin))} margin against a ${pct(targetPct)} target (close enough is within ${pct(bandPts).replace("%", "")} points).`,
    };
  }

  const raise = advised > price;
  return {
    ...base,
    state: raise ? "raise" : "lower",
    advisedPrice: advised,
    sentence: raise
      ? `Raise the ${kind} to ${fmt(advised)} (now ${fmt(price)}): today's margin is ${pct(toCents(margin))}, your target is ${pct(targetPct)}.`
      : `Lower the ${kind} to ${fmt(advised)} (now ${fmt(price)}): today's margin is ${pct(toCents(margin))}, above your ${pct(targetPct)} target.`,
  };
}
