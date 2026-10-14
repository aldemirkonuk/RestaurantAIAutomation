/**
 * CountReview -- `/count/:sessionId/review`, a stock-take's review (F-1544
 * lane 4). Phone width first (founder 2026-10-12, F4 a).
 *
 * Every line already posted the moment it arrived, as the person who counted
 * it (F2 a): nothing here approves a count. The manager reads the walk shelf
 * by shelf and settles what the walk could not settle by itself:
 *  - a shelf counted twice: use one of the counts, or count the shelf again;
 *  - a bottle the house does not carry: count it as one of the house's items,
 *    or drop it (creating a new item here is not built: ADR 0115 is still
 *    proposed);
 *  - a shelf not counted, and what a done shelf's books hold with no line
 *    (a line the phone could not send);
 *  - then signs the walk off, which stamps "last counted" on the items it
 *    counted on every shelf they sit on.
 * A bottle short on one shelf and found on another reads "probably moved":
 * both counts already set each shelf right, so nothing is posted for it.
 *
 * What the books expected, the difference and its value come only to an
 * owner or a manager -- the gateway leaves them out for anyone else.
 *
 * F-1628 / F-1629 / F-1617: the page names its house and offers the others,
 * offers to open a count held by another of the person's houses, and lets an
 * owner or a manager stop an open count.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  askShelfRecount,
  carryParkedCountLine,
  chooseHeldCountLine,
  dropHeldCountLine,
  dropParkedCountLine,
  periodWords,
  reviewCountSession,
  signOffCountSession,
  type CountReview as Review,
  type ReviewLine,
} from '@/services/api/countSessions'
import { getInventory } from '@/services/api/inventory'
import { formatHouseMoney, getHouseLocale } from '@/lib/houseCurrency'
import { useHouseZone } from '@/lib/houseZone'
import { useHouseCurrency } from '@/hooks/useHouseCurrency'
import { findItems, kindWords, tenthsWords, type FindableItem } from './countWalkModel'
import { CountSheetPanel } from './CountSheetPanel'
import { CountHeldElsewhere, CountHouseLine, StopCount } from './CountHouse'

const TAP = 'min-h-[56px] min-w-[56px]'
const BTN = `${TAP} rounded-xl px-4 text-base font-semibold`
const PRIMARY = `${BTN} bg-wine-600 text-white active:bg-wine-700 disabled:opacity-50`
const QUIET = `${BTN} bg-white/10 text-inkm-1 active:bg-white/20 disabled:opacity-50`
const CARD = 'rounded-xl bg-white/5 px-4 py-3'

function saidBy(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return typeof m === 'string' && m.trim() ? m : fallback
}

/**
 * "5 bottles, 5/10 of a bottle open": the open bottles in tenths of the
 * item's own bottle, as staff entered them, never ml (S230 owed). An item
 * that names no bottle size is said on a 750 ml bottle, and the line says so.
 */
function countedWords(
  counted: number,
  open: { openMl: number | null; openTenths?: number | null; bottleSizeKnown?: boolean },
): string {
  const b = `${counted} ${counted === 1 ? 'bottle' : 'bottles'}`
  if (open.openMl == null || open.openMl <= 0) return b
  if (open.openTenths == null) return `${b} and ${open.openMl} ml open`
  if (open.openTenths === 0) return `${b}, less than 1/10 of a bottle open`
  const standIn = open.bottleSizeKnown === false ? ' (on a 750 ml bottle: this item has no bottle size)' : ''
  return `${b}, ${tenthsWords(open.openTenths)}${standIn}`
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')

/**
 * "+1" / "−2" / "0" in full bottles, then the open bottles in tenths as staff
 * entered them -- "0, −3/10 open" -- so the column says what its value
 * counts (F-1621).
 */
function differenceWords(variance: number, openTenths: number | null | undefined): string {
  if (!openTenths) return signed(variance)
  const whole = Math.floor(Math.abs(openTenths) / 10)
  const part = Math.abs(openTenths) % 10
  const open = whole === 0 ? `${part}/10` : part === 0 ? `${whole}` : `${whole} and ${part}/10`
  return `${signed(variance)}, ${openTenths > 0 ? '+' : '−'}${open} open`
}

/** Short, counting the open bottles too: the amber is keyed on what the value says. */
function isShort(line: ReviewLine): boolean {
  return (line.variance ?? 0) * 10 + (line.openDifferenceTenths ?? 0) < 0
}

function moneyWords(value: number | null | undefined, currency: string | null): string {
  if (value == null) return 'no cost on record'
  return formatHouseMoney(value, currency)
}

/**
 * On the house's clock and in its way of writing a date, in digits so the
 * words stay English: "11/10, 23:40", never "11 Eki" (F-1658, as the bell's).
 */
function timeWords(iso: string | null, zone: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }
  if (zone) {
    try {
      return d.toLocaleString(getHouseLocale(), { ...opts, timeZone: zone })
    } catch {
      /* a zone this browser cannot read: the device's clock stands in */
    }
  }
  return d.toLocaleString(getHouseLocale(), opts)
}

