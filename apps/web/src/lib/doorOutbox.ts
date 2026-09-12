/**
 * doorOutbox — offline queue for deliveries received at the door.
 *
 * There is no signal in a walk-in and barely any in a stairwell. A receiver who
 * taps "done" and watches a spinner fail has learned that the app costs them
 * time, and they go back to the clipboard — permanently. So the tap always
 * succeeds locally and syncs whenever the network returns.
 *
 * IDEMPOTENCY IS THE WHOLE DESIGN. Every queued receipt carries a key generated
 * at the moment of the tap and reused on every retry, so a request that actually
 * reached the server before the connection dropped cannot book the stock twice.
 * The server treats a duplicate key as "already recorded" rather than an error,
 * which means the client never has to know whether its first attempt landed.
 *
 * Built on the existing offlineStorage pending-mutation queue rather than a new
 * store, so it inherits the IndexedDB-with-localStorage-fallback that already
 * works on the old iPads a receiving desk actually has.
 */

import { offlineStorage } from './offline-storage'
import { receivingApi, type DoorReceiptRequest } from '../services/api/receiving'

const MUTATION_TYPE = 'receiving.door'

/** Give up after this many attempts and surface it, rather than retrying forever. */
const MAX_ATTEMPTS = 8

/**
 * Stamped on a queue entry the flush gave up on but could NOT write a record
 * for. It is the on-disk MARK of a stranded receipt: the entry is parked at the
 * attempt ceiling and deliberately kept, and this string is what tells it apart
 * from an entry that merely ran out of retries and is about to be dropped.
 *
 * Written in one place and matched in one place (`readStrandedDoorReceipts`) on
 * purpose — reworded in the flush alone, every standing strand goes invisible,
 * which is this file's own fault class wearing a copy-editor's hat.
 */
const STRANDED_MARKER =
  'Given up on, and this device could not save a record of it. Kept here so the delivery is not lost — keep the paperwork.'

/**
 * The strands this SESSION has seen, held in memory on purpose.
 *
 * THE MARK CANNOT BE THE ONLY SOURCE, because the condition that creates a
 * strand is `localStorage` refusing a write — and the mark is written through
 * the same storage. Measured, against the real `offlineStorage` on its
 * localStorage fallback (the path this file's header advertises for "the old
 * iPads a receiving desk actually has"): the parking update is swallowed by
 * `localStoragePut`'s `console.error`, `updatePendingMutation` RESOLVES having
 * written nothing, the entry stays at `retryCount: 0` with no `lastError`, and
 * a reader that trusted the mark returned `[]` for a delivery that is gone. The
 * screen then said "still trying". That is this repo's named fault — absence
 * reported as health — sitting under the loudest alarm in the app.
 *
 * So the ledger is memory first and disk second, and the reader takes the
 * UNION. Identity is the queue id, so a strand re-seen on a later pass is the
 * same strand; entries that leave the queue are pruned on every read. What this
 * cannot survive is a full page reload on a device whose disk is refusing
 * writes — and nothing can. The next flush re-derives it within the second,
 * because the receipt is still queued and the server refuses it again.
 */
const strandedThisSession = new Set<string>()

/**
 * A receipt the outbox GAVE UP ON, kept after the receipt itself is gone.
 *
 * The queue entry is deleted on a drop, so without this the only record of a
 * permanent loss was a counter in one component's state, on one phone, erased
 * by the next navigation. It is written here, from the flush that caused it,
 * so it survives a remount and can still name the order it lost.
 */
export interface DroppedDoorReceipt {
  /**
   * The queue entry's id. The record is keyed on it, so recording the same
   * drop twice — two passes racing, a re-read after a reload — cannot turn one
   * lost receipt into two.
   */
  id: string
  orderLabel: string
  droppedAt: string
  /**
   * Why it was given up on, kept because the REMEDY differs and a notice that
   * names the wrong one wastes the only minutes in which anything can be done:
   *   auth    — 401/403. The app was signed out; the next move is signing in
   *             again, not walking upstairs.
   *   refused — any other 4xx. The server understood and said no.
   *   retries — the attempt budget ran out.
   *   unknown — inherited from a pre-scoping record that never stored one.
   * None of these recovers the receipt. They only stop the notice sending a
   * porter after the wrong fix.
   */
  reason: 'auth' | 'refused' | 'retries' | 'unknown'
  /**
   * True for a record inherited from a pre-scoping key. The restaurant it
   * belongs to was never written down, so it is shown — losing it is the very
   * defect this store exists to prevent — but it is NOT claimed as the
   * restaurant that happened to open the page.
   */
  tenantUnknown?: boolean
}

