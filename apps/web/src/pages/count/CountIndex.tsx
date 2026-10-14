/**
 * CountIndex -- `/count`, the way into a phone stock-take (F-1544 lane 3).
 *
 * Lists the house's open counts; anyone in the house picks one and walks it.
 * An owner or a manager may start one (ADR 0238 / 0334: the gateway checks
 * the role again). A start carries one key made at the tap, so a double tap
 * or a retry opens one count, not two (count-sessions.service.ts `openKey`).
 *
 * S227 owed: a manager may narrow a count to some of the house's places
 * (the gateway's `zoneIds`; the shelves under each are the gateway's own leaf
 * rule). None chosen is every shelf. The counts that ended are listed under
 * the open ones, with when, the month and who signed off or stopped them.
 *
 * F-1544 lane 5 (the founder's F1 b, 2026-10-12): a count says which month it
 * is for. In the 6 hours after a month ends the page asks, so a count started
 * at 00:30 on the 1st can be the month that ended; otherwise it is this month.
 *
 * F-1617 / F-1628: a start asks first, naming the house and what the count
 * covers; Opening stock says what it is, because it locks staff out and sets
 * where the books start. The page names the house and offers the others.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  listOpenCountSessions,
  openCountSession,
  periodWords,
  type CountPeriods,
  type CountSessionKind,
  type CountSessionSummary,
  type CountZone,
  type EndedCountSession,
} from '@/services/api/countSessions'
import { getHouseLocale } from '@/lib/houseCurrency'
import { useHouseZone } from '@/lib/houseZone'
import { useHouseCurrency } from '@/hooks/useHouseCurrency'
import { kindWords, newWalkId } from './countWalkModel'
import { CountHouseLine } from './CountHouse'

const TAP = 'min-h-[56px] min-w-[56px]'
const KINDS: CountSessionKind[] = ['closing', 'month_end', 'full', 'opening']

/** "Bar", "Bar and Cellar", "Bar, Cellar and Terrace". */
function listWords(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * On the house's clock and in its way of writing a date, in digits so the
 * words stay English -- "14.10 01:10", never the phone's zone or "14 Eki"
 * (F-1679, F-1682: as count review's sign-off time, F-1658). Nothing when the
 * moment is unknown.
 */
function endedWords(iso: string | null, zone: string | null): string {
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

/** What a start covers, said before it starts (F-1617); `places` narrows it (S227 owed). */
function coverWords(kind: CountSessionKind, house: string, places: string[] = []): string {
  const where = places.length ? `every shelf in ${listWords(places)} at ${house}` : `every shelf of ${house}`
  if (kind === 'opening')
    return (
      `Opening stock counts ${where} to set what the house starts with. Only an owner or a manager can count ` +
      "it, so staff cannot count while it is open. Its lines are where the books start, so the month's " +
      'differences leave them out.'
    )
  return `${kindWords(kind)} of ${where}. Everyone in the house can count it, and each line goes on the books when it is sent.`
}

function saidBy(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return typeof m === 'string' && m.trim() ? m : fallback
}

export default function CountIndex() {
  const navigate = useNavigate()
  const { activeRole, availableRestaurants, activeRestaurantId } = useAuth()
  const manager = activeRole === 'owner' || activeRole === 'manager'
  // F-1680: /count sits outside the shell, so nothing else reads this house's
  // way of writing figures and dates; after a house switch the last one stood.
  useHouseCurrency()
  const zone = useHouseZone() ?? null
  const [sessions, setSessions] = useState<CountSessionSummary[] | null>(null)
  const [ended, setEnded] = useState<EndedCountSession[]>([])
  const [zones, setZones] = useState<CountZone[]>([])
  // The places chosen for the next start; none = every shelf (S227 owed).
  const [chosenZones, setChosenZones] = useState<string[]>([])
  const [periods, setPeriods] = useState<CountPeriods | null>(null)
  // The month chosen while a month has just ended; the month that ended
  // until the manager taps the other.
  const [period, setPeriod] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The kind tapped, waiting for "Start it" (F-1617).
  const [asking, setAsking] = useState<CountSessionKind | null>(null)
  const here = (availableRestaurants ?? []).find((r) => r.id === activeRestaurantId)
  const houseName = here?.name ? (here.city ? `${here.name}, ${here.city}` : here.name) : null
  // One key per start, kept across a retry of the same start.
  const openKey = useRef<{ kind: CountSessionKind; period: string | null; zones: string; key: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const out = await listOpenCountSessions()
      setSessions(out.sessions)
      setPeriods(out.periods)
      const places = out.zones ?? []
      setEnded(out.ended ?? [])
      setZones(places)
      // A place that is gone is no longer chosen.
      setChosenZones((c) => c.filter((id) => places.some((z) => z.id === id)))
      setPeriod((p) =>
        out.periods?.ended && (p === out.periods.ended || p === out.periods.current) ? p : (out.periods?.ended ?? null),
      )
      setError(null)
    } catch (err) {
      setError(saidBy(err, 'The counts could not be read. Check the signal and try again.'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const start = async (kind: CountSessionKind) => {
    setAsking(null)
    setBusy(true)
    setError(null)
    // Named only while there is a choice; otherwise the gateway says this month.
    const chosen = periods?.ended ? period : null
    const zoneKey = [...chosenZones].sort().join(',')
    if (openKey.current?.kind !== kind || openKey.current.period !== chosen || openKey.current.zones !== zoneKey)
      openKey.current = { kind, period: chosen, zones: zoneKey, key: newWalkId() }
    try {
      const s = await openCountSession({
        kind,
        openKey: openKey.current.key,
        ...(chosen ? { period: chosen } : {}),
        ...(chosenZones.length ? { zoneIds: chosenZones } : {}),
      })
      openKey.current = null
      navigate(`/count/${s.id}`)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      // A refusal is final for this key; a lost answer keeps it for the retry.
      if (status && status >= 400 && status < 500) {
        openKey.current = null
        // The 6 hours may have run out since the page was read.
        void load()
      }
      setError(saidBy(err, 'The count could not be started. Try again.'))
      setBusy(false)
    }
  }

  return (
    <div
      className="mudavym mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-paper-0 text-inkm-1"
      data-ground="charcoal"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-2 py-2">
        <button
          type="button"
          onClick={() => navigate('/inventory')}
          aria-label="Back"
          className={`${TAP} flex items-center justify-center rounded-xl text-inkm-2`}
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="flex-1 text-base font-semibold">Stock count</h1>
      </div>
      <CountHouseLine onSwitched={() => void load()} />
      <div className="space-y-3 px-4 py-4">
        {error && (
          <p role="alert" className="rounded-xl bg-white/10 px-3 py-2 text-sm text-amber-300">
            {error}
          </p>
        )}
        {sessions === null && !error && <p className="text-inkm-2">Getting the counts…</p>}
        {sessions?.length === 0 && <p className="text-inkm-2">No count is open.</p>}
        <ul className="space-y-2">
          {sessions?.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                data-ux-key="count:open-session"
                onClick={() => navigate(`/count/${s.id}`)}
                className={`${TAP} flex w-full items-center justify-between rounded-xl bg-white/5 px-4 text-left active:bg-white/10`}
              >
                <span className="font-semibold">
                  {kindWords(s.kind)}
                  {s.period ? <span className="font-normal text-inkm-2"> · {periodWords(s.period)}</span> : null}
                </span>
                <span className="text-sm text-inkm-2">
                  {s.shelvesDone} of {s.shelves} shelves done
                </span>
              </button>
            </li>
          ))}
        </ul>
        {manager && (
          <div className="space-y-2 pt-4">
            {periods?.ended && (
              <div className="space-y-2" role="group" aria-label="Which month is this count for?">
                <p className="text-sm text-inkm-4">Which month is this count for?</p>
                <div className="flex gap-2">
                  {[periods.ended, periods.current].map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={period === m}
                      onClick={() => setPeriod(m)}
                      className={`${TAP} flex-1 rounded-xl px-4 font-semibold ${
                        period === m ? 'bg-white text-black' : 'bg-white/10 active:bg-white/20'
                      }`}
                    >
                      {periodWords(m)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {zones.length > 1 && (
              <div className="space-y-2" role="group" aria-label="Which places does it count?">
                <p className="text-sm text-inkm-4">Which places does it count? None chosen counts every shelf.</p>
                <div className="flex flex-wrap gap-2">
                  {zones.map((z) => {
                    const on = chosenZones.includes(z.id)
                    return (
                      <button
                        key={z.id}
                        type="button"
                        aria-pressed={on}
                        disabled={busy || asking !== null}
                        onClick={() =>
                          setChosenZones((c) => (on ? c.filter((id) => id !== z.id) : [...c, z.id]))
                        }
                        className={`${TAP} rounded-xl px-4 font-semibold disabled:opacity-50 ${
                          on ? 'bg-white text-black' : 'bg-white/10 active:bg-white/20'
                        }`}
                      >
                        {z.name}
                        <span className="font-normal"> · {z.shelves === 1 ? '1 shelf' : `${z.shelves} shelves`}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <p className="text-sm text-inkm-4">
              {chosenZones.length
                ? `Start a count of ${listWords(zones.filter((z) => chosenZones.includes(z.id)).map((z) => z.name))}`
                : 'Start a count of every shelf'}
            </p>
            {asking ? (
              <div className="space-y-2 rounded-xl bg-white/5 px-4 py-3">
                <p role="alert" className="text-inkm-1">
                  {coverWords(
                    asking,
                    houseName ?? 'this house',
                    zones.filter((z) => chosenZones.includes(z.id)).map((z) => z.name),
                  )}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void start(asking)}
                  className={`${TAP} w-full rounded-xl bg-white px-4 font-semibold text-black disabled:opacity-50`}
                >
                  Start it
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(null)}
                  className={`${TAP} w-full rounded-xl bg-white/10 px-4 font-semibold active:bg-white/20`}
                >
                  Not now
                </button>
              </div>
            ) : (
              KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={busy}
                  onClick={() => setAsking(k)}
                  className={`${TAP} w-full rounded-xl bg-white/10 px-4 text-left font-semibold active:bg-white/20 disabled:opacity-50`}
                >
                  {kindWords(k)}
                </button>
              ))
            )}
          </div>
        )}
        {ended.length > 0 && (
          <section className="space-y-2 pt-4" aria-label="Counts that ended">
            <h2 className="text-sm text-inkm-4">Counts that ended</h2>
            <ul className="space-y-2">
              {ended.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    data-ux-key="count:ended-session"
                    onClick={() => navigate(`/count/${e.id}/review`)}
                    className={`${TAP} w-full rounded-xl bg-white/5 px-4 py-2 text-left active:bg-white/10`}
                  >
                    <span className="block font-semibold">
                      {kindWords(e.kind)}
                      {e.period ? <span className="font-normal text-inkm-2"> · {periodWords(e.period)}</span> : null}
                    </span>
                    <span className="block text-sm text-inkm-2">
                      {e.status === 'signed_off' ? 'Signed off' : 'Stopped'}
                      {e.endedBy ? ` by ${e.endedBy}` : ''}
                      {e.endedAt ? `, ${endedWords(e.endedAt, zone)}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
