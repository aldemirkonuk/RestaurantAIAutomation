/**
 * Correlated logs timeline — read-only feed over POS checks, agent decisions,
 * stock movements, documents, audit log, and (when filtered) the event store.
 *
 * A LOST SOURCE IS SAID IN WORDS (ADR 0086)
 *
 * The gateway catches each of its six sources individually so that one dead
 * register cannot take the other five down, and the request still returns 200.
 * That is the right half of the trade and it used to be the whole of it: a
 * source that 500ed contributed zero events, the request succeeded, and this
 * page rendered a SHORTER FEED with a chip reading `POS 0` — a fabricated zero
 * that is indistinguishable from a quiet restaurant. The only party that knew a
 * register was missing was the server log.
 *
 * So the response now carries `failedSources` and `sourcesQueried` alongside
 * `events`, and this page renders them:
 *
 *   - a failed source's chip shows `—`, never a count, and the banner names it;
 *   - a source that was not queried at all (`event_store` is not
 *     restaurant-scoped and is read only when a correlation id names the rows)
 *     shows `—` too, because it reported nothing rather than reporting none;
 *   - both fields are OPTIONAL here. A gateway that does not send them tells us
 *     nothing, and nothing is not "all six were fine" — absent means unknown,
 *     so the page falls silent rather than claiming health it cannot prove.
 *
 * `TimelineEvent.occurredAt` mirrors the gateway's own type and is
 * `string | null`: `procurement_documents.created_at` and
 * `system_audit_log.created_at` are both nullable in the baseline, so an
 * undated row is real. It renders as `—` (ADR 0016, ADR 0051), never as
 * "Invalid Date" and never as a borrowed timestamp.
 *
 * The shape below mirrors apps/api-gateway/src/logs/logs-timeline.service.ts;
 * the web app has no import path into the gateway, so it is restated, not
 * shared. Keep the two in step.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Loader2, Search } from 'lucide-react'
import { Header } from '../components/layout/Header'
import { useAuth } from '../contexts/AuthContext'
import { apiClient } from '../services/api/client'
import { cn } from '../lib/utils'

type TimelineSource =
  | 'pos_checks'
  | 'decision_log'
  | 'inventory_transactions'
  | 'procurement_documents'
  | 'system_audit_log'
  | 'event_store'

interface TimelineEvent {
  id: string
  source: TimelineSource
  /** Null when the row's timestamp column is null — the gateway returns the
   *  event rather than dropping it, and sorts undated rows last. */
  occurredAt: string | null
  correlationId: string | null
  summary: string
  detail: Record<string, unknown>
}

interface TimelineResponse {
  events: TimelineEvent[]
  correlationId: string | null
  /** Every source the call actually read — a skip is stated, never inferred.
   *  Optional: a gateway predating ADR 0086 omits it, and omitted is unknown. */
  sourcesQueried?: TimelineSource[]
  /** Sources that errored. Non-empty means every count here is a FLOOR. */
  failedSources?: TimelineSource[]
}

/** Fixed render order, so the chip row does not depend on object key order. */
const SOURCE_ORDER: TimelineSource[] = [
  'pos_checks',
  'decision_log',
  'inventory_transactions',
  'procurement_documents',
  'system_audit_log',
  'event_store',
]

const SOURCE_STYLE: Record<TimelineSource, string> = {
  pos_checks: 'bg-indigo-50 text-indigo-700',
  decision_log: 'bg-violet-50 text-violet-700',
  inventory_transactions: 'bg-emerald-50 text-emerald-700',
  procurement_documents: 'bg-amber-50 text-amber-700',
  system_audit_log: 'bg-gray-100 text-gray-600',
  event_store: 'bg-sky-50 text-sky-700',
}

const SOURCE_LABEL: Record<TimelineSource, string> = {
  pos_checks: 'POS',
  decision_log: 'Agent',
  inventory_transactions: 'Stock',
  procurement_documents: 'Doc',
  system_audit_log: 'Audit',
  event_store: 'Event',
}