/**
 * ONE store, per restaurant, shared with the receiving rail.
 *
 * This is deliberately the key family `useReceivingNextData.ts` already uses
 * (`DROPS_KEY_PREFIX` there), not a second convention: a drop is one event and
 * two stores for it meant a single loss written to two places and dismissed in
 * neither. The rail reads and dismisses through this module now; the flush is
 * the only writer.
 *
 * Scoping is restaurant, not user, for the same reason the rail chose it: the
 * tablet at the door is shared and the porter signing in is not who the lost
 * delivery belongs to — the house is. What it fixes is the leak: a global key
 * showed one house's order label, as a `role="alert"`, to the next house the
 * tablet switched to, and survived the logout in between.
 */
const DROPS_KEY_PREFIX = 'mudavym.receiving.outboxDrops'

/**
 * Keys written before scoping existed, read once per browser and then removed.
 * Two of them: the rail's original global key, and this module's own
 * `door.drops.v1` — which re-created the leak the rail had already closed.
 */
const LEGACY_DROPS_KEYS = ['mudavym.receiving.outboxDrops', 'mudavym.door.drops.v1']

/**
 * Where a drop goes when the queue entry predates the tenant stamp and there
 * is no house to file it under. It is `LEGACY_DROPS_KEYS[0]` on purpose: the
 * adoption below picks it up on the next read and shows it marked, rather than
 * leaving it in a bucket no screen ever reads — which is the fault this file
 * exists to stop, wearing a different hat.
 */
const UNATTRIBUTED_DROPS_KEY = LEGACY_DROPS_KEYS[0]

function dropsKey(restaurantId: string): string {
  // An empty id would collapse back onto the legacy key and re-create the leak.
  return `${DROPS_KEY_PREFIX}.${restaurantId || 'unscoped'}`
}

/**
 * Read a stored record defensively. The rail's own pins used `label` and had
 * no `reason`, so the shapes are normalised on the way in rather than left for
 * every consumer to guess at.
 */
function normalizeDrop(value: unknown): DroppedDoorReceipt | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id === '') return null
  const label =
    typeof o.orderLabel === 'string' && o.orderLabel
      ? o.orderLabel
      : typeof o.label === 'string' && o.label
        ? o.label
        : 'Door receipt'
  const reason =
    o.reason === 'auth' || o.reason === 'refused' || o.reason === 'retries'
      ? o.reason
      : 'unknown'
  return {
    id: o.id,
    orderLabel: label,
    droppedAt: typeof o.droppedAt === 'string' ? o.droppedAt : new Date(0).toISOString(),
    reason,
    ...(o.tenantUnknown === true ? { tenantUnknown: true as const } : {}),
  }
}

function parseDrops(raw: string | null): DroppedDoorReceipt[] {
  if (!raw) return []
  try {
    const arr: unknown = JSON.parse(raw)
    return Array.isArray(arr)
      ? arr.map(normalizeDrop).filter((d): d is DroppedDoorReceipt => d !== null)
      : []
  } catch {
    return []
  }
}

/**
 * Every receipt this house has lost, oldest first.
 *
 * MIGRATION, decided rather than defaulted — the same three options the rail
 * weighed, resolved the same way so the two halves cannot disagree:
 *
 *   discard      — silently loses a receipt that needs a person. That IS the
 *                  defect this store exists to fix; refused.
 *   re-attribute — hands them to whichever restaurant is active now and claims
 *                  them as its own. That is the leak; refused.
 *   adopt, marked — taken by the first restaurant to open the door, stamped
 *                  `tenantUnknown`, rendered saying the house was not recorded.
 *                  Nothing is lost and nothing is claimed.
 *
 * The legacy keys are removed on adoption so the records land in exactly one
 * place instead of fanning out to every house that later opens the page — but
 * only AFTER the scoped write succeeds, because a removal that outran a failed
 * write would be this whole file's defect one more time.
 */
