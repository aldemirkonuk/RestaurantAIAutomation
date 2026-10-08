/**
 * The house's order book: every order, read page by page (F-140, ADR 0269).
 *
 * WHY THIS FILE EXISTS
 * `getOrders` (orders.ts) sends no page and no limit, so the gateway answers
 * with its default page of 50 (`procurement.service.ts:3155`). Every screen
 * built on it has been reading the newest 50 orders as if they were all of
 * them. This reader asks for 100 at a time (the DTO's `@Max(100)`,
 * `procurement.dto.ts:839`) until the gateway says there are no more.
 *
 * WHY `/orders/history` AND NOT `/orders`
 * Both routes call the same `listOrders(user.restaurantId, query)` with the same
 * `OrderFilterDto` and answer `OrderListResponseDto`
 * (`procurement.controller.ts:162-177` and `:219-234`). The rate guard keys on
 * the client IP plus `request.route.path` and not on the method
 * (`rate-limit.guard.ts:294-295`), so `GET /orders` shares its 100-per-60s
 * bucket with `POST /orders`, which places an order. Reading the book on
 * `/history` keeps book reads out of that bucket.
 *
 * WHAT THE READER WILL NOT DO
 * - It never calls a read whole on trust: the count of distinct ids must equal
 *   the gateway's `total`. Otherwise it reads again once, and then falls back to
 *   reading every open status it can name on its own, marked `partial`, with
 *   `openComplete` false when it can tell that read may have missed an open
 *   order. It cannot always tell (see `OrderBook.openComplete`).
 * - It never returns a row from another house. The token's house is checked
 *   before and after every page, and every row's `restaurantId` is compared
 *   with the house asked for.
 * - It never reads `?? []` into an empty book. A page that is not the shape
 *   `OrderListResponseDto` declares is a `BookShapeError`.
 */

import { apiClient, getErrorStatus } from './client'
import { tokenHouse } from '../../lib/houseMemory'
import { canonicalStatus } from '../../lib/mudavym/status'
import type { Order, OrderStatus, OrderWireStatus } from './types'

/**
 * `GET /procurement/orders/history`'s body: `OrderListResponseDto`
 * (`procurement.dto.ts:1293`). `scripts/check_web_reads_gateway_dto_keys.py`
 * fails CI when a key here is not on the DTO.
 */
export interface OrderListPage {
  orders: Order[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

const HISTORY_PATH = '/procurement/orders/history'
const ORDER_PATH = '/procurement/orders'

/** Rows per page: `OrderFilterDto.limit` is `@Max(100)` (`procurement.dto.ts:839`). */
export const PAGE_LIMIT = 100
/** Pages read before the book is called capped: 30 × 100 = 3,000 orders. */
export const CEILING_PAGES = 30
/** The guard's default window (`rate-limit.guard.ts:28`, 100 per 60 s). */
export const RATE_WINDOW_MS = 60_000
/** A 429's wait is spread uniformly over 0 to this, so devices do not return together. */
export const RATE_JITTER_MAX_MS = Math.min(30_000, RATE_WINDOW_MS)
/** 429 waits one page will sit out before the read gives up (counted per page, in `openSession`). */
const MAX_RATE_LIMIT_WAITS = 2

// ---------------------------------------------------------------------------
// The status vocabulary: which orders are open
// ---------------------------------------------------------------------------

/** Every value `ProcurementOrderStatus` sends (`procurement.dto.ts:70-84`). */
export const ORDER_WIRE_STATUSES: readonly OrderWireStatus[] = [
  'PENDING',
  'APPROVAL_NEEDED',
  'NEGOTIATING',
  'APPROVED',
  'CONFIRMED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_RECEIVED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
]

/**
 * Closed, by the founder's F-140 rulings (ADR 0269). `FAILED` reads as
 * `cancelled` (`canonicalStatus`, lib/mudavym/status.ts:18), so it is closed
 * too. Everything else is open, including `delivered` ("Not counted yet") and
 * `partially_received`, and including a status this app cannot read, which
 * `normalizeOrderStatus` files as `pending`. A whole read lists such an order
 * with the open ones. The open sweep cannot ask for a status it cannot name,
 * so a degraded read keeps such an order only as the unfiltered pages it read
 * showed it, and counts the rest in `unclassifiedCount` with `openComplete`
 * false, except when a concurrent move offsets them exactly: then both read as
 * complete and the order is missing (see `OrderBook.openComplete`).
 */
const CLOSED_STAGES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'completed',
  'verified',
  'cancelled',
  'rejected',
])

