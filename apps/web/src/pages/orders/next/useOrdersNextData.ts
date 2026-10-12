/**
 * OrdersNext view model — live data only, assembled from the EXISTING hooks
 * (useOrderWindow, useProviders); nothing here invents a number. The ledger
 * is the newest orders, a page at a time; the spine's counts and the month
 * are the gateway's, over the whole book, sent with the first page (F-1368). The five-stage
 * spine the founder kept (pending · approved · ordered · delivered · recurring)
 * is derived from the canonical OrderStatus set via normalizeOrderStatus, with
 * `recurring` orthogonal: a repeating order sits in the recurring station
 * whatever its current status, exactly as the legacy page bucketed it.
 *
 * Unknowns are null and render as em dashes downstream — a failed query is not
 * an empty ledger, and a missing price is not $0.00.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { readFailureWords } from '@/lib/readFailure';
import { useOrderWindow } from '@/hooks/queries/useOrderQueries';
import { getOrder, type OrderBookSummary } from '@/services/api/orders';
import { useProviders } from '@/hooks/queries/useProviderQueries';
import { type Order, type OrderStatus } from '@/services/api/types';
import { num, sumByCurrency, type MoneyInCurrency } from './format';
import { settingsApi } from '@/services/api/settings';
import { queryKeys } from '@/lib/query-keys';
import { useHouseGroupMark } from '@/hooks/useHouseGroupMark';
import type { GroupMark } from '@/lib/parseDecimal';
import {
  PRICE_UOMS,
  agreementTotal,
  readFeesFromWire,
  type AgreementFees,
  readPriceUnitFromWire,
  type AgreementTotal,
  type PriceUnitReading,
  type PriceUom,
} from './price-unit';
import {
  isRecurring,
  readRecurrence,
  recurrenceLabel,
  type RecurrenceReading,
} from './recurrence';

export type Stage = 'pending' | 'approved' | 'ordered' | 'delivered';
export const STAGES: Stage[] = ['pending', 'approved', 'ordered', 'delivered'];

export const STAGE_LABEL: Record<Stage | 'recurring', string> = {
  pending: 'Pending',
  approved: 'Approved',
  ordered: 'Ordered',
  delivered: 'Delivered',
  recurring: 'Recurring',
};

function stageOf(status: OrderStatus): Stage | 'cancelled' {
  switch (status) {
    case 'draft':
    case 'negotiating':
    case 'pending':
    case 'pending_approval':
      return 'pending';
    case 'approved':
      return 'approved';
    case 'ordered':
    case 'in_transit':
      return 'ordered';
    case 'delivered':
    case 'partially_received':
    case 'verified':
    case 'completed':
      return 'delivered';
    case 'cancelled':
    case 'rejected':
      return 'cancelled';
  }
}

/**
 * The gateway speaks ProcurementOrderStatus (SCREAMING_SNAKE) and the raw list
 * endpoint returns it verbatim; normalizeOrderStatus knows the canonical set
 * but not these backend-only variants, which the legacy page mapped by hand
 * (useOrdersPage.ts mapApiStatusToUi). Same truth, kept here.
 */
// Moved to the foundation (lib/mudavym/status.ts) so other pages depend on
// lib/mudavym, never on this page; imported for local use and re-exported to
// keep existing call sites stable.
import { canonicalStatus } from '@/lib/mudavym/status';
export { canonicalStatus };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string | null | undefined): boolean => !!v && UUID_RE.test(v);

/**
 * What this page reads beyond the shared `Order` type.
 *
 * It used to carry six more: `finalPrice`, `totalCost`, `bottlesTotal`,
 * `unitType`, `priceUom` and `pricePackSize` were declared here because the
 * shared type named none of them — it named `unitPrice` / `totalPrice`, which
 * the list route has never sent. On 2026-09-05 the shared type was rewritten to
 * be exactly `OrderResponseDto`, so those six moved there and this intersection
 * shrank to what remains genuinely local.
 *
 * The three fee keys stay because they are ADR 0119 Q3, still being built on the
 * gateway side; they join the shared type when `OrderResponseDto` declares them.
 * `scripts/check_web_reads_gateway_dto_keys.py` guards the shared type, not this
 * intersection — a widening cast is always a way around a guard, which is why
 * the only three keys in it are named, dated and owned.
 */
