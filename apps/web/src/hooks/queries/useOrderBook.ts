/**
 * useOrderBook: the house's whole order book in the query cache (F-140, ADR 0269).
 *
 * A whole read is one GET per 100 orders. A capped read is at least 42 (30
 * pages, 8 open sweeps, 4 closed counts), and a read that does not hold still
 * reads its pages twice before it degrades. The gateway allows 100 per 60 s
 * per client IP and route (`rate-limit.guard.ts:28`, `:294-295`). So the reads
 * do not go straight from TanStack Query to the gateway. They go through one
 * runner per house, held at module level so every screen in the tab shares it:
 *
 * - ONE READ AT A TIME per house. A request that arrives mid-read waits for one
 *   trailing read, because whatever asked for it may have changed after the
 *   in-flight read passed that page.
 * - A 400 ms SETTLE before a read starts, which absorbs the double
 *   invalidation one websocket order event makes (websocket.tsx:646 and the
 *   `order_change` it dispatches at :650).
 * - URGENT BY DEFAULT. Every invalidate or refetch is urgent unless the code
 *   that caused it calls `markBackground(house)` first, in the same tick. The
 *   runner owns its own interval and tab-visibility triggers instead of
 *   TanStack's `refetchInterval` / `refetchOnWindowFocus`, so it knows those
 *   are background. Only a background read waits out the minimum gap, and a
 *   background read in a hidden tab waits until the tab is visible.
 * - At most 40 list requests per 60 s from this tab, and after a 429 no list
 *   request until the gateway's `retryAfter` has passed.
 * - A FENCE for optimistic writes: `noteLocalWrite(house)` bumps the house's
 *   write epoch, and a read that started before the bump is never written to
 *   the cache. An urgent read is scheduled in its place.
 * - A house switch aborts the other house's read; a read is only ever written
 *   under `book(<the house it read>)`.
 *
 * PR-A (this file) has no consumer: no screen calls `useOrderBook` yet.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/query-keys'
import { useAuth } from '../../contexts/AuthContext'
import {
  abortableSleep,
  BookShapeError,
  fetchOrderBook,
  ForeignRowError,
  HouseChangedError,
  RateLimitedError,
  type OrderBook,
} from '../../services/api/order-book'

/** Requests that land within this of the first are read once. */
export const BOOK_SETTLE_MS = 400
/** The background refresh interval (useOrders polls at 60 s today). */
export const BOOK_INTERVAL_MS = 60_000
/** A background read starts no sooner than this after the last read ended. */
export const BOOK_BACKGROUND_GAP_MS = 30_000
/** The per-tab sliding window: list requests per BOOK_WINDOW_MS. */
export const BOOK_WINDOW_MAX_REQUESTS = 40
export const BOOK_WINDOW_MS = 60_000

interface Waiter {
  done: boolean
  resolve: (book: OrderBook) => void
  reject: (error: unknown) => void
}

interface Batch {
  waiters: Set<Waiter>
  urgent: boolean
  /** The runner's own interval or visibility trigger asked for it. */
  fromRunner: boolean
  /** The settle: the earliest the read may start. */
  notBefore: number
  timer: ReturnType<typeof setTimeout> | null
}

interface InFlight {
  controller: AbortController
  /** The house's write epoch when the read started. */
  epoch: number
  waiters: Set<Waiter>
}

export interface BookFreshness {
  /**
   * When the book in the cache was read (its readStartedAt). Null means the
   * book has not been read yet, NOT that it is fresh: `failing` and `stale`
   * are both false then and say nothing, so a screen reads `asOf` first.
   */
  asOf: number | null
  /** The last refresh failed. */
  failing: boolean
  /** Older than twice the interval, or a refresh is failing. */
  stale: boolean
}

type FreshnessState = Pick<BookFreshness, 'asOf' | 'failing'>