export function isOpenOrderStatus(raw: string | undefined): boolean {
  return !CLOSED_STAGES.has(canonicalStatus(raw))
}

/** The open wire statuses, each of which the open sweep reads on its own. */
export const OPEN_WIRE_STATUSES: readonly OrderWireStatus[] = ORDER_WIRE_STATUSES.filter((s) =>
  isOpenOrderStatus(s),
)
export const CLOSED_WIRE_STATUSES: readonly OrderWireStatus[] = ORDER_WIRE_STATUSES.filter(
  (s) => !isOpenOrderStatus(s),
)

export type OrderMarkKind =
  | 'not_counted'
  | 'backorder'
  | 'counted_not_checked'
  | 'awaiting_invoice'
  | 'receipt_unreadable'

export interface OrderMark {
  kind: OrderMarkKind
  /** The founder's words (2026-10-03), quoted in ADR 0269. */
  text: string
  /** Bottles still owed; set only on `backorder`. */
  bottlesOwed?: number
}

/**
 * What an open delivered or partly received order says beside its stage
 * (founder, 2026-10-03; ADR 0269). Null for every other order.
 *
 * `PARTIALLY_RECEIVED` covers three states, so the mark is read from the
 * order's `received` block, never from the status alone. When the block cannot
 * tell which state it is (absent, unreadable, a checked order whose owed
 * bottles are not a bottle count, or a gateway that does not send
 * `verifiedAt`), the mark says the receipt could not be read. That last group
 * is fork 4 in ADR 0269.
 */