export function readDroppedDoorReceipts(restaurantId: string): DroppedDoorReceipt[] {
  let merged: DroppedDoorReceipt[]
  try {
    merged = parseDrops(window.localStorage.getItem(dropsKey(restaurantId)))
  } catch {
    return []
  }

  const inheritedFrom: string[] = []
  for (const key of LEGACY_DROPS_KEYS) {
    // Reading without a house (signed out, or before auth resolves) SHOWS the
    // unattributed records but never adopts them: moving them under an empty
    // id would hide them from the house they actually belong to.
    if (key === dropsKey(restaurantId)) continue
    let raw: string | null
    try {
      raw = window.localStorage.getItem(key)
    } catch {
      return merged
    }
    if (!raw) continue
    inheritedFrom.push(key)
    merged = [
      ...merged,
      ...parseDrops(raw)
        .filter((d) => !merged.some((m) => m.id === d.id))
        .map((d) => ({ ...d, tenantUnknown: true as const })),
    ]
  }
  if (inheritedFrom.length === 0 || !restaurantId) return merged

  try {
    window.localStorage.setItem(dropsKey(restaurantId), JSON.stringify(merged))
    for (const key of inheritedFrom) window.localStorage.removeItem(key)
  } catch {
    // The adoption could not be written. The legacy keys are left exactly where
    // they are — losing them here would be the loss this store prevents — and
    // the records are still returned, so the screen shows them this session.
  }
  return merged
}

/**
 * Forget one record. The PORTER acknowledging it, from the receiving rail.
 * Returns what is left so the caller renders storage rather than its guess.
 */
export function dismissDroppedDoorReceipt(
  restaurantId: string,
  id: string,
): DroppedDoorReceipt[] {
  const next = readDroppedDoorReceipts(restaurantId).filter((d) => d.id !== id)
  try {
    window.localStorage.setItem(dropsKey(restaurantId), JSON.stringify(next))
  } catch {
    /* storage blocked — the caller still renders `next` this session */
  }
  // And out of any legacy key it may still be sitting in. Without this half, an
  // acknowledgement made with no active house wrote the survivors to
  // `…outboxDrops.unscoped` and touched nothing else — but the read it was
  // based on came from the legacy key, which adoption deliberately leaves alone
  // when there is no house to adopt into. The caller was handed a list without
  // the record on it while the record was still on disk, and it came back on
  // the next read: told gone, not gone.
  forgetFromLegacyKeys(restaurantId, (d) => d.id !== id)
  return next
}

/**
 * Rewrite every legacy key, keeping only what `keep` allows. A key that empties
 * is removed outright so the adoption path stops finding it.
 */
function forgetFromLegacyKeys(
  restaurantId: string,
  keep: (d: DroppedDoorReceipt) => boolean,
): void {
  for (const key of LEGACY_DROPS_KEYS) {
    if (key === dropsKey(restaurantId)) continue
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const left = parseDrops(raw).filter(keep)
      if (left.length === 0) window.localStorage.removeItem(key)
      else window.localStorage.setItem(key, JSON.stringify(left))
    } catch {
      /* storage blocked — nothing was persisted to change */
    }
  }
}

/**
 * Forget the records. The PORTER acknowledging the notice — nothing in the
 * flush path calls this, and no successful send clears it, because a later
 * delivery does not make an earlier loss untrue. It exists at all because a
 * warning on a shared dock phone that can never be cleared is one nobody reads
 * by the third delivery.
 */
export function clearDroppedDoorReceipts(restaurantId: string): void {
  try {
    window.localStorage.removeItem(dropsKey(restaurantId))
  } catch {
    /* storage blocked — there was nothing persisted to clear */
  }
  // The legacy keys too. What the porter acknowledged is what the screen showed
  // them, and the screen shows the inherited records as well — marked, but
  // shown. Clearing only this house's key left them on disk to be re-read, or,
  // with no active house at all, cleared a key the read was never using.
  forgetFromLegacyKeys(restaurantId, () => false)
}

