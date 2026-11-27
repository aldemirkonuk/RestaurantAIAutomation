/**
 * The finish-setup nudge asks only for the menu (proposal F1, F20): it no
 * longer waits on a threshold no screen sets (verdict G8).
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { navigate, guidance, state } = vi.hoisted(() => ({
  navigate: vi.fn(),
  guidance: {
    isSetupNudgeDue: true,
    setupNudgeDismissedThisSession: false,
    markSetupNudgeShown: vi.fn(),
    snoozeSetupNudge: vi.fn(),
    dismissSetupNudgeForever: vi.fn(),
  },
  state: {
    progress: null as Record<string, boolean> | null,
    role: 'owner' as string,
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../GuidanceProvider', () => ({ useGuidanceOptional: () => guidance }))
vi.mock('../../hooks/queries/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ progress: state.progress }),
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: state.role, restaurantId: 'house-1' } }),
}))

import { SetupNudgeBanner } from './SetupNudgeBanner'

const banner = () => render(<MemoryRouter initialEntries={['/']}><SetupNudgeBanner /></MemoryRouter>)

// The primary button says the next step in the house's words (#1111: 'Read your
// menu', 'Choose the current menu'); #848 first called it 'Finish setup'. Any of
// them is the one button, so the spec holds on either side of that change.
const PRIMARY = { name: /^(Finish setup|Read your menu|Choose the current menu)$/ }

beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'owner'
  state.progress = null
})

describe('SetupNudgeBanner', () => {
  // #848 hid the banner once a menu was read even while `activated` was false.
  // #1214 later gates it on `activated` (a CURRENT menu), so a menu that is read
  // but not yet current is offered "Choose the current menu". What both agree
  // on, and what is pinned here, is that a read AND current menu hides it.
  it('stays hidden once a menu is read and current', () => {
    state.progress = { menu_uploaded: true, threshold_configured: false, activated: true }
    banner()
    expect(screen.queryByRole('button', PRIMARY)).toBeNull()
  })

  it('shows while no menu is read, keeps snooze and dismiss, and asks in plain words', () => {
    state.progress = { menu_uploaded: false, threshold_configured: false, activated: false }
    banner()
    fireEvent.click(screen.getByRole('button', PRIMARY))
    expect(navigate).toHaveBeenCalledWith('/get-started')
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(guidance.snoozeSetupNudge).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: "Don't remind me" }))
    expect(guidance.dismissSetupNudgeForever).toHaveBeenCalled()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/threshold/i)
    expect(text).not.toMatch(/wine list/i)
  })

  it('sends a manager to /menu, since /get-started opens an owner\'s first house', () => {
    state.role = 'manager'
    state.progress = { menu_uploaded: false, threshold_configured: false, activated: false }
    banner()
    fireEvent.click(screen.getByRole('button', PRIMARY))
    expect(navigate).toHaveBeenCalledWith('/menu')
  })

  it('is never shown to staff', () => {
    state.role = 'staff'
    state.progress = { menu_uploaded: false, threshold_configured: false, activated: false }
    banner()
    expect(screen.queryByRole('button', PRIMARY)).toBeNull()
  })
})
