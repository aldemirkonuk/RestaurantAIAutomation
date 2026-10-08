/**
 * OrdersNext view model — live data only, assembled from the EXISTING hooks
 * (useOrderBook since PR-B of ADR 0269, useProviders); nothing here invents a
 * number. The five-stage spine the founder kept (pending · approved · ordered ·
 * delivered · recurring) is derived from the canonical OrderStatus set via
 * normalizeOrderStatus, with
 * `recurring` orthogonal: a repeating order sits in the recurring station
 * whatever its current status, exactly as the legacy page bucketed it.
 *
 * Unknowns are null and render as em dashes downstream — a failed query is not
 * an empty ledger, and a missing price is not $0.00.
 */

import axios from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient, getErrorStatus } from '@/services/api/client';
import { readOlderPage, useOrderBook, useOrderBookFreshness } from '@/hooks/queries/useOrderBook';
import { useProviders } from '@/hooks/queries/useProviderQueries';
import {
  BookShapeError,
  fetchOrderById,
  ForeignRowError,
  HouseChangedError,
  isOpenOrderStatus,
  markFor,
  RateLimitedError,
  type OrderBook,
  type OrderMark,
} from '@/services/api/order-book';
import { type Order, type OrderStatus } from '@/services/api/types';
import { num } from './format';
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
  stage: Stage | 'cancelled';
  status: OrderStatus;
  /**
   * What an open arrival still owes, in the founder's words (2026-10-03, ADR
   * 0269), from `markFor`; null for every order that is not an open arrival.
   * Always set by `toRow`; optional only so a row built by hand in a test need
   * not name it.
   */
  mark?: OrderMark | null;
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
}

export interface MonthFigure {
  /** Sum of known order values created this calendar month (cancelled excluded). Null = unknown. */
  thisMonth: number | null;
  lastMonth: number | null;
  /** Orders inside this month whose value is unknown — stated, not silently zeroed. */
  unpricedThisMonth: number;
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
  month: MonthFigure;
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
  /** What the read covered, so the page can say so. */
  book: BookStateView;
  /** A deep-linked order not among the rows read, asked for on its own. */
  target: TargetLookup;
}

export interface OlderReads {
  /** True while a page past those read is known to exist (capped read only). */
  canRead: boolean;
  reading: boolean;
  /** House words, or null. */
  error: string | null;
  /**
   * Read until `need` more finished one-time orders arrived, at most OLDER_PAGES_PER_TAP pages.
   * Resolves true when the read ended without an error (it may have found fewer, at the end),
   * false on an error or an abort. The page counts a tap only on true (Attack ledger 5).
   */
  read: (need: number) => Promise<boolean>;
}

export interface BookStateView {
  mode: 'whole' | 'capped' | 'partial' | null; // null: not read yet
  total: number | null;
  readCount: number;
  openComplete: boolean | null;
  unreadableStates: number | null; // OrderBook.unclassifiedCount
  deliveredAtLeast: number | null;
  recurringAtLeast: number | null;
  older: OlderReads;
}

export type TargetLookup =
  | { state: 'none' }
  | { state: 'checking' }
  | { state: 'found' }
  | { state: 'unreadable'; /** Asks again, with the same retries. */ retry: () => void };

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
export function toRow(o: OrderWire, providerNameById: Map<string, string>): OrderRowVM {
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
    stage: stageOf(status),
    status,
    mark: markFor(o),
    recurring,
    recurrence,
    recurrenceLabel: recurrenceLabel(recurrence),
    requestedAt: o.requestedAt ?? null,
    approvedAt: o.approvedAt ?? null,
    deliveredAt: o.deliveredAt ?? null,
    notes: null,
  };
}

/**
 * Finished orders Show older adds per tap, and how many a station with nothing
 * open opens on (founder, 2026-10-02 List and 2026-10-03 Empty tab).
 */
export const OLDER_STEP = 50;

/** Pages one Show older tap reads past the cap, at most. */
const OLDER_PAGES_PER_TAP = 5;