/**
 * Write the record down. Returns whether it is now DURABLE.
 *
 * The return value is the whole point and the caller must obey it: a `false`
 * here means the only trace of the loss is in memory, and deleting the queue
 * entry on top of that destroys the delivery outright. Measured, not
 * theoretical — a full or unavailable localStorage on a shared dock tablet is
 * the ordinary case, not the exotic one.
 *
 * Not capped. A record is ~90 bytes, and evicting the oldest to make room
 * would be this same defect one layer down: a loss disappearing quietly.
 */
function recordDrop(restaurantId: string, drop: DroppedDoorReceipt): boolean {
  const key = restaurantId ? dropsKey(restaurantId) : UNATTRIBUTED_DROPS_KEY
  try {
    const all = restaurantId
      ? readDroppedDoorReceipts(restaurantId)
      : parseDrops(window.localStorage.getItem(key))
    // Already written by an earlier pass: durable, and writing it again would
    // turn one lost receipt into two.
    if (all.some((d) => d.id === drop.id)) return true
    window.localStorage.setItem(key, JSON.stringify([...all, drop]))
    return true
  } catch {
    return false
  }
}

export interface QueuedDoorReceipt {
  orderId: string
  orderLabel: string
  /**
   * The house the delivery was taken at, stamped at the tap.
   *
   * Carried on the ENTRY rather than read at flush time because the flush can
   * run long after a restaurant switch — off an `online` event, from a page
   * that is no longer the door — and attributing the loss to whoever is active
   * then is how one house's order label ends up on another's screen.
   */
  restaurantId: string
  body: DoorReceiptRequest
}

/** A key that survives a reload, a retry and a browser restart. */
export function newIdempotencyKey(orderId: string): string {
  const rand =
    (globalThis.crypto?.randomUUID?.() ??
      Math.random().toString(36).slice(2)) as string
  return `door:${orderId}:${rand}`
}

/**
 * Record a door receipt, queueing it if the network is unavailable.
 *
 * Returns `synced: false` when it went to the queue — the caller should tell the
 * receiver it is saved, NOT that it failed, because from their side it is done
 * and their next action is walking away from the door.
 */
export async function submitDoorReceipt(
  entry: QueuedDoorReceipt,
): Promise<{
  synced: boolean
  alreadyRecorded?: boolean
  /**
   * Whether the shelf count moved. Passed through — not collapsed into
   * `synced` — because "the delivery is recorded" and "the stock is booked" are
   * two different facts and the gateway used to report the second one whether or
   * not it happened. A caller that only knows `synced` cannot tell them apart.
   */
  stockBooked?: boolean
  stockIssue?: string
}> {
  if (!navigator.onLine) {
    await queue(entry)
    return { synced: false }
  }

  try {
    const res = await receivingApi.recordDoorReceipt(entry.orderId, entry.body)
    return {
      synced: true,
      alreadyRecorded: res.alreadyRecorded,
      stockBooked: res.stockBooked,
      stockIssue: res.stockIssue,
    }
  } catch (err) {
    // A 4xx means the server understood and refused; retrying will not help and
    // queueing it would hide a real problem behind a permanently stuck item.
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status && status >= 400 && status < 500 && status !== 408 && status !== 429)
      throw err

    await queue(entry)
    return { synced: false }
  }
}

async function queue(entry: QueuedDoorReceipt): Promise<void> {
  await offlineStorage.addPendingMutation({
    type: MUTATION_TYPE,
    data: entry,
    timestamp: new Date(),
  })
}

/** How many door receipts are waiting to sync. Drives the pending badge. */
export async function pendingDoorCount(): Promise<number> {
  const all = await offlineStorage.getPendingMutationsByType(MUTATION_TYPE)
  return all.length
}

/**
 * A receipt the outbox gave up on and could NOT write a record for, so it kept
 * the queue ENTRY instead of deleting it. The entry is the record here.
 */
export interface StrandedDoorReceipt {
  /** The queue entry's id — the identity that makes one strand count once. */
  id: string
  orderLabel: string
  /** Empty when the entry was queued before the tenant stamp existed. */
  restaurantId: string
}

