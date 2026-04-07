import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Users } from 'lucide-react'
import { StudioLayout } from './StudioLayout'
import { ContributorTable, Contributor } from './certify/ContributorTable'
import { InviteDialog } from './certify/InviteDialog'
import { EmptyState } from '../../components/ui/empty-state'
import { Skeleton } from '../../components/ui/loading-skeleton'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('accessToken')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchContributors(): Promise<{ contributors: Contributor[] }> {
  const resp = await fetch(`${API_URL}/api/v1/studio/contributors`, { headers: getAuthHeaders() })
  if (!resp.ok) throw new Error('Failed to load contributors')
  return resp.json()
}

export default function StudioCertify() {
  const [inviteOpen, setInviteOpen] = useState(false)
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['studio-contributors'],
    queryFn: fetchContributors,
    refetchInterval: 60_000,
  })

  const contributors = data?.contributors ?? []

  const handleRevoke = async (userId: string) => {
    await fetch(`${API_URL}/api/v1/studio/contributors/${userId}/revoke`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    })
    queryClient.invalidateQueries({ queryKey: ['studio-contributors'] })
  }

  const handleToggleEnable = async (userId: string, enable: boolean) => {
    await fetch(`${API_URL}/api/v1/studio/contributors/${userId}/${enable ? 'enable' : 'disable'}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    })
    queryClient.invalidateQueries({ queryKey: ['studio-contributors'] })
  }

  return (
    <StudioLayout>
      <div className="px-6 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Certified Contributors</h1>
            <p className="text-sm text-slate-500 mt-1">{contributors.length} active contributors</p>
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
        ) : contributors.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <EmptyState
              size="md"
              icon={<Users className="w-full h-full" />}
              title="No certified contributors"
              description="Invite trusted contributors using the button above. They will receive a single-use link."
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
