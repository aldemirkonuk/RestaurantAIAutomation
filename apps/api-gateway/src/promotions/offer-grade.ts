/**
 * Grade a vendor's offer against the house's OWN ledger — pure, no I/O.
 *
 * ADR 0144 §4 names this as the one thing a deals feed cannot do: an offer
 * shown against what the house actually pays for that item today, e.g. "12%
 * under your last landed cost, on a bottle you bought 40 of last quarter" —
 * never against the vendor's own claimed list price. This module takes rows
 * already read and already tenant-scoped by `promotions.service.ts`, and
 * turns one offer into a verdict per wine with the line it was judged
 * against beside it.
 *
 * Sketch 113 direction B, as the founder picked it (ADR 0160 §113): the
 * headline is the offer's worth against the house's own book, sized so a
 * bigger saving draws a bigger box. This module supplies BOTH readings a
 * card needs — the categorical verdict against the lowest other vendor
 * (`beats`/`matches`/`above`/`no_elsewhere`) and, where the ledger supports
 * it, a projected dollar `worth` (§ WORTH below) — and states plainly when
 * either cannot be produced.
 *
 * THE RULES IT WILL NOT BEND
 * --------------------------
 * - A price states its unit (ADR 0119 Q4). A bottle price is never compared
 *   with a case price; a line in another unit is listed under `skipped` with
 *   the reason, never silently dropped and never converted here.
 * - A price states its money (ADR 0117 Q25). Two lines compare only when both
 *   carry the same non-null currency. "Currency not recorded" is a reason, not
 *   a zero.
 * - A price states its bottle (ADR 0124 Q5, `price_history.identity_id`). Two
 *   lines in the same unit can still be different trade items — a 375ml half
 *   bottle and a 750ml bottle both read "bottle" — so when both lines carry an
 *   `identityId` and they disagree, the line is skipped, not silently pooled.
 * - "No comparable purchase" is a stated state, distinct from "the ledger is
 *   empty" and from "the offer names no wine". Each is its own verdict word.
 * - The offered price is derived from what THIS vendor last charged the
 *   house, never from a list price the mail claims: the mail's "12% off" is
 *   applied to the house's own baseline, so the grade is about the house's
 *   money. Between two baselines this vendor could supply, an actually
 *   RECEIVED and checked invoice (`receipt_verified`) is preferred over a
 *   merely AGREED price (`order_confirmed`, ADR 0054 rule 6) — landed cost
 *   first. When only an agreed price exists, the derivation says so in
 *   words, in full, wherever the figure is shown.
 * - Nothing here acts on an offer. It grades; a person decides.
 *
 * WORTH (the size-driving figure, sketch 113 direction B)
 * ---------------------------------------------------------
 * `worth` is a PROJECTION, not a saving already banked: (this vendor's
 * lowest OTHER vendor price − this offer's derived price) × the house's own
 * purchase quantity for that wine inside the ledger window, in `baseline`'s
 * unit, from ANY vendor (the rate the house already buys at, not a count of
 * what it bought from this one vendor). Withheld — never zero — whenever
 * there is no `bestElsewhere` line or the window holds no purchase of that
 * wine. The quantity summed is a FLOOR, never an inflation: `price_history
 * .quantity` defaults unrecorded amounts to 1 (`procurement.service.ts:5293,
 * 7051` — an invoice with no counted quantity, or an order confirmed with
 * none, both write `1`), and a real purchase event that happened is worth at
 * least 1 of whatever it priced. Summing those floors can only UNDERSTATE
 * the true quantity, never invent it, so the projection is printed as "at
 * least" and never rounds up past what the rows can prove.
 *
 * WHEN A WORTH MAY BE SHOWN (ADR 0165 — the ranking rules, settled before any
 * box is sized)
 * ---------------------------------------------------------------------------
 * A `worth` drives a box's size, so three things must hold or it is withheld
 * (`worth: null`, with the sentence saying why in `worthWithheld`):
 *  1. The offer QUALIFIES. An offer's stated minimum (`OfferForGrade.minimum`)
 *     is compared with the house's LARGEST SINGLE ORDER — one vendor on one
 *     day, in the minimum's own unit, never converted — of EACH named wine on
 *     its own, unless the offer says the wines may be mixed, when one order's
 *     named wines are summed (ADR 0165 open item 3, founder 2026-09-26; `qualifyOffer`). The stored quantity is a floor, so
 *     the answer is "qualifies" or "not shown to qualify", never "does not".
 *     A minimum with no unit (every row the extractor writes today) cannot be
 *     compared at all and withholds the worth (ADR 0119: a quantity states
 *     its unit). An offer stating no minimum has nothing to qualify against.
 *  2. The worth is real — a comparison line and a purchase rate exist (above).
 *  3. The comparison price is recent — `bestElsewhere` is at most
 *     COMPARISON_MAX_AGE_DAYS old on `asOf`. An undated or future-dated line
 *     cannot be shown to be current.
 * The categorical verdict and the delta are NOT gated by any of this: they
 * are what the house last paid, stated with its date; only the projected
 * dollar figure that sizes a box needs to be current and takeable.
 */

