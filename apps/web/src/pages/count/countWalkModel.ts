/**
 * The phone stock-take walk (F-1544 lane 3), as plain functions the screen
 * and its tests share. Nothing here talks to the network.
 *
 * The rules it keeps, from the decision draft (decision-phone-stock-count.md)
 * and the founder's 2026-10-12 answers (sim-ledger S224):
 *  - a blind count: the screen knows which items the books expect on a
 *    shelf, never how many;
 *  - every line posts as it syncs, as the person who counted it (F2 a);
 *  - open bottles are entered in tenths of a bottle and stored as ml by the
 *    one count writer (F3 a) -- the screen never converts;
 *  - "shelf done" is said out loud: the items not touched are listed and
 *    confirmed, then each posts as 0. Absence is never read as zero.
 */

import type {
  CountSession,
  CountSessionKind,
  CountShelf,
  CountShelfItem,
  ShelfDoneResult,
} from '../../services/api/countSessions'

export type LineState = 'sent' | 'saved' | 'held' | 'refused'

/** One counted (item, shelf) on this phone. */
export interface WalkLine {
  locationId: string
  itemId: string
  itemLabel: string
  sealed: number
  /** Tenths of a bottle left in the open bottles; null = open bottles not counted. */
  tenths: number | null
  clientCountId: string
  /** The moment of the tap, on this phone's clock. */
  at: string
  state: LineState
  message?: string
}

export interface WalkDone {
  clientDoneId: string
  state: 'sent' | 'saved' | 'refused'
  /** Items the house refused to zero because their bottles moved. */
  recount?: string[]
  message?: string
}

export interface WalkPark {
  clientLineId: string
  locationId: string
  description: string
  countedQty: number
  /** Tenths of a bottle left open, as entered; null or absent = not counted. */
  openTenths?: number | null
  state: 'sent' | 'saved'
}

/**
 * A parked line as the walk shows it after parking: "Raki, 3, 5/10 of a
 * bottle open, for the manager" -- the open amount in tenths, as entered.
 */
export function parkedWords(p: WalkPark): string {
  const open = p.openTenths != null && p.openTenths > 0 ? `, ${tenthsWords(p.openTenths)}` : ''
  return `${p.description}: ${p.countedQty}${open}, for the manager${p.state === 'saved' ? ' (saved on this phone)' : ''}`
}

/** What this phone remembers of one person's walk of one count. */
export interface WalkRecord {
  lines: Record<string, WalkLine>
  /** Items found by search on a shelf whose books do not expect them. */
  extras: Record<string, CountShelfItem[]>
  dones: Record<string, WalkDone>
  parked: WalkPark[]
  /** F-1544 lane 4: the round of each shelf this phone last saw. */
  rounds?: Record<string, number>
}

export const emptyWalk = (): WalkRecord => ({ lines: {}, extras: {}, dones: {}, parked: [] })

/**
 * F-1544 lane 4. A manager sent a shelf back to be counted again: this phone
 * forgets its "done" for that shelf and the lines it counted there before the
 * ask, so the shelf reads as not started and every item can be counted anew.
 * Lines counted after the ask stay. What was already sent stays sent on the
 * house's books; only this phone's copy is forgotten. The ask's time is the
 * house's clock and a line's is this phone's, so a phone whose clock runs
 * far behind forgets a line taken just after the ask -- it is then counted
 * once more, never lost.
 */
export function forgetRecounted(
  walk: WalkRecord,
  session: Pick<CountSession, 'shelves'>,
): { walk: WalkRecord; forgot: string[] } {
  const seen = walk.rounds ?? {}
  const forgot: string[] = []
  const lines = { ...walk.lines }
  const dones = { ...walk.dones }
  const rounds = { ...seen }
  for (const shelf of session.shelves) {
    const round = shelf.round ?? 0
    if (round <= (seen[shelf.locationId] ?? 0)) continue
    rounds[shelf.locationId] = round
    const asked = shelf.recountAskedAt ? Date.parse(shelf.recountAskedAt) : NaN
    let changed = false
    for (const [k, l] of Object.entries(lines)) {
      if (l.locationId !== shelf.locationId) continue
      if (Number.isFinite(asked) && Date.parse(l.at) >= asked) continue
      delete lines[k]
      changed = true
    }
    if (dones[shelf.locationId]) {
      delete dones[shelf.locationId]
      changed = true
    }
    if (changed) forgot.push(shelf.locationId)
  }
  const moved = Object.keys(rounds).some((k) => rounds[k] !== seen[k])
  if (!moved) return { walk, forgot }
  return { walk: { ...walk, lines, dones, rounds }, forgot }
}