export function markFor(row: Pick<Order, 'status' | 'received'>): OrderMark | null {
  const stage = canonicalStatus(row.status)
  if (stage === 'delivered') return { kind: 'not_counted', text: 'Not counted yet' }
  if (stage !== 'partially_received') return null

  const unreadable: OrderMark = { kind: 'receipt_unreadable', text: 'Receipt could not be read' }
  const received = row.received
  if (!received || received.readable !== true) return unreadable
  if (received.verifiedAt === null) {
    return { kind: 'counted_not_checked', text: 'Counted, not checked yet' }
  }
  if (typeof received.verifiedAt !== 'string') return unreadable

  const owed = received.backorderBottles
  if (typeof owed === 'number' && owed > 0) {
    return {
      kind: 'backorder',
      text: `Backorder: ${owed} ${owed === 1 ? 'bottle' : 'bottles'} still owed`,
      bottlesOwed: owed,
    }
  }
  if (owed === 0) return { kind: 'awaiting_invoice', text: 'Waiting on the invoice' }
  return unreadable
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The gateway answered 429. `retryAfterMs` is from the body; CORS exposes no headers (`main.ts:20-23`). */
export class RateLimitedError extends Error {
  readonly retryAfterMs: number
  constructor(retryAfterMs: number) {
    super('The order book is being read too often; waiting before reading again.')
    this.name = 'RateLimitedError'
    this.retryAfterMs = retryAfterMs
  }
}

/** The session's token names another house than the one this read was for. */
export class HouseChangedError extends Error {
  constructor(message = 'The house changed while its order book was being read.') {
    super(message)
    this.name = 'HouseChangedError'
  }
}

/**
 * A row on a page belongs to another house while the token still names this
 * one: the gateway answered for a house this read did not ask for. Unlike a
 * `HouseChangedError`, this is a failed read of this house.
 */
export class ForeignRowError extends Error {
  constructor() {
    super('A row on the order book page belongs to another house.')
    this.name = 'ForeignRowError'
  }
}

/** A page was not the shape `OrderListResponseDto` declares. */
export class BookShapeError extends Error {
  constructor(message: string) {
    super(`The order book page could not be read: ${message}`)
    this.name = 'BookShapeError'
  }
}

/**
 * The count of distinct ids did not match `total`. Used only inside a read:
 * the reader reads once more and then falls back to the open sweep, so this
 * never reaches a caller.
 */
export class BookUnstableError extends Error {
  constructor(readonly seen: number, readonly total: number) {
    super(`The order book read ${seen} distinct orders against a total of ${total}.`)
    this.name = 'BookUnstableError'
  }
}

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

export interface OrderBook {
  house: string
  /**
   * whole: every order was read and the distinct ids matched the total.
   * capped: the house has more than CEILING_PAGES pages; `rows` are the newest
   * 3,000 plus the open orders its sweeps found. partial: the read did not hold
   * still after one more try; `rows` are the closed rows it saw, and any of a
   * status no sweep can ask for, plus the open orders its sweeps found. In both,
   * `openComplete` false says some open orders may be missing: a status no sweep
   * can ask for, or a sweep that did not hold still, can leave some out.
   * `openComplete` true does not prove the opposite (see below).
   */
  mode: 'whole' | 'capped' | 'partial'
  reason: 'ceiling' | 'unstable' | null
  rows: Order[]
  /** The gateway's count of every order in the house, from the last page read. */
  total: number
  /**
   * Whole book: always true, and every order read is in `rows`.
   *
   * Degraded book: true only when every open sweep held still and the
   * per-status counts add up to `total` exactly. That is necessary, not
   * sufficient. Below `total`, a status no sweep can ask for may hold open
   * orders the unfiltered pages did not show, so it is false even when they
   * showed all of them. Above it, the counts were taken while orders moved, so
   * it is false too. But the counts can also add up exactly by accident: an
   * order of a status no sweep can ask for, outside the pages read (a deficit of
   * N), and N extra counts from orders that moved status, or were placed, while
   * the counts were taken (a surplus of N), cancel out. Then this is true and that order is not
   * in `rows`. The reader cannot see the tie. A known gap, pinned by a test in
   * `order-book.test.ts`; proving the open set needs a count from the gateway
   * itself (ADR 0269).
   */
  openComplete: boolean
  /** Per wire status, the gateway's count. Read only when the book is not whole. */
  statusTotals: Partial<Record<OrderWireStatus, number>> | null
  /** `total` less the per-status counts, floored at 0: rows of a status no sweep can ask for. */
  unclassifiedCount: number | null
  /** The next page (at PAGE_LIMIT) not read, for "Show older" past the cap. */
  nextClosedPage: number | null
  readStartedAt: number
  readFinishedAt: number
  /** GET requests this read made, 429s included. */
  requests: number
}

export interface OrderBookOptions {
  /** Called before every GET; the runner waits here for its request window. */
  beforeRequest?: (signal: AbortSignal) => Promise<void>
  /** Told of every 429, with the wait the gateway asked for. */
  onRateLimited?: (retryAfterMs: number) => void
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  random?: () => number
  now?: () => number
}

interface PageRequest {
  page: number
  limit: number
  status?: OrderWireStatus
}

// ---------------------------------------------------------------------------
// One page
// ---------------------------------------------------------------------------

function sessionHouse(): string | null {
  return tokenHouse(localStorage.getItem('accessToken'))
}

function assertHouse(house: string): void {
  const now = sessionHouse()
  if (now !== house) throw new HouseChangedError()
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The read was stopped.', 'AbortError')
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function rateLimitedFrom(error: unknown): RateLimitedError | null {
  if (getErrorStatus(error) !== 429) return null
  const body = (error as { response?: { data?: { retryAfter?: unknown } } }).response?.data
  const seconds = body?.retryAfter
  // Clamped to the guard's window: a wait longer than that buys nothing, and an
  // unbounded one overflows setTimeout (past ~2.1M s) into a read that spins.
  const ms =
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
      ? Math.min(seconds * 1000, RATE_WINDOW_MS)
      : RATE_WINDOW_MS
  return new RateLimitedError(ms)
}

/** Checks one page against what was asked; throws on anything else. */
function readPage(data: unknown, req: PageRequest, house: string): OrderListPage {
  if (!data || typeof data !== 'object') throw new BookShapeError('the body is not an object')
  const body = data as Partial<OrderListPage>
  if (!Array.isArray(body.orders)) throw new BookShapeError('orders is not a list')
  if (!Number.isInteger(body.total) || (body.total as number) < 0) {
    throw new BookShapeError('total is not a count')
  }
  if (typeof body.hasMore !== 'boolean') throw new BookShapeError('hasMore is not true or false')
  if (body.page !== req.page) throw new BookShapeError(`asked for page ${req.page}, got ${body.page}`)
  if (body.limit !== req.limit) {
    throw new BookShapeError(`asked for ${req.limit} a page, got ${body.limit}`)
  }
  const orders = body.orders as Order[]
  const total = body.total as number
  if (orders.length > req.limit) {
    throw new BookShapeError(`${orders.length} rows on a page of ${req.limit}`)
  }
  const ids = new Set<string>()
  for (const row of orders) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) {
      throw new BookShapeError('a row has no id')
    }
    if (ids.has(row.id)) throw new BookShapeError(`order ${row.id} appears twice on one page`)
    ids.add(row.id)
    if (row.restaurantId !== house) {
      throw new ForeignRowError()
    }
    if (req.status && row.status !== req.status) {
      throw new BookShapeError(`asked for ${req.status}, got a ${String(row.status)} row`)
    }
  }
  const expectMore = (req.page - 1) * req.limit + orders.length < total
  if (body.hasMore !== expectMore) {
    throw new BookShapeError(`hasMore is ${body.hasMore} with ${orders.length} rows of ${total}`)
  }
  return { orders, total, page: req.page, limit: req.limit, hasMore: body.hasMore }
}