/**
 * How old the other vendor's price may be before a worth is withheld (ADR
 * 0165). The research behind it found no fixed standard: finance says
 * "current" and leaves the number to written policy, real-estate appraisal
 * defaults to 12 months with a stated-reason override, procurement bids to 90
 * days. 180 sits inside that bracket. It is a JUDGMENT, named here as one so
 * it can be moved in one place, and printed on every worth it gates.
 */
export const COMPARISON_MAX_AGE_DAYS = 180;

/** The seven singulars `price_history.unit` may hold (20260905072500). */
export const PRICE_SERIES_UNITS = [
  "bottle",
  "case",
  "keg",
  "pack",
  "split_case",
  "each",
  "liter",
] as const;

export interface LedgerLine {
  /** `paid` — a price_history row (what the house paid). `sighting` — a register row. */
  kind: "paid" | "sighting";
  /** `<table>:<id>` — the row a reader can open behind the figure. */
  ref: string;
  providerId: string | null;
  providerName: string | null;
  /** `master_wine_id` when the row carries one. */
  productKey: string | null;
  /**
   * `price_history.identity_id` (ADR 0124 Q5) — the trade item, distinct
   * pack sizes of the same wine included. Null on a row written before the
   * backfill, or on a sighting (the register carries no identity column).
   */
  identityId: string | null;
  productName: string | null;
  price: number;
  /** The unit `price` is stated in — verbatim from the row, or `bottle` for a sighting normalised per 750 ml. */
  unit: string;
  /** ISO 4217, or null when the row did not record it. */
  currency: string | null;
  /** ISO date (YYYY-MM-DD) the price applied / was seen; null when the row has none. */
  date: string | null;
  /** `receipt_verified` · `order_confirmed` · `invoice` · `quote` · … */
  source: string;
  scope: "house" | "open_market";
  /**
   * A `paid` line's `price_history.quantity` — the amount that purchase
   * covered, in `unit`. A FLOOR, not a fact: the column defaults an
   * unrecorded amount to 1 (see the module doc). Null for a `sighting`,
   * which prices what was SEEN, not what was bought.
   */
  quantity: number | null;
  /** A sentence about how the figure was derived, when it was not read verbatim. */
  note: string | null;
}

export interface OfferDiscount {
  percent: number | null;
  amount: number | null;
  currency: string | null;
  freeShipping: boolean;
}

/**
 * The smallest order the vendor will take at this price. The caller passes a
 * finite quantity above zero or `null` (it normalises `conditions.min_qty`);
 * the unit is `null` when the offer gave none — which is how every stored row
 * reads today, because the extractor records the number and not the unit.
 */
export interface OfferMinimum {
  quantity: number | null;
  unit: string | null;
  /**
   * Whether the OFFER says its minimum may be made up of several of its wines
   * (a "mixed case"). Absent or false, the minimum counts PER WINE (ADR 0165
   * open item 3, founder 2026-09-26, round 6): twelve bottles means twelve of
   * one wine, not six and six. Optional so an older caller that never read it
   * gets the stricter reading, never the more permissive one.
   */
  mixed?: boolean;
}

export interface OfferForGrade {
  id: string;
  providerId: string;
  wines: string[];
  discount: OfferDiscount;
  /** `null` when the offer states no minimum. */
  minimum: OfferMinimum | null;
}

/** `restaurant_inventory.wine_name` → `master_wine_id`, the bridge the extractor's names came over. */
export interface WineBridge {
  name: string;
  productKey: string | null;
}

