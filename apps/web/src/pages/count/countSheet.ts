/**
 * A stock-take on paper (F-1544 lane 6): the count's sheet out, and the
 * filled-in sheet back in. No React here; `CountSheetPanel` draws it.
 *
 * Out: one line per item the books list on each shelf of the count, in walk
 * order, with the count's id, the shelf, the item and its code, and blank
 * "Full bottles", "Open (tenths)" and "Counted at" columns. A blind count:
 * never what the books expect, never a price.
 *
 * In, the ADR 0335 way (map by the header's own words, a preview that names
 * every line and shelf it refuses and why, nothing sent until the person
 * confirms), then into the walk's own path -- never a new one:
 *   - each counted line goes through the per-item count route with the
 *     count's id and the shelf (`recordSpotCount`, ADR 0078's one writer),
 *     with its age taken from the shelf's "Counted at", so a shelf that moved
 *     after it was counted is refused by the same rule as a late phone line
 *     (F-249 / F-880) and comes back as "count this shelf again";
 *   - a bottle the house does not carry is parked for the manager;
 *   - a shelf is said done only when every item on it has a number. A blank
 *     is never read as 0 (absence is not a count).
 * Every key is made from what the line says, so loading the same sheet twice
 * replays and posts nothing twice; a changed number is a second count of the
 * shelf, which the writer holds for the manager (F2 a).
 */

import type { CountSession, CountShelfItem } from '@/services/api/countSessions'
import type { TableExportColumn } from '@/lib/tableExport'
import { displayGroupMark, parseDecimal } from '@/lib/parseDecimal'
import { houseInstant } from '@/lib/houseCalendar'
import { MAX_TENTHS } from './countWalkModel'

/* ── out ─────────────────────────────────────────────────────────────── */

export interface SheetRow {
  sessionId: string
  shelf: string
  locationId: string
  item: string
  producer: string
  vintage: string
  inventoryId: string
}

/**
 * The count's sheet: every item on every shelf (not one counted whole, which
 * the walk does not count either), then one blank line per shelf for a bottle
 * found there that the books do not list.
 */
export function countSheetRows(session: CountSession): SheetRow[] {
  const rows: SheetRow[] = []
  const shelves = [...session.shelves].sort((a, b) => a.order - b.order)
  for (const s of shelves) {
    const base = { sessionId: session.id, shelf: s.name, locationId: s.locationId }
    for (const i of s.items) {
      if (i.countWhole) continue
      rows.push({
        ...base,
        item: i.name,
        producer: i.producer ?? '',
        vintage: i.vintage ?? '',
        inventoryId: i.inventoryId,
      })
    }
    rows.push({ ...base, item: '', producer: '', vintage: '', inventoryId: '' })
  }
  return rows
}

export const countSheetColumns: TableExportColumn<SheetRow>[] = [
  { header: 'Count', value: (r) => r.sessionId },
  { header: 'Shelf', value: (r) => r.shelf },
  { header: 'Shelf code', value: (r) => r.locationId },
  { header: 'Item', value: (r) => r.item },
  { header: 'Producer', value: (r) => r.producer },
  { header: 'Vintage', value: (r) => r.vintage },
  { header: 'Item code', value: (r) => r.inventoryId },
  { header: 'Full bottles', value: () => '' },
  { header: 'Open (tenths)', value: () => '' },
  { header: 'Counted at', value: () => '' },
]

/* ── in ──────────────────────────────────────────────────────────────── */