interface HouseRun {
  house: string
  client: QueryClient | null
  subscribers: number
  inFlight: InFlight | null
  next: Batch | null
  writeEpoch: number
  lastFinishedAt: number | null
  backgroundMark: boolean
  interval: ReturnType<typeof setInterval> | null
  freshness: FreshnessState
  listeners: Set<() => void>
}

const NO_FRESHNESS: FreshnessState = { asOf: null, failing: false }

const runs = new Map<string, HouseRun>()
let requestStamps: number[] = []
let gateUntil = 0
let onVisibility: (() => void) | null = null

function runFor(house: string): HouseRun {
  let run = runs.get(house)
  if (!run) {
    run = {
      house,
      client: null,
      subscribers: 0,
      inFlight: null,
      next: null,
      writeEpoch: 0,
      lastFinishedAt: null,
      backgroundMark: false,
      interval: null,
      freshness: NO_FRESHNESS,
      listeners: new Set(),
    }
    runs.set(house, run)
  }
  return run
}

function tabHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function setFreshness(run: HouseRun, next: FreshnessState): void {
  run.freshness = next
  run.listeners.forEach((listener) => listener())
}

/** Waits for a slot in this tab's window, and past any 429 the gateway answered. */
async function acquireSlot(signal: AbortSignal): Promise<void> {
  for (;;) {
    const now = Date.now()
    if (gateUntil > now) {
      await abortableSleep(gateUntil - now, signal)
      continue
    }
    requestStamps = requestStamps.filter((t) => t > now - BOOK_WINDOW_MS)
    if (requestStamps.length < BOOK_WINDOW_MAX_REQUESTS) {
      requestStamps.push(now)
      return
    }
    await abortableSleep(requestStamps[0] + BOOK_WINDOW_MS - now, signal)
  }
}

function enqueue(
  run: HouseRun,
  ask: { urgent: boolean; fromRunner: boolean; waiter?: Waiter },
): Batch {
  let batch = run.next
  if (!batch) {
    batch = {
      waiters: new Set(),
      urgent: false,
      fromRunner: false,
      notBefore: Date.now() + BOOK_SETTLE_MS,
      timer: null,
    }
    run.next = batch
  }
  if (ask.urgent) batch.urgent = true
  if (ask.fromRunner) batch.fromRunner = true
  if (ask.waiter) batch.waiters.add(ask.waiter)
  schedule(run)
  return batch
}

function schedule(run: HouseRun): void {
  const batch = run.next
  if (!batch || run.inFlight) return
  if (batch.timer) {
    clearTimeout(batch.timer)
    batch.timer = null
  }
  let startAt = batch.notBefore
  if (!batch.urgent && run.lastFinishedAt !== null) {
    startAt = Math.max(startAt, run.lastFinishedAt + BOOK_BACKGROUND_GAP_MS)
  }
  batch.timer = setTimeout(() => start(run), Math.max(0, startAt - Date.now()))
}

function start(run: HouseRun): void {
  const batch = run.next
  if (!batch || run.inFlight) return
  batch.timer = null
  // A background read in a hidden tab waits, still queued, for the tab to be
  // seen: the visibility handler times it again. This is checked when the
  // timer fires, not when it is set, since the tab may hide in between.
  if (!batch.urgent && tabHidden()) return
  run.next = null
  const waiting = [...batch.waiters].filter((w) => !w.done)
  // Everyone who asked has gone (a cancelled query); nothing to read for.
  if (!batch.fromRunner && waiting.length === 0) return

  const flight: InFlight = {
    controller: new AbortController(),
    epoch: run.writeEpoch,
    waiters: new Set(waiting),
  }
  run.inFlight = flight
  fetchOrderBook(run.house, flight.controller.signal, {
    beforeRequest: acquireSlot,
    onRateLimited: (ms) => {
      gateUntil = Math.max(gateUntil, Date.now() + ms)
    },
  }).then(
    (book) => finish(run, flight, book, null),
    (error) => finish(run, flight, null, error),
  )
}