export type WineVerdict =
  /** The offered price is below the house's best price from another vendor. */
  | "beats"
  /** Within half a percent of it. */
  | "matches"
  /** Above it. */
  | "above"
  /** Baseline and offered price known; no other vendor's line in the same unit and money. */
  | "no_elsewhere"
  /** The house has never bought this wine from this vendor, so there is no price to discount. */
  | "no_baseline"
  /** The ledger holds no line for this wine at all. */
  | "unknown_wine"
  /** The offer carries neither a percentage nor an amount. */
  | "not_a_price";

export interface OfferedPrice {
  price: number;
  unit: string;
  currency: string | null;
  /** How the figure was derived from the baseline — printed as provenance. */
  derivation: string;
}

export interface SkippedLine {
  ref: string;
  reason: string;
}

/** The projected worth of taking this offer over the house's own buying rate — see module doc "WORTH". */
export interface WineWorth {
  amount: number;
  currency: string;
  /** The wine's purchase quantity the projection multiplied by. Always a floor. */
  quantity: number;
  /** How many price_history rows contributed `quantity`. */
  invoiceLines: number;
  /** The ledger window this was summed over, in days — stated so the figure can be re-checked. */
  windowDays: number;
  /** The date of the other vendor's price this was measured against. */
  comparisonDate: string;
  /** How old that price was on the day of grading, in days. */
  comparisonAgeDays: number;
  /** The age past which the worth would have been withheld — the rule, stated beside the figure. */
  maxAgeDays: number;
}

export interface WineGrade {
  /** The wine as the offer names it. */
  wine: string;
  /** The ledger name it was matched to, or null when nothing matched. */
  matchedAs: string | null;
  /** What this vendor last charged the house for it — landed cost first (ADR 0054 rule 6). */
  baseline: LedgerLine | null;
  /** The baseline after the offer's discount. */
  offered: OfferedPrice | null;
  /** The house's best price for it from another vendor, same unit and money — landed cost first. */
  bestElsewhere: LedgerLine | null;
  /** The best openly posted sighting, same unit and money — context, never the verdict. */
  market: LedgerLine | null;
  /** When there is no baseline: the house's most recent line for this wine from any vendor. */
  reference: LedgerLine | null;
  /** (offered − bestElsewhere) / bestElsewhere × 100, one decimal. Negative beats. */
  deltaPct: number | null;
  verdict: WineVerdict;
  /** The projected dollar worth of taking this offer — see module doc. Null when it cannot be produced. */
  worth: WineWorth | null;
  /** When a worth was producible but the rules above refused it: the sentence saying why. Otherwise null. */
  worthWithheld: string | null;
  /** Lines that matched the wine but could not be compared, with the reason each. */
  skipped: SkippedLine[];
}

export type QualificationState =
  /** The house's largest single order of these wines reached the minimum. */
  | "qualifies"
  /** The largest order fell short — a floor, so this is "not shown", never "does not qualify". */
  | "not_shown"
  /** A minimum was stated with no unit the ledger can be compared in. */
  | "unit_unknown";

/**
 * How the minimum is counted (ADR 0165 open item 3, answered 2026-09-26):
 * `per_wine` — each named wine must reach it on its own in one order (the
 * default); `mixed` — the offer says the wines may be mixed, so one order's
 * named wines are summed (the rule before that answer, now only on the offer's word).
 */
export type QualificationBasis = "per_wine" | "mixed";

export interface WineQualification {
  wine: string;
  /** This wine's largest single order in the minimum's unit (a floor). */
  largestOrder: number;
  qualifies: boolean;
}

export interface OfferQualification {
  /**
   * `qualifies` only when EVERY named wine is shown to qualify (per wine), or
   * the mixed order does. When only some wines do, the offer is `not_shown`
   * and each wine's own worth is gated by its own line in `perWine`.
   */
  state: QualificationState;
  minimum: OfferMinimum;
  basis: QualificationBasis;
  /**
   * The house's largest single order in the minimum's unit — per wine, the
   * largest of the wines' own; mixed, the largest summed order. Null when the
   * unit could not be compared.
   */
  largestOrder: number | null;
  /** Per wine only: each named wine's own largest order. Null for `mixed` and for `unit_unknown`. */
  perWine: WineQualification[] | null;
  /** The sentence that stands beside a withheld worth; null when the offer qualifies. */
  reason: string | null;
}