export const lineKey = (locationId: string, itemId: string) => `${locationId}:${itemId}`

/** The largest open part one line takes: ten open bottles. */
export const MAX_TENTHS = 100

/** The stock-take's name, as a person says it. */
export function kindWords(kind: CountSessionKind): string {
  switch (kind) {
    case 'closing':
      return 'Closing count'
    case 'month_end':
      return 'Month-end count'
    case 'opening':
      return 'Opening stock'
    default:
      return 'Full count'
  }
}

/**
 * Tenths in words, with a slash, never a decimal point: a Turkish house
 * writes 0,7 and a US one 0.7, and "7/10" reads the same in both.
 */
export function tenthsWords(tenths: number | null): string {
  if (tenths == null) return 'Open bottle not counted'
  if (tenths === 0) return 'No open bottle'
  const whole = Math.floor(tenths / 10)
  const part = tenths % 10
  const bottles = whole === 1 ? '1 bottle' : `${whole} bottles`
  if (whole === 0) return `${part}/10 of a bottle open`
  if (part === 0) return `${bottles} open`
  return `${bottles} and ${part}/10 open`
}

/** One step of the open-bottle stepper. Below none is "not counted". */
export function stepTenths(tenths: number | null, by: 1 | -1): number | null {
  if (tenths == null) return by === 1 ? 1 : null
  const next = tenths + by
  if (next < 0) return null
  return Math.min(MAX_TENTHS, next)
}

export function stepSealed(sealed: number, by: 1 | -1): number {
  return Math.max(0, sealed + by)
}

/** A typed bottle count: a whole number at or above nothing, else null. */
export function readSealed(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,5}$/.test(t)) return null
  return Number(t)
}

/** The items this shelf's walk shows: the books' list, then any found by search. */
export function itemsOnShelf(shelf: CountShelf, walk: WalkRecord): CountShelfItem[] {
  const listed = new Set(shelf.items.map((i) => i.inventoryId))
  const extra = (walk.extras[shelf.locationId] ?? []).filter((i) => !listed.has(i.inventoryId))
  return [...shelf.items, ...extra]
}

/**
 * The items the books expect on this shelf that this phone has not counted
 * there -- what "shelf done" posts as 0, once the person confirms. An item
 * counted whole (F-945) is never zeroed from one shelf: a shelf count of it
 * would book its off-shelf bottles a second time.
 */
export function untouchedOnShelf(shelf: CountShelf, walk: WalkRecord): CountShelfItem[] {
  return shelf.items.filter(
    (i) => !i.countWhole && !walk.lines[lineKey(shelf.locationId, i.inventoryId)],
  )
}

/**
 * The house's answer to a "shelf done" that did not close the shelf
 * (F-1616, F-1619), kept on this phone: which items to count again, and the
 * zeros that did post, written as this shelf's lines so they read as counted
 * and the next "done" does not send them again. Same for an answer that came
 * straight back and one a queued "done" got later.
 */
export function refusedDone(
  walk: WalkRecord,
  shelf: Pick<CountShelf, 'locationId' | 'items'>,
  clientDoneId: string,
  answer: Pick<ShelfDoneResult, 'posted' | 'held' | 'refused' | 'message'>,
  at: string,
): WalkRecord {
  const lines = { ...walk.lines }
  const label = new Map(shelf.items.map((i) => [i.inventoryId, [i.name, i.vintage].filter(Boolean).join(' ')]))
  const zero = (itemId: string, state: LineState) => {
    const k = lineKey(shelf.locationId, itemId)
    if (lines[k]) return
    lines[k] = {
      locationId: shelf.locationId,
      itemId,
      itemLabel: label.get(itemId) ?? '',
      sealed: 0,
      tenths: 0,
      clientCountId: `shelf-done:${clientDoneId}`,
      at,
      state,
    }
  }
  for (const id of answer.posted ?? []) zero(id, 'sent')
  for (const id of answer.held ?? []) zero(id, 'held')
  return {
    ...walk,
    lines,
    dones: {
      ...walk.dones,
      [shelf.locationId]: {
        clientDoneId,
        state: 'refused',
        recount: (answer.refused ?? []).map((r) => r.inventoryId),
        message: answer.message,
      },
    },
  }
}

