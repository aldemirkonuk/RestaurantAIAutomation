import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { StudioLayout } from './StudioLayout'
import { QueueTable } from './queue/QueueTable'
import { QueueItem } from './queue/QueueRow'
import { Badge } from '../../components/ui/badge'
import { EmptyState } from '../../components/ui/empty-state'
import { Skeleton } from '../../components/ui/loading-skeleton'
import { studioRequest, studioJsonRequest, studioErrorMessage } from './studioApi'

// Orchestrator, not the gateway — a relative /api/v1/studio/* path resolves to the
// NestJS gateway, which has no studio module, so both of these 404'd. See studioApi.ts.
function fetchQueue(): Promise<{ queue: QueueItem[]; total: number }> {
  return studioRequest<{ queue: QueueItem[]; total: number }>('/api/v1/studio/queue')
}

// `library` is the library-promotion outcome the server tries after an approval:
// 'promoted' | 'not_ready' | 'failed'. Absent for a rejection.
interface DecisionResponse {
  library?: string
}

function decideOverride(id: string, decision: 'approved' | 'rejected', note?: string) {
  return studioJsonRequest<DecisionResponse>(`/api/v1/studio/queue/${encodeURIComponent(id)}`, 'PATCH', { decision, note })
}

export default function StudioApprovalQueue() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['studio-queue'],
    queryFn: fetchQueue,
    refetchInterval: 30_000,
  })

  const mutation = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approved' | 'rejected'; note?: string }) =>
      decideOverride(id, decision, note),
    onSuccess: (result, { decision }) => {
      queryClient.invalidateQueries({ queryKey: ['studio-queue'] })
      if (decision === 'approved' && result?.library === 'failed') {
        // The change is kept on the record; only the step into the shared library failed.
        toast.warning('Override approved, but the wine was not added to the library', {
          description: 'The change is saved on this record. Use Promote on the record to add it to the library.',
        })
        return
      }
      toast.success(decision === 'approved' ? 'Override approved' : 'Override rejected')
    },
    // studioJsonRequest throws on any non-2xx, so this is the only path a failed
    // decision can take — the success toast above cannot fire for a 404/403.
    onError: (err) => toast.error('Decision failed', { description: studioErrorMessage(err).slice(0, 160) }),
  })

  const handleDecide = async (id: string, decision: 'approved' | 'rejected', note?: string) => {
    // Swallow the rejection after onError has toasted: QueueRow awaits this and has no
    // catch of its own, so re-throwing would only surface as an unhandled rejection.
    await mutation.mutateAsync({ id, decision, note }).catch(() => undefined)
  }

  const pending = data?.total ?? 0

  return (
    <StudioLayout>
      <div className="px-6 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-900">Override Approval Queue</h1>
            {/* A green "All clear" was rendered whenever `total` was absent — including
                when the fetch had failed. A dead endpoint must never read as an empty
                queue, so the success badge requires a loaded, non-erroring response. */}
            {isError ? (
              <Badge variant="destructive">Queue unavailable</Badge>
            ) : isLoading ? (
              <Badge variant="secondary">Loading…</Badge>
            ) : pending > 0 ? (
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
            Could not load the approval queue — {studioErrorMessage(error)}{' '}
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