function finish(run: HouseRun, flight: InFlight, book: OrderBook | null, error: unknown): void {
  if (run.inFlight === flight) run.inFlight = null
  run.lastFinishedAt = Date.now()
  const settle = (fn: (w: Waiter) => void) => flight.waiters.forEach((w) => !w.done && fn(w))

  if (flight.controller.signal.aborted) {
    // Stopped by a house switch. Not a failed refresh, and nothing is written.
    const stopped = new HouseChangedError()
    settle((w) => w.reject(stopped))
    schedule(run)
    return
  }
  if (!book) {
    // A token that now names another house is not a failed refresh of this
    // house. A row of another house on a page (ForeignRowError) is.
    if (!(error instanceof HouseChangedError)) {
      setFreshness(run, { asOf: run.freshness.asOf, failing: true })
    }
    settle((w) => w.reject(error))
    schedule(run)
    return
  }
  if (run.writeEpoch !== flight.epoch) {
    // The fence: this house wrote locally after this read started, so the read
    // may predate the write. It is not written; an urgent read replaces it and
    // its callers wait for that one.
    const batch = enqueue(run, { urgent: true, fromRunner: true })
    settle((w) => batch.waiters.add(w))
    return
  }
  // A book read later than this one stays in the cache. Its callers get the
  // kept book too, since TanStack writes whatever the query function returns.
  let kept = book
  run.client?.setQueryData<OrderBook>(queryKeys.orders.book(run.house), (old) => {
    kept = old && old.readStartedAt > book.readStartedAt ? old : book
    return kept
  })
  setFreshness(run, { asOf: kept.readStartedAt, failing: false })
  settle((w) => w.resolve(kept))
  schedule(run)
}

/** Every house but `house` stops: its read is aborted and its queued callers are told. */
function stopOtherHouses(house: string): void {
  for (const run of runs.values()) {
    if (run.house === house) continue
    if (run.interval) {
      clearInterval(run.interval)
      run.interval = null
    }
    run.inFlight?.controller.abort()
    const batch = run.next
    if (batch) {
      if (batch.timer) clearTimeout(batch.timer)
      run.next = null
      const stopped = new HouseChangedError()
      batch.waiters.forEach((w) => !w.done && w.reject(stopped))
    }
  }
}

