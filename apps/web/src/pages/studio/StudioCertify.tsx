import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Users } from 'lucide-react'
import { StudioLayout } from './StudioLayout'
import { ContributorTable, Contributor } from './certify/ContributorTable'
import { InviteDialog } from './certify/InviteDialog'
import { EmptyState } from '../../components/ui/empty-state'
import { Skeleton } from '../../components/ui/loading-skeleton'
import { studioRequest, studioJsonRequest, studioErrorMessage } from './studioApi'

// Orchestrator, not the gateway — see studioApi.ts.
function fetchContributors(): Promise<{ contributors: Contributor[] }> {
  return studioRequest<{ contributors: Contributor[] }>('/api/v1/studio/contributors')
}

export default function StudioCertify() {
  const [inviteOpen, setInviteOpen] = useState(false)
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['studio-contributors'],
    queryFn: fetchContributors,
    refetchInterval: 60_000,
  })

  const contributors = data?.contributors ?? []

  // These two previously ignored `resp.ok` entirely: the request 404'd at the gateway,
  // the promise still resolved, and ContributorTable toasted "Contributor revoked" for a
  // revoke that never happened. studioJsonRequest throws on any non-2xx, so the caller's
  // catch is now the only path a failure can take.
  const handleRevoke = async (userId: string) => {
    await studioJsonRequest(`/api/v1/studio/contributors/${encodeURIComponent(userId)}/revoke`, 'PATCH')
    queryClient.invalidateQueries({ queryKey: ['studio-contributors'] })
  }

  const handleToggleEnable = async (userId: string, enable: boolean) => {
    await studioJsonRequest(
      `/api/v1/studio/contributors/${encodeURIComponent(userId)}/${enable ? 'enable' : 'disable'}`,
      'PATCH',
    )
    queryClient.invalidateQueries({ queryKey: ['studio-contributors'] })
  }

  return (
    <StudioLayout>
      <div className="px-6 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Certified Contributors</h1>
            {/* "0 active contributors" is what a dead endpoint used to look like. */}
            <p className={`text-sm mt-1 ${isError ? 'text-red-600' : 'text-slate-500'}`}>
              {isError ? 'Contributor list unavailable' : `${contributors.length} active contributors`}
            </p>
          </div>
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-2 bg-wine-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-wine-700 transition-colors shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            Invite Contributor
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : isError ? (
          <div className="text-center py-16 text-sm text-red-600">
            Could not load contributors — {studioErrorMessage(error)}{' '}
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['studio-contributors'] })}
              className="underline hover:no-underline"
            >
              Refresh
            </button>
          </div>
        ) : contributors.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <EmptyState
              size="md"
              icon={<Users className="w-full h-full" />}
              title="No certified contributors"
              description="Generate a single-use invite token with the button above. Redemption is not self-service yet — a developer or review admin still has to grant the role."
              action={{ label: 'Invite Contributor', onClick: () => setInviteOpen(true) }}
            />
          </div>
        ) : (
          <ContributorTable
            contributors={contributors}
            onRevoke={handleRevoke}
            onToggleEnable={handleToggleEnable}
          />
        )}

        <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      </div>
    </StudioLayout>
  )
}
