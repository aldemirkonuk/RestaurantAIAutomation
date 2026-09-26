/**
 * `/promotions` — pure view-model types and formatting for PromotionsNext.
 *
 * Mirrors the gateway's wire shapes exactly (`apps/api-gateway/src/promotions/
 * offer-grade.ts` and `promotions.service.ts`) rather than redeclaring a
 * looser type — a field this file cannot spell is a field the page cannot
 * misread. Nothing here does I/O; every function takes data already read.
 */

/* ── wire types, mirrored from the gateway ──────────────────────────────── */

export type WineVerdict =
  | 'beats'
  | 'matches'
  | 'above'
  | 'no_elsewhere'
  | 'no_baseline'
  | 'unknown_wine'
  | 'not_a_price';

export interface LedgerLine {
  kind: 'paid' | 'sighting';
  ref: string;
  providerId: string | null;
  providerName: string | null;
  productKey: string | null;
  identityId: string | null;
  productName: string | null;
  price: number;
  unit: string;
  currency: string | null;
  date: string | null;
  source: string;
  scope: 'house' | 'open_market';
  quantity: number | null;
  note: string | null;
}

export interface OfferedPrice {
  price: number;
  unit: string;
  currency: string | null;
  derivation: string;
}

export interface SkippedLine {
  ref: string;
  reason: string;
}

export interface WineWorth {
  amount: number;
  currency: string;
  quantity: number;
  invoiceLines: number;
  windowDays: number;
  /** The date of the other vendor's price this was measured against. */
  comparisonDate: string;
  comparisonAgeDays: number;
  /** The age past which the gateway would have withheld this worth. */
  maxAgeDays: number;
}

export interface WineGrade {
  wine: string;
  matchedAs: string | null;
  baseline: LedgerLine | null;
  offered: OfferedPrice | null;
  bestElsewhere: LedgerLine | null;
  market: LedgerLine | null;
  reference: LedgerLine | null;
  deltaPct: number | null;
  verdict: WineVerdict;
  worth: WineWorth | null;
  /** Why a worth the ledger could have produced was refused (stale price, unqualified offer); null otherwise. */
  worthWithheld: string | null;
  skipped: SkippedLine[];
}

export type QualificationState = 'qualifies' | 'not_shown' | 'unit_unknown';

export interface OfferQualification {
  state: QualificationState;
  minimum: { quantity: number | null; unit: string | null };
  largestOrder: number | null;
  reason: string | null;
}

export interface OfferGrade {
  status: 'graded' | 'not_a_price' | 'no_wines' | 'no_ledger_lines';
  /** Null when there is nothing to qualify (no stated minimum, or not graded). */
  qualification: OfferQualification | null;
  wines: WineGrade[];
  tally: { beats: number; matches: number; above: number; ungraded: number };
  vendor: { lastPurchaseDate: string | null; paidLines: number };
}

export interface BundleWorth {
  amount: number;
  currency: string;
  linesCounted: number;
}

export type OfferState = 'open' | 'undated' | 'passed' | 'dismissed';

export interface OfferDto {
  id: string;
  provider_id: string;
  provider_name: string | null;
  name: string;
  promo_type: string;
  description: string | null;
  conditions: Record<string, unknown>;
  discount_value: Record<string, unknown>;
  applicable_wines: string[];
  start_date: string | null;
  end_date: string | null;
  confidence: number | null;
  created_at: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  state: OfferState;
  grade: OfferGrade;
  bundle: BundleWorth | null;
}

export interface LedgerSummaryDto {
  window_days: number;
  since: string;
  paid_lines: number;
  house_sightings: number;
  market_sightings: number;
  skipped_sightings: number;
}

export interface PromotionsReadDto {
  read_at: string;
  offers: OfferDto[];
  ledger: LedgerSummaryDto;
}

/* ── failure, three sentences (401 / 403 / other) — never a blank list ──── */

