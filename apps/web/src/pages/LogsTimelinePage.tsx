/**
 * Correlated logs timeline — read-only feed over POS checks, agent decisions,
 * stock movements, documents, audit log, and (when filtered) the event store.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Search } from 'lucide-react'
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
  occurredAt: string
  correlationId: string | null
  summary: string
  detail: Record<string, unknown>
}

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

async function fetchTimeline(
  restaurantId: string,
  correlationId?: string,
): Promise<{ events: TimelineEvent[]; correlationId: string | null }> {
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

        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(SOURCE_LABEL) as TimelineSource[]).map((s) => (
            <span
              key={s}
              className={cn(
                'text-[10px] font-bold px-2 py-1 rounded-full',
                SOURCE_STYLE[s],
              )}
            >
              {SOURCE_LABEL[s]} {sources[s] ?? 0}
            </span>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {query.isLoading ? (
            <div className="flex items-center justify-center h-40 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-xs text-gray-400">
              No events{correlationId ? ' for this correlation id' : ''}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {events.map((e) => (
                <li key={`${e.source}:${e.id}`} className="px-5 py-3.5">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5',
                        SOURCE_STYLE[e.source],
                      )}
                    >
                      {SOURCE_LABEL[e.source]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900">{e.summary}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {new Date(e.occurredAt).toLocaleString()}
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
