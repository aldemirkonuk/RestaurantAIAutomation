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
 * "Close enough" is a PERCENT OF THE ADVISED PRICE (the founder, 2026-09-21,
 * relayed: "within N% gets no advice", and in his words "percent is always
 * shown everywhere"): a wine whose price is within `bandPct` percent of the
 * target price is on target and gets no advice. Otherwise the advice is the
 * exact target price: "raise to X" when it is above today's price, "lower to
 * Y" when below. Every sentence states the gap as a percent. Nothing here
 * changes a price; a manager accepting the advice does
 * (MarginAdviceService.accept).
 *
 * A GLASS WAITS FOR THE HOUSE'S POUR (founder, 2026-09-21, relayed: glass
 * advice appears only after the house confirms its pour size, once; bottle
 * advice unaffected). A glass whose house has not confirmed its pour is
 * `pour_unconfirmed`, never priced on the database's 150 ml default.
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
 *
 * A HOUSE WHOSE TILL PRICES INCLUDE TAX (F-620; founder 2026-10-12, S218: F1
 * build it, F3 stamp cost basis). With `pricesIncludeTax` given, the margin is
 * worked out on the price WITHOUT tax and the advised price is shown back WITH
 * it, because that is what the menu prints:
 *
 *     net price    = price / (1 + r)
 *     margin       = (net price - cost) / net price
 *     advised      = cost / (1 - target) * (1 + r)
 *
 * The 0193 formula itself is unchanged; only the price it reads is made
 * pre-tax. It goes ahead only when the caller has proven the cost pre-tax too
 * and found the item's rate; otherwise the caller's named refusal is said
 * ("cost basis not stated", "no tax rate"), never a margin on a mixed basis.
 * A target set before the house said its prices include tax is not advised
 * on until an owner or manager confirms it again (`target_unconfirmed`): it
 * was chosen against tax-inclusive prices, and "on target" must not flip to
 * "raise" silently. Without `pricesIncludeTax` -- every house that is unset,
 * excludes tax or charges no VAT -- nothing here changes, key for key.
 */
import { priceForMargin } from "../analytics/engine/pricing-agility";
import { moneyIn } from "../procurement/agreed-price";

export type PriceKind = "bottle" | "glass";

export type AdviceState =
  | "no_target"
  | "pour_unconfirmed"
  | "no_price"
  | "no_cost"
  | "on_target"
  | "raise"
  | "lower"
  // Only for a house whose till prices include tax (F-620):
  | "target_unconfirmed"
  | "no_tax_rate"
  | "cost_not_pre_tax";

/** The states only a house whose till prices include tax can reach. */
export const TAX_ADVICE_STATES = [
  "target_unconfirmed",
  "no_tax_rate",
  "cost_not_pre_tax",
] as const;

/**
 * What a house whose till prices include tax adds to one line's advice. The
 * caller (MarginAdviceService) finds the rate and proves the cost; this file
 * only does the arithmetic and says the refusal at its place in the order.
 */
export interface PricesIncludeTax {
  /** The item's rate in force today, a fraction (0.2 = 20 %); null = refused. */
  rate: number | null;
  /** Set when the line must refuse; said after no_target/no_price/no_cost. */
  refusal: { state: "no_tax_rate" | "cost_not_pre_tax"; sentence: string } | null;
  /** The target was set before the switch and not confirmed since. */
  targetReconfirm: boolean;
}

export interface AdviceInput {
  kind: PriceKind;
  /** The house's current price for this kind; null when none is set. */
  price: number | null;
  /** Cost of ONE unit of this kind (a bottle, or one pour); null when unknown. */
  unitCost: number | null;
  /** Target gross margin in PERCENT (65 = 65 %); null when the house set none. */
  targetPct: number | null;
  /** "Close enough", a PERCENT of the advised price; null when the house set none. */
  bandPct: number | null;
  /**
   * Glass only: whether the house has confirmed its pour size. `false` makes
   * the glass `pour_unconfirmed`. Ignored for a bottle; omitted = not asked.
   */
  pourConfirmed?: boolean;
  /**
   * The house's money and number formats (`restaurants.currency`, the formats
   * tag of `readHouseMoney`), so a sentence reads "₺1.250,00", not "1250.00"
   * (F-1174). Omitted or null prints the bare figure, as before.
   */
  money?: HouseMoneyTerms;
  /**
   * Only for a house whose till prices include tax (F-620). Omitted: the
   * advice is exactly what it was before, with no new key.
   */
  pricesIncludeTax?: PricesIncludeTax;
}

/** The house's currency code and formats tag; either may be unknown (null). */
export interface HouseMoneyTerms {
  currency?: string | null;
  locale?: string | null;
}

export interface PriceAdvice {
  kind: PriceKind;
  state: AdviceState;
  price: number | null;
  unitCost: number | null;
  /** Margin in percent at today's price; null when price or cost is unknown. */
  currentMarginPct: number | null;
  targetPct: number | null;
  bandPct: number | null;
  /** The exact price that reaches the target; set only for raise / lower. */
  advisedPrice: number | null;
  /**
   * How far today's price sits from the target price, as a PERCENT of the
   * target price (negative = below it). Set whenever a target price could be
   * computed (raise, lower, on_target); null otherwise.
   */
  gapPct: number | null;
  /** One plain sentence a manager can read, its money in the house's own (F-1174). */
  sentence: string;
  /**
   * The tax rate divided out of the price, a fraction; present only for a
   * house whose till prices include tax (null when none could be used).
   */
  taxRate?: number | null;
}

