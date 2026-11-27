/**
 * The finish-setup nudge names the one step a house is missing (OB-1 fix
 * round): no menu read yet, or a menu read but kept as a draft. "Activated"
 * is a CURRENT menu, so a house whose read menu is not current is nudged to
 * choose it on /menu, never told to upload a wine list or set a threshold.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SetupNudgeBanner } from './SetupNudgeBanner'

const navigate = vi.fn()
let role: string | null = 'owner'
let progress: Record<string, unknown> | null = null

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../GuidanceProvider', () => ({
  useGuidanceOptional: () => ({
    setupNudgeDismissedThisSession: false,
    isSetupNudgeDue: true,
    markSetupNudgeShown: vi.fn(),
    snoozeSetupNudge: vi.fn(),
    dismissSetupNudgeForever: vi.fn(),
  }),
}))
vi.mock('../../hooks/queries/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ progress }),
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'u-1', role } }),
}))

const base = {
  id: null,
  menu_uploaded: false,
  menu_current: false,
  vendor_added: true,
  team_member_invited: true,
  checklist_dismissed: false,
  completed_at: null,
  threshold_configured: true,
  activated: false,
}

function renderBanner() {
  return render(
    <MemoryRouter initialEntries={['/inventory']}>
      <SetupNudgeBanner />
    </MemoryRouter>,
  )
}

describe('SetupNudgeBanner says the step that is missing', () => {
  beforeEach(() => {
    navigate.mockClear()
    role = 'owner'
    progress = null
  })

  it('a menu read but not current (kept as a draft, or the choice skipped) leads to /menu', () => {
    progress = { ...base, menu_uploaded: true }
    renderBanner()
    expect(screen.getByText('Your menu is read, but it is not the current menu yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose the current menu' }))
    expect(navigate).toHaveBeenCalledWith('/menu')
  })

  it('no menu read yet leads to /get-started', () => {
    progress = { ...base }
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Read your menu' }))
    expect(navigate).toHaveBeenCalledWith('/get-started')
  })

  it('a manager with no menu reads it on /menu', () => {
    role = 'manager'
    progress = { ...base }
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Read your menu' }))
    expect(navigate).toHaveBeenCalledWith('/menu')
  })

  it('never names a wine list or a threshold', () => {
    for (const p of [{ ...base }, { ...base, menu_uploaded: true }]) {
      progress = p
      const { container, unmount } = renderBanner()
      expect(container.textContent ?? '').not.toMatch(/threshold|wine list/i)
      unmount()
    }
  })

  it('a house with a current menu is not nudged, whatever its threshold says', () => {
    progress = { ...base, menu_uploaded: true, menu_current: true, activated: true, threshold_configured: false }
    const { container } = renderBanner()
    expect(container.textContent).toBe('')
  })

  it('staff are never nudged', () => {
    role = 'staff'
    progress = { ...base, menu_uploaded: true }
    const { container } = renderBanner()
    expect(container.textContent).toBe('')
  })
})