/** Long-form names for the banner — a sentence needs more than a chip does. */
const SOURCE_NAME: Record<TimelineSource, string> = {
  pos_checks: 'POS checks',
  decision_log: 'agent decisions',
  inventory_transactions: 'stock movements',
  procurement_documents: 'procurement documents',
  system_audit_log: 'the audit log',
  event_store: 'the event store',
}

/**
 * A source the gateway names and this file has not mirrored yet has no short
 * label, no long name and no colour. Falling through to `undefined` renders an
 * EMPTY badge — an unknown printed as nothing, which is the fault this page
 * exists to stop, one field further down. So every lookup falls back to the raw
 * key: ugly on purpose, and never blank.
 */
function labelOf(s: TimelineSource): string {
  return SOURCE_LABEL[s] ?? s
}
function styleOf(s: TimelineSource): string {
  return SOURCE_STYLE[s] ?? 'bg-gray-100 text-gray-600'
}
function nameOf(s: TimelineSource): string {
  return SOURCE_NAME[s] ?? s
}

/** An undated row is rendered as unknown, never as "Invalid Date". */
function fmtOccurredAt(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  return Number.isNaN(t) ? '—' : new Date(t).toLocaleString()
}

function listSources(sources: TimelineSource[]): string {
  return sources.map(nameOf).join(', ')
}

async function fetchTimeline(
  restaurantId: string,
  correlationId?: string,
): Promise<TimelineResponse> {
  const { data } = await apiClient.get(`/logs/timeline/${restaurantId}`, {
    params: { correlationId: correlationId || undefined, limit: 100 },
  })
  return data
}