function bindVisibility(): void {
  if (onVisibility || typeof document === 'undefined') return
  onVisibility = () => {
    if (tabHidden()) return
    // Seen again: this is the focus refresh, and it releases a deferred one.
    for (const run of runs.values()) {
      if (run.subscribers > 0) enqueue(run, { urgent: false, fromRunner: true })
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
}

// ---------------------------------------------------------------------------
// Exported for the hooks below and for PR-B
// ---------------------------------------------------------------------------

/**
 * The read the cache asks for. Urgent unless `markBackground(house)` ran
 * earlier in this same tick.
 */
export function requestOrderBook(
  house: string,
  client: QueryClient,
  signal?: AbortSignal,
): Promise<OrderBook> {
  const run = runFor(house)
  run.client = client
  const urgent = !run.backgroundMark
  return new Promise<OrderBook>((resolve, reject) => {
    const onAbort = () => waiter.reject(signal?.reason)
    const waiter: Waiter = {
      done: false,
      resolve: (book) => {
        if (waiter.done) return
        waiter.done = true
        signal?.removeEventListener('abort', onAbort)
        resolve(book)
      },
      reject: (error) => {
        if (waiter.done) return
        waiter.done = true
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      },
    }
    if (signal?.aborted) {
      waiter.reject(signal.reason)
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    enqueue(run, { urgent, fromRunner: false, waiter })
  })
}

/**
 * The next refresh of `house`'s book, asked for in this same tick, is a
 * background one: the websocket, the interval, a focus. Call it immediately
 * before `invalidateQueries`; the mark clears at the end of the tick.
 */
export function markBackground(house: string): void {
  const run = runFor(house)
  run.backgroundMark = true
  void Promise.resolve().then(() => {
    run.backgroundMark = false
  })
}

/**
 * This tab just wrote an order in `house` optimistically. A read that started
 * before now is not written to the cache. Call it where the optimistic write
 * lands and again when the write settles.
 */
export function noteLocalWrite(house: string): void {
  runFor(house).writeEpoch++
}

/** Starts the house's interval; aborts every other house's read. */
export function subscribeOrderBook(house: string, client: QueryClient): () => void {
  stopOtherHouses(house)
  const run = runFor(house)
  run.client = client
  run.subscribers++
  bindVisibility()
  if (!run.interval) {
    run.interval = setInterval(
      () => enqueue(run, { urgent: false, fromRunner: true }),
      BOOK_INTERVAL_MS,
    )
  }
  return () => {
    run.subscribers = Math.max(0, run.subscribers - 1)
    if (run.subscribers === 0 && run.interval) {
      clearInterval(run.interval)
      run.interval = null
    }
  }
}

/**
 * TanStack's retry, overriding the app default of one retry (App.tsx:156): a
 * 429 was already waited out inside the read, and a retry would start again
 * at page 1; a house change, a row of another house or a page of the wrong
 * shape will not mend itself.
 */
export function retryOrderBook(failureCount: number, error: unknown): boolean {
  if (
    error instanceof RateLimitedError ||
    error instanceof HouseChangedError ||
    error instanceof ForeignRowError ||
    error instanceof BookShapeError
  ) {
    return false
  }
  return failureCount < 1
}

export function useOrderBook() {
  const { activeRestaurantId, isAuthenticated } = useAuth()
  const queryClient = useQueryClient()
  const house = activeRestaurantId ?? ''
  const enabled = !!house && isAuthenticated

  useEffect(() => {
    if (!enabled) return
    return subscribeOrderBook(house, queryClient)
  }, [enabled, house, queryClient])

  return useQuery<OrderBook>({
    queryKey: queryKeys.orders.book(house),
    queryFn: ({ signal }) => requestOrderBook(house, queryClient, signal),
    enabled,
    staleTime: BOOK_INTERVAL_MS,
    refetchOnMount: true,
    // The runner owns these, so it knows they are background.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: retryOrderBook,
  })
}

/** One reading of how fresh `house`'s book is, shared by every screen that shows it. */
export function useOrderBookFreshness(house: string | null | undefined): BookFreshness {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!house) return () => {}
      const run = runFor(house)
      run.listeners.add(onChange)
      return () => {
        run.listeners.delete(onChange)
      }
    },
    [house],
  )
  const getSnapshot = () => (house ? runs.get(house)?.freshness ?? NO_FRESHNESS : NO_FRESHNESS)
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Re-render when the book crosses the age line, not only when it changes.
  const [, setTick] = useState(0)
  const ageLimit = 2 * BOOK_INTERVAL_MS
  useEffect(() => {
    if (state.asOf === null || state.failing) return
    const due = state.asOf + ageLimit - Date.now()
    if (due < 0) return
    const timer = setTimeout(() => setTick((n) => n + 1), due + 1)
    return () => clearTimeout(timer)
  }, [state, ageLimit])

  const stale = state.failing || (state.asOf !== null && Date.now() - state.asOf > ageLimit)
  return { asOf: state.asOf, failing: state.failing, stale }
}

/** Clears every runner, window and listener. Tests only. */
export function resetOrderBookRunnerForTests(): void {
  for (const run of runs.values()) {
    if (run.interval) clearInterval(run.interval)
    if (run.next?.timer) clearTimeout(run.next.timer)
    run.inFlight?.controller.abort()
  }
  runs.clear()
  requestStamps = []
  gateUntil = 0
  if (onVisibility && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibility)
  }
  onVisibility = null
}
