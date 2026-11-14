/**
 * r36 onboarding gap 12: the last setup step waited for an invite, so a
 * house run by its owner alone never finished its setup. The person can now
 * answer "No team yet"; the gateway keeps it on their own row and settles the
 * team step with it while the house has no invite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LearnPanel } from './LearnPanel'
import type { OnboardingProgress } from '../../services/api/menus'

const update = vi.fn()
vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, updateOnboardingProgress: (...args: unknown[]) => update(...args) }
})
const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../GuidanceProvider', () => ({ useGuidanceOptional: () => null }))
vi.mock('../analytics', () => ({ trackGuidance: vi.fn() }))

const base: OnboardingProgress = {
  id: 'uop-1',
  user_id: 'u-1',
  restaurant_id: 'rest-A',
  menu_uploaded: true,
  menu_current: true,
  vendor_added: true,
  team_member_invited: false,
  no_team_yet: false,
  checklist_dismissed: false,
  completed_at: null,
  threshold_configured: true,
  activated: true,
}

function panel(progress: OnboardingProgress, client?: QueryClient) {
  const tree = (
    <MemoryRouter>
      <LearnPanel progress={progress} mode="get-started" anchorRef={{ current: null }} onClose={vi.fn()} />
    </MemoryRouter>
  )
  render(client ? <QueryClientProvider client={client}>{tree}</QueryClientProvider> : tree)
}

const teamRow = () => {
  const label = screen.getByText('Invite a team member')
  return label.closest('div.flex') as HTMLElement
}

describe('the team step takes "No team yet"', () => {
  beforeEach(() => {
    update.mockReset()
    navigate.mockReset()
  })

  it('offers "No team yet" beside the invite while the house has none', () => {
    panel(base)
    expect(within(teamRow()).getByRole('button', { name: /Send Invite/ })).toBeInTheDocument()
    expect(within(teamRow()).getByRole('button', { name: 'No team yet' })).toBeInTheDocument()
    expect(screen.getByText('3/4 complete')).toBeInTheDocument()
  })

  it('an older gateway (no answer field) is not offered it', () => {
    const { no_team_yet: _gone, ...older } = base
    panel(older)
    expect(within(teamRow()).queryByRole('button', { name: 'No team yet' })).toBeNull()
    expect(within(teamRow()).getByRole('button', { name: /Send Invite/ })).toBeInTheDocument()
  })

  it('pressing it keeps the answer and refreshes the setup read', async () => {
    update.mockResolvedValue(undefined)
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    panel(base, client)
    fireEvent.click(within(teamRow()).getByRole('button', { name: 'No team yet' }))
    expect(update).toHaveBeenCalledWith({ no_team_yet: true })
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['onboarding-progress'] }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says while it is keeping the answer, and does not take a second press', async () => {
    let finish: () => void = () => {}
    update.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    panel(base)
    fireEvent.click(within(teamRow()).getByRole('button', { name: 'No team yet' }))
    const busy = await within(teamRow()).findByRole('button', { name: 'Keeping your answer…' })
    expect(busy).toBeDisabled()
    finish()
    await within(teamRow()).findByRole('button', { name: 'No team yet' })
  })

  it('a refused answer is said, and can be tried again', async () => {
    update.mockRejectedValueOnce(new Error('500'))
    panel(base)
    fireEvent.click(within(teamRow()).getByRole('button', { name: 'No team yet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your answer was not kept. Try again.')
    expect(within(teamRow()).getByRole('button', { name: 'No team yet' })).toBeEnabled()
  })

  it('once answered, the step is done, says so, and offers nothing', () => {
    panel({ ...base, no_team_yet: true })
    const row = teamRow()
    expect(row.querySelector('.line-through')).not.toBeNull()
    expect(row.textContent).toContain('You said there is no team yet. Invite someone in Settings › Team when they join.')
    expect(within(row).queryByRole('button')).toBeNull()
    expect(screen.getByText('4/4 complete')).toBeInTheDocument()
  })

  it('an invite is the team step: no answer is said beside it', () => {
    panel({ ...base, team_member_invited: true, no_team_yet: false })
    const row = teamRow()
    expect(row.querySelector('.line-through')).not.toBeNull()
    expect(row.textContent).not.toContain('no team yet')
  })
})