type OrderWire = Order & {
  /** ADR 0119 Q3 — the money outside the price of the wine. */
  allowance?: number | null;
  deposit?: number | null;
  freight?: number | null;
  /** `procurement_orders.currency`, sent by `mapOrderRow`; null names none. */
  currency?: string | null;
  /**
   * The order was written at the door for a truck that came with no order on
   * file (F-669, `source = 'retroactive'`): "Logged at door". In spend and
   * stock, out of lead time, on-time and fill rate. Absent where the route
   * does not read the order's source.
   */
  loggedAtDoor?: boolean;
  /** The day the door said it was ordered, `YYYY-MM-DD`; null for Don't know. */
  placedOnStated?: string | null;
};

export interface OrderRowVM {
  id: string;
  orderNumber: string | null;
  wineName: string | null;
  producer: string | null;
  providerName: string | null;
  quantity: number | null;
  /**
   * The AGREED price, stated per `priceUom` — not necessarily per bottle. Read
   * it only alongside `priceUnit`; on its own it is the ambiguous number ADR
   * 0119 exists to end.
   */
  unitPrice: number | null;
  /** Bottles (or kegs/litres, when the unit is opaque) the order comes to. */
  bottlesTotal: number | null;
  /** The unit the order's QUANTITY is counted in. Independent of the price's. */
  unitType: PriceUom | null;
  /**
   * What the route said about the unit `unitPrice` is stated in — including
   * whether it said anything at all (`read`). See `readPriceUnitFromWire`.
   */
  priceUnit: PriceUnitReading;
  /**
   * What the route said about the money OUTSIDE the price of the wine (ADR 0119
   * Q3) — including whether it said anything at all. `read: false` means this
   * payload came from a route that does not read the line's fee columns, which
   * is not the same as the agreement charging nothing.
   */
  fees: { read: boolean; fees: AgreementFees };
  /**
   * The total worked out from the price and ITS unit, with the working in
   * words. `null` when the operands are not all known — never a zero, and never
   * a per-bottle multiplication applied to a per-case price.
   */
  agreement: AgreementTotal | null;
  /** The arithmetic the page can show. Null when it cannot be done honestly. */
  computedTotal: number | null;
  /** The server's own totalPrice, kept separately so a disagreement can be said. */
  listedTotal: number | null;
  /** The figure the page acts on: listed if present, else computed, else null. */
  total: number | null;
  /**
   * The money every amount on this row is in (F-341): the order's own
   * `procurement_orders.currency`, else the house's. Null when neither is
   * recorded, and the row then says "currency not recorded" — never `$`.
   * Absent only on a row built by hand rather than by `toRow`.
   */
  currency?: string | null;
  stage: Stage | 'cancelled';
  status: OrderStatus;
  /**
   * "Refused at door — broken case · credit requested" (F-669, founder S198):
   * the truck was turned away at the door. Null when it was not, or when the
   * door could not be read. A refused order is NEVER called "cancelled", even
   * though it sits off the figures with the cancelled ones; and an order still
   * in transit whose truck was refused says so too. Absent only on a row built
   * by hand rather than by `toRow`.
   */
  refusedAtDoor?: string | null;
  /**
   * "Logged at door · ordered 10 Oct" (F-669): the truck came with no order on
   * file and the door added it to the books. Null when the order was placed
   * the usual way, or when the route did not say.
   */
  loggedAtDoor?: string | null;
  /**
   * Does this order repeat? A MEASURED fact since 2026-09-05 — it was a
   * hardcoded `false` before that, because the route sent nothing. False here
   * now means either "read, and it does not" or "this route did not say"; read
   * `recurrence.read` to tell those apart, and never print "none" off this
   * boolean alone.
   */
  recurring: boolean;
  /** The whole reading, three-state. See `recurrence.ts`. */
  recurrence: RecurrenceReading;
  /** "recurs weekly, next 12 Sep". Null when there is nothing true to say. */
  recurrenceLabel: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  /**
   * The reader is staff and the gateway sent no money for this order (F-441).
   * Every figure above is then null because it was WITHHELD; the row prints no
   * amount and no "not stated" sentence about one.
   */
  amountsWithheld?: boolean;
  /**
   * Bottles still to come, when this order may be closed short (F-826); null
   * or absent when it may not. See `closeShortOwed`.
   */
  closeShortOwedBottles?: number | null;
  /**
   * Bottles a truck is still bringing on a part-delivered order (F-1127); null
   * or absent when none are owed or the ledger did not say. See `stillOwed`.
   */
  stillOwedBottles?: number | null;
}