/** Header words folded: case, accents and Turkish i, punctuation to spaces. */
function foldHeader(s: string): string {
  return s
    .replace(/[İIı]/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A name folded for matching, the same way the walk's Find folds it. */
function foldName(s: string): string {
  return foldHeader(s)
}

const COLUMNS = {
  session: ['count', 'count id', 'sayim', 'sayim no'],
  shelf: ['shelf', 'location', 'raf', 'konum', 'yer'],
  shelfCode: ['shelf code', 'raf kodu'],
  item: ['item', 'wine', 'name', 'urun', 'sarap', 'urun adi', 'ad'],
  producer: ['producer', 'winery', 'uretici'],
  vintage: ['vintage', 'year', 'yil', 'rekolte'],
  itemCode: ['item code', 'urun kodu'],
  bottles: ['full bottles', 'bottles', 'qty', 'quantity', 'tam sise', 'sise', 'adet'],
  tenths: ['open tenths', 'open', 'acik', 'acik sise', 'acik onda'],
  countedAt: ['counted at', 'time', 'sayim saati', 'saat', 'zaman'],
} as const

type Col = keyof typeof COLUMNS

/**
 * A sheet opened and saved in Excel keeps what the export guarded against a
 * formula (`'=...`); the guard's quote is not part of the name.
 */
function cellOf(r: string[], i: number): string {
  if (i < 0) return ''
  const v = (r[i] ?? '').trim()
  return /^'[=+\-@]/.test(v) ? v.slice(1) : v
}

/**
 * When a shelf was counted, as the house's clock reads it, to the instant.
 * Read: `2026-10-13 01:30` (any locale), `13.10.2026 01:30` (day first), and
 * `10/13/2026 1:30 AM` -- slashes are month first for a US house and day
 * first elsewhere, the way that house's Excel writes them. Seconds and
 * AM/PM are optional. Null when it is not a real day and time.
 */
export function parseCountedAt(raw: string, zone: string | null | undefined, locale: string): number | null {
  const text = raw.trim().replace(/\s+/g, ' ')
  const time = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp])?\.?(?:[Mm]\.?)?`
  let y: number, mo: number, d: number
  let m = new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})[ T,]+${time}$`).exec(text)
  let rest: RegExpExecArray
  if (m) {
    y = Number(m[1])
    mo = Number(m[2])
    d = Number(m[3])
    rest = m
  } else {
    m = new RegExp(String.raw`^(\d{1,2})([./])(\d{1,2})\2(\d{4})[ ,]+${time}$`).exec(text)
    if (!m) return null
    const usHouse = /-us$/i.test(locale) || locale.toLowerCase() === 'en'
    const monthFirst = m[2] === '/' && usHouse
    d = Number(monthFirst ? m[3] : m[1])
    mo = Number(monthFirst ? m[1] : m[3])
    y = Number(m[4])
    // Line the time groups up with the first form's (4, 5, 6, 7).
    rest = [m[0], m[1], m[3], m[4], m[5], m[6], m[7], m[8]] as unknown as RegExpExecArray
  }
  let h = Number(rest[4])
  const mi = Number(rest[5])
  const ampm = rest[7]?.toLowerCase()
  if (ampm) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (ampm === 'p' ? 12 : 0)
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  const day = new Date(Date.UTC(y, mo - 1, d))
  if (day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return null
  return houseInstant(zone, y, mo, d, h, mi) ?? new Date(y, mo - 1, d, h, mi).getTime()
}

export interface SheetRefused {
  line: number
  label: string
  reason: string
}

export interface SheetLine {
  line: number
  inventoryId: string
  name: string
  sealed: number
  tenths: number | null
}

export interface SheetParked {
  line: number
  description: string
  sealed: number
  /** The line named an open bottle, which a parked line cannot keep. */
  openDropped: boolean
}

export interface SheetShelf {
  locationId: string
  name: string
  countedAt: number
  lines: SheetLine[]
  parked: SheetParked[]
  /** Every item the books list here has a number, so the shelf is said done. */
  closes: boolean
  /** Items the books list here with no number: the shelf stays not counted. */
  notCounted: string[]
  alreadyDone: boolean
}

export interface CountSheetPlan {
  fileProblem: string | null
  shelves: SheetShelf[]
  refused: SheetRefused[]
  refusedShelves: Array<{ name: string; reason: string; lines: number }>
}

export interface SheetItem {
  id: string
  name: string
  producer?: string | null
  vintage?: string | number | null
}

const MAX_BOTTLES = 10000
const SLACK_MS = 60_000

interface Draft {
  locationId: string
  name: string
  times: Array<{ raw: string; at: number | null }>
  lines: SheetLine[]
  parked: SheetParked[]
}

/**
 * Sorts a filled-in count sheet into what will be sent, shelf by shelf, and
 * what will not, with the reason in plain words. Sends nothing.
 */
