/**
 * CountWalk -- `/count/:sessionId`, the phone stock-take (F-1544 lane 3).
 *
 * A bartender at a shelf, one hand, maybe no signal. The page is phone width
 * and outside the app shell, like the door (App.tsx): every menu would be a
 * tap in the way. It states its own ground (charcoal), because a bar at
 * closing is dark.
 *
 * What it does, from the decision draft and the founder's 2026-10-12 picks
 * (F2 a no approval, F3 a tenths, F4 a phone-width web first):
 *  1. pulls the count: shelves in walk order and the items expected on each,
 *     never how many (a blind count) -- and keeps that copy on this phone, so
 *     a cellar with no signal can still be walked;
 *  2. takes a shelf while there is signal; taken with none, it says so;
 *  3. each item is counted in bottles, plus the open bottle in tenths, and
 *     posts at once as this person through the existing count route with the
 *     count's id -- or is saved on this phone and sent when the signal is
 *     back (the spot-count queue, ADR 0241);
 *  4. "Shelf done" lists the items not counted and asks before each posts as
 *     0; a shelf never said done stays not counted;
 *  5. a bottle the house does not carry is parked for the manager, never
 *     created here.
 * No money and no expected figure is ever shown here, to anyone.
 *
 * F-1628: the page names its house and offers the person's other houses; a
 * switch goes back to `/count`, because this count is the house left. F-1629:
 * a link to a count in another of their houses offers to open it there.
 * F-1617: an owner or a manager can stop the count from here.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CloudOff, Minus, Plus, Search } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  claimCountShelf,
  periodWords,
  pullCountSession,
  type CountSession,
  type CountShelf,
  type CountShelfItem,
} from '@/services/api/countSessions'
import { getInventory } from '@/services/api/inventory'
import { offlineStorage } from '@/lib/offline-storage'
import {
  PARK_TYPE,
  SHELF_DONE_TYPE,
  SPOT_COUNTS_CHANGED_EVENT,
  submitParkedLine,
  submitShelfDone,
  submitSpotCount,
  watchSpotCountOutbox,
  type QueuedShelfDone,
  type QueuedSpotCount,
} from '@/lib/spotCountOutbox'
import {
  findItems,
  forgetRecounted,
  itemsOnShelf,
  kindWords,
  lineBody,
  lineKey,
  newWalkId,
  nextShelf,
  parkedWords,
  pullStorageKey,
  readSealed,
  readStored,
  readWalk,
  refusedDone,
  shelfStatus,
  stepSealed,
  stepTenths,
  tenthsWords,
  untouchedOnShelf,
  walkStorageKey,
  writeStored,
  type FindableItem,
  type WalkLine,
  type WalkRecord,
} from './countWalkModel'
import { CountHeldElsewhere, CountHouseLine, StopCount } from './CountHouse'

const TAP = 'min-h-[56px] min-w-[56px]'
const BTN = `${TAP} rounded-xl px-4 text-base font-semibold`
const PRIMARY = `${BTN} bg-wine-600 text-white active:bg-wine-700 disabled:opacity-50`
const QUIET = `${BTN} bg-white/10 text-inkm-1 active:bg-white/20`

/** The house's own sentence for a refusal, else a plain one. */
function saidBy(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return typeof m === 'string' && m.trim() ? m : fallback
}

function itemTitle(i: CountShelfItem): string {
  return [i.name, i.vintage].filter(Boolean).join(' ')
}