/**
 * Bottles still owed on a part-delivered order, or null (F-1127). The same
 * reading as the door lane's `stillExpected` (useReceivingNextData.ts): the
 * order less the shelf, less what was sent back at the door or the desk. Unlike
 * `closeShortOwed` it does not wait for the invoice check — the row says the
 * rest is coming whether or not anyone has checked the paper yet. An unread
 * ledger is not "owed": the row would announce a remainder nobody measured.
 */
export function stillOwed(
  status: OrderStatus,
  received: Order['received'] | undefined,
): number | null {
  if (status !== 'partially_received' || !received || received.readable !== true) return null;
  const backorder = received.backorderBottles;
  if (typeof backorder !== 'number' || received.rejectedAtDoorBottles == null) return null;
  const owed =
    backorder - Math.max(0, received.rejectedAtDoorBottles) - Math.max(0, received.rejectedAtDeskBottles ?? 0);
  return owed > 0 ? owed : null;
}

/**
 * The bottles still to come on an order that may be closed short, or null
 * (F-826). The gateway's `decideCloseShort` decides; this mirrors it so the
 * page offers the act only where it can succeed.
 *
 * Partly received is not enough: a door count leaves EVERY order partly
 * received, full ones too, and so does waiting for an invoice. So it is
 * offered only when bottles are still owed — ordered, less the shelf, less
 * what was sent back — and the delivery has been checked against its invoice,
 * since a closed order can no longer be checked. A reading that does not say
 * (unread, or an older gateway without the keys) is null, never an offer.
 */
export function closeShortOwed(
  status: OrderStatus,
  received: Order['received'] | undefined,
): number | null {
  if (status !== 'partially_received' || !received || received.readable !== true) return null;
  const backorder = received.backorderBottles;
  if (typeof backorder !== 'number' || received.invoicedBottles == null) return null;
  const owed =
    backorder - (received.rejectedAtDoorBottles ?? 0) - (received.rejectedAtDeskBottles ?? 0);
  return owed > 0 ? owed : null;
}

export interface MonthFigure {
  /**
   * Sum of known values of COMMITTED orders (approved, ordered, delivered —
   * never a draft, a pending order or a cancelled one) requested this calendar
   * month on the house's clock (F-230). Null = unknown, or the month's orders are in more than one currency: there
   * is no rate to add them by, and `thisMonthByCurrency` then carries each
   * (F-341, the dashboard's per-currency shape from F-339).
   */
  thisMonth: number | null;
  lastMonth: number | null;
  /** One line per currency; the single figure's currency when there is one. */
  thisMonthByCurrency?: MoneyInCurrency[];
  lastMonthByCurrency?: MoneyInCurrency[];
  /** Orders inside this month whose value is unknown — stated, not silently zeroed. */
  unpricedThisMonth: number;
  /** The month's name on the house's clock ("October"); absent before a read. */
  label?: string;
}

/** The stages that are money the house has agreed to spend (F-230). */
const COMMITTED: ReadonlySet<Stage | 'cancelled'> = new Set<Stage | 'cancelled'>([
  'approved',
  'ordered',
  'delivered',
]);

/**
 * Year and month (1-12) of an instant on `zone`'s clock, or null when it cannot
 * be read. A null zone (the house has stated none, or the read failed) falls
 * back to this browser's clock — the only clock left to ask.
 */
export function houseMonthOf(
  t: string | Date | null | undefined,
  zone: string | null,
): { year: number; month: number } | null {
  if (!t) return null;
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  const read = (timeZone: string | undefined) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(d);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return { year: get('year'), month: get('month') };
  };
  try {
    return read(zone ?? undefined);
  } catch {
    return read(undefined); // a zone name this browser cannot read
  }
}

/**
 * "<Month> so far" and "last month": committed orders only, filed by the
 * house's month (F-230). Per currency, never one sum across them (F-341).
 */
