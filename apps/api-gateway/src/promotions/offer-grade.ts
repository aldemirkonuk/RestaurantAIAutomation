/**
 * Grade a vendor's offer against the house's OWN ledger — pure, no I/O.
 *
 * DESIGN-FOUNDATION §6 names this as the one thing a deals feed cannot do:
 * "12% off list, but 4% above what you paid Vendor B in March". The house has
 * the invoice history to say it (`price_history`, one writer:
 * `procurement.service.ts` `recordPriceHistory`; and the price register,
 * `vendor_price_observations`, read through `scopePriceRegisterRead`). This
 * module takes those rows, already read and already tenant-scoped by
 * `promotions.service.ts`, and turns one offer into a verdict per wine with
 * the line it was judged against beside it.
 *
 * THE RULES IT WILL NOT BEND
 * --------------------------
 * - A price states its unit (ADR 0119 Q4). A bottle price is never compared
 *   with a case price; a line in another unit is listed under `skipped` with
 *   the reason, never silently dropped and never converted here.
 * - A price states its money (ADR 0117 Q25). Two lines compare only when both
 *   carry the same non-null currency. "Currency not recorded" is a reason, not
 *   a zero.
 * - "No comparable purchase" is a stated state, distinct from "the ledger is
 *   empty" and from "the offer names no wine". Each is its own verdict word.
 * - The offered price is derived from what THIS vendor last charged the house,
 *   never from a list price the mail claims: the mail's "12% off" is applied to
 *   the house's own baseline, so the grade is about the house's money.
 * - Nothing here acts on an offer. It grades; a person decides (§6, "Never").
 */

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
  /** A sentence about how the figure was derived, when it was not read verbatim. */
  note: string | null;
}

export interface OfferDiscount {
  percent: number | null;
  amount: number | null;
  currency: string | null;
  freeShipping: boolean;
}

export interface OfferForGrade {
  id: string;
  providerId: string;
  wines: string[];
  discount: OfferDiscount;
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

export interface WineGrade {
  /** The wine as the offer names it. */
  wine: string;
  /** The ledger name it was matched to, or null when nothing matched. */
  matchedAs: string | null;
  /** What this vendor last charged the house for it. */
  baseline: LedgerLine | null;
  /** The baseline after the offer's discount. */
  offered: OfferedPrice | null;
  /** The house's best price for it from another vendor, same unit and money. */
  bestElsewhere: LedgerLine | null;
  /** The best openly posted sighting, same unit and money — context, never the verdict. */
  market: LedgerLine | null;
  /** When there is no baseline: the house's most recent line for this wine from any vendor. */
  reference: LedgerLine | null;
  /** (offered − bestElsewhere) / bestElsewhere × 100, one decimal. Negative beats. */
  deltaPct: number | null;
  verdict: WineVerdict;
  /** Lines that matched the wine but could not be compared, with the reason each. */
  skipped: SkippedLine[];
}

export interface OfferGrade {
  status: "graded" | "not_a_price" | "no_wines" | "no_ledger_lines";
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
    .replace(/[\u0300-\u036f]/g, "")
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

/** Most recent by date; `paid` beats `sighting` at the same date; a stable ref order after that. */
function mostRecent(lines: LedgerLine[]): LedgerLine | null {
  let best: LedgerLine | null = null;
  for (const l of lines) {
    if (!best) {
      best = l;
      continue;
    }
    const dl = dateValue(l.date);
    const db = dateValue(best.date);
    if (dl > db) best = l;
    else if (dl === db) {
      if (l.kind === "paid" && best.kind !== "paid") best = l;
      else if (l.kind === best.kind && l.ref < best.ref) best = l;
    }
  }
  return best;
}

/** Lowest price; ties go to the most recent. */
function cheapest(lines: LedgerLine[]): LedgerLine | null {
  let best: LedgerLine | null = null;
  for (const l of lines) {
    if (!best || l.price < best.price) best = l;
    else if (l.price === best.price && dateValue(l.date) > dateValue(best.date)) best = l;
  }
  return best;
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
  if (discount.percent != null && Number.isFinite(discount.percent)) {
    const price = round2(baseline.price * (1 - discount.percent / 100));
    return {
      offered: {
        price,
        unit: baseline.unit,
        currency: baseline.currency,
        derivation: `${discount.percent}% off ${baseline.price} per ${baseline.unit}, this vendor's last price to you`,
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
        derivation: `${discount.amount} ${discount.currency} off ${baseline.price} per ${baseline.unit}, this vendor's last price to you`,
      },
      reason: null,
    };
  }
  return { offered: null, reason: "the offer carries neither a percentage nor an amount off" };
}

export function gradeWine(
  wine: string,
  offer: OfferForGrade,
  ledger: LedgerLine[],
  bridge: WineBridge[],
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
    skipped,
  };
  if (matched.length === 0) return base;

  const house = matched.filter((l) => l.scope === "house");
  const fromVendor = house.filter((l) => l.providerId === offer.providerId);
  const baseline =
    mostRecent(fromVendor.filter((l) => l.kind === "paid")) ??
    mostRecent(fromVendor);
  base.matchedAs = (baseline ?? mostRecent(house) ?? mostRecent(matched))?.productName ?? null;

  if (!baseline) {
    base.reference = mostRecent(house);
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

  base.market = cheapest(marketable);
  const best = cheapest(comparable);
  if (!best) {
    base.verdict = "no_elsewhere";
    return base;
  }
  base.bestElsewhere = best;
  const delta = best.price > 0 ? round1(((offered.price - best.price) / best.price) * 100) : null;
  base.deltaPct = delta;
  if (delta == null) base.verdict = "no_elsewhere";
  else if (Math.abs(delta) < 0.5) base.verdict = "matches";
  else if (delta < 0) base.verdict = "beats";
  else base.verdict = "above";
  return base;
}

export function gradeOffer(
  offer: OfferForGrade,
  ledger: LedgerLine[],
  bridge: WineBridge[],
): OfferGrade {
  const vendorPaid = ledger.filter(
    (l) => l.kind === "paid" && l.scope === "house" && l.providerId === offer.providerId,
  );
  const vendor = {
    lastPurchaseDate: mostRecent(vendorPaid)?.date ?? null,
    paidLines: vendorPaid.length,
  };
  const tally = { beats: 0, matches: 0, above: 0, ungraded: 0 };
  const notPrice =
    (offer.discount.percent == null || !Number.isFinite(offer.discount.percent)) &&
    (offer.discount.amount == null || !Number.isFinite(offer.discount.amount));

  if (ledger.length === 0) {
    return { status: "no_ledger_lines", wines: [], tally, vendor };
  }
  if (notPrice) {
    return { status: "not_a_price", wines: [], tally, vendor };
  }
  const names = Array.from(new Set(offer.wines.map((w) => w.trim()).filter(Boolean)));
  if (names.length === 0) {
    return { status: "no_wines", wines: [], tally, vendor };
  }
  const wines = names.map((w) => gradeWine(w, offer, ledger, bridge));
  for (const g of wines) {
    if (g.verdict === "beats") tally.beats += 1;
    else if (g.verdict === "matches") tally.matches += 1;
    else if (g.verdict === "above") tally.above += 1;
    else tally.ungraded += 1;
  }
  return { status: "graded", wines, tally, vendor };
}