export interface StationView {
  /** Open orders here, newest first: always every one. */
  open: OrderRowVM[];
  /** Finished orders shown, newest first, plus a deep-linked one wherever it falls. */
  finished: OrderRowVM[];
  /** Finished orders here that are read but not shown yet. */
  hiddenFinished: number;
}

/**
 * What one station lists (ADR 0269, PR-B). Every open order is shown; finished
 * ones come in under Show older, `OLDER_STEP` a tap. Openness is computed from
 * the status here, never stored.
 */
export function stationView(
  rows: OrderRowVM[],
  station: Stage | 'recurring' | null,
  taps: number,
  targetId: string | null,
  keepFirstFifty: boolean,
): StationView {
  const byDate = (a: OrderRowVM, b: OrderRowVM) =>
    new Date(b.requestedAt ?? 0).getTime() - new Date(a.requestedAt ?? 0).getTime();
  // Fork 5 (ADR 0269): the Recurring station lists as before.
  if (station === 'recurring') {
    return { open: rows.filter((r) => r.recurring).sort(byDate), finished: [], hiddenFinished: 0 };
  }
  const oneTime = rows.filter((r) => !r.recurring && r.stage !== 'cancelled');
  const here = station === null ? oneTime : oneTime.filter((r) => r.stage === station);
  const open = here.filter((r) => isOpenOrderStatus(r.status)).sort(byDate);
  const allFinished = here.filter((r) => !isOpenOrderStatus(r.status)).sort(byDate);
  // Empty tab ruling: nothing open opens on the newest 50; fork 8: once shown, kept.
  const shown = OLDER_STEP * taps + (open.length === 0 || keepFirstFifty ? OLDER_STEP : 0);
  const finished = allFinished.filter((r, i) => i < shown || r.id === targetId);
  return { open, finished, hiddenFinished: allFinished.length - finished.length };
}

export interface BookFigures {
  /** Station counts. Null while unknown, or when the read cannot back them. */
  counts: Record<Stage, number | null>;
  recurringCount: number | null;
  cancelledCount: number | null;
  month: MonthFigure;
  /** Capped or partial read: delivered one-time orders read, a floor. Null in a whole read. */
  deliveredAtLeast: number | null;
  /** Capped or partial read: recurring orders read, a floor. Null in a whole read. */
  recurringAtLeast: number | null;
}

const UNKNOWN_FIGURES: BookFigures = {
  counts: { pending: null, approved: null, ordered: null, delivered: null },
  recurringCount: null,
  cancelledCount: null,
  month: { thisMonth: null, lastMonth: null, unpricedThisMonth: 0 },
  deliveredAtLeast: null,
  recurringAtLeast: null,
};

/**
 * The spine's counts and the month figures from the book's own rows (never
 * older or looked-up rows). A whole read counts every order. A capped or
 * partial read did not see every order, so a figure it cannot back is null
 * and the page says the floor it read instead (ADR 0269 fork 9).
 */
export function figuresFor(book: OrderBook, rows: OrderRowVM[], now: Date): BookFigures {
  const oneTime = rows.filter((r) => !r.recurring);
  const seen = (s: Stage) => oneTime.filter((r) => r.stage === s).length;

  if (book.mode === 'whole') {
    const counts: Record<Stage, number | null> = {
      pending: null,
      approved: null,
      ordered: null,
      delivered: null,
    };
    for (const s of STAGES) counts[s] = seen(s);
    const recurringCount = rows.filter((r) => r.recurring).length;
    const cancelledCount = rows.filter((r) => r.stage === 'cancelled').length;

    const month: MonthFigure = { thisMonth: null, lastMonth: null, unpricedThisMonth: 0 };
    const inMonth = (iso: string | null, ref: Date) => {
      if (!iso) return false;
      const d = new Date(iso);
      return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
    };
    const lastRef = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const active = rows.filter((r) => r.stage !== 'cancelled');
    const sumKnown = (rs: OrderRowVM[]) =>
      rs.reduce((s, r) => s + (r.total ?? 0), 0);
    const thisRows = active.filter((r) => inMonth(r.requestedAt, now));
    const lastRows = active.filter((r) => inMonth(r.requestedAt, lastRef));
    month.thisMonth = sumKnown(thisRows);
    month.lastMonth = sumKnown(lastRows);
    month.unpricedThisMonth = thisRows.filter((r) => r.total === null).length;
    return { counts, recurringCount, cancelledCount, month, deliveredAtLeast: null, recurringAtLeast: null };
  }

  // Capped or partial: the cancelled count is the gateway's per-status count,
  // and an open station is exact only when every open order was read.
  const t = book.statusTotals;
  const parts = t ? [t.CANCELLED, t.REJECTED, t.FAILED] : [];
  const cancelledCount =
    parts.length === 3 && parts.every((n) => Number.isInteger(n))
      ? parts.reduce<number>((sum, n) => sum + (n as number), 0)
      : null;
  const open = (s: Stage) => (book.openComplete ? seen(s) : null);
  return {
    counts: { pending: open('pending'), approved: open('approved'), ordered: open('ordered'), delivered: null },
    recurringCount: null,
    cancelledCount,
    month: { thisMonth: null, lastMonth: null, unpricedThisMonth: 0 },
    deliveredAtLeast: seen('delivered'),
    recurringAtLeast: rows.filter((r) => r.recurring).length,
  };
}