export function monthFigureOf(
  rows: OrderRowVM[],
  zone: string | null,
  now: Date = new Date(),
): MonthFigure {
  const here = houseMonthOf(now, zone)!;
  const last =
    here.month === 1
      ? { year: here.year - 1, month: 12 }
      : { year: here.year, month: here.month - 1 };
  const inMonth = (iso: string | null, ref: { year: number; month: number }) => {
    const m = houseMonthOf(iso, zone);
    return !!m && m.year === ref.year && m.month === ref.month;
  };
  const committed = rows.filter((r) => COMMITTED.has(r.stage));
  const sumKnown = (rs: OrderRowVM[]) =>
    sumByCurrency(rs.map((r) => ({ amount: r.total, currency: r.currency })));
  const thisRows = committed.filter((r) => inMonth(r.requestedAt, here));
  const lastRows = committed.filter((r) => inMonth(r.requestedAt, last));
  const thisSum = sumKnown(thisRows);
  const lastSum = sumKnown(lastRows);
  let label: string;
  try {
    label = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: zone ?? undefined }).format(now);
  } catch {
    label = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(now);
  }
  return {
    thisMonth: thisSum.total,
    thisMonthByCurrency: thisSum.byCurrency,
    lastMonth: lastSum.total,
    lastMonthByCurrency: lastSum.byCurrency,
    unpricedThisMonth: thisRows.filter((r) => r.total === null).length,
    label,
  };
}

/**
 * The month figure from the gateway's summary (F-1368): the same committed
 * orders and house month `monthFigureOf` reads, summed over the whole book
 * on the server instead of over the rows this page happens to hold. An order
 * that names no currency is filed under the house's, as `toRow` files it.
 */
export function monthFigureFromSummary(
  summary: OrderBookSummary,
  houseCurrency: string | null,
): MonthFigure {
  if (!summary.thisMonth || !summary.lastMonth) {
    return { thisMonth: null, lastMonth: null, unpricedThisMonth: 0 };
  }
  const sum = (m: NonNullable<OrderBookSummary['thisMonth']>) =>
    sumByCurrency(m.byCurrency.map((c) => ({ amount: c.amount, currency: c.currency ?? houseCurrency })));
  const thisSum = sum(summary.thisMonth);
  const lastSum = sum(summary.lastMonth);
  const [year, month] = summary.thisMonth.month.split('-').map(Number);
  const label =
    Number.isInteger(year) && Number.isInteger(month)
      ? new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(
          new Date(Date.UTC(year, month - 1, 15)),
        )
      : undefined;
  return {
    thisMonth: thisSum.total,
    thisMonthByCurrency: thisSum.byCurrency,
    lastMonth: lastSum.total,
    lastMonthByCurrency: lastSum.byCurrency,
    unpricedThisMonth: summary.thisMonth.unpriced,
    label,
  };
}

/**
 * What this house's approval rules say about one pending order.
 *
 * `GET /procurement/order-approval-gate`, one call for the whole house. The
 * facts the rules test — whether this is the first order to a vendor, how far
 * the price is above what the house last paid — are a single walk through the
 * order ledger, so they are computed there and never here: a browser cannot see
 * the ledger, and a per-row call would recompute the walk once per row and still
 * not agree with itself.
 */
export interface ApprovalGateRow {
  orderId: string;
  requiredRole: 'owner' | 'manager' | null;
  firedBy: string[];
  reasons: string[];
  untestable: string[];
  mayApprove: boolean;
  /** The whole sentence, when the caller may not seal it. Null when they may. */
  sentence: string | null;
}

/**
 * A house rule in words (F-1129): the gateway sends rule ids, and a person
 * reading "manager_ceiling" learns nothing. Same names /settings gives them.
 */
const APPROVAL_RULE_WORDS: Record<string, string> = {
  manager_ceiling: 'the spending ceiling',
  new_vendor: 'the first order to a vendor',
  price_jump: 'a price above what the house last paid',
};

export function approvalRuleWords(rules: string[]): string {
  return rules.map((r) => APPROVAL_RULE_WORDS[r] ?? 'a house rule').join('; ');
}

export interface ApprovalGate {
  restaurantId: string;
  callerRole: string | null;
  policySet: boolean;
  policyNote: string;
  readable: boolean;
  reason: string | null;
  orders: ApprovalGateRow[];
}

