/**
 * F-289: a `developer` may read the override queue and the contributor list,
 * but the orchestrator answers 403 to every decide / invite / revoke / enable /
 * disable unless the caller is `review_admin` (api/studio_routes.py). The pages
 * must hide those controls by the same rule instead of offering buttons that
 * always fail.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ roles: [] as string[], request: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'u1', email: 'dev@example.com', studioRoles: mocks.roles } }),
}))
vi.mock('./studioApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./studioApi')>()),
  studioRequest: (path: string) => mocks.request(path),
}))

import StudioCertify from './StudioCertify'
import StudioApprovalQueue from './StudioApprovalQueue'

const CONTRIBUTOR = {
  id: 'c1', user_id: 'user-1', role: 'certified_contributor', granted_at: '2026-09-01T00:00:00Z',
  revoked_at: null, consecutive_approved_overrides: 0, promotion_policy: 'queue',
  auto_promote_earned_at: null, email: 'ana@example.com', name: 'Ana',
}
const ITEM = {
  id: 'o1', submission_id: 's1', actor_id: 'a1', field_name: 'region', old_value: 'Rioja',
  new_value: 'Rioja Alta', old_confidence: 0.5, reason: 'label', citation_url: null,
  promotion_status: 'pending', created_at: '2026-10-01T00:00:00Z', wine_name: 'Viña Ardanza',
}

const renderPage = (page: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  mocks.request.mockReset().mockImplementation(async (path: string) =>
    path.endsWith('/contributors') ? { contributors: [CONTRIBUTOR] } : { queue: [ITEM], total: 1 },
  )
})

describe('studio review controls follow the review_admin rule (F-289)', () => {
  it('a developer sees the contributor list without invite, enable/disable or revoke', async () => {
    mocks.roles = ['developer']
    renderPage(<StudioCertify />)
    await screen.findByText('Ana')
    expect(screen.queryByRole('button', { name: /Invite Contributor/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Disable Ana/ })).toBeNull()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('a review admin keeps invite and the access toggle', async () => {
    mocks.roles = ['review_admin']
    renderPage(<StudioCertify />)
    await screen.findByText('Ana')
    expect(screen.getByRole('button', { name: /Invite Contributor/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Disable Ana/ })).toBeInTheDocument()
  })

  it('a developer sees the queue without approve or reject', async () => {
    mocks.roles = ['developer']
    renderPage(<StudioApprovalQueue />)
    await screen.findByText('A review admin decides')
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Reject/ })).toBeNull()
  })

  it('a review admin can approve or reject', async () => {
    mocks.roles = ['review_admin']
    renderPage(<StudioApprovalQueue />)
    expect(await screen.findByRole('button', { name: /Approve/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reject/ })).toBeInTheDocument()
  })
})