export interface OfferGrade {
  status: "graded" | "not_a_price" | "no_wines" | "no_ledger_lines";
  /**
   * Null when there is nothing to qualify: the offer states no minimum, or the
   * status is not `graded` (no wines). Never a stand-in for "qualifies".
   */
  qualification: OfferQualification | null;
  wines: WineGrade[];
  tally: { beats: number; matches: number; above: number; ungraded: number };
  /** The house's paid history with the offer's vendor — how much the vendor's word is worth here. */
  vendor: { lastPurchaseDate: string | null; paidLines: number };
}

/* ── name matching ─────────────────────────────────────────────────────────── */

/**
 * Fold a product name for comparison: NFD, strip combining marks, fold the
 * Turkish dotless i (which does not decompose), lowercase, keep letters and
 * digits, collapse whitespace.
 */
export function foldName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ıİ]/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const MIN_CONTAINS_LEN = 6;

/** Does a ledger line name the wine the offer names? */
export function lineMatchesWine(
  line: LedgerLine,
  wine: string,
  bridgeKey: string | null,
): boolean {
  if (bridgeKey && line.productKey && line.productKey === bridgeKey) return true;
  const a = foldName(wine);
  const b = foldName(line.productName);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  return shorter.length >= MIN_CONTAINS_LEN && longer.includes(shorter);
}

function bridgeKeyFor(wine: string, bridge: WineBridge[]): string | null {
  const w = foldName(wine);
  for (const b of bridge) {
    if (foldName(b.name) === w) return b.productKey;
  }
  return null;
}

/* ── selection helpers ─────────────────────────────────────────────────────── */

function dateValue(d: string | null): number {
  if (!d) return -1;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : -1;
}

/** Most recent by date; a stable ref order at a tie. */
function mostRecentOf(lines: LedgerLine[]): LedgerLine | null {
  let best: LedgerLine | null = null;
  for (const l of lines) {
    if (!best) {
      best = l;
      continue;
    }
    const dl = dateValue(l.date);
    const db = dateValue(best.date);
    if (dl > db) best = l;
    else if (dl === db && l.ref < best.ref) best = l;
  }
  return best;
}

/**
 * Most recent, LANDED COST FIRST (ADR 0054 rule 6 — `receipt_verified` is
 * what the vendor actually charged; `order_confirmed` is only what they
 * agreed to). A `receipt_verified` line beats every `order_confirmed` line
 * regardless of date; only when NO `receipt_verified` line exists does an
 * agreed-only line stand in, and every caller that prints the result states
 * that it is agreed-only (`derivationFor` below).
 */
function mostRecentLandedFirst(lines: LedgerLine[]): LedgerLine | null {
  const landed = lines.filter((l) => l.source === "receipt_verified");
  return mostRecentOf(landed.length > 0 ? landed : lines);
}

/** Lowest price; ties go to the most recent. Landed cost first, same rule as above. */
function cheapestOf(lines: LedgerLine[]): LedgerLine | null {
  let best: LedgerLine | null = null;
  for (const l of lines) {
    if (!best || l.price < best.price) best = l;
    else if (l.price === best.price && dateValue(l.date) > dateValue(best.date)) best = l;
  }
  return best;
}