/**
 * One read session: a request counter, and a page reader that sits out a 429
 * and asks for the SAME page again. Resuming is safe because every page is
 * de-duplicated by id and the final count is checked against `total`.
 */
function openSession(house: string, signal: AbortSignal, opts: OrderBookOptions) {
  const sleep = opts.sleep ?? abortableSleep
  const random = opts.random ?? Math.random
  const session = {
    requests: 0,
    async page(req: PageRequest): Promise<OrderListPage> {
      for (let waits = 0; ; waits++) {
        if (signal.aborted) throw abortError(signal)
        await opts.beforeRequest?.(signal)
        assertHouse(house)
        session.requests++
        let data: unknown
        try {
          const params: Record<string, string | number> = { page: req.page, limit: req.limit }
          if (req.status) params.status = req.status
          const response = await apiClient.get<OrderListPage>(HISTORY_PATH, { params, signal })
          data = response.data
        } catch (error) {
          const limited = rateLimitedFrom(error)
          if (!limited) throw error
          opts.onRateLimited?.(limited.retryAfterMs)
          if (waits >= MAX_RATE_LIMIT_WAITS) throw limited
          await sleep(limited.retryAfterMs + random() * RATE_JITTER_MAX_MS, signal)
          continue
        }
        assertHouse(house)
        return readPage(data, req, house)
      }
    },
  }
  return session
}

type Session = ReturnType<typeof openSession>

// ---------------------------------------------------------------------------
// The open sweep: the fallback that reads each open status this client can
// name on its own, twice at most, and says whether each held still
// (`openComplete` false when one did not, or when the per-status counts do not
// add up to `total`)
// ---------------------------------------------------------------------------

async function sweepStatus(
  session: Session,
  status: OrderWireStatus,
): Promise<{ rows: Order[]; total: number; complete: boolean }> {
  let rows = new Map<string, Order>()
  let total = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    rows = new Map()
    let pages = 0
    for (let p = 1; ; p++) {
      const page = await session.page({ page: p, limit: PAGE_LIMIT, status })
      for (const row of page.orders) rows.set(row.id, row)
      total = page.total
      pages++
      if (!page.hasMore || pages >= CEILING_PAGES) break
    }
    if (rows.size === total) return { rows: [...rows.values()], total, complete: true }
  }
  return { rows: [...rows.values()], total, complete: false }
}

async function degrade(
  session: Session,
  house: string,
  prefix: Map<string, Order>,
  total: number,
  reason: 'ceiling' | 'unstable',
  readStartedAt: number,
  now: () => number,
): Promise<OrderBook> {
  const statusTotals: Partial<Record<OrderWireStatus, number>> = {}
  const open = new Map<string, Order>()
  let openComplete = true
  for (const status of OPEN_WIRE_STATUSES) {
    const swept = await sweepStatus(session, status)
    statusTotals[status] = swept.total
    if (!swept.complete) openComplete = false
    for (const row of swept.rows) open.set(row.id, row)
  }
  for (const status of CLOSED_WIRE_STATUSES) {
    const one = await session.page({ page: 1, limit: 1, status })
    statusTotals[status] = one.total
  }
  // A prefix row of a swept status comes from the sweep: if the sweep does not
  // have it, it has left that status since the prefix was read, and its old
  // status would be a lie. Closed rows come from the prefix, and so do rows of
  // a status no sweep can ask for: open (isOpenOrderStatus), as last read.
  const swept = new Set<string>(OPEN_WIRE_STATUSES)
  const rows = new Map<string, Order>()
  for (const row of prefix.values()) if (!swept.has(row.status)) rows.set(row.id, row)
  for (const row of open.values()) rows.set(row.id, row)
  const counted = Object.values(statusTotals).reduce((sum, n) => sum + (n ?? 0), 0)
  const unclassifiedCount = Math.max(0, total - counted)
  // An exact sum is necessary for `openComplete`, not sufficient. Above `total`,
  // an order moved status between sweeps (or one was placed mid-sweep), and that
  // surplus can hide an order of a status no sweep can name, so the clamp above
  // would read 0; the read did not hold still. At exactly `total`, a surplus of N
  // can still cancel a deficit of N such orders outside the pages read, and this
  // check passes with them missing. The reader cannot tell the two apart; that
  // tie is a known gap (`OrderBook.openComplete`, ADR 0269).
  const totalsAddUp = counted === total
  return {
    house,
    mode: reason === 'ceiling' ? 'capped' : 'partial',
    reason,
    rows: [...rows.values()],
    total,
    openComplete: openComplete && totalsAddUp,
    statusTotals,
    unclassifiedCount,
    nextClosedPage: reason === 'ceiling' ? CEILING_PAGES + 1 : null,
    readStartedAt,
    readFinishedAt: now(),
    requests: session.requests,
  }
}