/**
 * A reader error in the house's words. Never the error's own message: the
 * reader's messages say "order book" and "page" (order-book.ts:170-217).
 */
export function orderBookErrorWords(error: unknown): string {
  if (error instanceof RateLimitedError) return 'too many reads in a short time';
  if (error instanceof ForeignRowError) return 'an order of another house came back, so nothing from that read was used';
  if (error instanceof BookShapeError) return 'an answer came back that this screen cannot read';
  if (error instanceof HouseChangedError) return 'the house was switched during the read';
  const status = getErrorStatus(error);
  if (status !== null) return `an error came back, code ${status}`;
  if (axios.isAxiosError(error) && !error.response) return 'no answer came back';
  return 'something unexpected went wrong while reading';
}

interface OlderState {
  house: string;
  /** The next page past those read; null until the first older read. */
  cursor: number | null;
  orders: Order[];
  reading: boolean;
  error: string | null;
  done: boolean;
}

const noOlder = (house: string): OlderState => ({
  house,
  cursor: null,
  orders: [],
  reading: false,
  error: null,
  done: false,
});

const NO_ORDERS: Order[] = [];

/**
 * Show older past the cap (ADR 0269, PR-B): pages after the newest 3,000, read
 * on from `book.nextClosedPage` through the runner's window and 429 gate
 * (`readOlderPage`). Kept per house; a house switch or unmount aborts a read
 * under way, and a book that is no longer capped starts again at none.
 */
function useOlderReads(
  house: string,
  book: OrderBook | undefined,
  providerNameById: Map<string, string>,
): { orders: Order[]; older: OlderReads } {
  const [state, setState] = useState<OlderState>(() => noOlder(house));
  const controller = useRef<AbortController | null>(null);
  const capped = book?.mode === 'capped';
  const live = state.house === house && capped ? state : null;

  useEffect(() => {
    if (state.house !== house || (!capped && state.cursor !== null)) setState(noOlder(house));
  }, [house, capped, state.house, state.cursor]);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [house, capped],
  );

  const cursor = live?.cursor ?? book?.nextClosedPage ?? null;
  const canRead = capped && cursor !== null && !live?.done;

  const read = useCallback(
    async (need: number): Promise<boolean> => {
      if (!book || book.mode !== 'capped' || cursor === null || live?.done) return false;
      controller.current?.abort();
      const ctl = new AbortController();
      controller.current = ctl;
      const { signal } = ctl;
      const forHouse = house;
      const known = new Set<string>(book.rows.map((o) => o.id));
      live?.orders.forEach((o) => known.add(o.id));
      const mine = (s: OlderState) => s.house === forHouse;
      setState((s) => ({ ...(mine(s) ? s : noOlder(forHouse)), reading: true, error: null }));
      let page = cursor;
      let found = 0;
      try {
        for (let i = 0; i < OLDER_PAGES_PER_TAP && found < need; i++) {
          const answer = await readOlderPage(forHouse, page, signal);
          if (signal.aborted) return false;
          const added = answer.orders.filter((o) => !known.has(o.id));
          for (const o of added) {
            known.add(o.id);
            const r = toRow(o, providerNameById);
            if (!r.recurring && r.stage !== 'cancelled' && !isOpenOrderStatus(r.status)) found++;
          }
          page = answer.page + 1;
          const done = !answer.hasMore;
          const next = page;
          // Pages that landed stay, even when a later one fails.
          setState((s) =>
            mine(s) ? { ...s, cursor: next, orders: [...s.orders, ...added], done } : s,
          );
          if (done) break;
        }
        setState((s) => (mine(s) ? { ...s, reading: false } : s));
        return true;
      } catch (error) {
        if (signal.aborted) return false;
        setState((s) => (mine(s) ? { ...s, reading: false, error: orderBookErrorWords(error) } : s));
        return false;
      }
    },
    [book, cursor, live, house, providerNameById],
  );

  const reading = live?.reading ?? false;
  const error = live?.error ?? null;
  const older = useMemo<OlderReads>(
    () => ({ canRead, reading, error, read }),
    [canRead, reading, error, read],
  );
  return { orders: live?.orders ?? NO_ORDERS, older };
}