export interface FailureVM {
  status: number | null;
  message: string;
  expired: boolean;
  forbidden: boolean;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function failureOf(err: unknown): FailureVM {
  const status = num((err as { response?: { status?: unknown } } | null)?.response?.status);
  const body = (err as { response?: { data?: { message?: unknown } } } | null)?.response?.data;
  const message =
    (typeof body?.message === 'string' && body.message) ||
    (err as { message?: string } | null)?.message ||
    'the request failed';
  return { status, message, expired: status === 401, forbidden: status === 403 };
}

/** The sentence the page shows for a failed read. Never an empty list standing in for it. */
export function failureSentence(f: FailureVM): string {
  if (f.expired)
    return 'Your session has expired — sign in again and this house’s offers will read. Nothing below is claimed.';
  if (f.forbidden)
    return 'This account is not owner or manager, so the house’s offers — which carry what a vendor charges you — are withheld. Nothing below is claimed.';
  return `The offers could not be read (${f.message}). Nothing below is claimed — this is not an empty table.`;
}

/* ── money / percent ──────────────────────────────────────────────────── */

const CURRENCY_LOCALE: Record<string, string> = {
  USD: 'en-US',
  TRY: 'tr-TR',
  EUR: 'de-DE',
  GBP: 'en-GB',
};

/** A precise price, in the currency's own convention (cents shown). */
export function fmtPrice(amount: number, currency: string | null): string {
  if (!currency) return `${amount.toFixed(2)} (currency not recorded)`;
  const locale = CURRENCY_LOCALE[currency] ?? 'en-US';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * Round a projection to a scale honest about its own precision: never more
 * exact than the estimate it labels ("about $31", never "$31.42"). Rounds to
 * the unit at small magnitudes and coarser as the figure grows, so the last
 * digit shown is never noise.
 */
export function roundEstimate(amount: number): number {
  const a = Math.abs(amount);
  const step = a < 100 ? 1 : a < 1000 ? 10 : a < 10000 ? 100 : 1000;
  return Math.round(amount / step) * step;
}

/** "about $31" / "about −₺2,100" — a projection, never printed as exact. */
export function fmtEstimate(amount: number, currency: string): string {
  const rounded = roundEstimate(amount);
  return `about ${fmtPrice(rounded, currency)}`;
}

/**
 * The rounded estimate as a headline figure, whole units only ("$164", never
 * "$164.00") — a tray's total is drawn at hero/large size, where cents would
 * claim a precision the estimate does not have. The caller prints "about"
 * beside it; this returns the figure alone.
 */
export function fmtEstimateFigure(amount: number, currency: string): string {
  const rounded = roundEstimate(amount);
  const locale = CURRENCY_LOCALE[currency] ?? 'en-US';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(rounded);
  } catch {
    return `${Math.round(rounded)} ${currency}`;
  }
}

/** "-4.6%" / "+4.2%" — the sign always shown, never implied by colour alone. */
export function fmtSignedPercent(pct: number): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '' : '±';
  return `${sign}${pct.toFixed(1)}%`;
}

/* ── verdict / state words ────────────────────────────────────────────── */

export function verdictWord(v: WineVerdict): string {
  switch (v) {
    case 'beats':
      return 'beats';
    case 'matches':
      return 'matches';
    case 'above':
      return 'above';
    case 'no_elsewhere':
      return 'no other vendor';
    case 'no_baseline':
      return 'never bought from this vendor';
    case 'unknown_wine':
      return 'not on your shelf';
    case 'not_a_price':
      return 'not a price';
  }
}

/** Colour class for a verdict — beats/above only; every other word is neutral ink. */
export function verdictTone(v: WineVerdict): 'beats' | 'above' | null {
  if (v === 'beats' || v === 'matches') return 'beats';
  if (v === 'above') return 'above';
  return null;
}

export function offerStateWord(o: OfferDto, todayIso: string): { word: string; soon: boolean } {
  if (o.state === 'dismissed') return { word: 'put away', soon: false };
  if (o.state === 'undated') return { word: 'no end date', soon: false };
  if (o.state === 'passed') return { word: 'ended', soon: false };
  if (!o.end_date) return { word: 'no end date', soon: false };
  const days = Math.ceil((Date.parse(o.end_date) - Date.parse(todayIso)) / 86_400_000);
  if (days <= 7) return { word: `${o.end_date} · ${Math.max(days, 0)} d`, soon: true };
  return { word: o.end_date, soon: false };
}

/* ── the discount claim, as the mail stated it (never the grade) ────────── */

export interface DiscountClaim {
  percent: number | null;
  amount: number | null;
  currency: string | null;
  freeShipping: boolean;
}

export function discountOf(dv: Record<string, unknown>): DiscountClaim {
  return {
    percent: num(dv.percent),
    amount: num(dv.amount),
    currency: typeof dv.currency === 'string' ? dv.currency : null,
    freeShipping: dv.free_shipping === true,
  };
}

export function claimSentence(discount: DiscountClaim): string {
  if (discount.percent != null) return `${discount.percent}% off`;
  if (discount.amount != null)
    return `${discount.amount}${discount.currency ? ` ${discount.currency}` : ''} off`;
  if (discount.freeShipping) return 'free shipping';
  return 'not a price';
}

export function conditionsOf(c: Record<string, unknown>) {
  return {
    code: typeof c.code === 'string' ? c.code : null,
    minQty: num(c.min_qty),
    minAmount: num(c.min_amount),
    validText: typeof c.valid_text === 'string' ? c.valid_text : null,
  };
}

/* ── picking and explaining the headline wine ────────────────────────────── */

