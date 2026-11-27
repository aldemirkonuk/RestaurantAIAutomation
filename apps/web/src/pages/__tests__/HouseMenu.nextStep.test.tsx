/**
 * After the first menu proof, an owner or a manager is offered "Invite your
 * people" as one calm line (r107 onboarding g3). Staff never see it; it goes
 * once someone has been invited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HouseMenu from '../HouseMenu'
import { FIRST_PROOF_KEY } from '../../lib/firstProof'
import { getOnboardingProgress } from '../../services/api/menus'

let role: string | null = 'owner'
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: role, user: { role } }),
}))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => null }))
vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, getOnboardingProgress: vi.fn(), reviewMenuItem: vi.fn(), addMenuItem: vi.fn() }
})
const progress = vi.mocked(getOnboardingProgress)

const item = {
  menuItemId: 'i1', submissionId: null, name: 'House Lager', producer: null, category: 'beer', vintage: null,
  region: null, grapeVariety: null, byGlassPrice: 8, bottlePrice: null, rawText: 'House Lager 8',
  matched: true, needsReview: false,
}

function open(invited: boolean | null) {
  progress.mockReset()
  progress.mockResolvedValue(invited === null ? null : ({ team_member_invited: invited } as never))
  sessionStorage.setItem(
    FIRST_PROOF_KEY,
    JSON.stringify({ menuId: 'm1', itemsExtracted: 1, submissionsCreated: 0, items: [item] }),
  )
  return render(<MemoryRouter><HouseMenu /></MemoryRouter>)
}

beforeEach(() => {
  sessionStorage.clear()
  role = 'owner'
})

describe('the first proof offers the way on to a team', () => {
  it('shows an owner with no team the link, to the invite sheet', async () => {
    open(false)
    const link = await screen.findByRole('link', { name: 'Invite your people' })
    expect(link.getAttribute('href')).toBe('/settings?tab=team&invite=1')
  })

  it('shows a manager the link', async () => {
    role = 'manager'
    open(false)
    expect(await screen.findByRole('link', { name: 'Invite your people' })).toBeTruthy()
  })

  it('never shows staff the link, and does not even ask', async () => {
    role = 'staff'
    open(false)
    await Promise.resolve()
    expect(screen.queryByRole('link', { name: 'Invite your people' })).toBeNull()
    expect(progress).not.toHaveBeenCalled()
  })

  it('hides it once the team step is ticked', async () => {
    open(true)
    await waitFor(() => expect(progress).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.queryByRole('link', { name: 'Invite your people' })).toBeNull()
  })

  it('shows nothing when the setup read failed', async () => {
    open(false)
    await screen.findByRole('link', { name: 'Invite your people' })
    cleanup()
    sessionStorage.clear()
    open(false)
    progress.mockReset()
    progress.mockRejectedValue(new Error('down'))
    cleanup()
    sessionStorage.setItem(FIRST_PROOF_KEY, JSON.stringify({ menuId: 'm1', itemsExtracted: 1, submissionsCreated: 0, items: [item] }))
    render(<MemoryRouter><HouseMenu /></MemoryRouter>)
    await waitFor(() => expect(progress).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.queryByRole('link', { name: 'Invite your people' })).toBeNull()
  })
})