export function planCountSheet(
  rows: string[][],
  ctx: {
    session: CountSession
    /** The house's items, for a bottle written in by name. */
    items: SheetItem[]
    zone: string | null | undefined
    locale: string
    now: number
  },
): CountSheetPlan {
  const plan: CountSheetPlan = { fileProblem: null, shelves: [], refused: [], refusedShelves: [] }
  const { session } = ctx
  if (session.status === 'abandoned') {
    plan.fileProblem = 'This count was stopped, so nothing can be added to it.'
    return plan
  }
  if (rows.length < 2) {
    plan.fileProblem = 'The sheet has no lines under its header row.'
    return plan
  }
  const header = rows[0].map(foldHeader)
  const col = {} as Record<Col, number>
  for (const k of Object.keys(COLUMNS) as Col[]) {
    col[k] = header.findIndex((h) => (COLUMNS[k] as readonly string[]).includes(h))
  }
  if ((col.shelf < 0 && col.shelfCode < 0) || (col.item < 0 && col.itemCode < 0) || col.bottles < 0) {
    plan.fileProblem =
      'The sheet needs its Shelf, Item and Full bottles columns, so nothing could be read. Download the count sheet and fill that one in.'
    return plan
  }

  const group = displayGroupMark(ctx.locale)
  const shelves = session.shelves
  const drafts = new Map<string, Draft>()
  const seen = new Map<string, number>()
  let mine = 0
  let foreign = 0

  rows.slice(1).forEach((r, i) => {
    const line = i + 2
    const at = (k: Col) => cellOf(r, col[k])
    const itemText = at('item')
    const refuse = (reason: string) =>
      plan.refused.push({ line, label: itemText || at('itemCode') || `Line ${line}`, reason })

    const sid = at('session')
    if (sid && sid !== session.id) {
      foreign += 1
      if (at('bottles') || at('tenths')) refuse('This line is from another count.')
      return
    }
    if (sid) mine += 1

    // The shelf: its code from the sheet, else its name.
    const code = at('shelfCode')
    const shelfName = at('shelf')
    let shelf = code ? shelves.find((s) => s.locationId === code) : undefined
    let shelfProblem: string | null = null
    if (!shelf) {
      const named = shelfName ? shelves.filter((s) => foldName(s.name) === foldName(shelfName)) : []
      if (named.length === 1) shelf = named[0]
      else if (named.length > 1)
        shelfProblem = `Two shelves in this count are called "${shelfName}". Keep the Shelf code from the sheet.`
      else if (shelfName || code) shelfProblem = `No shelf called "${shelfName || code}" in this count.`
      else shelfProblem = 'No shelf on this line.'
    }

    let draft: Draft | undefined
    if (shelf) {
      draft = drafts.get(shelf.locationId)
      if (!draft) {
        draft = { locationId: shelf.locationId, name: shelf.name, times: [], lines: [], parked: [] }
        drafts.set(shelf.locationId, draft)
      }
      const t = at('countedAt')
      if (t) draft.times.push({ raw: t, at: parseCountedAt(t, ctx.zone, ctx.locale) })
    }

    const bottlesRaw = at('bottles')
    const tenthsRaw = at('tenths')
    // Nothing written: not counted. Never read as 0.
    if (!bottlesRaw && !tenthsRaw) return
    if (!shelf || !draft) return refuse(shelfProblem ?? 'No shelf on this line.')
    if (!bottlesRaw) return refuse('Write the full bottles too, 0 if there are none.')
    const sealed = parseDecimal(bottlesRaw, group)
    if (sealed === null || !Number.isInteger(sealed) || sealed < 0 || sealed > MAX_BOTTLES) {
      return refuse(`"${bottlesRaw}" is not a number of full bottles (a whole number).`)
    }
    let tenths: number | null = null
    if (tenthsRaw) {
      const t = parseDecimal(tenthsRaw, group)
      if (t === null || !Number.isInteger(t) || t < 0 || t > MAX_TENTHS) {
        return refuse(`"${tenthsRaw}" is not tenths of a bottle (a whole number: 5 is half a bottle).`)
      }
      tenths = t
    }

    // The item: its code from the sheet, else its name (and year, and maker).
    const itemCode = at('itemCode')
    let item: SheetItem | CountShelfItem | undefined
    let itemId = ''
    if (itemCode) {
      const listed = shelf.items.find((x) => x.inventoryId === itemCode)
      const house = ctx.items.find((x) => x.id === itemCode)
      item = listed ?? house
      itemId = listed?.inventoryId ?? house?.id ?? ''
      if (!itemId) return refuse("The Item code is not one of this house's items.")
    } else {
      if (!itemText) return refuse('No item on this line.')
      const vintage = at('vintage')
      const producer = at('producer')
      const fits = (name: string, v: string | number | null | undefined, p: string | null | undefined) =>
        foldName(name) === foldName(itemText) &&
        (!vintage || String(v ?? '') === vintage) &&
        (!producer || !p || foldName(p) === foldName(producer))
      const onShelf = shelf.items.filter((x) => fits(x.name, x.vintage, x.producer))
      const inHouse = onShelf.length ? [] : ctx.items.filter((x) => fits(x.name, x.vintage, x.producer))
      const hits: Array<{ id: string; v: SheetItem | CountShelfItem }> = onShelf.length
        ? onShelf.map((x) => ({ id: x.inventoryId, v: x }))
        : inHouse.map((x) => ({ id: x.id, v: x }))
      if (hits.length > 1) return refuse(`More than one item is called "${itemText}". Add its year or maker.`)
      if (hits.length === 0) {
        // Not one of the house's items: parked for the manager, never created.
        draft.parked.push({
          line,
          description: [itemText, producer, vintage].filter(Boolean).join(' '),
          sealed,
          openDropped: tenths !== null && tenths > 0,
        })
        return
      }
      item = hits[0].v
      itemId = hits[0].id
    }
    const listed = shelf.items.find((x) => x.inventoryId === itemId)
    if (listed?.countWhole) {
      return refuse('Some of this sits off the shelves. Count it on Inventory, all at once.')
    }
    const twice = `${shelf.locationId}:${itemId}`
    if (seen.has(twice)) {
      return refuse(`Also on line ${seen.get(twice)} for this shelf; the first line is used.`)
    }
    seen.set(twice, line)
    draft.lines.push({ line, inventoryId: itemId, name: item?.name ?? itemText, sealed, tenths })
  })

  if (foreign > 0 && mine === 0) {
    return {
      fileProblem: "This sheet is from another count. Download this count's sheet and fill that one in.",
      shelves: [],
      refused: [],
      refusedShelves: [],
    }
  }

  const openedAt = Date.parse(session.openedAt)
  for (const s of [...shelves].sort((a, b) => a.order - b.order)) {
    const d = drafts.get(s.locationId)
    if (!d || (d.lines.length === 0 && d.parked.length === 0)) continue
    const count = d.lines.length + d.parked.length
    const unread = d.times.find((t) => t.at === null)
    const instants = [...new Set(d.times.map((t) => t.at).filter((t): t is number => t !== null))]
    let reason: string | null = null
    if (unread) reason = `"${unread.raw}" could not be read as a time. Write it like 2026-10-13 01:30.`
    else if (instants.length === 0) reason = 'No time is written for when this shelf was counted.'
    else if (instants.length > 1) reason = 'Two different times are written for this shelf. Write one.'
    else if (instants[0] > ctx.now + SLACK_MS) reason = 'The time written for this shelf has not come yet.'
    else if (Number.isFinite(openedAt) && instants[0] < openedAt - SLACK_MS)
      reason = 'The time written for this shelf is before this count was opened.'
    if (reason) {
      plan.refusedShelves.push({ name: s.name, reason, lines: count })
      continue
    }
    const counted = new Set(d.lines.map((l) => l.inventoryId))
    const notCounted = s.items.filter((x) => !x.countWhole && !counted.has(x.inventoryId))
    plan.shelves.push({
      locationId: s.locationId,
      name: s.name,
      countedAt: instants[0],
      lines: d.lines,
      parked: d.parked,
      closes: !s.done && notCounted.length === 0,
      notCounted: notCounted.map((x) => [x.name, x.vintage].filter(Boolean).join(' ')),
      alreadyDone: s.done,
    })
  }
  return plan
}