export function useOrdersNextData(targetOrderId: string | null = null): OrdersNextData {
  const { activeRestaurantId, user } = useAuth();
  const restaurantId = activeRestaurantId || user?.restaurantId || '';
  // The key useOrderBook reads under (useOrderBook.ts), not `restaurantId`.
  const house = activeRestaurantId ?? '';
  const bookQuery = useOrderBook();
  const freshness = useOrderBookFreshness(house);
  const providersQuery = useProviders(restaurantId);

  // Tenant-keyed: a restaurant switch must never carry the previous house's
  // verdicts. `retry: false` because a 403/500 here is a real state the page
  // renders in words — silently retrying would make the page look like it is
  // still loading while it has an answer.
  const gateQuery = useQuery<ApprovalGate>({
    queryKey: ['procurement', 'order-approval-gate', restaurantId],
    enabled: !!restaurantId,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.get<ApprovalGate>(
        '/procurement/order-approval-gate',
      );
      return data;
    },
  });

  const providerNameById = useMemo(() => {
    const map = new Map<string, string>();
    (providersQuery.data ?? []).forEach((p) => {
      if (p?.id && p?.name) map.set(p.id, p.name);
    });
    return map;
  }, [providersQuery.data]);

  const book = bookQuery.data;
  const { orders: olderOrders, older } = useOlderReads(house, book, providerNameById);

  /*
   * A deep-linked order that is not among the rows read is asked for on its
   * own before the page says anything about it. Found, it is listed but never
   * counted, and it is not refreshed while the page stays open.
   */
  const inBook = !!targetOrderId && !!book && book.rows.some((o) => o.id === targetOrderId);
  const lookupQuery = useQuery({
    // Outside ['orders'] on purpose: every orders invalidation would re-ask for it.
    queryKey: ['order-lookup', house, targetOrderId],
    enabled: !!house && !!targetOrderId && !!book && !inBook && !bookQuery.isError,
    queryFn: async ({ signal }) => {
      const found = await fetchOrderById(house, targetOrderId as string, signal);
      // fetchOrderById reads an abort as 'unreadable'; never keep that.
      if (signal.aborted) throw signal.reason ?? new Error('aborted');
      // It also folds a 429, a timeout and the gateway's not-found 500 into
      // 'unreadable' (order-book.ts:552-577), so none of them is final: throw,
      // and let the query try again.
      if (found.state !== 'read') throw new Error('order lookup unreadable');
      return found.order;
    },
    staleTime: Infinity,
    gcTime: 0,
    retry: 2, // TanStack's default delay: 1 s, then 2 s
  });
  const foundOrder = lookupQuery.data;
  const lookupRefetch = lookupQuery.refetch;
  const lookupFailed = lookupQuery.isError && !lookupQuery.isFetching;
  const target = useMemo<TargetLookup>(
    () =>
      !targetOrderId || !book || inBook || bookQuery.isError
        ? { state: 'none' }
        : foundOrder
          ? { state: 'found' }
          : lookupFailed
            ? { state: 'unreadable', retry: () => void lookupRefetch() }
            : { state: 'checking' },
    [targetOrderId, book, inBook, bookQuery.isError, foundOrder, lookupFailed, lookupRefetch],
  );

  return useMemo(() => {
    const known = !!book;
    const bookRows = book ? book.rows.map((o) => toRow(o, providerNameById)) : [];
    // Counts come from the book's rows only: never older or looked-up rows.
    const figures = book ? figuresFor(book, bookRows, new Date()) : UNKNOWN_FIGURES;

    const rows = [...bookRows];
    const present = new Set(rows.map((r) => r.id));
    for (const o of olderOrders) {
      if (present.has(o.id)) continue;
      present.add(o.id);
      rows.push(toRow(o, providerNameById));
    }
    if (foundOrder && !present.has(foundOrder.id)) rows.push(toRow(foundOrder, providerNameById));

    /*
     * HOW MANY ROWS ACTUALLY ANSWERED THE QUESTION.
     *
     * `recurringCount === 0` on its own has two meanings — "none of these
     * repeats" and "this route never said" — and the station is not allowed
     * to print the first when it only has grounds for the second. This count
     * is what tells them apart, and `emptyStationSentence` is what turns it
     * into words. Before 2026-09-05 the answer was ALWAYS the second one and
     * the station showed nothing without saying so. It counts the same rows
     * the page compares it with (`data.rows.length`), older and looked-up
     * ones included (ADR 0269, PR-B).
     */
    const recurrenceReadCount = known ? rows.filter((r) => r.recurrence.read).length : null;

    // A gate that has not answered is `null`, not an empty map: an empty map
    // reads as "every order is unrestricted", which is the one thing an
    // unanswered gate must never be taken to mean.
    const gate = gateQuery.data ?? null;
    const approvalByOrder =
      gate && gate.readable
        ? new Map(gate.orders.map((o) => [o.orderId, o]))
        : null;
    const gateErr = gateQuery.error as { message?: string } | null;
    const approvalGateError = gateQuery.isError
      ? gateErr?.message ?? 'the approval rules could not be read'
      : gate && !gate.readable
        ? gate.reason ?? 'the approval rules could not be read'
        : null;

    return {
      approvalByOrder,
      approvalGateError,
      approvalPolicyNote: gate?.readable ? gate.policyNote : null,
      rows,
      counts: figures.counts,
      recurringCount: figures.recurringCount,
      recurrenceReadCount,
      cancelledCount: figures.cancelledCount,
      month: figures.month,
      hasData: known,
      // The kept read's start (ADR 0269): an optimistic write stamps a query's
      // own update time, and "the last read, from HH:MM" must name a read.
      dataUpdatedAt: known ? freshness.asOf : null,
      isLoading: bookQuery.isLoading,
      // A failed runner refresh (its interval included) holds no query error;
      // it is said as a failed re-read only over rows it can date.
      isError: bookQuery.isError || (freshness.failing && known),
      errorMessage: bookQuery.isError
        ? orderBookErrorWords(bookQuery.error)
        : freshness.failing && known ? 'the latest refresh failed' : null,
      refetch: () => void bookQuery.refetch(),
      book: {
        mode: book?.mode ?? null,
        total: book?.total ?? null,
        readCount: book?.rows.length ?? 0,
        openComplete: book?.openComplete ?? null,
        unreadableStates: book?.unclassifiedCount ?? null,
        deliveredAtLeast: figures.deliveredAtLeast,
        recurringAtLeast: figures.recurringAtLeast,
        older,
      },
      target,
    };
  }, [book, bookQuery.isLoading, bookQuery.isError, bookQuery.error, bookQuery.refetch, freshness.asOf, freshness.failing, olderOrders, older, foundOrder, target, providerNameById, gateQuery.data, gateQuery.isError, gateQuery.error]);
}