export function LogsTimelinePage() {
  const { activeRestaurantId } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [draft, setDraft] = useState(searchParams.get('correlationId') || '')
  const correlationId = searchParams.get('correlationId') || undefined

  const query = useQuery({
    queryKey: ['logs-timeline', activeRestaurantId, correlationId],
    queryFn: () => fetchTimeline(activeRestaurantId!, correlationId),
    enabled: !!activeRestaurantId,
  })

  const events = query.data?.events ?? []
  const sources = useMemo(() => {
    const counts: Partial<Record<TimelineSource, number>> = {}
    for (const e of events) counts[e.source] = (counts[e.source] ?? 0) + 1
    return counts
  }, [events])

  // Undefined is UNKNOWN, not empty: `?? []` here would turn "the gateway did
  // not say" into "nothing failed", which is the fault this change exists to
  // remove. Only a present, empty array means nothing failed.
  const failedSources = query.data?.failedSources
  const sourcesQueried = query.data?.sourcesQueried
  const skippedSources = useMemo(
    () =>
      sourcesQueried
        ? SOURCE_ORDER.filter((s) => !sourcesQueried.includes(s))
        : [],
    [sourcesQueried],
  )
  const readCount = sourcesQueried
    ? sourcesQueried.length - (failedSources?.length ?? 0)
    : null
  // Every register either side knows about, in this file's order, with anything
  // the gateway named and this file has not mirrored yet appended. Drift is a
  // known risk — the type is restated, not imported — and it must not surface
  // as an impossible figure ("Read 7 of 6") NOR as a tally that counts a
  // register the chip row below does not show. One list drives both, so the two
  // cannot disagree.
  const displaySources = useMemo(
    () => [...new Set<TimelineSource>([...SOURCE_ORDER, ...(sourcesQueried ?? [])])],
    [sourcesQueried],
  )

  // The whole request failed: no source was reached, so nothing below is a
  // measurement. `isError` is used directly rather than gated on !isFetching —
  // on @tanstack/react-query 5.x a refetch after an error resets status to
  // pending, so the mid-retry flash this would guard against does not arise
  // (measured under ADR 0086 clause 8).
  const requestFailed = query.isError
  const someSourcesFailed = (failedSources?.length ?? 0) > 0

  const applyFilter = () => {
    const trimmed = draft.trim()
    if (trimmed) setSearchParams({ correlationId: trimmed })
    else setSearchParams({})
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        title="Logs"
        subtitle="Correlated timeline across POS, stock, documents, and agents"
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            applyFilter()
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Filter by correlation id…"
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-wine-500"
            />
          </div>
          <button
            type="submit"
            className="h-10 px-4 rounded-xl bg-wine-600 hover:bg-wine-700 text-white text-xs font-bold"
          >
            Filter
          </button>
          {correlationId && (
            <button
              type="button"
              onClick={() => {
                setDraft('')
                setSearchParams({})
              }}
              className="h-10 px-3 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-600"
            >
              Clear
            </button>
          )}
        </form>

        {requestFailed && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3"
          >
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <p className="text-xs text-rose-800">
              <span className="font-bold">The timeline could not be read.</span>{' '}
              No register below was reached, so this is a failure, not a quiet
              restaurant. Nothing here is a count of anything.
            </p>
          </div>
        )}

        {!requestFailed && someSourcesFailed && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3"
          >
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <p className="text-xs text-rose-800">
              <span className="font-bold">
                {failedSources!.length === 1
                  ? '1 register could not be read'
                  : `${failedSources!.length} registers could not be read`}
                :
              </span>{' '}
              {listSources(failedSources!)}. Every count below is a floor — the
              feed is missing whatever those registers hold.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {displaySources.map((s) => {
              const failed = failedSources?.includes(s) ?? false
              const skipped = !failed && skippedSources.includes(s)
              const unknown = failed || skipped || requestFailed
              return (
                <span
                  key={s}
                  title={
                    failed
                      ? `${nameOf(s)} could not be read`
                      : skipped
                        ? `${nameOf(s)} was not read for this view`
                        : requestFailed
                          ? `${nameOf(s)} was not reached`
                          : undefined
                  }
                  className={cn(
                    'text-[10px] font-bold px-2 py-1 rounded-full',
                    failed
                      ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                      : styleOf(s),
                    (skipped || requestFailed) && !failed && 'opacity-50',
                  )}
                >
                  {labelOf(s)} {unknown ? '—' : (sources[s] ?? 0)}
                </span>
              )
            })}
          </div>

          {/* Presence is stated, not assumed. Rendered only when the gateway
              actually reported which registers it read. */}
          {!requestFailed && readCount !== null && (
            <p className="text-[11px] text-gray-400">
              Read {readCount} of {displaySources.length} registers
              {skippedSources.length > 0 &&
                ` · not read: ${listSources(skippedSources)}`}
            </p>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {query.isLoading ? (
            <div className="flex items-center justify-center h-40 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : requestFailed ? (
            <div className="flex items-center justify-center h-40 text-xs text-rose-700">
              The timeline is unavailable
            </div>
          ) : events.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-xs text-gray-400">
              {someSourcesFailed
                ? 'No events from the registers that could be read'
                : `No events${correlationId ? ' for this correlation id' : ''}`}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {events.map((e) => (
                <li key={`${e.source}:${e.id}`} className="px-5 py-3.5">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5',
                        styleOf(e.source),
                      )}
                    >
                      {labelOf(e.source)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900">{e.summary}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        <span title={e.occurredAt ? undefined : 'This row records no timestamp'}>
                          {fmtOccurredAt(e.occurredAt)}
                        </span>
                        {e.correlationId ? (
                          <>
                            {' · '}
                            <button
                              className="font-mono text-wine-600 hover:underline"
                              onClick={() => {
                                setDraft(e.correlationId!)
                                setSearchParams({ correlationId: e.correlationId! })
                              }}
                            >
                              {e.correlationId}
                            </button>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export default LogsTimelinePage