export interface OrdersNextData {
  rows: OrderRowVM[];
  /** Station counts. Null while unknown (loading with no cache, or errored). */
  counts: Record<Stage, number | null>;
  recurringCount: number | null;
  /**
   * How many rows CARRIED a recurrence reading, out of `rows.length`. Null
   * while unknown. The Recurring station may say "none" only when this equals
   * the row count and `recurringCount` is zero; anything less and it says what
   * it does not know instead. See `emptyStationSentence`.
   */
  recurrenceReadCount: number | null;
  cancelledCount: number | null;
  /**
   * Orders closed because the truck was refused at the door (F-669), counted
   * apart from `cancelledCount` and never added to it. Null while unknown —
   * an older gateway that does not send it — never a guessed zero. Absent
   * only on data built by hand.
   */
  refusedCount?: number | null;
  month: MonthFigure;
  /** The house's currency, for a figure with no order behind it (an empty month). */
  houseCurrency?: string | null;
  /**
   * The reader is staff: the list came with no money (F-441), so the month
   * figure stays null and the header says so in words instead of "$0".
   */
  amountsWithheld?: boolean;
  /**
   * True only once the orders list has actually arrived. While false, an empty
   * `rows` means UNKNOWN (fetching, retrying, or waiting on a restaurant
   * context) — never "no orders". The page must not claim an empty book on it.
   */
  hasData: boolean;
  /**
   * When the rows on screen were last read (ms epoch), or null before the
   * first read. A re-read that fails keeps the last rows — the page says how
   * old they are instead of calling them unknown (ORD-W15).
   */
  dataUpdatedAt: number | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  refetch: () => void;
  /** How many orders the house has in all, when known; `rows` is the newest of them. */
  totalInBook?: number | null;
  /** Reads the next older page; null when every order is already loaded. */
  loadOlder?: (() => void) | null;
  loadingOlder?: boolean;
  /**
   * The order a link asked for is outside the loaded rows and is being read
   * on its own. While true, the page must not say it was not found.
   */
  targetPending?: boolean;
  /**
   * Per-order approval verdicts, keyed by order id. `null` while the gate has
   * not been read, so an absent entry can never be mistaken for "anyone may
   * seal this" — the page renders the ceremony as it always did until the gate
   * actually answers.
   */
  approvalByOrder: Map<string, ApprovalGateRow> | null;
  /** Why the gate could not be read. Rendered in words, never swallowed. */
  approvalGateError: string | null;
  /** The house's policy in one sentence, once the gate has answered. */
  approvalPolicyNote: string | null;
  /**
   * The reader's role here, once the gate has answered (`null` = no role could
   * be shown). `undefined` while it has not answered — never read as staff.
   */
  approvalCallerRole?: string | null;
}

/** The order's own quantity unit, when it is one of the seven the schema allows. */
function readUnitType(v: unknown): PriceUom | null {
  const raw = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (PRICE_UOMS as readonly string[]).includes(raw) ? (raw as PriceUom) : null;
}

/**
 * One wire row into one ledger row. Exported so the mapping can be tested on
 * the payload `GET /procurement/orders` ACTUALLY sends — the defect this pass
 * found lived entirely in the key names, and a test that builds an `OrderRowVM`
 * by hand cannot see a key name that was never read.
 */
/**
 * The door's own words for a refused truck (F-669). The gateway sends them on
 * `doorRefusal`; a FAILED order from a route that does not read the door
 * still says "Refused at door", because FAILED has no other writer than a
 * refused truck (delivery.service.ts failRefusedOrder) — never "Cancelled".
 */
export function refusedAtDoorLabel(o: Pick<Order, 'status' | 'doorRefusal'>): string | null {
  const label = o.doorRefusal?.label;
  if (typeof label === 'string' && label.trim()) return label;
  return String(o.status ?? '').toUpperCase() === 'FAILED' ? 'Refused at door' : null;
}

/**
 * The words for an order the door wrote for a truck with no order on file
 * (F-669): "Logged at door", and the day it was ordered when the door knew it.
 */
