/**
 * CountIndex -- `/count`, the way into a phone stock-take (F-1544 lane 3).
 *
 * Lists the house's open counts; anyone in the house picks one and walks it.
 * An owner or a manager may start one (ADR 0238 / 0334: the gateway checks
 * the role again). A start carries one key made at the tap, so a double tap
 * or a retry opens one count, not two (count-sessions.service.ts `openKey`).
 *
 * Not here (said, not hidden): choosing zones. A count started here covers
 * every leaf shelf of the house; a narrower walk is the gateway's `zoneIds`,
 * which this page does not offer yet.
 *
 * F-1544 lane 5 (the founder's F1 b, 2026-10-12): a count says which month it
 * is for. In the 6 hours after a month ends the page asks, so a count started
 * at 00:30 on the 1st can be the month that ended; otherwise it is this month.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  listOpenCountSessions,
  openCountSession,
  type CountPeriods,
  type CountSessionKind,
  type CountSessionSummary,
} from '@/services/api/countSessions'
import { kindWords, newWalkId } from './countWalkModel'

const TAP = 'min-h-[56px] min-w-[56px]'
const KINDS: CountSessionKind[] = ['closing', 'month_end', 'full', 'opening']

/** "October" for 2026-10, in the reader's language. */
function monthWords(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  )
}

function saidBy(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return typeof m === 'string' && m.trim() ? m : fallback
}

export default function CountIndex() {
  const navigate = useNavigate()
  const { activeRole } = useAuth()
  const manager = activeRole === 'owner' || activeRole === 'manager'
  const [sessions, setSessions] = useState<CountSessionSummary[] | null>(null)
  const [periods, setPeriods] = useState<CountPeriods | null>(null)
  // The month chosen while a month has just ended; the month that ended
  // until the manager taps the other.
  const [period, setPeriod] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // One key per start, kept across a retry of the same start.
  const openKey = useRef<{ kind: CountSessionKind; period: string | null; key: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const out = await listOpenCountSessions()
      setSessions(out.sessions)
      setPeriods(out.periods)
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
    setBusy(true)
    setError(null)
    // Named only while there is a choice; otherwise the gateway says this month.
    const chosen = periods?.ended ? period : null
    if (openKey.current?.kind !== kind || openKey.current.period !== chosen)
      openKey.current = { kind, period: chosen, key: newWalkId() }
    try {
      const s = await openCountSession({
        kind,
        openKey: openKey.current.key,
        ...(chosen ? { period: chosen } : {}),
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
                  {s.period ? <span className="font-normal text-inkm-2"> · {monthWords(s.period)}</span> : null}
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
                      {monthWords(m)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="text-sm text-inkm-4">Start a count of every shelf</p>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                disabled={busy}
                onClick={() => void start(k)}
                className={`${TAP} w-full rounded-xl bg-white/10 px-4 text-left font-semibold active:bg-white/20 disabled:opacity-50`}
              >
                {kindWords(k)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
