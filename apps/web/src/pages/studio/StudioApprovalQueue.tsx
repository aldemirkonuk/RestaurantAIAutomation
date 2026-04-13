import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { StudioLayout } from './StudioLayout'
import { QueueTable } from './queue/QueueTable'
import { QueueItem } from './queue/QueueRow'
import { Badge } from '../../components/ui/badge'
import { EmptyState } from '../../components/ui/empty-state'
import { Skeleton } from '../../components/ui/loading-skeleton'

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('accessToken')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchQueue(): Promise<{ queue: QueueItem[]; total: number }> {
  const resp = await fetch(`/api/v1/studio/queue`, { headers: getAuthHeaders() })
  if (!resp.ok) throw new Error('Failed to load queue')
  return resp.json()
}

async function decideOverride(id: string, decision: 'approved' | 'rejected', note?: string) {
  const resp = await fetch(`/api/v1/studio/queue/${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, note }),
  })
  if (!resp.ok) throw new Error('Decision failed')
  return resp.json()
}

export default function StudioApprovalQueue() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['studio-queue'],
    queryFn: fetchQueue,
    refetchInterval: 30_000,
  })

  const mutation = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approved' | 'rejected'; note?: string }) =>
      decideOverride(id, decision, note),
    onSuccess: (_, { decision }) => {
      queryClient.invalidateQueries({ queryKey: ['studio-queue'] })
      toast.success(decision === 'approved' ? 'Override approved' : 'Override rejected')
    },
    onError: () => toast.error('Decision failed. Please try again.'),
  })

  const handleDecide = async (id: string, decision: 'approved' | 'rejected', note?: string) => {
    await mutation.mutateAsync({ id, decision, note })
  }

  const pending = data?.total ?? 0

  return (
    <StudioLayout>
      <div className="px-6 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-900">Override Approval Queue</h1>
            {pending > 0 ? (
              <Badge variant="warning">{pending} pending</Badge>
            ) : (
              <Badge variant="success">All clear</Badge>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Review and approve field overrides submitted by certified contributors.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : isError ? (
          <div className="text-center py-16 text-sm text-red-600">
            Could not load the approval queue.{' '}
            <button onClick={() => queryClient.invalidateQueries({ queryKey: ['studio-queue'] })}
                    className="underline hover:no-underline">Refresh</button>
          </div>
        ) : (data?.queue ?? []).length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <EmptyState
              size="md"
              icon={<CheckCircle className="w-full h-full" />}
              title="All caught up"
              description="No overrides are waiting for approval. The queue is clear."
            />
          </div>
        ) : (
          <QueueTable items={data!.queue} onDecide={handleDecide} />
        )}
      </div>
    </StudioLayout>
  )
}