/**
 * Every receipt currently STRANDED on this device.
 *
 * READ, never accumulated. `DoorFlushResult.stranded` is a statement about one
 * pass, and a strand is re-reported by every later pass because the entry is
 * deliberately still there — so adding those numbers up turned ONE lost receipt
 * into "3 deliveries could not be sent" by the third screen unlock, while
 * holding the total in component state turned it back into nothing on the
 * navigate that Finish triggers. Both halves are the mistake this module
 * already fixed for `dropped`: a count where a record belongs.
 *
 * The record is the QUEUE ENTRY, identified two ways and taken as a union:
 * `strandedThisSession` (memory — see its docblock for why the mark alone is
 * not enough) and the mark the flush tries to park on the entry, which is what
 * carries a strand across a reload on a device whose disk still works. Either
 * alone is silent in a case the other covers.
 *
 * Disjointness from `dropped` is DERIVED here rather than asserted: an entry
 * that has a drop record is not a strand, whatever is on it. That is what makes
 * the claim true for the two states that used to break it — a record written on
 * a later pass whose delete then failed, and a receipt the server finally
 * accepted while its delete failed.
 *
 * `null` means the queue could not be READ — not that nothing is stranded. A
 * caller must keep what it last knew rather than render the absence as an
 * all-clear.
 *
 * An entry with no house stamped on it is returned for every house. It costs a
 * count with no order label attached to it; hiding it would lose the only thing
 * on this device that says a delivery is gone.
 */
export async function readStrandedDoorReceipts(
  restaurantId: string,
): Promise<StrandedDoorReceipt[] | null> {
  let pending
  try {
    pending = await offlineStorage.getPendingMutationsByType(MUTATION_TYPE)
  } catch {
    return null
  }

  // Prune: a strand exists only while its entry does. Delivered, dropped, or
  // cleared by hand, the id stops being one — and this is the only place that
  // can see it, since the removal may have happened in another pass.
  const live = new Set(pending.map((m) => m.id))
  for (const id of strandedThisSession) if (!live.has(id)) strandedThisSession.delete(id)

  const recorded = new Set(readDroppedDoorReceipts(restaurantId).map((d) => d.id))

  return pending
    .filter(
      (m) =>
        !recorded.has(m.id) &&
        (strandedThisSession.has(m.id) ||
          m.lastError === STRANDED_MARKER ||
          m.retryCount >= MAX_ATTEMPTS),
    )
    .map((m) => {
      const entry = m.data as QueuedDoorReceipt | undefined
      return {
        id: m.id,
        orderLabel: entry?.orderLabel || entry?.orderId || 'Door receipt',
        restaurantId: entry?.restaurantId ?? '',
      }
    })
    .filter((d) => !restaurantId || !d.restaurantId || d.restaurantId === restaurantId)
}

export interface DoorFlushResult {
  sent: number
  /** Did not reach the server this pass — retryable ones included. */
  failed: number
  /**
   * How many receipts this pass GAVE UP ON **and wrote down**: a 4xx, or the
   * retry budget spent. A subset of `failed`, and the only permanent part of
   * it — the item is deleted from the queue, so the pending badge decrements
   * exactly as it does on a delivery. Reported separately because a caller
   * that sees only `failed` cannot tell a receipt that will be retried from
   * one nobody will ever send, and a screen that cannot tell them apart
   * renders a loss as a success.
   */
  dropped: number
  /**
   * Gave up on, and this device could NOT write the record — so the queue
   * entry was KEPT rather than deleted.
   *
   * Disjoint from `dropped`, a subset of `failed`. The receipt still exists,
   * on this phone only, and the next flush will try to record it again; until
   * it succeeds the entry sits in the queue at its attempt ceiling with the
   * reason on it. A caller must render this LOUDLY: the one outcome that is
   * never acceptable is the screen saying nothing while a delivery is gone.
   */
  stranded: number
  /**
   * The queue itself could not be read or walked this pass. The counters are
   * then a statement about nothing — not a clean sync — and the caller must
   * not print them as one.
   */
  unreachable: boolean
}

