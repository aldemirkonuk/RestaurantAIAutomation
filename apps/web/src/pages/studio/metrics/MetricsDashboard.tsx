import { useQuery } from '@tanstack/react-query'
import { MetricCard } from './MetricCard'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

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

async function fetchMetrics(): Promise<StudioMetrics> {
  const token = localStorage.getItem('accessToken')
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const resp = await fetch(`${API_URL}/api/v1/studio/metrics`, { headers })
  if (!resp.ok) throw new Error('Failed to load studio metrics')
  return resp.json()
}

export function MetricsDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['studio-metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 60_000,
  })

  return (
    <div className="flex gap-4 flex-wrap mb-6">
      <MetricCard
        label="Total Overrides"
        value={data?.total_overrides ?? 0}
        trend={data?.overrides_delta}
        loading={isLoading}
      />
      <MetricCard
        label="Pending Queue"
        value={data?.pending_queue ?? 0}
        trend={data?.queue_delta}
        loading={isLoading}
      />
      <MetricCard
        label="Auto-Promoted"
        value={data?.auto_promoted ?? 0}
        trend={data?.promoted_delta}
        loading={isLoading}
      />
      <MetricCard
        label="Active Contributors"
        value={data?.active_contributors ?? 0}
        trend={data?.contributors_delta}
        loading={isLoading}
      />
    </div>
  )
}
