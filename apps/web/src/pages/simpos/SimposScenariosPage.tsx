/**
 * SimPOS scenarios — the harness's verdict page (ADR 0093).
 *
 * A scenario run posted by `scripts/simulate scenario …` carries its own
 * expectation. The gateway compares it against what the product actually did
 * and returns one row per named check. This page renders that verdict, and its
 * whole job is to render it HONESTLY:
 *
 *   • `unverifiable` gets its own colour and its own count. It is not the fail
 *     colour, and it is not grey-as-empty — "we could not tell" is a finding,
 *     not a blank (ADR 0020).
 *   • A failed request renders the message. Never an empty table, because an
 *     empty table over a failed request reads as "everything is fine".
 *   • The runs list is capped server-side, so a full page renders as
 *     "showing N of ≥50" — a floor, never a total.
 *   • The empty state names what creates runs, and contains no command: the
 *     reader may have no terminal (no-dev-instructions-in-ui.test.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Loader2,
  Mail,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import {
  simposApi,
  type ScenarioCheckRow,
  type ScenarioCheckStatus,
  type ScenarioInsightsResult,
  type ScenarioRunSummary,
  type ScenarioSweepResult,
  type ScenarioVerifyResult,
} from '../../services/api/simpos'
import { cn } from '../../lib/utils'

function errorText(e: unknown): string {
  const anyErr = e as {
    response?: { data?: { message?: string } }
    message?: string
  }
  return (
    anyErr?.response?.data?.message ||
    anyErr?.message ||
    'The request failed, and the reason was not reported.'
  )
}

function fmtMoney(n: number | undefined | null): string {
  return n == null ? '—' : `$${Number(n).toFixed(2)}`
}

function preview(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  try {
    const s = JSON.stringify(value)
    return s.length > 160 ? `${s.slice(0, 157)}…` : s
  } catch {
    return String(value)
  }
}

/**
 * Three statuses, three colours. `unverifiable` is violet on purpose: it must
 * be legible as its OWN outcome next to a red fail, and must not read as an
 * empty cell.
 */
const STATUS_STYLE: Record<
  ScenarioCheckStatus,
  { chip: string; text: string; label: string }
> = {
  pass: {
    chip: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    text: 'text-emerald-400',
    label: 'Pass',
  },
  fail: {
    chip: 'bg-rose-950 text-rose-300 border-rose-800',
    text: 'text-rose-400',
    label: 'Fail',
  },
  unverifiable: {
    chip: 'bg-violet-950 text-violet-300 border-violet-700',
    text: 'text-violet-300',
    label: 'Unverifiable',
  },
}

function StatusGlyph({ status }: { status: ScenarioCheckStatus }) {
  const Icon = status === 'pass' ? Check : status === 'fail' ? X : HelpCircle
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        STATUS_STYLE[status].text,
      )}
      aria-label={STATUS_STYLE[status].label}
      title={STATUS_STYLE[status].label}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="text-[10px] font-bold uppercase tracking-wide">
        {STATUS_STYLE[status].label}
      </span>
    </span>
  )
}

function SummaryChips({
  summary,
}: {
  summary: ScenarioVerifyResult['summary']
}) {
  const chips: Array<[ScenarioCheckStatus, number]> = [
    ['pass', summary.pass],
    ['fail', summary.fail],
    ['unverifiable', summary.unverifiable],
  ]
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map(([status, n]) => (
        <span
          key={status}
          data-testid={`chip-${status}`}
          className={cn(
            'px-2 py-1 rounded-md border text-[11px] font-bold uppercase tracking-wide',
            STATUS_STYLE[status].chip,
          )}
        >
          {STATUS_STYLE[status].label} {n}
        </span>
      ))}
      <span className="text-[11px] text-gray-500">
        of {summary.total} checks
      </span>
    </div>
  )
}