/**
 * The pass currently running, handed to every caller that arrives while it is
 * in flight — but only while it can still SEE their receipt.
 *
 * Three triggers fire a flush — mount, 'online', 'visibilitychange' — and the
 * walk from the dock to the office raises the last two in the same tick.
 * Without this each pass read the whole pending list BEFORE any of them
 * removed anything, so a single lost receipt was attempted once per pass and
 * reported as one drop per pass: one loss, counted twice.
 */
let inFlight: Promise<DoorFlushResult> | null = null

/**
 * Whether the running pass has already snapshotted the queue.
 *
 * This is the difference between joining a pass and being lied to by one. A
 * caller arriving BEFORE the snapshot is genuinely covered by it. A caller
 * arriving after it is not: its receipt was queued too late to be in that
 * list, and handing it that pass's `{sent, failed, dropped}` reports success
 * for work nobody did. Those callers get a pass of their own instead.
 */
let snapshotTaken = false

/**
 * Push everything queued. Safe to call repeatedly and concurrently.
 *
 * A caller that arrives while a pass is still assembling its list joins that
 * pass. (The idempotency key already made a double SEND harmless on the
 * server; what it could not make harmless was double COUNTING the loss on the
 * client.) A caller that arrives after the list was read gets a fresh pass
 * chained behind the running one, so the result it is handed is always a
 * result about its own receipt.
 *
 * Never rejects. A pass that cannot read the queue returns `unreachable`
 * instead — a rejection propagated to every joined caller at once and no
 * consumer has a catch, which froze the rail's "last sync" with no sign why.
 */
export function flushDoorOutbox(): Promise<DoorFlushResult> {
  if (!inFlight) {
    snapshotTaken = false
    const pass = runFlush(() => {
      snapshotTaken = true
    })
    inFlight = pass.finally(() => {
      inFlight = null
      snapshotTaken = false
    })
    return inFlight
  }
  if (!snapshotTaken) return inFlight
  // Joined too late to be in the running list. Wait it out, then run. The
  // `finally` above has already cleared `inFlight` by the time this lands, so
  // this starts a real pass; further joiners of THAT pass share it normally.
  return inFlight.then(
    () => flushDoorOutbox(),
    () => flushDoorOutbox(),
  )
}

