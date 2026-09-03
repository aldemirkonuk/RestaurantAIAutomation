/**
 * What the house's own orders can be made to admit about a vendor's terms.
 *
 * Pure. No database, no Nest, no clock of its own — every function here takes
 * rows and a zone and returns a finding, so the arithmetic can be asserted
 * directly instead of through a mocked query builder.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS TO HOLD
 * ---------------------------------------------------------------------------
 * An inference is a CLAIM ABOUT EVIDENCE, never a value. Every function returns
 * the number AND the number of receipts it came from AND what kind of bound it
 * is, because the four fields differ in what orders can even prove:
 *
 *   delivery weekdays  a house can SEE which days a vendor turned up.
 *   lead time          a house can MEASURE how long each order took.
 *   order cutoff       a house can only BRACKET it — the latest placement that
 *                      still made the fastest turnaround, and the earliest that
 *                      did not. The cutoff is somewhere between the two, and no
 *                      quantity of orders collapses that bracket to a time.
 *   minimum order      a house can only ever see an UPPER BOUND. Every order in
 *                      the ledger was accepted, so the smallest accepted order
 *                      proves the minimum is at most that. A refusal leaves no
 *                      row, so the true minimum is invisible from this side.
 *   payment terms      NOT INFERABLE AT ALL from these rows: `procurement_orders`
 *                      (baseline 20260805000000:4514-4567) records no payment
 *                      date, no invoice due date and no settlement, so there is
 *                      nothing to difference. It returns `unknown` with that
 *                      reason rather than a shrug.
 *
 * Reporting "2 days" for a lead time computed from three receipts, next to a "2
 * days" computed from four hundred, is [[absence-reported-as-health]] with a
 * plausible number on top — so nothing here returns a bare number.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ZONE IS AN ARGUMENT AND NOT A CONSTANT
 * ---------------------------------------------------------------------------
 * A weekday and a clock time are LOCAL facts. `procurement_orders.requested_at`
 * and `delivered_at` are `timestamptz`; read in UTC, a delivery signed for at
 * 01:00 in Istanbul is a Sunday when it was a Monday, and a cutoff of 14:00
 * becomes 11:00. So the caller passes `restaurants.timezone`.
 *
 * That column is itself DEFAULTED — `character varying(50) DEFAULT
 * 'America/Los_Angeles'` (baseline:3575) — so a house that has never set one is
 * indistinguishable from a house in California. The caller says which case it is
 * in `ZoneUse`, and the register prints the caveat rather than the finding
 * silently absorbing it.
 */

/** 0 = Sunday .. 6 = Saturday — `extract(dow)` and JS `Date#getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * One order, reduced to the five columns any inference here reads.
 *
 * Deliberately not the full row: a shape with forty optional columns invites a
 * sixth inference to reach for a column nobody checked the meaning of.
 */
export interface OrderFact {
  /** `procurement_orders.requested_at` — when the house placed it. */
  requestedAt: string | null;
  /** `procurement_orders.delivered_at` — when it actually arrived. */
  deliveredAt: string | null;
  /** `procurement_orders.expected_delivery_date` — a `date`, zone-free. */
  expectedDeliveryDate: string | null;
  /** `procurement_orders.total_cost`. */
  totalCost: number | null;
  /** `procurement_orders.status`. */
  status: string | null;
}

/** How much the caller may lean on a finding, and why. */
export type Confidence = "high" | "medium" | "low";

export interface Evidence {
  /** Receipts the finding was computed from. Never rounded, never inferred. */
  n: number;
  confidence: Confidence;
  /** One sentence naming what was counted. Rendered verbatim. */
  basis: string;
}

/** Nothing could be computed, and the reason is the answer. */
export interface NoFinding {
  known: false;
  reason: string;
  n: number;
}

export type Finding<T> = (T & { known: true } & Evidence) | NoFinding;

export interface ZoneUse {
  /** IANA zone the local weekday and clock were computed in. */
  zone: string;
  /**
   * True when `restaurants.timezone` still holds its column default, so the
   * house may simply never have been asked. The finding is still computed —
   * refusing to compute would be worse — but it is flagged.
   */
  isColumnDefault: boolean;
}