/**
 * The wine a card leads with: the largest |worth| when any line has one (a
 * loss is still the most informative line to lead with — the Fords Gin card
 * in the sketch is exactly this, a −$28 loss leading a single-wine card), else
 * the first line carrying a `deltaPct`, else simply the first named wine.
 */
export function headlineWineOf(wines: WineGrade[]): WineGrade | null {
  if (wines.length === 0) return null;
  const withWorth = wines.filter((w) => w.worth != null);
  if (withWorth.length > 0) {
    return withWorth.reduce((a, b) => (Math.abs(b.worth!.amount) > Math.abs(a.worth!.amount) ? b : a));
  }
  const withDelta = wines.find((w) => w.deltaPct != null);
  return withDelta ?? wines[0];
}

/**
 * Why a line's worth is withheld — stated, never left as a bare "worth —".
 * `offer-grade.ts`'s own rule: a worth needs a `bestElsewhere` in the SAME
 * currency as `offered`, and a non-zero purchase quantity for the wine in the
 * ledger window. Every other verdict already carries its own reason.
 */
export function worthReasonFor(w: WineGrade): string {
  if (w.worth) return '';
  // The gateway refused a worth it could have produced (a stale comparison
  // price, or an offer the house is not shown to qualify for): its sentence
  // is the reason, and it is the more specific one.
  if (w.worthWithheld) return w.worthWithheld;
  switch (w.verdict) {
    case 'no_elsewhere':
      return 'no other vendor has a comparable line for this bottle';
    case 'no_baseline':
      return 'the house has never bought this from this vendor';
    case 'unknown_wine':
      return "this bottle is not on the house's shelf";
    case 'not_a_price':
      return 'the mail states neither a percentage nor an amount off';
    default:
      break;
  }
  if (w.bestElsewhere && w.offered && w.bestElsewhere.currency !== w.offered.currency) {
    return `the comparison is in ${w.bestElsewhere.currency}; the offer is in ${w.offered.currency} — not the same money`;
  }
  return 'no purchase of this bottle in the ledger window, so there is no rate to project against';
}

/** Why a bundle's aggregate worth is withheld (offer-grade.ts's `bundleWorth`: all-or-nothing, never partially summed). */
export function bundleWorthReason(wines: WineGrade[]): string {
  const named = wines.filter((w) => w.verdict !== 'unknown_wine');
  if (named.length === 0) return "none of the bundle's named wines matched anything on the house's shelf";
  const refused = named.find((w) => !w.worth && w.worthWithheld);
  if (refused?.worthWithheld) return refused.worthWithheld;
  const missing = named.filter((w) => !w.worth);
  if (missing.length > 0) {
    const names = missing.map((m) => m.wine).join(', ');
    return `${missing.length} of ${named.length} bottles in this bundle has no worth of its own (${names}) — a partial sum would look complete when it is not, so the total is withheld`;
  }
  return "the bundle's lines are not all in the same currency";
}

/* ── ranking and sizing — direction B "bigger sale, bigger box" + C's density ── */

export type OfferTier = 'hero' | 'large' | 'compact';

/** Founder's shape, ADR 0160 §113: at most one hero, up to three larger cards, then compact tiles. */
export const LARGE_TIER_MAX = 3;

export interface RankedOffer {
  offer: OfferDto;
  tier: OfferTier;
  /** The figure the rank and the tier are both driven by, when one exists. */
  rankWorth: number | null;
}

/**
 * The worth the whole offer ranks by: a bundle's rolled-up total, else the
 * single largest per-wine `worth.amount` (a multi-wine, non-bundle offer is
 * ranked by its best line, since nothing rolls those up — only a bundle gets
 * one worth, offer-grade.ts's own rule).
 *
 * A BUNDLE RANKS ONLY BY ITS TOTAL (founder, 2026-09-25, round 5, sketch 124
 * questions 3 and 4 — ADR 0160 §113). When the rollup is withheld (a bottle
 * with no worth, or a minimum whose unit is unknown), the bundle has NO rank
 * worth: it is drawn compact, never sized by the best of its own bottles.
 * That second rule was offered and not taken.
 */
export function rankWorthOf(o: OfferDto): number | null {
  if (isBundleOffer(o)) return o.bundle ? o.bundle.amount : null;
  const amounts = o.grade.wines.map((w) => w.worth?.amount).filter((n): n is number => n != null);
  if (amounts.length === 0) return null;
  return Math.max(...amounts);
}

/** Only offers currently on the table can be ranked or shown as cards at all. */
export function onTheTable(o: OfferDto): boolean {
  return o.state === 'open' || o.state === 'undated';
}