// ---------------------------------------------------------------------------
// The book
// ---------------------------------------------------------------------------

/**
 * Read every order in `house`, PAGE_LIMIT at a time, until the gateway says
 * there are no more; past the ceiling, or when the read does not hold still,
 * fall back to the open sweep (`OrderBook.mode`, `openComplete`). See the file
 * header for what it refuses.
 */
export async function fetchOrderBook(
  house: string,
  signal: AbortSignal,
  opts: OrderBookOptions = {},
): Promise<OrderBook> {
  const now = opts.now ?? Date.now
  const readStartedAt = now()
  const session = openSession(house, signal, opts)
  let lastSeen = new Map<string, Order>()
  let lastTotal = 0

  // Two attempts. A created_at tie across a page boundary can show one order
  // twice and skip another (listOrders orders by created_at alone,
  // procurement.service.ts:3207), and an order placed mid-read shifts every
  // later page by one. Both leave fewer distinct ids than `total`.
  for (let attempt = 0; attempt < 2; attempt++) {
    const seen = new Map<string, Order>()
    let total = 0
    try {
      for (let p = 1; ; p++) {
        if (p > CEILING_PAGES) {
          return await degrade(session, house, seen, total, 'ceiling', readStartedAt, now)
        }
        const page = await session.page({ page: p, limit: PAGE_LIMIT })
        for (const row of page.orders) seen.set(row.id, row)
        total = page.total
        if (!page.hasMore) break
      }
      if (seen.size !== total) throw new BookUnstableError(seen.size, total)
      return {
        house,
        mode: 'whole',
        reason: null,
        rows: [...seen.values()],
        total,
        openComplete: true,
        statusTotals: null,
        unclassifiedCount: null,
        nextClosedPage: null,
        readStartedAt,
        readFinishedAt: now(),
        requests: session.requests,
      }
    } catch (error) {
      if (!(error instanceof BookUnstableError)) throw error
      lastSeen = seen
      lastTotal = total
    }
  }
  return degrade(session, house, lastSeen, lastTotal, 'unstable', readStartedAt, now)
}

/**
 * One page of the book past the cap, for "Show older" (PR-B). Same checks,
 * same 429 handling, as a page of the book.
 */
export async function fetchOrderBookPage(
  house: string,
  page: number,
  signal: AbortSignal,
  opts: OrderBookOptions = {},
): Promise<OrderListPage> {
  return openSession(house, signal, opts).page({ page, limit: PAGE_LIMIT })
}

export type OrderByIdResult = { state: 'read'; order: Order } | { state: 'unreadable' }

/**
 * Confirm one order before a screen says it is not in the book. EVERY failure
 * reads as "could not be read", never as "does not exist": the gateway turns
 * not-found into a 500 (`getOrder` uses `.single()`, procurement.service.ts:3288,
 * and the controller rewraps it at procurement.controller.ts:236-251).
 */
export async function fetchOrderById(
  house: string,
  id: string,
  signal: AbortSignal,
): Promise<OrderByIdResult> {
  try {
    assertHouse(house)
    const response = await apiClient.get<Order>(`${ORDER_PATH}/${encodeURIComponent(id)}`, {
      signal,
    })
    assertHouse(house)
    const order = response.data
    if (!order || typeof order !== 'object') return { state: 'unreadable' }
    if (order.id !== id || order.restaurantId !== house) return { state: 'unreadable' }
    return { state: 'read', order }
  } catch {
    return { state: 'unreadable' }
  }
}