/** The statuses that mean the vendor actually turned up with goods. */
const DELIVERED_STATUSES = new Set([
  "delivered",
  "completed",
  "received",
  "verified",
]);

/* ── Local-time primitives ───────────────────────────────────────────────── */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  const hit = partsCache.get(zone);
  if (hit) return hit;
  // `en-CA` yields YYYY-MM-DD for the date parts, which is the only ordering
  // that sorts and compares correctly as a string.
  const made = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  partsCache.set(zone, made);
  return made;
}

export interface LocalMoment {
  /** `YYYY-MM-DD` in the given zone. */
  date: string;
  /** Minutes since local midnight, 0..1439. */
  minuteOfDay: number;
  /** 0 = Sunday .. 6 = Saturday, in the given zone. */
  weekday: Weekday;
}

/**
 * A timestamptz read as a wall clock in `zone`.
 *
 * Returns null for an absent or unparseable value rather than throwing or
 * falling back to now(): a row with a broken date must drop out of the sample,
 * not quietly join it wearing today's date.
 */
export function localMoment(iso: string | null, zone: string): LocalMoment | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterFor(zone).formatToParts(new Date(ms));
  } catch {
    // An unknown IANA zone. The caller's zone came from a database column, so
    // this is reachable; UTC is announced by the caller rather than hidden.
    parts = formatterFor("UTC").formatToParts(new Date(ms));
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hour)) return null;
  return {
    date,
    // `hour12: false` emits "24" for midnight in some ICU versions.
    minuteOfDay: ((hour % 24) * 60 + (Number.isFinite(minute) ? minute : 0)) % 1440,
    weekday: weekdayOfDateString(date),
  };
}

/** The weekday of a `YYYY-MM-DD` string, read as a calendar date, not an instant. */
export function weekdayOfDateString(date: string): Weekday {
  // Parsed at UTC noon so no zone shift can move it across a day boundary.
  const ms = Date.parse(`${date}T12:00:00Z`);
  return (Number.isFinite(ms) ? new Date(ms).getUTCDay() : 0) as Weekday;
}

/** Whole calendar days between two `YYYY-MM-DD` strings. Negative is possible. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function hhmm(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* ── The delivery date an order actually landed on ───────────────────────── */

export interface Landed {
  /** `YYYY-MM-DD` the goods arrived on, local to the house. */
  date: string;
  /** True when this came from `delivered_at`; false when it is only a promise. */
  actual: boolean;
}

/**
 * The date an order landed, preferring what happened over what was promised.
 *
 * `expected_delivery_date` is a bare `date` and needs no zone; `delivered_at`
 * is an instant and does. Both are reported with `actual` so a weekday pattern
 * built from promises can never be presented as a pattern of arrivals.
 */
export function landedOn(order: OrderFact, zone: string): Landed | null {
  const actual = localMoment(order.deliveredAt, zone);
  if (actual) return { date: actual.date, actual: true };
  const promised = order.expectedDeliveryDate;
  if (promised && /^\d{4}-\d{2}-\d{2}/.test(promised)) {
    return { date: promised.slice(0, 10), actual: false };
  }
  return null;
}

/* ── Confidence ──────────────────────────────────────────────────────────── */

/**
 * Confidence from sample size alone, before dispersion narrows it further.
 *
 * The cut points are stated here once so every finding uses the same ones and
 * a reader can disagree with a number rather than with a vibe: under 4 receipts
 * is `low` (one holiday week moves it), 4..11 is `medium`, 12 and above is
 * `high` — twelve being roughly a quarter of weekly ordering, the shortest span
 * over which a weekly pattern repeats often enough to be a pattern.
 */
export function confidenceFromCount(n: number): Confidence {
  if (n >= 12) return "high";
  if (n >= 4) return "medium";
  return "low";
}