function cheapestLandedFirst(lines: LedgerLine[]): LedgerLine | null {
  const landed = lines.filter((l) => l.source === "receipt_verified");
  return cheapestOf(landed.length > 0 ? landed : lines);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ── the grade ─────────────────────────────────────────────────────────────── */

function offeredFrom(
  baseline: LedgerLine,
  discount: OfferDiscount,
): { offered: OfferedPrice | null; reason: string | null } {
  const agreedOnly =
    baseline.source !== "receipt_verified"
      ? ", this vendor's AGREED price — never checked against an invoice"
      : ", this vendor's last landed price to you";
  if (discount.percent != null && Number.isFinite(discount.percent)) {
    const price = round2(baseline.price * (1 - discount.percent / 100));
    return {
      offered: {
        price,
        unit: baseline.unit,
        currency: baseline.currency,
        derivation: `${discount.percent}% off ${baseline.price} per ${baseline.unit}${agreedOnly}`,
      },
      reason: null,
    };
  }
  if (discount.amount != null && Number.isFinite(discount.amount)) {
    if (!discount.currency || !baseline.currency) {
      return {
        offered: null,
        reason: !discount.currency
          ? "the mail states an amount off but not its currency, so it cannot be taken from a recorded price"
          : "the baseline records no currency, so an amount off cannot be taken from it",
      };
    }
    if (discount.currency !== baseline.currency) {
      return {
        offered: null,
        reason: `the mail's amount is in ${discount.currency}; the baseline is in ${baseline.currency} — not the same money`,
      };
    }
    const price = round2(Math.max(0, baseline.price - discount.amount));
    return {
      offered: {
        price,
        unit: baseline.unit,
        currency: baseline.currency,
        derivation: `${discount.amount} ${discount.currency} off ${baseline.price} per ${baseline.unit}${agreedOnly}`,
      },
      reason: null,
    };
  }
  return { offered: null, reason: "the offer carries neither a percentage nor an amount off" };
}

/**
 * The house's own buying rate for this wine, in `baseline.unit`, from ANY
 * vendor, over the window the caller already read `ledger` for. See module
 * doc "WORTH" for why summing `quantity` is a floor and never a fabrication.
 */
function purchaseRate(
  matched: LedgerLine[],
  baseline: LedgerLine,
): { quantity: number; invoiceLines: number } {
  let quantity = 0;
  let invoiceLines = 0;
  for (const l of matched) {
    if (l.kind !== "paid" || l.unit !== baseline.unit || l.quantity == null) continue;
    quantity += l.quantity;
    invoiceLines += 1;
  }
  return { quantity, invoiceLines };
}

const DAY_MS = 86_400_000;

/**
 * Whether the other vendor's price is current enough to size a box on `asOf`.
 * The reason names the vendor, the age and the cutoff, so a person can
 * re-check it without opening the code. An undated line cannot be shown to be
 * current, and one dated after `asOf` cannot be trusted; both are withheld.
 */
function comparisonFreshness(
  line: LedgerLine,
  asOf: string,
): { ageDays: number } | { withheld: string } {
  const who = line.providerName ?? "the other vendor";
  const then = dateValue(line.date);
  const now = dateValue(asOf);
  if (then < 0 || now < 0) {
    return { withheld: `${who}'s price has no date, so it cannot be shown to be current` };
  }
  const ageDays = Math.floor((now - then) / DAY_MS);
  if (ageDays < 0) {
    return { withheld: `${who}'s price is dated ${line.date}, after today — it cannot be trusted as current` };
  }
  if (ageDays > COMPARISON_MAX_AGE_DAYS) {
    return {
      withheld: `${who}'s price is ${ageDays} days old (${line.date}); a worth is shown only against a price at most ${COMPARISON_MAX_AGE_DAYS} days old`,
    };
  }
  return { ageDays };
}

/**
 * Whether the house can be shown to meet the offer's stated minimum — see
 * module doc "WHEN A WORTH MAY BE SHOWN". An ORDER is one vendor on one day
 * (a line with no date is its own order: it cannot be grouped, and treating
 * it alone can only understate). Lines in another unit contribute nothing
 * and are never converted.
 *
 * PER WINE UNLESS THE OFFER SAYS MIXED (founder, 2026-09-26, round 6; ADR 0165
 * open item 3). A vendor's "12 bottles" is, unless the offer says
 * the case may be mixed, twelve of ONE wine. So by default each named wine is
 * measured alone — its own largest single order must reach the minimum — and
 * each wine's worth is gated by its own answer. Only when the offer says
 * mixed (`minimum.mixed`) are the named wines in one order summed, which was
 * the rule for every offer before this answer and read more permissively
 * than most vendors mean.
 */
function qualifyOffer(
  offer: OfferForGrade,
  names: string[],
  ledger: LedgerLine[],
  bridge: WineBridge[],
): OfferQualification | null {
  const minimum = offer.minimum;
  if (!minimum || minimum.quantity == null || !(minimum.quantity > 0)) return null;
  const { quantity, unit } = minimum;
  const basis: QualificationBasis = minimum.mixed === true ? "mixed" : "per_wine";
  const shown = `${quantity}${unit ? ` ${unit.replace("_", " ")}${quantity === 1 ? "" : "s"}` : ""}`;

  if (!unit || !(PRICE_SERIES_UNITS as readonly string[]).includes(unit)) {
    return {
      state: "unit_unknown",
      minimum,
      basis,
      largestOrder: null,
      perWine: null,
      reason: `the offer states a minimum of ${quantity} without saying bottles or cases, so it cannot be shown whether the house qualifies — not sized`,
    };
  }

  /** The largest single order, in `unit`, of the lines matching any of `wanted`. */
  const largestOrderOf = (wanted: Array<{ name: string; key: string | null }>): number => {
    const orders = new Map<string, number>();
    for (const l of ledger) {
      if (l.kind !== "paid" || l.scope !== "house" || l.unit !== unit || l.quantity == null) continue;
      if (!wanted.some(({ name, key }) => lineMatchesWine(l, name, key))) continue;
      const order = l.date ? `${l.providerId ?? ""}|${l.date}` : `undated|${l.ref}`;
      orders.set(order, (orders.get(order) ?? 0) + l.quantity);
    }
    return orders.size === 0 ? 0 : Math.max(...orders.values());
  };
  const keys = names.map((n) => ({ name: n, key: bridgeKeyFor(n, bridge) }));

  if (basis === "mixed") {
    const largestOrder = largestOrderOf(keys);
    if (largestOrder >= quantity) {
      return { state: "qualifies", minimum, basis, largestOrder, perWine: null, reason: null };
    }
    return {
      state: "not_shown",
      minimum,
      basis,
      largestOrder,
      perWine: null,
      reason: `the offer needs ${shown} in one order, mixed across its wines; the house's largest single order of these wines on record is ${largestOrder} (a floor), so it is not shown that the house qualifies — not sized`,
    };
  }

  const perWine: WineQualification[] = keys.map((k) => {
    const largestOrder = largestOrderOf([k]);
    return { wine: k.name, largestOrder, qualifies: largestOrder >= quantity };
  });
  const largestOrder = perWine.length === 0 ? 0 : Math.max(...perWine.map((w) => w.largestOrder));
  const qualifying = perWine.filter((w) => w.qualifies).length;
  if (qualifying === perWine.length) {
    return { state: "qualifies", minimum, basis, largestOrder, perWine, reason: null };
  }
  const reason =
    perWine.length === 1
      ? `the offer needs ${shown} of this wine in one order; the house's largest single order of it on record is ${largestOrder} (a floor), so it is not shown that the house qualifies — not sized`
      : `the offer needs ${shown} of each wine in one order (it does not say the wines may be mixed); ${qualifying} of its ${perWine.length} wines reached that in a single order on record, so the rest are not shown to qualify — not sized`;
  return { state: "not_shown", minimum, basis, largestOrder, perWine, reason };
}

/** The sentence beside ONE wine whose own order fell short of a per-wine minimum. */
function perWineReason(q: OfferQualification, w: WineQualification): string {
  const { quantity, unit } = q.minimum;
  const shown = `${quantity}${unit ? ` ${unit.replace("_", " ")}${quantity === 1 ? "" : "s"}` : ""}`;
  return `the offer needs ${shown} of this wine in one order; the house's largest single order of it on record is ${w.largestOrder} (a floor), so it is not shown that the house qualifies — not sized`;
}

export function gradeWine(
  wine: string,
  offer: OfferForGrade,
  ledger: LedgerLine[],
  bridge: WineBridge[],
  windowDays: number,
  asOf: string,
): WineGrade {
  const key = bridgeKeyFor(wine, bridge);
  const matched = ledger.filter((l) => lineMatchesWine(l, wine, key));
  const skipped: SkippedLine[] = [];
  const base: WineGrade = {
    wine,
    matchedAs: null,
    baseline: null,
    offered: null,
    bestElsewhere: null,
    market: null,
    reference: null,
    deltaPct: null,
    verdict: "unknown_wine",
    worth: null,
    worthWithheld: null,
    skipped,
  };
  if (matched.length === 0) return base;

  const house = matched.filter((l) => l.scope === "house");
  const fromVendor = house.filter((l) => l.providerId === offer.providerId);
  // Prefer an actual PAID line over a sighting at this vendor (a sighting is
  // not a payment); only when this vendor has no paid line at all does a
  // sighting stand in. Landed-cost-first applies inside whichever pool wins.
  const vendorPaid = fromVendor.filter((l) => l.kind === "paid");
  const baseline = mostRecentLandedFirst(vendorPaid.length > 0 ? vendorPaid : fromVendor);
  base.matchedAs = (baseline ?? mostRecentOf(house) ?? mostRecentOf(matched))?.productName ?? null;

  if (!baseline) {
    base.reference = mostRecentOf(house);
    base.verdict = "no_baseline";
    return base;
  }
  base.baseline = baseline;

  const notPrice =
    (offer.discount.percent == null || !Number.isFinite(offer.discount.percent)) &&
    (offer.discount.amount == null || !Number.isFinite(offer.discount.amount));
  if (notPrice) {
    base.verdict = "not_a_price";
    return base;
  }

  const { offered, reason } = offeredFrom(baseline, offer.discount);
  if (!offered) {
    skipped.push({ ref: baseline.ref, reason: reason ?? "could not derive an offered price" });
    base.verdict = "not_a_price";
    return base;
  }
  base.offered = offered;

  const comparable: LedgerLine[] = [];
  const marketable: LedgerLine[] = [];
  for (const l of matched) {
    if (l.providerId === offer.providerId && l.scope === "house") continue;
    if (l.unit !== baseline.unit) {
      skipped.push({
        ref: l.ref,
        reason: `stated per ${l.unit}; the baseline is per ${baseline.unit} — not comparable across units`,
      });
      continue;
    }
    if (baseline.identityId && l.identityId && l.identityId !== baseline.identityId) {
      skipped.push({
        ref: l.ref,
        reason: "a different bottle identity (pack size) — not the same product as the baseline",
      });
      continue;
    }
    if (!l.currency || !baseline.currency) {
      skipped.push({
        ref: l.ref,
        reason: !l.currency
          ? "its currency is not recorded"
          : "the baseline's currency is not recorded",
      });
      continue;
    }
    if (l.currency !== baseline.currency) {
      skipped.push({
        ref: l.ref,
        reason: `in ${l.currency}; the baseline is in ${baseline.currency} — not the same money`,
      });
      continue;
    }
    if (l.scope === "open_market") marketable.push(l);
    else comparable.push(l);
  }

  base.market = cheapestOf(marketable);
  const best = cheapestLandedFirst(comparable);
  if (!best) {
    base.verdict = "no_elsewhere";
  } else {
    base.bestElsewhere = best;
    const delta = best.price > 0 ? round1(((offered.price - best.price) / best.price) * 100) : null;
    base.deltaPct = delta;
    if (delta == null) base.verdict = "no_elsewhere";
    else if (Math.abs(delta) < 0.5) base.verdict = "matches";
    else if (delta < 0) base.verdict = "beats";
    else base.verdict = "above";
  }

  // WORTH — only when there is a line to be worth something against, and the
  // house's own buying rate for this wine in this unit is not zero.
  if (base.bestElsewhere && base.bestElsewhere.currency === offered.currency) {
    const fresh = comparisonFreshness(base.bestElsewhere, asOf);
    if ("withheld" in fresh) {
      base.worthWithheld = fresh.withheld;
    } else {
      const rate = purchaseRate(matched, baseline);
      if (rate.quantity > 0) {
        base.worth = {
          amount: round2((base.bestElsewhere.price - offered.price) * rate.quantity),
          currency: offered.currency as string,
          quantity: rate.quantity,
          invoiceLines: rate.invoiceLines,
          windowDays,
          comparisonDate: base.bestElsewhere.date as string,
          comparisonAgeDays: fresh.ageDays,
          maxAgeDays: COMPARISON_MAX_AGE_DAYS,
        };
      }
    }
  }

  return base;
}

export function gradeOffer(
  offer: OfferForGrade,
  ledger: LedgerLine[],
  bridge: WineBridge[],
  windowDays: number,
  asOf: string,
): OfferGrade {
  const vendorPaid = ledger.filter(
    (l) => l.kind === "paid" && l.scope === "house" && l.providerId === offer.providerId,
  );
  const vendor = {
    lastPurchaseDate: mostRecentOf(vendorPaid)?.date ?? null,
    paidLines: vendorPaid.length,
  };
  const tally = { beats: 0, matches: 0, above: 0, ungraded: 0 };
  const notPrice =
    (offer.discount.percent == null || !Number.isFinite(offer.discount.percent)) &&
    (offer.discount.amount == null || !Number.isFinite(offer.discount.amount));

  if (ledger.length === 0) {
    return { status: "no_ledger_lines", qualification: null, wines: [], tally, vendor };
  }
  if (notPrice) {
    return { status: "not_a_price", qualification: null, wines: [], tally, vendor };
  }
  const names = Array.from(new Set(offer.wines.map((w) => w.trim()).filter(Boolean)));
  if (names.length === 0) {
    return { status: "no_wines", qualification: null, wines: [], tally, vendor };
  }
  const wines = names.map((w) => gradeWine(w, offer, ledger, bridge, windowDays, asOf));
  // The offer must qualify before any of its wines may size a box: a worth the
  // house could not take is withheld with the sentence saying why, never zeroed.
  const qualification = qualifyOffer(offer, names, ledger, bridge);
  if (qualification && qualification.state !== "qualifies") {
    wines.forEach((g, i) => {
      if (!g.worth) return;
      // Per wine (ADR 0165 open item 3): a wine that reached the minimum on its own keeps
      // its worth; only the ones that fell short are withheld, each with its
      // own sentence. Mixed or unit-unknown: the whole offer's answer.
      const own = qualification.perWine?.[i] ?? null;
      if (own && own.qualifies) return;
      g.worth = null;
      g.worthWithheld =
        own && qualification.perWine && qualification.perWine.length > 1
          ? perWineReason(qualification, own)
          : qualification.reason;
    });
  }
  for (const g of wines) {
    if (g.verdict === "beats") tally.beats += 1;
    else if (g.verdict === "matches") tally.matches += 1;
    else if (g.verdict === "above") tally.above += 1;
    else tally.ungraded += 1;
  }
  return { status: "graded", qualification, wines, tally, vendor };
}

/**
 * BUNDLES (sketch 113, "the bigger the sale, the bigger the box" + C's
 * density + bundles as their own shape — ADR 0160 §113, owed: "decide and
 * draw how a bundle is graded and shown"). This lane's decision:
 *
 * A bundle (`promo_type === 'bundle'`) grades EVERY line exactly like any
 * other offer — one `gradeWine` per named wine, the identical arithmetic,
 * because a bundle is not a different kind of price claim, only a claim
 * naming several wines at once. What is new is the ROLLUP: a single
 * aggregate `worth` for the whole bundle, so a bundle card can be sized by
 * one number the way a single-wine card is.
 *
 * The aggregate is the sum of every line's own `worth`, and ONLY when every
 * named line has one. The instant one line lacks a `worth` (no baseline, no
 * other vendor, or no purchase in the window), the aggregate is withheld —
 * never partially summed and never silently dropped down to "the lines that
 * happened to have one". A partial sum would be indistinguishable from a
 * complete one on the page, and a bundle whose worth is half-invented is
 * exactly the fabrication ADR 0020 refuses.
 *
 * OPEN HALF OF THE QUESTION (not decided here — see the build doc's
 * not_fixed) **[decided 2026-09-19: "the build doc's not_fixed" is a scratch
 * report, not in the repo. The founder answered this directly ("Lane
 * answers batch 2" ~09:30Z, founder-sketch-decisions-106-115.md:141, corrected 2026-09-19 from a stale 138):
 * "promos bundle line with no comparison = keep excluding." That is the
 * "excluded from the sum the same as a fully ungraded line" option below —
 * chosen, not (baseline − offered). See ADR 0165 Consequences. No code
 * change: `bundleWorth` below already excludes such lines.]**: a bundle line that grades `no_elsewhere` still has a real
 * `offered` price and a real `baseline` — there is money on the table, it
 * is only that no OTHER vendor's line exists to net it against. Whether such
 * a line should count toward the aggregate using (baseline − offered) — the
 * discount itself, with no other-vendor comparison — or should be excluded
 * from the sum the same as a fully ungraded line, is a real choice with
 * money consequences and is the founder's call, not this lane's.
 */
export interface BundleWorth {
  amount: number;
  currency: string;
  /** How many of the bundle's named wines contributed — always all of them, or the aggregate is withheld. */
  linesCounted: number;
}

export function bundleWorth(wines: WineGrade[]): BundleWorth | null {
  const named = wines.filter((w) => w.verdict !== "unknown_wine");
  if (named.length === 0) return null;
  if (!named.every((w) => w.worth)) return null;
  const currency = named[0].worth!.currency;
  if (!named.every((w) => w.worth!.currency === currency)) return null;
  const amount = round2(named.reduce((sum, w) => sum + w.worth!.amount, 0));
  return { amount, currency, linesCounted: named.length };
}