/* ── send ────────────────────────────────────────────────────────────── */

/**
 * The keys a sheet's acts are sent under: made from what the sheet says, so
 * the same sheet loaded twice replays every act instead of posting it again.
 * The writer adds the item (`count:<item>:<key>`).
 */
export function sheetLineKey(sessionId: string, shelf: SheetShelf, l: SheetLine): string {
  return `sheet:${sessionId}:${shelf.locationId}:${shelf.countedAt}:${l.sealed}:${l.tenths ?? 'n'}`
}

export function sheetParkKey(sessionId: string, shelf: SheetShelf, p: SheetParked): string {
  return `sheet:${sessionId}:${shelf.locationId}:${shelf.countedAt}:${foldName(p.description).slice(0, 80)}:${p.sealed}`
}

export function sheetDoneKey(sessionId: string, shelf: SheetShelf): string {
  return `sheet:${sessionId}:${shelf.locationId}:${shelf.countedAt}`
}

export interface SheetSendApi {
  recordSpotCount: (
    itemId: string,
    body: {
      countedQty: number
      stockState: 'live'
      clientCountId: string
      reason: string
      countedAgoMs: number
      locationId: string
      sessionId: string
      opening?: boolean
      openTenths?: number
    },
  ) => Promise<{ count?: { held?: boolean } | null } | null | undefined>
  parkCountLine: (
    sessionId: string,
    body: { clientLineId: string; locationId: string; description: string; countedQty: number; countedAgoMs: number },
  ) => Promise<unknown>
  markCountShelfDone: (
    sessionId: string,
    locationId: string,
    body: { clientDoneId: string; zeroItemIds: string[]; countedAgoMs: number },
  ) => Promise<{ done: boolean; message?: string }>
}