export default function CountWalk() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const { user, activeRestaurantId, activeRole } = useAuth()
  const house = activeRestaurantId || user?.restaurantId || ''
  const userId = user?.userId ?? ''
  const manager = activeRole === 'owner' || activeRole === 'manager'
  const wKey = walkStorageKey(house, userId, sessionId)
  const pKey = pullStorageKey(house, userId, sessionId)

  const [session, setSession] = useState<CountSession | null>(() => readStored<CountSession>(pKey))
  const [fromPhone, setFromPhone] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [walk, setWalkState] = useState<WalkRecord>(() => readWalk(wKey))
  const [shelfId, setShelfId] = useState<string | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [notice, setNotice] = useState<string | null>(null)
  const [takeOver, setTakeOver] = useState<string | null>(null)
  const [provisional, setProvisional] = useState<Record<string, boolean>>({})
  // F-1677: a shelf someone else finished, asked about before it is counted again.
  const [recountAsk, setRecountAsk] = useState<string | null>(null)

  const setWalk = useCallback(
    (fn: (w: WalkRecord) => WalkRecord) =>
      setWalkState((prev) => {
        const next = fn(prev)
        writeStored(wKey, next)
        return next
      }),
    [wKey],
  )

  const load = useCallback(async () => {
    try {
      const s = await pullCountSession(sessionId)
      // F-1544 lane 4: a shelf a manager sent back reads as not started.
      setWalk((w) => forgetRecounted(w, s).walk)
      setSession(s)
      setFromPhone(false)
      setLoadError(null)
      writeStored(pKey, s)
    } catch (err) {
      if (readStored<CountSession>(pKey)) setFromPhone(true)
      else setLoadError(saidBy(err, 'The count could not be read. Check the signal and try again.'))
    }
  }, [sessionId, pKey, setWalk])

  /**
   * What the queue says about this walk: a line or a "done" saved on this
   * phone that the house refused, and -- only when `flushed` -- one that has
   * since gone through. Missing from the queue is not proof of "sent" (a
   * read that falls back to an empty store looks the same), so a saved act is
   * called sent only right after the outbox reports it sent something.
   */
  const readQueue = useCallback(async (flushed = false) => {
    try {
      const counts = (await offlineStorage.getPendingMutationsByType('inventory.spotCount')) ?? []
      const dones = (await offlineStorage.getPendingMutationsByType(SHELF_DONE_TYPE)) ?? []
      const parks = (await offlineStorage.getPendingMutationsByType(PARK_TYPE)) ?? []
      const byCountId = new Map(
        counts
          .filter((m) => (m.data as QueuedSpotCount)?.body?.sessionId === sessionId)
          .map((m) => [(m.data as QueuedSpotCount).body.clientCountId, m]),
      )
      const byDoneId = new Map(
        dones
          .filter((m) => (m.data as QueuedShelfDone)?.sessionId === sessionId)
          .map((m) => [(m.data as QueuedShelfDone).body.clientDoneId, m]),
      )
      const parkIds = new Set(
        parks.map((m) => (m.data as { body?: { clientLineId?: string } })?.body?.clientLineId),
      )
      setWalk((w) => {
        const lines = { ...w.lines }
        for (const [k, l] of Object.entries(lines)) {
          if (l.state !== 'saved') continue
          const m = byCountId.get(l.clientCountId)
          if (!m) {
            if (flushed) lines[k] = { ...l, state: 'sent' }
          }
          else if (m.parked?.reason === 'refused')
            lines[k] = { ...l, state: 'refused', message: m.lastError ?? 'Count it again.' }
        }
        const done = { ...w.dones }
        // F-1619: a queued "done" the house answered "count again" keeps
        // which items to count again and the zeros that did post.
        const answered: Array<[string, string, NonNullable<QueuedShelfDone['answer']>, string]> = []
        for (const [loc, d] of Object.entries(done)) {
          if (d.state !== 'saved') continue
          const m = byDoneId.get(d.clientDoneId)
          if (!m) {
            if (flushed) done[loc] = { ...d, state: 'sent' }
          }
          else if (m.parked?.reason === 'refused') {
            const q = m.data as QueuedShelfDone
            if (q.answer) answered.push([loc, d.clientDoneId, q.answer, q.countedAt ?? new Date().toISOString()])
            else done[loc] = { ...d, state: 'refused', message: m.lastError ?? undefined }
          }
        }
        const parked = w.parked.map((p) =>
          flushed && p.state === 'saved' && !parkIds.has(p.clientLineId) ? { ...p, state: 'sent' as const } : p,
        )
        let next: WalkRecord = { ...w, lines, dones: done, parked }
        const shelves = readStored<CountSession>(pKey)?.shelves ?? []
        for (const [loc, doneId, answer, at] of answered) {
          next = refusedDone(next, shelves.find((x) => x.locationId === loc) ?? { locationId: loc, items: [] }, doneId, answer, at)
        }
        return next
      })
    } catch {
      /* the queue could not be read; the walk keeps what it showed */
    }
  }, [sessionId, setWalk, pKey])

  useEffect(() => {
    void load()
    void readQueue()
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    // A refusal parked in the queue: read it, and pull the list again, since
    // a refused "done" may come from a list the books have moved on from (F-1616).
    const changed = () => {
      void readQueue()
      void load()
    }
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    window.addEventListener(SPOT_COUNTS_CHANGED_EVENT, changed)
    const stop = watchSpotCountOutbox(() => {
      void readQueue(true)
      void load()
    })
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
      window.removeEventListener(SPOT_COUNTS_CHANGED_EVENT, changed)
      stop()
    }
  }, [load, readQueue])

  const shelf = session?.shelves.find((s) => s.locationId === shelfId) ?? null
  const ended = !!session && session.status !== 'open'
  const lockedOut = session?.kind === 'opening' && !manager

  const openShelf = async (s: CountShelf, force = false) => {
    setNotice(null)
    setTakeOver(null)
    setRecountAsk(null)
    // F-1677: someone else finished this shelf. Say who, and ask first: a
    // second count of what they counted goes to the manager to pick.
    if (s.done && !s.claimedByMe && !walk.dones[s.locationId] && !ended && !lockedOut) {
      setRecountAsk(s.locationId)
      return
    }
    if (s.claimedByMe || s.done) {
      setShelfId(s.locationId)
      return
    }
    // F-1660: an ended count is not counted any more. A shelf this phone
    // already worked opens to show what it saved; no other shelf opens.
    if (ended) {
      const worked =
        Object.values(walk.lines).some((l) => l.locationId === s.locationId) ||
        !!walk.dones[s.locationId] ||
        walk.parked.some((p) => p.locationId === s.locationId)
      if (worked) setShelfId(s.locationId)
      else setNotice('This count has ended, so this shelf is not counted now.')
      return
    }
    if (!navigator.onLine) {
      // A claim needs the signal. Taken here it is not held for anyone, and
      // nothing sends it later (F-1676): the page says so, not that it will.
      setProvisional((p) => ({ ...p, [s.locationId]: true }))
      setShelfId(s.locationId)
      return
    }
    try {
      await claimCountShelf(sessionId, s.locationId, force)
      setSession((cur) =>
        cur && {
          ...cur,
          shelves: cur.shelves.map((x) =>
            x.locationId === s.locationId ? { ...x, claimedByMe: true, claimedBy: null } : x,
          ),
        },
      )
      setShelfId(s.locationId)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 409) {
        setNotice(saidBy(err, 'Someone else is counting this shelf. Pick another one.'))
        if (manager && !force) setTakeOver(s.locationId)
        return
      }
      // No answer: walk it anyway, said as taken on this phone only.
      setProvisional((p) => ({ ...p, [s.locationId]: true }))
      setShelfId(s.locationId)
    }
  }

  if (!session) {
    return (
      <Frame online={online} title="Stock count" onBack={() => navigate('/count')}>
        <p className="px-4 py-8 text-center text-inkm-2" role={loadError ? 'alert' : undefined}>
          {loadError ?? 'Getting the shelves…'}
        </p>
        {loadError && (
          <div className="space-y-3 px-4">
            <CountHeldElsewhere sessionId={sessionId} />
            <button type="button" className={`${QUIET} w-full`} onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}
      </Frame>
    )
  }

  if (shelf) {
    return (
      <Frame online={online} title={shelf.name} onBack={() => setShelfId(null)}>
        <ShelfWalk
          key={shelf.locationId}
          session={session}
          shelf={shelf}
          house={house}
          walk={walk}
          setWalk={setWalk}
          provisional={!!provisional[shelf.locationId]}
          lockedOut={lockedOut || ended}
          reload={() => void load()}
          onFinished={(said) => {
            const next = nextShelf(session.shelves, walk, shelf.locationId)
            setShelfId(null)
            setNotice([said, next ? `Next: ${next.name}` : 'Every shelf is done or taken.'].filter(Boolean).join(' '))
            void load()
          }}
        />
      </Frame>
    )
  }

  const doneCount = session.shelves.filter((s) => shelfStatus(s, walk).tone === 'done').length
  return (
    <Frame
      online={online}
      title={`${kindWords(session.kind)}${session.period ? ` · ${periodWords(session.period)}` : ''}`}
      onBack={() => navigate('/count')}
    >
      <div className="space-y-3 px-4 py-4">
        <p className="text-sm text-inkm-2">
          {doneCount} of {session.shelves.length} shelves done
        </p>
        {manager && (
          <button
            type="button"
            data-ux-key="count:review"
            className={`${QUIET} w-full`}
            onClick={() => navigate(`/count/${sessionId}/review`)}
          >
            Review and sign off
          </button>
        )}
        {manager && !ended && !fromPhone && (
          <StopCount
            sessionId={sessionId}
            onStopped={() => {
              setNotice('This count is stopped. What was counted stays on the books.')
              void load()
            }}
          />
        )}
        {fromPhone && (
          <p className="rounded-xl bg-white/5 px-3 py-2 text-sm text-inkm-2">
            No signal: this is the list saved on this phone.
          </p>
        )}
        {ended && (
          <p className="rounded-xl bg-white/5 px-3 py-2 text-sm text-inkm-2">
            This count has ended, so nothing more is counted on it. What this phone saved before it ended is
            still sent.
          </p>
        )}
        {lockedOut && (
          <p role="alert" className="rounded-xl bg-white/5 px-3 py-2 text-sm text-inkm-1">
            Only an owner or a manager counts opening stock.
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-xl bg-white/10 px-3 py-2 text-sm text-inkm-1">
            {notice}
          </p>
        )}
        {recountAsk &&
          (() => {
            const s = session.shelves.find((x) => x.locationId === recountAsk)
            if (!s) return null
            return (
              <div role="status" className="space-y-2 rounded-xl bg-white/10 px-3 py-2 text-sm text-inkm-1">
                <p>
                  {s.doneBy ?? 'Someone'} finished {s.name}. Anything you count again there goes to the manager to
                  pick.
                </p>
                <button
                  type="button"
                  className={`${QUIET} w-full`}
                  onClick={() => {
                    setRecountAsk(null)
                    setShelfId(s.locationId)
                  }}
                >
                  Count it again
                </button>
              </div>
            )
          })()}
        {takeOver && (
          <button
            type="button"
            className={`${QUIET} w-full`}
            onClick={() => {
              const s = session.shelves.find((x) => x.locationId === takeOver)
              if (s) void openShelf(s, true)
            }}
          >
            Take this shelf over
          </button>
        )}
        <ol className="space-y-2">
          {session.shelves.map((s) => {
            const st = shelfStatus(s, walk)
            return (
              <li key={s.locationId}>
                <button
                  type="button"
                  data-ux-key="count:shelf"
                  disabled={lockedOut}
                  onClick={() => void openShelf(s)}
                  className={`${TAP} flex w-full items-center justify-between rounded-xl bg-white/5 px-4 text-left active:bg-white/10 disabled:opacity-50`}
                >
                  <span className="font-semibold text-inkm-1">{s.name}</span>
                  <span
                    className={`text-sm ${st.tone === 'recount' ? 'font-semibold text-amber-300' : 'text-inkm-2'}`}
                  >
                    {st.words}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </Frame>
  )
}

function Frame({
  online,
  title,
  onBack,
  children,
}: {
  online: boolean
  title: string
  onBack: () => void
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div
      className="mudavym mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-paper-0 text-inkm-1"
      data-ground="charcoal"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-2 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className={`${TAP} flex items-center justify-center rounded-xl text-inkm-2`}
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
        {!online && (
          <span className="flex items-center gap-1 pr-2 text-sm text-amber-300" aria-live="polite">
            <CloudOff className="h-4 w-4" /> No signal
          </span>
        )}
      </div>
      <CountHouseLine onSwitched={() => navigate('/count')} />
      {children}
    </div>
  )
}

function Stepper({
  label,
  value,
  onStep,
  children,
}: {
  label: string
  value: string
  onStep: (by: 1 | -1) => void
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={`${label}: one less`}
        onClick={() => onStep(-1)}
        className={`${TAP} flex items-center justify-center rounded-xl bg-white/10 active:bg-white/20`}
      >
        <Minus className="h-6 w-6" />
      </button>
      <div className="flex-1 text-center">{children ?? <span className="text-lg font-semibold">{value}</span>}</div>
      <button
        type="button"
        aria-label={`${label}: one more`}
        onClick={() => onStep(1)}
        className={`${TAP} flex items-center justify-center rounded-xl bg-white/10 active:bg-white/20`}
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  )
}

function lineWords(l: WalkLine): string {
  const bottles = l.sealed === 1 ? '1 bottle' : `${l.sealed} bottles`
  const open = l.tenths == null ? '' : `, ${tenthsWords(l.tenths).toLowerCase()}`
  switch (l.state) {
    case 'saved':
      return `${bottles}${open}. Saved on this phone, sends when there is signal.`
    case 'held':
      return `${bottles}${open}. Counted twice here, so the manager picks one.`
    case 'refused':
      return l.message ?? 'Not counted. Count it again.'
    default:
      return `${bottles}${open}. Sent.`
  }
}

function ShelfWalk({
  session,
  shelf,
  house,
  walk,
  setWalk,
  provisional,
  lockedOut,
  reload,
  onFinished,
}: {
  session: CountSession
  shelf: CountShelf
  house: string
  walk: WalkRecord
  setWalk: (fn: (w: WalkRecord) => WalkRecord) => void
  provisional: boolean
  lockedOut: boolean
  /** Pull the count again: the list on this phone may be behind the books. */
  reload: () => void
  /** `said`: the house's words about the shelf, e.g. an item it did not count. */
  onFinished: (said?: string) => void
}) {
  const items = itemsOnShelf(shelf, walk)
  const firstOpen = items.find(
    (i) => !i.countWhole && !walk.lines[lineKey(shelf.locationId, i.inventoryId)],
  )
  const [openId, setOpenId] = useState<string | null>(firstOpen?.inventoryId ?? null)
  const [mode, setMode] = useState<'count' | 'done' | 'find' | 'park'>('count')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const done = walk.dones[shelf.locationId]
  const recount = new Set(done?.state === 'refused' ? (done.recount ?? []) : [])

  const save = async (item: CountShelfItem, sealed: number, tenths: number | null) => {
    setError(null)
    setBusy(true)
    const line: WalkLine = {
      locationId: shelf.locationId,
      itemId: item.inventoryId,
      itemLabel: itemTitle(item),
      sealed,
      tenths,
      clientCountId: newWalkId(),
      at: new Date().toISOString(),
      state: 'saved',
    }
    try {
      const out = await submitSpotCount({
        itemId: item.inventoryId,
        itemLabel: line.itemLabel,
        restaurantId: house || undefined,
        body: lineBody(session.id, session.kind, line),
        countedAt: line.at,
      })
      line.state = !out.synced ? 'saved' : out.count?.held ? 'held' : 'sent'
    } catch (err) {
      line.state = 'refused'
      line.message = saidBy(err, 'The house did not take this count. Count it again.')
    }
    setWalk((w) => ({ ...w, lines: { ...w.lines, [lineKey(shelf.locationId, item.inventoryId)]: line } }))
    setBusy(false)
    const after = items.find(
      (i) =>
        i.inventoryId !== item.inventoryId &&
        !i.countWhole &&
        !walk.lines[lineKey(shelf.locationId, i.inventoryId)],
    )
    setOpenId(line.state === 'refused' ? item.inventoryId : (after?.inventoryId ?? null))
  }

  const untouched = untouchedOnShelf(shelf, walk)
  // F-1675: an item this count already knows is counted whole stays so when
  // Find adds it to a shelf; one it does not know is refused by the house.
  const countedWhole = new Set(
    session.shelves.flatMap((s) => s.items.filter((i) => i.countWhole).map((i) => i.inventoryId)),
  )

  const sayDone = async () => {
    setError(null)
    setBusy(true)
    const clientDoneId = newWalkId()
    const zeroItemIds = untouched.map((i) => i.inventoryId)
    try {
      const out = await submitShelfDone({
        restaurantId: house || undefined,
        sessionId: session.id,
        locationId: shelf.locationId,
        shelfLabel: shelf.name,
        body: { clientDoneId, zeroItemIds },
      })
      if (out.synced && out.result && !out.result.done) {
        const answer = out.result
        setWalk((w) => refusedDone(w, shelf, clientDoneId, answer, new Date().toISOString()))
        setMode('count')
        setBusy(false)
        reload()
        return
      }
      setWalk((w) => ({
        ...w,
        dones: { ...w.dones, [shelf.locationId]: { clientDoneId, state: out.synced ? 'sent' : 'saved' } },
      }))
      setBusy(false)
      onFinished(out.result?.message)
    } catch (err) {
      setError(saidBy(err, 'The shelf could not be closed. Try again.'))
      setBusy(false)
      // A refusal may come from a list the books have moved on from (F-1616).
      reload()
    }
  }

  if (mode === 'done') {
    return (
      <div className="space-y-4 px-4 py-4">
        {untouched.length === 0 ? (
          <p className="text-inkm-1">Every item on this shelf is counted.</p>
        ) : (
          <>
            <p className="text-inkm-1">Not found on this shelf? Each of these will count as 0.</p>
            <ul className="space-y-1">
              {untouched.map((i) => (
                <li key={i.inventoryId} className="rounded-xl bg-white/5 px-3 py-2">
                  {itemTitle(i)}
                </li>
              ))}
            </ul>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-amber-300">
            {error}
          </p>
        )}
        <button type="button" className={`${PRIMARY} w-full`} disabled={busy} onClick={() => void sayDone()}>
          {untouched.length ? 'Yes, none of these here. Shelf done' : 'Shelf done'}
        </button>
        <button type="button" className={`${QUIET} w-full`} onClick={() => setMode('count')}>
          Back to counting
        </button>
      </div>
    )
  }

  if (mode === 'find') {
    return (
      <FindBottle
        house={house}
        countedWhole={countedWhole}
        onPick={(it) => {
          setWalk((w) => ({
            ...w,
            extras: {
              ...w.extras,
              [shelf.locationId]: [...(w.extras[shelf.locationId] ?? []).filter((x) => x.inventoryId !== it.inventoryId), it],
            },
          }))
          setOpenId(it.inventoryId)
          setMode('count')
        }}
        onNotListed={() => setMode('park')}
        onBack={() => setMode('count')}
      />
    )
  }

  if (mode === 'park') {
    return (
      <ParkBottle
        onBack={() => setMode('count')}
        onPark={async (description, countedQty, openTenths) => {
          const clientLineId = newWalkId()
          const out = await submitParkedLine({
            restaurantId: house || undefined,
            sessionId: session.id,
            body: {
              clientLineId,
              locationId: shelf.locationId,
              description,
              countedQty,
              ...(openTenths != null ? { openTenths } : {}),
            },
          })
          setWalk((w) => ({
            ...w,
            parked: [
              ...w.parked,
              {
                clientLineId,
                locationId: shelf.locationId,
                description,
                countedQty,
                openTenths,
                state: out.synced ? 'sent' : 'saved',
              },
            ],
          }))
          setMode('count')
        }}
      />
    )
  }

  const parkedHere = walk.parked.filter((p) => p.locationId === shelf.locationId)
  return (
    <div className="space-y-3 px-4 py-4 pb-28">
      {provisional && (
        <p className="rounded-xl bg-white/5 px-3 py-2 text-sm text-inkm-2">
          No signal, so this shelf is not held for you: the others are not told you are counting it. If someone
          else counts it too, the manager picks.
        </p>
      )}
      {shelf.done && !shelf.claimedByMe && !done && !lockedOut && (
        <p className="rounded-xl bg-white/5 px-3 py-2 text-sm text-inkm-2">
          {shelf.doneBy ?? 'Someone'} finished this shelf. Anything you count again here goes to the manager to pick.
        </p>
      )}
      {done?.state === 'refused' && (
        <p role="alert" className="rounded-xl bg-white/10 px-3 py-2 text-sm text-amber-300">
          {done.message ?? 'Count this shelf again: some bottles moved after it was counted.'}
        </p>
      )}
      {items.length === 0 && (
        <p className="text-inkm-2">The books list nothing here. Find a bottle if you see one.</p>
      )}
      <ul className="space-y-2">
        {items.map((item) => {
          const line = walk.lines[lineKey(shelf.locationId, item.inventoryId)]
          return (
            <li key={item.inventoryId} className="rounded-xl bg-white/5">
              {openId === item.inventoryId && !item.countWhole && !lockedOut ? (
                <CountItem
                  item={item}
                  line={line}
                  busy={busy}
                  onSave={(sealed, tenths) => void save(item, sealed, tenths)}
                  onClose={() => setOpenId(null)}
                />
              ) : (
                <button
                  type="button"
                  data-ux-key="count:item"
                  disabled={item.countWhole || lockedOut}
                  onClick={() => setOpenId(item.inventoryId)}
                  className={`${TAP} w-full px-4 py-2 text-left`}
                >
                  <span className="block font-semibold text-inkm-1">{itemTitle(item)}</span>
                  {item.producer && <span className="block text-sm text-inkm-2">{item.producer}</span>}
                  <span
                    className={`block text-sm ${line?.state === 'refused' || recount.has(item.inventoryId) ? 'text-amber-300' : 'text-inkm-4'}`}
                  >
                    {item.countWhole
                      ? 'Some of this sits off the shelves. Count it on Inventory, all at once.'
                      : line
                        ? lineWords(line)
                        : recount.has(item.inventoryId)
                          ? 'Bottles moved. Count it again.'
                          : 'Not counted yet'}
                  </span>
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {parkedHere.length > 0 && (
        <ul className="space-y-1">
          {parkedHere.map((p) => (
            <li key={p.clientLineId} className="rounded-xl bg-white/5 px-3 py-2 text-sm text-inkm-2">
              {parkedWords(p)}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
      {!lockedOut && (
        <div className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-[480px] gap-2 border-t border-white/10 bg-paper-0 px-4 py-3">
          <button type="button" className={`${QUIET} flex items-center gap-2`} onClick={() => setMode('find')}>
            <Search className="h-5 w-5" /> Find
          </button>
          <button
            type="button"
            data-ux-key="count:shelf-done"
            className={`${PRIMARY} flex-1`}
            onClick={() => setMode('done')}
          >
            Shelf done
          </button>
        </div>
      )}
    </div>
  )
}

function CountItem({
  item,
  line,
  busy,
  onSave,
  onClose,
}: {
  item: CountShelfItem
  line: WalkLine | undefined
  busy: boolean
  onSave: (sealed: number, tenths: number | null) => void
  onClose: () => void
}) {
  const again = line && line.state !== 'refused'
  const [sealedText, setSealedText] = useState(String(again ? line.sealed : 0))
  const [tenths, setTenths] = useState<number | null>(again ? line.tenths : null)
  const sealed = readSealed(sealedText)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-3 px-4 py-3">
      <div>
        <p className="font-semibold text-inkm-1">{itemTitle(item)}</p>
        {item.producer && <p className="text-sm text-inkm-2">{item.producer}</p>}
      </div>
      <Stepper
        label="Full bottles"
        value=""
        onStep={(by) => setSealedText(String(stepSealed(sealed ?? 0, by)))}
      >
        <label className="block">
          <span className="block text-sm text-inkm-4">Full bottles</span>
          <input
            ref={input}
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Full bottles"
            value={sealedText}
            onFocus={() => input.current?.select()}
            onChange={(e) => setSealedText(e.target.value)}
            className="w-24 rounded-lg bg-paper-1 py-1 text-center text-2xl font-semibold text-inkm-1"
          />
        </label>
      </Stepper>
      <Stepper label="Open bottle" value={tenthsWords(tenths)} onStep={(by) => setTenths((t) => stepTenths(t, by))} />
      {again && (
        <p className="text-sm text-amber-300">Already counted here. A new count goes to the manager to pick.</p>
      )}
      {sealed == null && <p className="text-sm text-amber-300">Type a whole number of bottles.</p>}
      <div className="flex gap-2">
        <button type="button" className={QUIET} onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          data-ux-key="count:save"
          className={`${PRIMARY} flex-1`}
          disabled={busy || sealed == null}
          onClick={() => sealed != null && onSave(sealed, tenths)}
        >
          Save
        </button>
      </div>
    </div>
  )
}

function FindBottle({
  house,
  countedWhole,
  onPick,
  onNotListed,
  onBack,
}: {
  house: string
  countedWhole: Set<string>
  onPick: (item: CountShelfItem) => void
  onNotListed: () => void
  onBack: () => void
}) {
  const [query, setQuery] = useState('')
  const [all, setAll] = useState<(FindableItem & { offShelf: boolean })[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    getInventory(house || undefined)
      .then((rows) => {
        if (!live) return
        setAll(
          rows.map((r) => ({
            id: r.id,
            name: r.wineName?.trim() || 'An item with no name',
            // ADR 0124: the label's own name finds a wine the house renamed.
            alsoKnownAs: (r as { libraryName?: string | null }).libraryName ?? null,
            producer: r.wineProducer ?? null,
            vintage: r.wineVintage ?? null,
            // F-1683: bottles on no shelf (an opening file with no Shelf
            // column) are not on any shelf's books, so a shelf line would book
            // them a second time. Counted whole on Inventory, as the list does.
            offShelf: (r.locations ?? []).some((l) => !l.locationId && (l.qty ?? 0) > 0),
          })),
        )
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [house])
  const hits = useMemo(() => (all ? findItems(all, query) : []), [all, query])
  return (
    <div className="space-y-3 px-4 py-4">
      <input
        autoFocus
        type="search"
        aria-label="Name on the label"
        placeholder="Name on the label"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={`${TAP} w-full rounded-xl bg-paper-1 px-4 text-base text-inkm-1`}
      />
      {failed && <p className="text-sm text-amber-300">The list could not be read. Check the signal.</p>}
      <p className="text-sm text-inkm-2">
        An item with some bottles on no shelf is counted on Inventory, all at once, not here.
      </p>
      <ul className="space-y-2">
        {hits.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              className={`${TAP} w-full rounded-xl bg-white/5 px-4 text-left active:bg-white/10`}
              onClick={() =>
                onPick({
                  inventoryId: h.id,
                  name: h.name,
                  producer: h.producer ?? '',
                  vintage: h.vintage == null ? null : String(h.vintage),
                  // F-1675 (count-walk) + F-1683 (opening-stock): whole when
                  // this count already counts it whole, or it has bottles on no shelf.
                  countWhole: countedWhole.has(h.id) || h.offShelf,
                })
              }
            >
              <span className="block font-semibold">{[h.name, h.vintage].filter(Boolean).join(' ')}</span>
              {h.producer && <span className="block text-sm text-inkm-2">{h.producer}</span>}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={`${QUIET} w-full`} onClick={onNotListed}>
        Not on the list
      </button>
      <button type="button" className={`${QUIET} w-full`} onClick={onBack}>
        Back
      </button>
    </div>
  )
}

function ParkBottle({
  onPark,
  onBack,
}: {
  onPark: (description: string, countedQty: number, openTenths: number | null) => Promise<void>
  onBack: () => void
}) {
  const [label, setLabel] = useState('')
  const [qty, setQty] = useState(1)
  // S234 owed: the open bottle too, in tenths, as on a counted item.
  const [tenths, setTenths] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-3 px-4 py-4">
      <p className="text-inkm-1">A bottle the house does not carry. The manager adds it or drops it.</p>
      <input
        autoFocus
        aria-label="What the label says"
        placeholder="What the label says"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className={`${TAP} w-full rounded-xl bg-paper-1 px-4 text-base text-inkm-1`}
      />
      <Stepper
        label="Bottles"
        value={qty === 1 ? '1 bottle' : `${qty} bottles`}
        onStep={(by) => setQty((q) => stepSealed(q, by))}
      />
      <Stepper label="Open bottle" value={tenthsWords(tenths)} onStep={(by) => setTenths((t) => stepTenths(t, by))} />
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
      <button
        type="button"
        className={`${PRIMARY} w-full`}
        disabled={busy || !label.trim()}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await onPark(label.trim(), qty, tenths)
          } catch (err) {
            setError(saidBy(err, 'It could not be saved. Try again.'))
            setBusy(false)
          }
        }}
      >
        Save for the manager
      </button>
      <button type="button" className={`${QUIET} w-full`} onClick={onBack}>
        Back
      </button>
    </div>
  )
}

