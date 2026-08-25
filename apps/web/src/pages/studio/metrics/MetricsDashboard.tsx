import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { MetricCard } from './MetricCard'
import { studioRequest, studioErrorMessage } from '../studioApi'

interface StudioMetrics {
  total_overrides: number
  pending_queue: number
  auto_promoted: number
  accepted_overrides: number
  rejected_overrides: number
  acceptance_rate: number
  avg_approval_latency_hours: number
  active_contributors: number
  computed_at: string
  // optional 7-day trend deltas
  overrides_delta?: number
  queue_delta?: number
  promoted_delta?: number
  contributors_delta?: number
}

// Orchestrator, not the gateway — the old comment here claimed the Vite proxy routed
// /api to FastAPI on 8000. It does not (vite.config.ts:24-27 → localhost:4000), which
// is why this call 404'd and every card rendered a fabricated zero. See studioApi.ts.
function fetchMetrics(): Promise<StudioMetrics> {
  return studioRequest<StudioMetrics>('/api/v1/studio/metrics')
}

export function MetricsDashboard() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['studio-metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 60_000,
  })

  // A dead endpoint used to look identical to a genuinely empty studio: four zeros.
  // On error show an em dash and say so, so "0 overrides" always means zero overrides.
  const cardValue = (n: number | undefined) => (isError ? '—' : n ?? 0)
  const cardTrend = (n: number | undefined) => (isError ? undefined : n)

  return (
    <div className="mb-6">
      <div className="flex gap-4 flex-wrap">
        <MetricCard
          label="Total Overrides"
          value={cardValue(data?.total_overrides)}
          trend={cardTrend(data?.overrides_delta)}
          loading={isLoading}
        />
        <MetricCard
          label="Pending Queue"
          value={cardValue(data?.pending_queue)}
          trend={cardTrend(data?.queue_delta)}
          loading={isLoading}
        />
        <MetricCard
          label="Auto-Promoted"
          value={cardValue(data?.auto_promoted)}
          trend={cardTrend(data?.promoted_delta)}
          loading={isLoading}
        />
        <MetricCard
          label="Active Contributors"
          value={cardValue(data?.active_contributors)}
          trend={cardTrend(data?.contributors_delta)}
          loading={isLoading}
        />
      </div>
      {isError && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Studio metrics unavailable — {studioErrorMessage(error)}
        </p>
      )}
    </div>
  )
}