/**
 * Rank + size the open offers: worth descending (a bigger box for a bigger
 * saving, direction B), offers with no worth fall to the end ordered by
 * ends-soonest (the stated fallback — sketch 113 README "Ranking by worth
 * falls back to ends-soonest when the worth is withheld"), and the whole set
 * stays dense enough to read ten-plus at once (direction C) by tiering
 * everything below the single top card as `large`/`compact` rather than
 * repeating the hero treatment. Bundles rank here with the single offers, by
 * their rolled-up total (`rankWorthOf`).
 *
 * Takes no "today" — `onTheTable` already reads the state the gateway
 * computed (`offerState`, server clock), and the ends-soonest fallback
 * compares two offers' own `end_date`s to each other, never to now.
 */
export function rankOffers(offers: OfferDto[]): RankedOffer[] {
  // Only a GRADED offer draws as a docket card. A `not_a_price` / `no_wines` /
  // `no_ledger_lines` offer has no wine lines to size or rank at all, and
  // belongs in `ungradableOffers`'s own fold instead — drawing it here too
  // would show the same offer twice.
  const onTable = offers.filter((o) => onTheTable(o) && o.grade.status === 'graded');
  const withWorth = onTable
    .map((offer) => ({ offer, rankWorth: rankWorthOf(offer) }))
    .filter((r): r is { offer: OfferDto; rankWorth: number } => r.rankWorth != null)
    .sort((a, b) => b.rankWorth - a.rankWorth);
  const endsValue = (o: OfferDto) => (o.end_date ? Date.parse(o.end_date) : Number.POSITIVE_INFINITY);
  const withoutWorth = onTable
    .filter((o) => rankWorthOf(o) == null)
    .sort((a, b) => endsValue(a) - endsValue(b))
    .map((offer) => ({ offer, rankWorth: null as number | null }));
  const ordered = [...withWorth, ...withoutWorth];
  // A box is sized only by a positive worth: the gateway has already withheld
  // any worth the house is not shown to qualify for or whose comparison price
  // is stale (ADR 0165), so a `rankWorth` here is one that passed those rules.
  // Ranks 1..LARGE_TIER_MAX after the hero are `large`; everything else —
  // including a worth at or below zero — is `compact`.
  return ordered.map((r, i) => {
    const sized = r.rankWorth != null && r.rankWorth > 0;
    const tier: OfferTier = !sized ? 'compact' : i === 0 ? 'hero' : i <= LARGE_TIER_MAX ? 'large' : 'compact';
    return { offer: r.offer, rankWorth: r.rankWorth, tier };
  });
}

/** The offers the docket does not draw as cards: never graded, or already off the table. */
export function ungradableOffers(offers: OfferDto[]): OfferDto[] {
  return offers.filter((o) => onTheTable(o) && o.grade.status !== 'graded');
}

/** A bundle prices several bottles together (`promo_type === 'bundle'`). */
export function isBundleOffer(o: OfferDto): boolean {
  return o.promo_type === 'bundle';
}

/**
 * DIRECTION A, "THE BAND" (founder, 2026-09-25, round 5 — sketch 124,
 * ADR 0160 §113): a row per size tier. One hero band across the page, the
 * large cards three across beneath it, then every compact tile five across.
 * Rank order is strict top to bottom: `rankOffers` hands out tiers in rank
 * order (hero, then up to three large, then compact), so splitting the ranked
 * list by tier never reorders it — `bandsOf` keeps each band in rank order
 * and asserts nothing new. Bundles sit in the same bands as single offers, at
 * the tier their rolled-up total earns (a tray card, `OfferCard`).
 */
export interface Bands {
  hero: RankedOffer | null;
  large: RankedOffer[];
  compact: RankedOffer[];
}

export function bandsOf(ranked: RankedOffer[]): Bands {
  return {
    hero: ranked.find((r) => r.tier === 'hero') ?? null,
    large: ranked.filter((r) => r.tier === 'large'),
    compact: ranked.filter((r) => r.tier === 'compact'),
  };
}

export function putAwayOffers(offers: OfferDto[]): OfferDto[] {
  return offers.filter((o) => o.state === 'dismissed');
}

/* ── the standing line — provable facts only, never a saved figure ──────── */

export function standingLine(read: PromotionsReadDto): string {
  const onTable = read.offers.filter(onTheTable);
  const wineLines = onTable.reduce((n, o) => n + o.applicable_wines.length, 0);
  const vendors = new Set(onTable.map((o) => o.provider_id)).size;
  if (onTable.length === 0) {
    return `No offers on the table — read ${new Date(read.read_at).toLocaleString()}, ${read.ledger.window_days} days of your own price history behind it.`;
  }
  const offerWord = onTable.length === 1 ? 'offer' : 'offers';
  const vendorWord = vendors === 1 ? 'vendor' : 'vendors';
  const lineWord = wineLines === 1 ? 'bottle line' : 'bottle lines';
  return `${onTable.length} ${offerWord} from ${vendors} ${vendorWord} · ${wineLines} ${lineWord}.`;
}