/** Never let dispersion RAISE a confidence — it may only lower it. */
function lower(a: Confidence, b: Confidence): Confidence {
  const order: Confidence[] = ["low", "medium", "high"];
  return order[Math.min(order.indexOf(a), order.indexOf(b))];
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

/* ── 1. Which days they deliver ──────────────────────────────────────────── */

export interface DeliveryWeekdaysFinding {
  weekdays: Weekday[];
  /** Share of receipts the returned weekdays account for, 0..1. */
  coverage: number;
  /** Receipts per weekday, index 0..6. Rendered as the working, not hidden. */
  perWeekday: number[];
  /** True when every receipt in the sample is a real arrival, not a promise. */
  fromArrivals: boolean;
}

/**
 * The days a vendor actually turns up.
 *
 * The rule, stated so it can be argued with: sort the weekdays by how many
 * receipts landed on them, take them in that order until they cover 80% of the
 * sample, then drop any that carries fewer than two receipts. The 80% is what
 * keeps one emergency Saturday out of a Monday-Wednesday-Friday vendor; the
 * two-receipt floor is what stops a single delivery becoming a "delivery day"
 * on a vendor the house has used four times.
 *
 * A vendor that genuinely delivers every day comes back with all seven, because
 * seven roughly-equal columns each clear both bars.
 */
export function inferDeliveryWeekdays(
  orders: OrderFact[],
  zone: string,
): Finding<DeliveryWeekdaysFinding> {
  const perWeekday = [0, 0, 0, 0, 0, 0, 0];
  let n = 0;
  let arrivals = 0;
  for (const o of orders) {
    const landed = landedOn(o, zone);
    if (!landed) continue;
    perWeekday[weekdayOfDateString(landed.date)] += 1;
    n += 1;
    if (landed.actual) arrivals += 1;
  }

  if (n === 0) {
    return {
      known: false,
      n: 0,
      reason:
        "no order to this vendor carries a delivery date — neither a signed arrival nor a promised one",
    };
  }

  const ranked = perWeekday
    .map((count, day) => ({ count, day: day as Weekday }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.day - b.day);

  const chosen: Weekday[] = [];
  let covered = 0;
  for (const r of ranked) {
    if (covered / n >= 0.8) break;
    chosen.push(r.day);
    covered += r.count;
  }
  // The two-receipt floor, applied only where dropping a day does not take the
  // sample back under its own 80%.
  const kept = chosen.filter((d) => perWeekday[d] >= 2);
  const finalDays = (kept.length > 0 ? kept : chosen).sort((a, b) => a - b);
  const finalCovered = finalDays.reduce((s, d) => s + perWeekday[d], 0);

  const spread = ranked.length;
  const base = confidenceFromCount(n);
  // Seven distinct weekdays over a handful of receipts is noise, not a pattern.
  const dispersion: Confidence = spread >= 6 && n < 20 ? "low" : "high";

  return {
    known: true,
    weekdays: finalDays,
    coverage: finalCovered / n,
    perWeekday,
    fromArrivals: arrivals === n,
    n,
    confidence: lower(base, dispersion),
    basis:
      arrivals === n
        ? `${n} signed arrival${n === 1 ? "" : "s"}`
        : `${n} delivery date${n === 1 ? "" : "s"}, of which ${arrivals} signed and ${n - arrivals} only promised`,
  };
}

/* ── 2. How long they take ───────────────────────────────────────────────── */

export interface LeadTimeFinding {
  /** Median whole days from placement to arrival. */
  medianDays: number;
  /** The slow tail, so a median of 2 with a p90 of 9 cannot read as "2 days". */
  p90Days: number;
  fastestDays: number;
  /** True when every receipt is a signed arrival rather than a promise. */
  fromArrivals: boolean;
}

/**
 * Placement to arrival, in whole local days.
 *
 * Whole days rather than hours on purpose: an order placed at 23:50 and
 * delivered at 08:00 the next morning took 8 hours and ONE day, and the day is
 * the unit a house reorders in. Hours would make the same vendor look twice as
 * fast for a late-night order.
 *
 * Negative gaps are dropped, not clamped to zero: an arrival dated before its
 * own placement is a broken row, and clamping it would pull the median down
 * with a number that describes nothing.
 */
export function inferLeadTime(
  orders: OrderFact[],
  zone: string,
): Finding<LeadTimeFinding> {
  const gaps: number[] = [];
  let arrivals = 0;
  let negatives = 0;
  for (const o of orders) {
    const placed = localMoment(o.requestedAt, zone);
    const landed = landedOn(o, zone);
    if (!placed || !landed) continue;
    const gap = daysBetween(placed.date, landed.date);
    if (gap === null) continue;
    if (gap < 0) {
      negatives += 1;
      continue;
    }
    gaps.push(gap);
    if (landed.actual) arrivals += 1;
  }

  if (gaps.length === 0) {
    return {
      known: false,
      n: 0,
      reason:
        negatives > 0
          ? `every order to this vendor is dated as arriving before it was placed (${negatives} of them) — the ledger cannot be differenced`
          : "no order to this vendor carries both a placement date and a delivery date",
    };
  }

  const med = median(gaps) as number;
  const p90 = percentile(gaps, 90) as number;
  const fastest = Math.min(...gaps);
  const base = confidenceFromCount(gaps.length);
  // A p90 more than three days beyond the median is not a lead time, it is two
  // behaviours averaged; say `low` rather than print a confident median.
  const dispersion: Confidence = p90 - med > 3 ? "low" : "high";

  return {
    known: true,
    medianDays: med,
    p90Days: p90,
    fastestDays: fastest,
    fromArrivals: arrivals === gaps.length,
    n: gaps.length,
    confidence: lower(base, dispersion),
    basis:
      `${gaps.length} receipt${gaps.length === 1 ? "" : "s"} with both dates` +
      (negatives > 0 ? `, ${negatives} dropped for arriving before placement` : ""),
  };
}

/* ── 3. When they close ──────────────────────────────────────────────────── */

export interface CutoffFinding {
  /**
   * The cutoff is no EARLIER than this: the latest local time the house has
   * placed an order that still achieved the vendor's fastest turnaround.
   */
  notBeforeMinute: number;
  /**
   * The cutoff is no LATER than this: the earliest local time the house has
   * placed an order that missed it. Null when nothing has ever missed — in
   * which case the ledger has found a floor and no ceiling.
   */
  notAfterMinute: number | null;
  /** The turnaround being treated as "made it". */
  fastestDays: number;
  /** Orders that achieved it / that did not. */
  madeIt: number;
  missed: number;
}

/**
 * Bracket the cutoff. Never state it.
 *
 * A house's own placement times say nothing about a vendor's cutoff on their
 * own — they describe the house's habits. What DOES carry information is the
 * pairing of a placement time with the turnaround it got: the latest placement
 * that still achieved the vendor's best turnaround is a FLOOR under the cutoff,
 * and the earliest placement that did not is a CEILING over it.
 *
 * This is the only shape the ledger supports, and it is why the register renders
 * "after 13:40, before 15:10" rather than a time. Choco stores a cutoff per
 * delivery day (https://help.choco.com/en/articles/6572290-view-and-edit-the-information-of-your-supplier
 * lists "Order Cut Off Times for each delivery day"), which these rows cannot
 * split at all — a Friday cutoff of 11:00 and a weekday cutoff of 15:00 land in
 * one bracket here. Said plainly rather than modelled away.
 *
 * The bracket can come out crossed (`notAfter <= notBefore`) whenever something
 * other than the clock decided the turnaround — a holiday, an out-of-stock, a
 * driver. That is reported as a floor with no ceiling rather than as a range
 * running backwards.
 */
export function inferOrderCutoff(
  orders: OrderFact[],
  zone: string,
): Finding<CutoffFinding> {
  const sample: Array<{ minute: number; gap: number }> = [];
  for (const o of orders) {
    const placed = localMoment(o.requestedAt, zone);
    const landed = landedOn(o, zone);
    if (!placed || !landed) continue;
    const gap = daysBetween(placed.date, landed.date);
    if (gap === null || gap < 0) continue;
    sample.push({ minute: placed.minuteOfDay, gap });
  }

  if (sample.length < 2) {
    return {
      known: false,
      n: sample.length,
      reason:
        sample.length === 0
          ? "no order to this vendor carries both a placement time and a delivery date"
          : "one order cannot bracket a cutoff — a floor needs an order that made the fastest turnaround and a ceiling needs one that did not",
    };
  }

  const fastest = Math.min(...sample.map((s) => s.gap));
  const made = sample.filter((s) => s.gap === fastest);
  const missedAll = sample.filter((s) => s.gap > fastest);

  const notBefore = Math.max(...made.map((s) => s.minute));
  const laterMisses = missedAll.filter((s) => s.minute > notBefore);
  const notAfter =
    laterMisses.length > 0 ? Math.min(...laterMisses.map((s) => s.minute)) : null;

  const base = confidenceFromCount(sample.length);
  // A bracket wider than six hours has not narrowed anything worth trusting;
  // no ceiling at all is weaker still.
  const width = notAfter === null ? Infinity : notAfter - notBefore;
  const dispersion: Confidence =
    notAfter === null ? "low" : width > 360 ? "medium" : "high";

  return {
    known: true,
    notBeforeMinute: notBefore,
    notAfterMinute: notAfter,
    fastestDays: fastest,
    madeIt: made.length,
    missed: missedAll.length,
    n: sample.length,
    confidence: lower(base, dispersion),
    basis:
      notAfter === null
        ? `${made.length} order${made.length === 1 ? "" : "s"} made the ${fastest}-day turnaround and none placed later missed it — a floor with no ceiling`
        : `${made.length} made the ${fastest}-day turnaround, ${missedAll.length} did not`,
  };
}

/* ── 4. What they will not go below ──────────────────────────────────────── */

export interface MinimumOrderFinding {
  /** The smallest order this vendor has ACCEPTED. An upper bound, never the minimum. */
  smallestAccepted: number;
  /** The next one up, so a single odd order cannot look like a policy. */
  secondSmallest: number | null;
}

/**
 * An upper bound on the minimum, and it can never be more than that.
 *
 * Every row in `procurement_orders` is an order the vendor took. A refusal —
 * "we do not deliver under 2,500" — writes nothing anywhere, so the ledger
 * holds no evidence of the floor itself, only of orders that cleared it. The
 * finding is therefore stated as "they have accepted as little as X", and the
 * register never prints it under the word "minimum".
 *
 * Only orders that actually arrived are counted: a cancelled or rejected order
 * proves nothing about what a vendor will accept, and including it would make
 * the bound wrong in the one direction that matters.
 */
export function inferMinimumOrder(orders: OrderFact[]): Finding<MinimumOrderFinding> {
  const totals = orders
    .filter((o) => DELIVERED_STATUSES.has(String(o.status ?? "").toLowerCase()))
    .map((o) => (typeof o.totalCost === "number" ? o.totalCost : Number(o.totalCost)))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  if (totals.length === 0) {
    return {
      known: false,
      n: 0,
      reason:
        "no order to this vendor has both arrived and carried a cost — an order that never landed proves nothing about what they will accept",
    };
  }

  return {
    known: true,
    smallestAccepted: totals[0],
    secondSmallest: totals.length > 1 ? totals[1] : null,
    n: totals.length,
    confidence: confidenceFromCount(totals.length),
    basis: `${totals.length} delivered order${totals.length === 1 ? "" : "s"} with a cost`,
  };
}

/* ── 5. Payment terms — the one that cannot be inferred ──────────────────── */

export const PAYMENT_TERMS_NOT_INFERABLE =
  "no table records when a vendor invoice was raised or settled, so there is no interval to measure — payment terms can only be stated";

/* ── The bundle a register renders ───────────────────────────────────────── */

export interface InferredTerms {
  deliveryWeekdays: Finding<DeliveryWeekdaysFinding>;
  leadTime: Finding<LeadTimeFinding>;
  orderCutoff: Finding<CutoffFinding>;
  minimumOrder: Finding<MinimumOrderFinding>;
  paymentTerms: NoFinding;
  /** Orders the inference read, before any field dropped its own unusable rows. */
  ordersRead: number;
  zone: ZoneUse;
}

export function inferTerms(
  orders: OrderFact[],
  zone: ZoneUse,
): InferredTerms {
  return {
    deliveryWeekdays: inferDeliveryWeekdays(orders, zone.zone),
    leadTime: inferLeadTime(orders, zone.zone),
    orderCutoff: inferOrderCutoff(orders, zone.zone),
    minimumOrder: inferMinimumOrder(orders),
    paymentTerms: { known: false, n: 0, reason: PAYMENT_TERMS_NOT_INFERABLE },
    ordersRead: orders.length,
    zone,
  };
}
