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

beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'owner'
  state.progress = null
})

describe('SetupNudgeBanner', () => {
  it('stays hidden once a menu is read, even though activated is still false', () => {
    state.progress = { menu_uploaded: true, threshold_configured: false, activated: false }
    banner()
    expect(screen.queryByRole('button', { name: 'Finish setup' })).toBeNull()
  })

  it('shows while no menu is read, keeps snooze and dismiss, and asks in plain words', () => {
    state.progress = { menu_uploaded: false, threshold_configured: false, activated: false }
    banner()
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(navigate).toHaveBeenCalledWith('/menu')
  })

  it('with an OB-1 server, a read menu that is not current still nudges, and leads an owner to the choice', () => {
    state.progress = { menu_uploaded: true, menu_current: false, activated: false }
    banner()
    expect(document.body.textContent).toMatch(/Choose it as the current menu/)
    fireEvent.click(screen.getByRole('button', { name: 'Choose the menu' }))
    expect(navigate).toHaveBeenCalledWith('/house/menu')
  })

  it('a manager makes the choice on /menu', () => {
    state.role = 'manager'
    state.progress = { menu_uploaded: true, menu_current: false, activated: false }
    banner()
    fireEvent.click(screen.getByRole('button', { name: 'Choose the menu' }))
    expect(navigate).toHaveBeenCalledWith('/menu')
  })

  it('a current menu ends the nudge', () => {
    state.progress = { menu_uploaded: true, menu_current: true, activated: true }
    banner()
    expect(screen.queryByRole('button', { name: /Finish setup|Choose the menu/ })).toBeNull()
  })

  it('is never shown to staff', () => {
    state.role = 'staff'
    state.progress = { menu_uploaded: false, threshold_configured: false, activated: false }
    banner()
    expect(screen.queryByRole('button', { name: 'Finish setup' })).toBeNull()
  })
})