/** How a shelf reads on the list. */
export function shelfStatus(
  shelf: CountShelf,
  walk: WalkRecord,
): { tone: 'done' | 'mine' | 'theirs' | 'open' | 'recount' | 'saved'; words: string } {
  const mine = walk.dones[shelf.locationId]
  if (mine?.state === 'refused') return { tone: 'recount', words: 'Count again' }
  if (mine?.state === 'saved') return { tone: 'saved', words: 'Done, saved on this phone' }
  if (shelf.done || mine?.state === 'sent') {
    return { tone: 'done', words: shelf.doneBy ? `Done by ${shelf.doneBy}` : 'Done' }
  }
  if (shelf.claimedByMe) return { tone: 'mine', words: 'Yours' }
  if (shelf.claimedBy) return { tone: 'theirs', words: `${shelf.claimedBy} is counting` }
  return { tone: 'open', words: 'Not started' }
}

/** The next shelf to walk after `from`: the first one not done, in walk order. */
export function nextShelf(
  shelves: CountShelf[],
  walk: WalkRecord,
  from: string | null,
): CountShelf | null {
  const open = (s: CountShelf) => {
    const t = shelfStatus(s, walk).tone
    return t !== 'done' && t !== 'saved' && t !== 'theirs'
  }
  const i = from ? shelves.findIndex((s) => s.locationId === from) : -1
  return shelves.slice(i + 1).find(open) ?? shelves.slice(0, Math.max(0, i)).find(open) ?? null
}

/** Folds case and accents, Turkish dotted and dotless i included. */
export function fold(text: string): string {
  return text
    .replace(/[İIı]/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export interface FindableItem {
  id: string
  name: string
  /** The library's own name, searched but never shown (ADR 0124: both names searchable). */
  alsoKnownAs?: string | null
  producer?: string | null
  vintage?: string | number | null
}

/** The house's items whose name (the house's or the library's), maker or year hold every word typed. */
export function findItems<T extends FindableItem>(items: T[], query: string, limit = 8): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return items
    .filter((it) => {
      const hay = fold(`${it.name} ${it.alsoKnownAs ?? ''} ${it.producer ?? ''} ${it.vintage ?? ''}`)
      return words.every((w) => hay.includes(w))
    })
    .slice(0, limit)
}

/**
 * The body a walk line is posted with, through the existing per-item count
 * route (ADR 0078's one writer). `sessionId` makes it a line of this walk;
 * the shelf is always named (the walk counts leaf shelves); open bottles go
 * only when counted.
 */
export function lineBody(sessionId: string, kind: CountSessionKind, line: WalkLine) {
  return {
    countedQty: line.sealed,
    stockState: 'live' as const,
    clientCountId: line.clientCountId,
    reason: kind === 'opening' ? 'Opening stock' : 'Stock-take',
    locationId: line.locationId,
    sessionId,
    ...(line.tenths != null ? { openTenths: line.tenths } : {}),
    ...(kind === 'opening' ? { opening: true } : {}),
  }
}

/** Where this phone keeps one person's walk of one count, in one house. */
export function walkStorageKey(house: string, userId: string, sessionId: string): string {
  return `mdv:count-walk:${house}:${userId}:${sessionId}`
}

export function pullStorageKey(house: string, userId: string, sessionId: string): string {
  return `mdv:count-pull:${house}:${userId}:${sessionId}`
}

/** Browser storage can be missing or refuse; the walk then lives in memory. */
export function readStored<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* kept in memory for this visit */
  }
}

export function readWalk(key: string): WalkRecord {
  const w = readStored<Partial<WalkRecord>>(key)
  return {
    lines: w?.lines ?? {},
    extras: w?.extras ?? {},
    dones: w?.dones ?? {},
    parked: w?.parked ?? [],
    ...(w?.rounds ? { rounds: w.rounds } : {}),
  }
}

/** A key made once at the tap and reused on every retry. */
export function newWalkId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