export interface SheetShelfOutcome {
  name: string
  posted: number
  held: string[]
  parked: number
  /** The house refused these: the shelf is counted again. */
  refused: Array<{ name: string; reason: string }>
  /** Not sent (no signal, the house away): load the same sheet again. */
  notSent: string[]
  done: 'closed' | 'open' | 'already' | 'not-closed'
  doneMessage?: string
}

function statusOf(err: unknown): number {
  return Number((err as { response?: { status?: unknown } })?.response?.status ?? 0)
}

function said(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return typeof m === 'string' && m.trim() ? m : fallback
}

/** The house answered "no" for this line: anything else is worth sending again. */
const refusedBy = (status: number) => status === 400 || status === 403 || status === 404 || status === 409

/**
 * Sends a confirmed plan, shelf by shelf, through the walk's own path. Each
 * act's age is measured when it is sent, from the shelf's "Counted at".
 */
export async function sendCountSheet(
  plan: CountSheetPlan,
  session: Pick<CountSession, 'id' | 'kind'>,
  api: SheetSendApi,
  now: () => number = Date.now,
): Promise<SheetShelfOutcome[]> {
  const out: SheetShelfOutcome[] = []
  for (const shelf of plan.shelves) {
    const o: SheetShelfOutcome = {
      name: shelf.name,
      posted: 0,
      held: [],
      parked: 0,
      refused: [],
      notSent: [],
      done: shelf.alreadyDone ? 'already' : 'open',
    }
    const ago = () => Math.max(0, now() - shelf.countedAt)
    for (const l of shelf.lines) {
      try {
        const r = await api.recordSpotCount(l.inventoryId, {
          countedQty: l.sealed,
          stockState: 'live',
          clientCountId: sheetLineKey(session.id, shelf, l),
          reason: session.kind === 'opening' ? 'Opening stock, from a count sheet' : 'Stock-take, from a count sheet',
          countedAgoMs: ago(),
          locationId: shelf.locationId,
          sessionId: session.id,
          ...(session.kind === 'opening' ? { opening: true } : {}),
          ...(l.tenths !== null ? { openTenths: l.tenths } : {}),
        })
        if (r?.count?.held) o.held.push(l.name)
        else o.posted += 1
      } catch (err) {
        if (refusedBy(statusOf(err))) {
          o.refused.push({ name: l.name, reason: said(err, 'Count this shelf again.') })
        } else o.notSent.push(l.name)
      }
    }
    for (const p of shelf.parked) {
      try {
        await api.parkCountLine(session.id, {
          clientLineId: sheetParkKey(session.id, shelf, p),
          locationId: shelf.locationId,
          description: p.description,
          countedQty: p.sealed,
          countedAgoMs: ago(),
        })
        o.parked += 1
      } catch (err) {
        if (refusedBy(statusOf(err))) {
          o.refused.push({ name: p.description, reason: said(err, 'It could not be kept for the manager.') })
        } else o.notSent.push(p.description)
      }
    }
    // Done only when every line on it landed: a refused or unsent line means
    // the shelf is not counted yet, and a held one waits for the manager.
    if (shelf.closes) {
      if (o.refused.length || o.notSent.length) {
        o.done = 'not-closed'
      } else {
        try {
          const d = await api.markCountShelfDone(session.id, shelf.locationId, {
            clientDoneId: sheetDoneKey(session.id, shelf),
            zeroItemIds: [],
            countedAgoMs: ago(),
          })
          o.done = d.done ? 'closed' : 'not-closed'
          if (!d.done && d.message) o.doneMessage = d.message
        } catch (err) {
          o.done = 'not-closed'
          o.doneMessage = said(err, 'The shelf could not be said done. Load the sheet again.')
        }
      }
    }
    out.push(o)
  }
  return out
}