/**
 * Who counted it. A line loaded from a paper sheet (S227) names the person
 * who counted on paper, and the person who loaded it when that was someone else.
 */
function byWords(countedBy: string | null, paperBy?: string): string {
  if (paperBy)
    return `, counted on paper by ${paperBy}${countedBy && countedBy !== paperBy ? `, loaded by ${countedBy}` : ''}`
  return countedBy ? `, by ${countedBy}` : ''
}

function Line({ line, money, currency }: { line: ReviewLine; money: boolean; currency: string | null }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block font-semibold">{line.name}</span>
        <span className="block text-sm text-inkm-2">
          {countedWords(line.counted, line)}
          {byWords(line.countedBy, line.paperBy)}
        </span>
      </span>
      {money && line.variance != null && (
        <span className="shrink-0 text-right">
          <span
            className={`block font-semibold ${isShort(line) ? 'text-amber-300' : 'text-inkm-1'}`}
          >
            {differenceWords(line.variance, line.openDifferenceTenths)}
          </span>
          <span className="block text-sm text-inkm-2">{moneyWords(line.value, currency)}</span>
        </span>
      )}
    </li>
  )
}

export default function CountReview() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const { activeRole, activeRestaurantId } = useAuth()
  const zone = useHouseZone() ?? null
  // F-1680: /count sits outside the shell, so this page reads the house's way
  // of writing figures and dates itself -- the money below and the paper
  // sheet's dates (CountSheetPanel) -- or a switched-from house's would stand.
  useHouseCurrency()
  const manager = activeRole === 'owner' || activeRole === 'manager'
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [unfinished, setUnfinished] = useState<number | null>(null)
  const [matching, setMatching] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setReview(await reviewCountSession(sessionId))
      setError(null)
    } catch (err) {
      setError(saidBy(err, 'The count could not be read. Check the signal and try again.'))
    }
  }, [sessionId])

  // Read again when the house changes (F-1629: "Open it there").
  useEffect(() => {
    void load()
  }, [load, activeRestaurantId])

  /** One act at a time; the page is read again after each. */
  const act = async (key: string, run: () => Promise<string | null>) => {
    setBusy(key)
    setNotice(null)
    try {
      const said = await run()
      if (said) setNotice(said)
      await load()
    } catch (err) {
      setNotice(saidBy(err, 'That did not go through. Check the signal and try again.'))
    } finally {
      setBusy(null)
    }
  }

  const signOff = (evenIfUnfinished: boolean) =>
    act('sign-off', async () => {
      const r = await signOffCountSession(sessionId, evenIfUnfinished)
      if (!r.signedOff && r.notCounted > 0) {
        setUnfinished(r.notCounted)
        return null
      }
      setUnfinished(null)
      return 'Signed off.'
    })

  if (!review) {
    return (
      <Frame title="Review" onBack={() => navigate(`/count/${sessionId}`)}>
        {error ? (
          <div className="space-y-3">
            <p role="alert" className="text-amber-300">
              {error}
            </p>
            <CountHeldElsewhere sessionId={sessionId} />
            <button type="button" className={`${QUIET} w-full`} onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : (
          <p className="text-inkm-2">Getting the count…</p>
        )}
      </Frame>
    )
  }

  const open = review.status === 'open'
  const money = review.seesMoney
  const canAct = manager
  return (
    <Frame
      title={`Review: ${kindWords(review.kind)}${review.period ? ` · ${periodWords(review.period)}` : ''}`}
      onBack={() => navigate(`/count/${sessionId}`)}
    >
      {notice && (
        <p role="status" className="rounded-xl bg-white/10 px-3 py-2 text-sm text-inkm-1">
          {notice}
        </p>
      )}
      <p className="text-sm text-inkm-2">
        {review.status === 'signed_off'
          ? `Signed off${review.signedOffBy ? ` by ${review.signedOffBy}` : ''} ${timeWords(review.signedOffAt, zone)}`
          : review.status === 'abandoned'
            ? 'This count was stopped. The counts it made stay.'
            : `${review.shelves.length - review.notCounted.length} of ${review.shelves.length} shelves done`}
      </p>

      {review.notCounted.length > 0 && (
        <Section title="Not counted">
          <ul className="space-y-2">
            {review.notCounted.map((s) => (
              <li key={s.locationId} className={CARD}>
                {s.name}
                {s.round > 0 && <span className="block text-sm text-inkm-2">Sent back to be counted again</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {review.held.length > 0 && (
        <Section title="Counted twice">
          <p className="text-sm text-inkm-2">
            The first count stands. Use the second instead, keep the first, or count the shelf again.
          </p>
          <ul className="space-y-3">
            {review.held.map((h) => {
              const shelf = review.shelves.find((s) => s.locationId === h.locationId)
              return (
                <li key={h.id} className={`${CARD} space-y-2`}>
                  <p className="font-semibold">
                    {h.name} <span className="font-normal text-inkm-2">on {h.shelf}</span>
                  </p>
                  {h.against && (
                    <p className="text-sm text-inkm-1">
                      First: {countedWords(h.against.counted, h.against)}
                      {byWords(h.against.countedBy, h.against.paperBy)}
                    </p>
                  )}
                  <p className="text-sm text-inkm-1">
                    Second: {countedWords(h.counted, h)}
                    {byWords(h.countedBy, h.paperBy)}
                  </p>
                  {canAct && (
                    <div className="grid gap-2">
                      <button
                        type="button"
                        disabled={busy !== null}
                        className={PRIMARY}
                        onClick={() =>
                          void act(`use:${h.id}`, async () => {
                            await chooseHeldCountLine(sessionId, h.id)
                            return 'The second count is in.'
                          })
                        }
                      >
                        Use the second
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        className={QUIET}
                        onClick={() =>
                          void act(`drop:${h.id}`, async () => {
                            await dropHeldCountLine(sessionId, h.id)
                            return 'The first count stays.'
                          })
                        }
                      >
                        Keep the first
                      </button>
                      {open && shelf && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          className={QUIET}
                          onClick={() =>
                            void act(`recount:${shelf.locationId}`, async () => {
                              await askShelfRecount(sessionId, shelf.locationId, shelf.round)
                              return `${shelf.name} goes back to be counted again.`
                            })
                          }
                        >
                          Count the shelf again
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {review.parked.length > 0 && (
        <Section title="Not on the list">
          <ul className="space-y-3">
            {review.parked.map((p) => (
              <li key={p.id} className={`${CARD} space-y-2`}>
                <p className="font-semibold">{p.description}</p>
                <p className="text-sm text-inkm-2">
                  {countedWords(p.counted, { openMl: p.openMl ?? null, openTenths: p.openTenths ?? null })} on {p.shelf}
                  {byWords(p.countedBy, p.paperBy)}
                </p>
                {canAct &&
                  (matching === p.id ? (
                    <MatchItem
                      house={activeRestaurantId ?? ''}
                      disabled={busy !== null}
                      onPick={(item) =>
                        void act(`carry:${p.id}`, async () => {
                          const r = await carryParkedCountLine(sessionId, p.id, item.id)
                          setMatching(null)
                          return r.held
                            ? `Counted as ${item.name}. It was counted on that shelf already, so it waits below.`
                            : `Counted as ${item.name}.`
                        })
                      }
                      onCancel={() => setMatching(null)}
                    />
                  ) : (
                    <div className="grid gap-2">
                      <button
                        type="button"
                        disabled={busy !== null}
                        className={PRIMARY}
                        onClick={() => setMatching(p.id)}
                      >
                        It is one of ours
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        className={QUIET}
                        onClick={() =>
                          void act(`dropp:${p.id}`, async () => {
                            await dropParkedCountLine(sessionId, p.id)
                            return 'Dropped. Nothing was counted for it.'
                          })
                        }
                      >
                        Drop it
                      </button>
                    </div>
                  ))}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {review.moved.length > 0 && (
        <Section title="Probably moved, not lost">
          <ul className="space-y-2">
            {review.moved.map((m) => (
              <li key={`${m.inventoryId}:${m.from}:${m.to}`} className={CARD}>
                <span className="block font-semibold">{m.name}</span>
                <span className="block text-sm text-inkm-2">
                  {m.bottles} short on {m.from}, found on {m.to}. Both shelves are already right.
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Shelves">
        <ul className="space-y-3">
          {review.shelves.map((s) => (
            <li key={s.locationId} className={CARD}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{s.name}</span>
                {money && s.done && (
                  <span className="text-sm text-inkm-2">{moneyWords(s.value, review.currency)}</span>
                )}
              </div>
              <p className="text-sm text-inkm-2">
                {s.done ? `Done${s.doneBy ? ` by ${s.doneBy}` : ''}` : 'Not counted'}
              </p>
              {s.lines.length > 0 && (
                <ul className="divide-y divide-white/10">
                  {s.lines.map((l) => (
                    <Line key={l.countId} line={l} money={money} currency={review.currency} />
                  ))}
                </ul>
              )}
              {s.missed.length > 0 && (
                <p className="pt-2 text-sm text-amber-300">
                  On the books here, no count sent: {s.missed.map((m) => m.name).join(', ')}
                </p>
              )}
              {canAct && open && s.done && (
                <button
                  type="button"
                  disabled={busy !== null}
                  className={`${QUIET} mt-2 w-full`}
                  onClick={() =>
                    void act(`recount:${s.locationId}`, async () => {
                      await askShelfRecount(sessionId, s.locationId, s.round)
                      return `${s.name} goes back to be counted again.`
                    })
                  }
                >
                  Count this shelf again
                </button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {review.elsewhere.length > 0 && (
        <Section title="Counted as a whole">
          <ul className={`${CARD} divide-y divide-white/10`}>
            {review.elsewhere.map((l) => (
              <Line key={l.countId} line={l} money={money} currency={review.currency} />
            ))}
          </ul>
        </Section>
      )}

      {review.afterSignOff.length > 0 && (
        <Section title="Came in after sign-off">
          <p className="text-sm text-inkm-2">Saved on a phone and sent late. Each is already on the books.</p>
          <ul className={`${CARD} divide-y divide-white/10`}>
            {review.afterSignOff.map((l) => (
              <Line key={l.countId} line={l} money={money} currency={review.currency} />
            ))}
          </ul>
        </Section>
      )}

      {/* F-1544 lane 6: a count on paper, loaded through the walk's own path. */}
      {canAct && review.status !== 'abandoned' && (
        <CountSheetPanel sessionId={sessionId} house={activeRestaurantId ?? ''} onSent={() => void load()} />
      )}

      {canAct && open && (
        <div className="space-y-2 pt-2">
          {unfinished != null ? (
            <>
              <p role="alert" className="text-amber-300">
                {unfinished === 1 ? '1 shelf is' : `${unfinished} shelves are`} not counted. Sign off anyway?
              </p>
              <button
                type="button"
                disabled={busy !== null}
                className={`${PRIMARY} w-full`}
                onClick={() => void signOff(true)}
              >
                Sign off anyway
              </button>
              <button
                type="button"
                disabled={busy !== null}
                className={`${QUIET} w-full`}
                onClick={() => setUnfinished(null)}
              >
                Not yet
              </button>
            </>
          ) : (
            <button
              type="button"
              data-ux-key="count:sign-off"
              disabled={busy !== null}
              className={`${PRIMARY} w-full`}
              onClick={() => void signOff(false)}
            >
              Sign off this count
            </button>
          )}
          <StopCount
            sessionId={sessionId}
            onStopped={() => {
              setNotice('This count is stopped. What was counted stays on the books.')
              void load()
            }}
          />
        </div>
      )}
    </Frame>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 pt-2">
      <h2 className="text-sm font-semibold text-inkm-4">{title}</h2>
      {children}
    </section>
  )
}

function Frame({
  title,
  onBack,
  children,
}: {
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
        <h1 className="flex-1 text-base font-semibold">{title}</h1>
      </div>
      <CountHouseLine onSwitched={() => navigate('/count')} />
      <div className="space-y-3 px-4 py-4">{children}</div>
    </div>
  )
}

/** Search the house's items to match a parked line to one of them. */
function MatchItem({
  house,
  disabled,
  onPick,
  onCancel,
}: {
  house: string
  disabled: boolean
  onPick: (item: FindableItem) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const [all, setAll] = useState<FindableItem[] | null>(null)
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
    <div className="space-y-2">
      <input
        autoFocus
        type="search"
        aria-label="Which of the house's items is it"
        placeholder="Name on the label"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={`${TAP} w-full rounded-xl bg-paper-1 px-4 text-base text-inkm-1`}
      />
      {failed && <p className="text-sm text-amber-300">The list could not be read. Check the signal.</p>}
      <ul className="space-y-2">
        {hits.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              disabled={disabled}
              className={`${TAP} w-full rounded-xl bg-white/10 px-4 text-left active:bg-white/20 disabled:opacity-50`}
              onClick={() => onPick(h)}
            >
              {[h.name, h.vintage].filter(Boolean).join(' ')}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={`${QUIET} w-full`} onClick={onCancel}>
        Back
      </button>
    </div>
  )
}