function CheckRow({ row }: { row: ScenarioCheckRow }) {
  const [open, setOpen] = useState(false)
  const hasSamples = Array.isArray(row.samples) && row.samples.length > 0
  return (
    <>
      <tr className="border-t border-gray-800 align-top">
        <td className="px-3 py-2 whitespace-nowrap">
          <StatusGlyph status={row.status} />
        </td>
        <td className="px-3 py-2">
          <div className="text-xs font-bold text-gray-200">{row.title}</div>
          <div className="font-mono text-[10px] text-gray-600">{row.id}</div>
        </td>
        <td className="px-3 py-2 font-mono text-[11px] text-gray-400 max-w-[14rem] break-words">
          {preview(row.expected)}
        </td>
        <td className="px-3 py-2 font-mono text-[11px] text-gray-400 max-w-[14rem] break-words">
          {preview(row.actual)}
        </td>
        <td className="px-3 py-2 text-[11px] text-gray-300 max-w-[26rem]">
          {row.detail}
          {hasSamples && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 hover:text-amber-300"
            >
              {open ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              {row.samples!.length} example
              {row.samples!.length === 1 ? '' : 's'}
            </button>
          )}
        </td>
      </tr>
      {open && hasSamples && (
        <tr className="bg-gray-900/60">
          <td colSpan={5} className="px-3 py-2">
            <ul className="space-y-1 font-mono text-[10px] text-gray-400">
              {row.samples!.map((s, i) => (
                <li key={i} className="break-words">
                  {preview(s)}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  )
}

export function SimposScenariosPage() {
  const { restaurantId = '' } = useParams<{ restaurantId: string }>()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [leverError, setLeverError] = useState<string | null>(null)
  const [sweep, setSweep] = useState<ScenarioSweepResult | null>(null)
  const [insights, setInsights] = useState<ScenarioInsightsResult | null>(null)
  const [busy, setBusy] = useState<null | 'sweep' | 'insights' | 'verify'>(null)

  const runsQuery = useQuery({
    queryKey: ['simpos-scenario-runs', restaurantId],
    queryFn: () => simposApi.listScenarioRuns(restaurantId),
    enabled: !!restaurantId,
  })

  const runs: ScenarioRunSummary[] = runsQuery.data?.runs ?? []
  const cap = runsQuery.data?.cap ?? 0
  const capped = runsQuery.data?.capped ?? false

  useEffect(() => {
    if (!selectedId && runs.length > 0) setSelectedId(runs[0].id)
  }, [runs, selectedId])

  const verifyQuery = useQuery({
    queryKey: ['simpos-scenario-verify', restaurantId, selectedId],
    queryFn: () =>
      simposApi.verifyScenarioRun(restaurantId, selectedId as string),
    enabled: !!restaurantId && !!selectedId,
  })

  const selected = useMemo(
    () => runs.find((r) => r.id === selectedId) ?? null,
    [runs, selectedId],
  )

  const reverify = useCallback(async () => {
    setBusy('verify')
    setLeverError(null)
    try {
      await verifyQuery.refetch()
    } finally {
      setBusy(null)
    }
  }, [verifyQuery])

  const doSweep = useCallback(async () => {
    if (!selectedId) return
    setBusy('sweep')
    setLeverError(null)
    try {
      setSweep(await simposApi.runLowStockSweep(restaurantId, selectedId))
      await verifyQuery.refetch()
    } catch (e) {
      setLeverError(errorText(e))
    } finally {
      setBusy(null)
    }
  }, [restaurantId, selectedId, verifyQuery])

  const doInsights = useCallback(async () => {
    if (!selectedId) return
    setBusy('insights')
    setLeverError(null)
    try {
      setInsights(await simposApi.generateInsights(restaurantId, selectedId))
      await verifyQuery.refetch()
    } catch (e) {
      setLeverError(errorText(e))
    } finally {
      setBusy(null)
    }
  }, [restaurantId, selectedId, verifyQuery])

  const verdict = verifyQuery.data as ScenarioVerifyResult | undefined
  const failedReads = (verdict?.reads ?? []).filter((r) => !r.ok)

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-4 py-3 flex flex-wrap items-center gap-3">
        <Link
          to={`/simpos/${restaurantId}`}
          className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to terminal
        </Link>
        <span className="text-xs font-bold tracking-widest text-amber-400 uppercase ml-2">
          Scenarios
        </span>
        <Link
          to={`/simpos/${restaurantId}/orders`}
          className="ml-auto text-[11px] font-bold text-gray-500 hover:text-gray-300"
        >
          Order log
        </Link>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-4 p-4">
        {/* ---------------------------------------------------------------- */}
        {/* Runs                                                             */}
        {/* ---------------------------------------------------------------- */}
        <aside className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-500">
              Runs
            </h2>
            {runsQuery.data && (
              <span className="text-[10px] text-gray-600 tabular-nums">
                {capped
                  ? `showing ${runs.length} of ≥${cap}`
                  : `${runs.length} run${runs.length === 1 ? '' : 's'}`}
              </span>
            )}
          </div>

          {runsQuery.isLoading ? (
            <div className="flex items-center justify-center h-24 text-gray-600">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : runsQuery.isError ? (
            <div className="rounded-xl border border-rose-800 bg-rose-950/60 p-3 text-xs text-rose-200">
              <div className="font-bold mb-1">Could not load the runs</div>
              <div className="break-words">{errorText(runsQuery.error)}</div>
              <div className="mt-1 text-rose-300/80">
                This is a failure, not an empty result.
              </div>
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-3 text-xs text-gray-400">
              No scenario runs recorded for this restaurant yet — the scenario
              simulator creates them.{' '}
              <Link
                to={`/simpos/${restaurantId}/orders`}
                className="text-amber-400 hover:text-amber-300 font-bold"
              >
                Open the order log
              </Link>{' '}
              to see the checks this terminal has produced.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(r.id)
                      setSweep(null)
                      setInsights(null)
                      setLeverError(null)
                    }}
                    className={cn(
                      'w-full text-left rounded-xl border px-3 py-2 transition',
                      r.id === selectedId
                        ? 'border-amber-700 bg-amber-950/40'
                        : 'border-gray-800 bg-gray-900 hover:border-gray-700',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-100 truncate">
                        {r.scenario ?? 'scenario'}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-gray-500">
                        seed {r.seed ?? '—'}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {r.service_date ?? 'no service date'}
                      {r.timezone ? ` · ${r.timezone}` : ''}
                    </div>
                    <div className="text-[10px] text-gray-600">
                      {r.posted_at
                        ? `posted ${new Date(r.posted_at).toLocaleString()}`
                        : 'not posted'}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-400 tabular-nums">
                      <span>{r.totals?.checks ?? '—'} checks</span>
                      <span>{r.totals?.wine_lines ?? '—'} wine</span>
                      <span>{fmtMoney(r.totals?.revenue)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ---------------------------------------------------------------- */}
        {/* Verdict                                                          */}
        {/* ---------------------------------------------------------------- */}
        <section className="space-y-3 min-w-0">
          {!selectedId ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-xs text-gray-500">
              Select a run to see what the product did with it.
            </div>
          ) : (
            <>
              {selected?.scenarios && selected.scenarios.length > 0 && (
                <div className="rounded-2xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
                  {selected.scenarios.map((s) => (
                    <div key={s.id} className="px-4 py-3">
                      <div className="text-xs font-bold text-amber-300">
                        {s.title}
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {s.story}
                      </p>
                      {s.check_ids && s.check_ids.length > 0 && (
                        <div className="mt-1 font-mono text-[10px] text-gray-600 break-words">
                          {s.check_ids.join(' · ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={reverify}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-bold border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                >
                  <RefreshCw
                    className={cn(
                      'w-3 h-3',
                      busy === 'verify' && 'animate-spin',
                    )}
                  />
                  Re-verify
                </button>
                <button
                  type="button"
                  onClick={doSweep}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-bold border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                >
                  <Mail
                    className={cn(
                      'w-3 h-3',
                      busy === 'sweep' && 'animate-pulse',
                    )}
                  />
                  Run low-stock sweep now
                </button>
                <button
                  type="button"
                  onClick={doInsights}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-bold border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                >
                  <Sparkles
                    className={cn(
                      'w-3 h-3',
                      busy === 'insights' && 'animate-pulse',
                    )}
                  />
                  Generate insights now
                </button>
              </div>

              {leverError && (
                <div className="rounded-xl border border-rose-800 bg-rose-950/60 p-3 text-xs text-rose-200 break-words">
                  {leverError}
                </div>
              )}

              {sweep && (
                <div className="rounded-xl border border-gray-800 bg-gray-900 p-3 text-[11px] text-gray-300 space-y-1">
                  <div className="font-bold text-gray-200">
                    Sweep ran at {new Date(sweep.swept_at).toLocaleTimeString()}{' '}
                    — {sweep.notifications.length} low-stock notification
                    {sweep.notifications.length === 1 ? '' : 's'} since the run
                    was posted
                  </div>
                  {sweep.notifications.length === 0 ? (
                    <div className="text-gray-500">
                      Nothing crossed par, or nothing was raised.
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {sweep.notifications.slice(0, 6).map((n) => {
                        const email = n.delivery_status?.email
                        return (
                          <li key={n.id} className="flex flex-wrap gap-2">
                            <span className="text-gray-400 truncate max-w-[22rem]">
                              {n.title}
                            </span>
                            <span
                              className={cn(
                                'font-bold',
                                email == null
                                  ? STATUS_STYLE.unverifiable.text
                                  : email.ok
                                    ? STATUS_STYLE.pass.text
                                    : STATUS_STYLE.fail.text,
                              )}
                            >
                              {email == null
                                ? 'email outcome not recorded'
                                : email.ok
                                  ? `emailed · ${email.recipients} recipient${email.recipients === 1 ? '' : 's'}`
                                  : `not emailed · ${email.error ?? 'unknown error'}`}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}

              {insights && (
                <div className="rounded-xl border border-gray-800 bg-gray-900 p-3 text-[11px] text-gray-300 space-y-1">
                  <div className="font-bold text-gray-200">
                    {insights.count} insight{insights.count === 1 ? '' : 's'}{' '}
                    generated at{' '}
                    {new Date(insights.generated_at).toLocaleTimeString()}
                  </div>
                  <div className="text-gray-500">
                    {insights.candidateTypesAvailable} of{' '}
                    {insights.candidateTypesTotal} catalogue types have the data
                    to fire — an upper bound, not a count of what fired.
                  </div>
                  <ul className="space-y-0.5 text-gray-400">
                    {insights.sample.map((s, i) => (
                      <li key={i}>· {s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {verifyQuery.isLoading ? (
                <div className="flex items-center justify-center h-32 text-gray-600">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : verifyQuery.isError ? (
                <div className="rounded-xl border border-rose-800 bg-rose-950/60 p-4 text-xs text-rose-200">
                  <div className="font-bold mb-1 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Verification request failed
                  </div>
                  <div className="break-words">
                    {errorText(verifyQuery.error)}
                  </div>
                  <div className="mt-1 text-rose-300/80">
                    This is a failure, not an empty result — nothing below was
                    checked.
                  </div>
                </div>
              ) : verdict ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <SummaryChips summary={verdict.summary} />
                    <span className="text-[10px] text-gray-600 ml-auto">
                      verified{' '}
                      {new Date(verdict.verifiedAt).toLocaleTimeString()}
                    </span>
                  </div>

                  {failedReads.length > 0 && (
                    <div className="rounded-xl border border-violet-800 bg-violet-950/40 p-3 text-[11px] text-violet-200">
                      <div className="font-bold mb-1">
                        {failedReads.length} read
                        {failedReads.length === 1 ? '' : 's'} failed — every
                        check that depended on them is unverifiable, not passing
                      </div>
                      <ul className="space-y-0.5 font-mono text-[10px]">
                        {failedReads.map((r, i) => (
                          <li key={i}>
                            {r.table}: {r.error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-2xl border border-gray-800 bg-gray-900">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-widest text-gray-600">
                          <th className="px-3 py-2 font-bold">Status</th>
                          <th className="px-3 py-2 font-bold">Check</th>
                          <th className="px-3 py-2 font-bold">Expected</th>
                          <th className="px-3 py-2 font-bold">Actual</th>
                          <th className="px-3 py-2 font-bold">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {verdict.checks.map((row) => (
                          <CheckRow key={row.id} row={row} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default SimposScenariosPage