/** Rounds to cents. The advice is a menu price, and a menu has no fractions of a cent. */
export function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A menu price in the house's money and formats (F-1174). With neither known
 * it is the bare figure to the cent, exactly what these sentences printed.
 */
export function fmtMoney(n: number, money?: HouseMoneyTerms | null): string {
  return moneyIn(n, money?.currency, {
    digits: 2,
    unrecorded: "bare",
    locale: money?.locale ?? null,
  });
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
  const { kind, price, unitCost, targetPct, bandPct } = input;
  const fmt = (n: number) => fmtMoney(n, input.money);
  const tax = input.pricesIncludeTax;
  // The rate in use: only when the caller found one and refused nothing.
  const rate =
    tax && tax.refusal === null && tax.rate !== null && Number.isFinite(tax.rate) && tax.rate >= 0 && tax.rate < 1
      ? tax.rate
      : null;
  const base: PriceAdvice = {
    kind,
    state: "no_target",
    price,
    unitCost,
    currentMarginPct: null,
    targetPct,
    bandPct,
    advisedPrice: null,
    gapPct: null,
    sentence: "",
    ...(tax ? { taxRate: rate } : {}),
  };
  // The price the margin is worked on: without tax for an inclusive house.
  const netOf = (p: number): number => (rate === null ? p : p / (1 + rate));

  const known =
    price !== null && Number.isFinite(price) && price > 0 &&
    unitCost !== null && Number.isFinite(unitCost) &&
    // An inclusive house's margin is stated only on a proven basis (F3).
    (!tax || rate !== null);
  if (known) {
    const net = netOf(price);
    base.currentMarginPct = ((net - unitCost) / net) * 100;
  }

  if (targetPct === null || bandPct === null) {
    return {
      ...base,
      state: "no_target",
      sentence: `No target margin is set for a ${kind}, so there is no advice. Set one in Settings.`,
    };
  }
  if (tax?.targetReconfirm) {
    return {
      ...base,
      // The margin is on a new basis the target was not chosen against.
      currentMarginPct: null,
      state: "target_unconfirmed",
      sentence:
        "Your till prices include tax now, so margin is worked out on prices without it. Your target was set before that: confirm it again in Settings, Target margin, and advice starts.",
    };
  }
  if (kind === "glass" && input.pourConfirmed === false) {
    return {
      ...base,
      // The margin at today's price rests on the same unconfirmed pour, so it
      // is not stated either.
      currentMarginPct: null,
      state: "pour_unconfirmed",
      sentence:
        "Glass advice waits until the house confirms its pour size (Settings, Target margin). Bottle advice does not.",
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
  if (tax && tax.refusal !== null) {
    return { ...base, state: tax.refusal.state, sentence: tax.refusal.sentence };
  }
  if (tax && rate === null) {
    // A caller that refused nothing must have found a rate; said, not assumed.
    return {
      ...base,
      state: "no_tax_rate",
      sentence: "Cannot advise: the tax rate inside this price is not known.",
    };
  }

  const margin = base.currentMarginPct as number;
  const netTarget = priceForMargin(unitCost, targetPct / 100);
  // Shown back with tax inside, as the menu prints it.
  const target = netTarget === null || rate === null ? netTarget : netTarget * (1 + rate);
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
  const taxSaid =
    rate === null
      ? ""
      : ` Your prices include ${pct(toCents(rate * 100))} tax; the margin is on the price without it.`;
  // The gap as a percent of the ADVISED price: "close enough" is measured in
  // the same unit, so the number a manager reads is the number that decided.
  const gap = ((price - target) / target) * 100;
  const gapAbs = pct(toCents(Math.abs(gap)));

  if (Math.abs(gap) <= bandPct || advised === toCents(price)) {
    return {
      ...base,
      state: "on_target",
      gapPct: gap,
      sentence: `On target: ${fmt(price)} is ${gapAbs} ${gap < 0 ? "below" : "above"} the advised ${fmt(advised)}, within your ${pct(bandPct)} (margin ${pct(toCents(margin))} against a ${pct(targetPct)} target).${taxSaid}`,
    };
  }

  const raise = advised > price;
  return {
    ...base,
    state: raise ? "raise" : "lower",
    advisedPrice: advised,
    gapPct: gap,
    sentence: raise
      ? `Raise the ${kind} to ${fmt(advised)} (now ${fmt(price)}, ${gapAbs} below it): today's margin is ${pct(toCents(margin))}, your target is ${pct(targetPct)}.${taxSaid}`
      : `Lower the ${kind} to ${fmt(advised)} (now ${fmt(price)}, ${gapAbs} above it): today's margin is ${pct(toCents(margin))}, above your ${pct(targetPct)} target.${taxSaid}`,
  };
}