export function loggedAtDoorLabel(o: Pick<OrderWire, 'loggedAtDoor' | 'placedOnStated'>): string | null {
  if (o.loggedAtDoor !== true) return null;
  const day = typeof o.placedOnStated === 'string' ? Date.parse(`${o.placedOnStated}T00:00:00Z`) : NaN;
  if (Number.isNaN(day)) return 'Logged at door';
  const said = new Date(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `Logged at door · ordered ${said}`;
}

export function toRow(
  o: OrderWire,
  providerNameById: Map<string, string>,
  /** The house's own currency, for an order that names none (F-341). */
  houseCurrency: string | null = null,
  /** The house's group mark, for the working's figures (F-942). */
  group: GroupMark | null = null,
): OrderRowVM {
  const status = canonicalStatus(o.status);
  const quantity = num(o.quantity);

  /*
   * `finalPrice` and `totalCost` FIRST, because those are the keys the route
   * actually sends.
   *
   * `OrderResponseDto` has always called them that (`mapOrderRow`); the shared
   * `Order` type calls them `unitPrice` / `totalPrice`, which appear nowhere in
   * the list route's payload. Reading only the shared names made both figures
   * `undefined` for every live row, so `total` was null and the ledger printed
   * an em dash in the money column, the working line, and the seal's own label
   * ("Hold to approve · —"). The em dash was honest about a number the page did
   * not have; it was not honest about WHY. Proven by `LedgerUnit.test.tsx`
   * case 1, which fails against the pre-fix hook.
   *
   * The `?? o.unitPrice` / `?? o.totalPrice` fallbacks that stood here until
   * 2026-09-05 are gone with the keys themselves: the shared type no longer
   * declares a name the route does not send, so there is nothing to fall back
   * to and nothing that could quietly supply one.
   */
  const unitPrice = num(o.finalPrice);
  const listedTotal = num(o.totalCost);
  const bottlesTotal = num(o.bottlesTotal);
  const unitType = readUnitType(o.unitType);
  const priceUnit = readPriceUnitFromWire(o);
  const fees = readFeesFromWire(o);
  const currency =
    (typeof o.currency === 'string' && /^[A-Za-z]{3}$/.test(o.currency.trim())
      ? o.currency.trim().toUpperCase()
      : null) ?? houseCurrency;

  /*
   * The working, drawn from the PRICE's unit — the same arithmetic the gateway
   * did (`agreedOrderTotal`), via the same function `AgreementSheet` shows
   * before saving.
   *
   * ATTEMPTED ONLY WHEN THE PRICE'S UNIT IS STATED, and that guard is the whole
   * point rather than a cheap exit. `agreementTotal` will happily total an
   * UNSTATED price on "the old per-bottle convention" — the gateway does the
   * same when it writes `total_cost`, and it must, because a stored total
   * cannot be null. A PAGE has no such obligation, and printing that figure was
   * measurably worse than printing nothing: the first capture of this row
   * (2026-09-05, `$SP/shots-ledger-unit/`) showed a $420-per-case agreement
   * whose unit was unstated rendering "60 × $420.00 = $25,200.00" in bold
   * beside the ledger's own $2,100.00 — the exact twelve-times error ADR 0119
   * exists to end, reprinted by the screen that was built to end it. An
   * unstated unit now yields NO working, and the row says why.
   *
   * The other two operands — the order's own unit, and how many bottles are in
   * one of them — are required for the same reason: defaulting `bottlesPerUnit`
   * to 1 is the per-bottle assumption wearing a different hat.
   */
  const bottlesPerUnit =
    quantity !== null && quantity > 0 && bottlesTotal !== null && bottlesTotal > 0
      ? bottlesTotal / quantity
      : null;
  const agreement =
    priceUnit.stated !== null && unitType !== null && bottlesPerUnit !== null
      ? agreementTotal({
          price: unitPrice,
          stated: priceUnit.stated,
          quantity,
          unitType,
          bottlesPerUnit,
          // Only what the route actually read. A row whose fee columns were
          // never selected totals the goods alone — which is what it did before
          // ADR 0119 phase 2 — rather than a total built on three assumed
          // zeroes.
          fees: fees.read ? fees.fees : undefined,
          currency,
          group,
        })
      : null;
  const computedTotal = agreement && agreement.ok ? agreement.total : null;

  /*
   * The route sends NO producer and NO notes. Both were read off the shared
   * `Order` type until 2026-09-05 and both were `undefined` on every live row:
   *
   *   providerName  the vendor was ALREADY resolved from `providerId` through
   *                 the providers query, so the page was right by accident —
   *                 `rawProvider` never once won that `??`. [changed
   *                 2026-10-01, ORD-W4: the route now joins `providers` and
   *                 sends `providerName`; it is read first, below.]
   *   producer      always null, so the row's producer line never rendered.
   *   notes         always null, so the note clause never rendered.
   *
   * Reading them again would need the route to send them; asserting them from
   * absence is the fault this whole pass exists to remove.
   *
   * RECURRENCE IS NO LONGER ON THAT LIST. It was, and it was the worst of the
   * four: `const recurring = false` meant the Recurring station could never
   * fill and every order fell into "one-time". `GET /procurement/orders` now
   * sends six recurrence keys (ADR 0125's addendum; the founder's decision of
   * 2026-09-05, "build recurrence on the order"), and `readRecurrence` reads
   * them with the same three-state discipline as the price unit — a value, a
   * null, or the key absent. `recurring` is now a MEASURED fact, and the
   * station may say "none" only when it has one.
   */
  const recurrence = readRecurrence(o as unknown as Record<string, unknown>);
  const recurring = isRecurring(recurrence);
  return {
    id: o.id,
    orderNumber: o.orderNumber ?? null,
    wineName: o.wineName && !isUuid(o.wineName) ? o.wineName : null,
    producer: null,
    // The route's own join first (ORD-W4, 2026-10-01): `GET /procurement/orders`
    // now sends `providerName`, and a vendor with no house of its own is absent
    // from the house's providers list, so the list alone printed "—" for a
    // vendor the order names. The list stays as the fallback for a route that
    // did not join (the key absent).
    providerName:
      (typeof o.providerName === 'string' && o.providerName.trim() ? o.providerName : null) ??
      providerNameById.get(o.providerId) ??
      null,
    quantity,
    unitPrice,
    bottlesTotal,
    unitType,
    priceUnit,
    fees,
    agreement,
    computedTotal,
    listedTotal,
    total: listedTotal ?? computedTotal,
    currency,
    stage: stageOf(status),
    status,
    refusedAtDoor: refusedAtDoorLabel(o),
    loggedAtDoor: loggedAtDoorLabel(o),
    recurring,
    recurrence,
    recurrenceLabel: recurrenceLabel(recurrence),
    requestedAt: o.requestedAt ?? null,
    approvedAt: o.approvedAt ?? null,
    deliveredAt: o.deliveredAt ?? null,
    notes: null,
    amountsWithheld: o.amountsWithheld === true,
    closeShortOwedBottles: closeShortOwed(status, o.received),
    stillOwedBottles: stillOwed(status, o.received),
  };
}

export function useOrdersNextData(targetOrderId: string | null = null): OrdersNextData {
  const { activeRestaurantId, user } = useAuth();
  const restaurantId = activeRestaurantId || user?.restaurantId || '';
  // The newest orders, page by page, and the whole book's figures (F-1368).
  const windowQuery = useOrderWindow();
  const providersQuery = useProviders(restaurantId);

  const windowOrders = useMemo(() => {
    const pages = windowQuery.data?.pages;
    if (!pages) return undefined;
    // An order that moved onto the next page while it was read is one order.
    const byId = new Map<string, Order>();
    for (const p of pages) for (const o of p.orders) if (o?.id) byId.set(o.id, o);
    return [...byId.values()];
  }, [windowQuery.data]);

  // A link to an order older than the loaded rows reads that order alone, so
  // `?order=` still opens it in a large house (F-1368).
  const targetOutside =
    !!targetOrderId && !!windowOrders && !windowOrders.some((o) => o.id === targetOrderId);
  const targetQuery = useQuery({
    queryKey: queryKeys.orders.detail(targetOrderId ?? ''),
    queryFn: () => getOrder(targetOrderId!, restaurantId),
    enabled: targetOutside && !!restaurantId,
    retry: false,
  });

  // Tenant-keyed: a restaurant switch must never carry the previous house's
  // verdicts. `retry: false` because a 403/500 here is a real state the page
  // renders in words — silently retrying would make the page look like it is
  // still loading while it has an answer.
  //
  // Keyed under the orders key (F-1128): the gate is a verdict on the pending
  // orders, so whatever re-reads them (the socket, a placement, an edit, an
  // approval) must re-read it too. Under its own key it was read once, and a
  // new order showed an armed Approve die to someone who may not seal it.
  const gateQuery = useQuery<ApprovalGate>({
    queryKey: [...queryKeys.orders.all, 'approval-gate', restaurantId],
    enabled: !!restaurantId,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.get<ApprovalGate>(
        '/procurement/order-approval-gate',
      );
      return data;
    },
  });

  // The house's money, for an order that names none (F-341). Same key as the
  // vendors page, so one read serves both. A failed read leaves it null and
  // such an order says "currency not recorded" — never dollars.
  const houseCurrencyQuery = useQuery({
    queryKey: ['settings', 'currency', restaurantId],
    queryFn: () => settingsApi.houseCurrency(),
    enabled: !!restaurantId,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const houseCurrency =
    houseCurrencyQuery.data?.readable && houseCurrencyQuery.data.code
      ? houseCurrencyQuery.data.code
      : null;

  // The working on each row is said in the house's marks (F-942).
  const group = useHouseGroupMark();

  const providerNameById = useMemo(() => {
    const map = new Map<string, string>();
    (providersQuery.data ?? []).forEach((p) => {
      if (p?.id && p?.name) map.set(p.id, p.name);
    });
    return map;
  }, [providersQuery.data]);

  return useMemo(() => {
    const known = Array.isArray(windowOrders);
    const target = targetOutside && targetQuery.data?.id === targetOrderId ? [targetQuery.data] : [];
    const rows = known
      ? [...windowOrders, ...target].map((o) => toRow(o, providerNameById, houseCurrency, group))
      : [];
    const summary = windowQuery.data?.pages[0]?.summary;

    const counts: Record<Stage, number | null> = {
      pending: null,
      approved: null,
      ordered: null,
      delivered: null,
    };
    let recurringCount: number | null = null;
    let recurrenceReadCount: number | null = null;
    let cancelledCount: number | null = null;
    let refusedCount: number | null = null;
    let month: MonthFigure = { thisMonth: null, lastMonth: null, unpricedThisMonth: 0 };

    const amountsWithheld =
      rows.some((r) => r.amountsWithheld) || summary?.amountsWithheld === true;

    // The spine and the month are the gateway's, over the whole book, never
    // the length of the rows loaded here (F-1368).
    if (summary) {
      for (const s of STAGES) counts[s] = summary.counts[s] ?? null;
      recurringCount = summary.recurring;
      cancelledCount = summary.cancelled;
      refusedCount = typeof summary.refused === 'number' ? summary.refused : null;
      // Withheld is not unpriced: a staff list summed to $0 here (F-441).
      if (!amountsWithheld) month = monthFigureFromSummary(summary, houseCurrency);
    }

    if (known) {
      /*
       * HOW MANY ROWS ACTUALLY ANSWERED THE QUESTION.
       *
       * `recurringCount === 0` on its own has two meanings — "none of these
       * repeats" and "this route never said" — and the station is not allowed
       * to print the first when it only has grounds for the second. This count
       * is what tells them apart, and `emptyStationSentence` is what turns it
       * into words. Before 2026-09-05 the answer was ALWAYS the second one and
       * the station showed nothing without saying so.
       */
      recurrenceReadCount = rows.filter((r) => r.recurrence.read).length;
    }


    // A gate that has not answered is `null`, not an empty map: an empty map
    // reads as "every order is unrestricted", which is the one thing an
    // unanswered gate must never be taken to mean.
    const gate = gateQuery.data ?? null;
    const approvalByOrder =
      gate && gate.readable
        ? new Map(gate.orders.map((o) => [o.orderId, o]))
        : null;
    const approvalGateError = gateQuery.isError
      ? readFailureWords(gateQuery.error)
      : gate && !gate.readable
        ? gate.reason ?? 'the approval rules could not be read'
        : null;

    return {
      houseCurrency,
      approvalByOrder,
      approvalGateError,
      approvalPolicyNote: gate?.readable ? gate.policyNote : null,
      approvalCallerRole: gate?.readable ? gate.callerRole : undefined,
      rows,
      counts,
      recurringCount,
      recurrenceReadCount,
      cancelledCount,
      refusedCount,
      month,
      amountsWithheld,
      hasData: known,
      dataUpdatedAt: known && windowQuery.dataUpdatedAt ? windowQuery.dataUpdatedAt : null,
      isLoading: windowQuery.isLoading,
      isError: windowQuery.isError,
      // Plain words, never axios's "Request failed with status code 429" (F-403).
      errorMessage: windowQuery.isError ? readFailureWords(windowQuery.error) : null,
      // The verdicts are re-read with the orders they judge (F-1128).
      refetch: () => {
        void windowQuery.refetch();
        void gateQuery.refetch();
      },
      totalInBook: summary?.total ?? windowQuery.data?.pages[0]?.total ?? null,
      loadOlder: windowQuery.hasNextPage ? () => void windowQuery.fetchNextPage() : null,
      loadingOlder: windowQuery.isFetchingNextPage,
      targetPending: targetOutside && targetQuery.isLoading,
    };
  }, [windowOrders, windowQuery.isLoading, windowQuery.isError, windowQuery.error, windowQuery.refetch, windowQuery.dataUpdatedAt, windowQuery.data, windowQuery.hasNextPage, windowQuery.fetchNextPage, windowQuery.isFetchingNextPage, targetOrderId, targetOutside, targetQuery.data, targetQuery.isLoading, providerNameById, houseCurrency, group, gateQuery.data, gateQuery.isError, gateQuery.error, gateQuery.refetch]);
}
