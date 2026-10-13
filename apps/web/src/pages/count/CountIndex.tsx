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
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  listOpenCountSessions,
  openCountSession,
  type CountSessionKind,
  type CountSessionSummary,
} from '@/services/api/countSessions'
import { kindWords, newWalkId } from './countWalkModel'

const TAP = 'min-h-[56px] min-w-[56px]'
const KINDS: CountSessionKind[] = ['closing', 'month_end', 'full', 'opening']

function saidBy(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return typeof m === 'string' && m.trim() ? m : fallback
}

export default function CountIndex() {
  const navigate = useNavigate()
  const { activeRole } = useAuth()
  const manager = activeRole === 'owner' || activeRole === 'manager'
  const [sessions, setSessions] = useState<CountSessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // One key per start, kept across a retry of the same start.
  const openKey = useRef<{ kind: CountSessionKind; key: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setSessions(await listOpenCountSessions())
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
    if (openKey.current?.kind !== kind) openKey.current = { kind, key: newWalkId() }
    try {
      const s = await openCountSession({ kind, openKey: openKey.current.key })
      openKey.current = null
      navigate(`/count/${s.id}`)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      // A refusal is final for this key; a lost answer keeps it for the retry.
      if (status && status >= 400 && status < 500) openKey.current = null
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
                <span className="font-semibold">{kindWords(s.kind)}</span>
                <span className="text-sm text-inkm-2">
                  {s.shelvesDone} of {s.shelves} shelves done
                </span>
              </button>
            </li>
          ))}
        </ul>
        {manager && (
          <div className="space-y-2 pt-4">
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