async function runFlush(onSnapshot: () => void): Promise<DoorFlushResult> {
  let sent = 0
  let failed = 0
  let dropped = 0
  let stranded = 0
  const result = (unreachable: boolean): DoorFlushResult => ({
    sent,
    failed,
    dropped,
    stranded,
    unreachable,
  })

  if (!navigator.onLine) {
    // Nothing was attempted and nothing can be: this pass covers no one, so a
    // caller arriving now gets its own rather than this pass's zeroes.
    onSnapshot()
    return result(false)
  }

  let pending
  try {
    pending = await offlineStorage.getPendingMutationsByType(MUTATION_TYPE)
  } catch {
    onSnapshot()
    // Unknown, reported as unknown. Zeroes with `unreachable: false` would be
    // this file's own fault class: absence rendered as health.
    return result(true)
  }
  onSnapshot()

  try {
    for (const m of pending) {
      const entry = m.data as QueuedDoorReceipt | undefined
      try {
        await receivingApi.recordDoorReceipt(entry!.orderId, entry!.body)
        // The server has it. Whatever this entry was before — including a
        // strand from an earlier pass — it is not a lost delivery now, and the
        // alarm must stop even if the delete below fails and the entry lingers.
        strandedThisSession.delete(m.id)
        try {
          await offlineStorage.removePendingMutation(m.id)
        } catch {
          // Sent, but still queued. The idempotency key makes the re-send a
          // no-op on the server, so this costs a request, never a double
          // booking. Best-effort: take the strand mark off it too, so a reload
          // that finds the entry still here does not alarm about a delivery
          // that landed. If this write fails as well the screen over-reports,
          // which is the direction to fail in.
          try {
            await offlineStorage.updatePendingMutation(m.id, { lastError: undefined })
          } catch {
            /* nothing more to try; the read's drop-record check still covers
               the recorded case, and a false alarm is loud, not silent */
          }
        }
        sent++
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response
          ?.status
        const permanent =
          status && status >= 400 && status < 500 && status !== 408 && status !== 429

        // Drop a permanently-rejected item rather than retrying it forever. A
        // queue that never drains stops being watched, and then a real failure
        // hides behind the stuck one.
        if (permanent || m.retryCount + 1 >= MAX_ATTEMPTS) {
          // Written BEFORE the delete and keyed on the queue id: the count
          // alone cannot say WHICH order left, and after the delete nothing
          // anywhere else in the app can.
          const written = recordDrop(entry?.restaurantId ?? '', {
            id: m.id,
            orderLabel: entry?.orderLabel || entry?.orderId || 'Door receipt',
            droppedAt: new Date().toISOString(),
            reason: permanent
              ? status === 401 || status === 403
                ? 'auth'
                : 'refused'
              : 'retries',
          })

          if (!written) {
            // THE RECEIPT IS NOT DELETED. Storage was full or unavailable, so
            // the queue is now the only copy of this delivery; deleting it
            // would destroy the count with nothing on screen and nothing on
            // disk. It is parked at the ceiling with the reason on it, which
            // the rail renders, and every later flush retries the record —
            // so the moment storage frees up it becomes an ordinary drop.
            // MEMORY FIRST. The disk just refused a write, so it cannot be
            // asked to remember that it refused one — and `localStoragePut`
            // swallows the refusal and resolves anyway, so the update below
            // reports success having written nothing. This line is what makes
            // the alarm certain; the update is what lets it survive a reload
            // when the disk recovers, and nothing depends on it landing.
            strandedThisSession.add(m.id)
            try {
              await offlineStorage.updatePendingMutation(m.id, {
                retryCount: MAX_ATTEMPTS,
                lastError: STRANDED_MARKER,
              })
            } catch {
              /* the entry itself survives, and the ledger above already holds
                 the strand for this session */
            }
            failed++
            stranded++
            continue
          }

          // Recorded. If an earlier pass stranded this id, it is a drop now —
          // one receipt, one alarm, and the drop pin is the one that names it.
          strandedThisSession.delete(m.id)
          try {
            await offlineStorage.removePendingMutation(m.id)
          } catch {
            // The record is already durable and keyed on this id, so a retry
            // that sees the entry again cannot double-count the loss — and the
            // reader excludes any entry that has a drop record, so an entry
            // that lingers here cannot be read as a strand either.
          }
          failed++
          dropped++
          continue
        }

        try {
          await offlineStorage.updatePendingMutation(m.id, {
            retryCount: m.retryCount + 1,
            lastError: (err as Error)?.message ?? 'sync failed',
          })
        } catch {
          /* the entry stays as it was and will be retried */
        }
        failed++
      }
    }
  } catch {
    // The walk itself came apart. Whatever was counted stands; the pass says
    // it cannot vouch for the rest.
    return result(true)
  }

  return result(false)
}

/**
 * Flush when the network returns and when the tab regains focus.
 * Returns a cleanup function.
 *
 * `onChange` is handed the flush result rather than called empty: a watcher
 * that only says "something changed" leaves the caller to re-read the pending
 * count, which falls by one whether the receipt was delivered or discarded.
 * The difference exists only here, so it is passed on.
 */
export function watchDoorOutbox(
  onChange?: (result: DoorFlushResult) => void,
): () => void {
  /**
   * The pass already reported. Two triggers firing together join ONE pass and
   * would otherwise hand the caller its single result twice. No caller in this
   * repo accumulates the counts any more — both door screens re-read instead,
   * and that is the durable fix — but the result is a public shape and a caller
   * that did accumulate would show two lost receipts where one was lost, so the
   * guard stays. Identity is the whole test: a later pass is a different promise.
   */
  let reported: Promise<DoorFlushResult> | null = null
  const run = () => {
    const pass = flushDoorOutbox()
    if (pass === reported) return
    reported = pass
    void pass.then((result) => onChange?.(result))
  }
  const onOnline = () => run()
  // Coming back to the tab is the other moment a receiver is likely to be
  // somewhere with signal — the walk from the loading dock to the office.
  const onVisible = () => {
    if (document.visibilityState === 'visible') run()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  run()
  // Both listeners, named for that reason: the visibility one used to be an
  // anonymous function the cleanup could not name, so every mount of the door
  // screen left one behind, flushing for a component that no longer exists.
  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
