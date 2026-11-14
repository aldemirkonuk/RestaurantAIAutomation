/**
 * The finish-setup nudge asks only for the menu (proposal F1, F20): it no
 * longer waits on a threshold no screen sets (verdict G8). Its words and its
 * read-but-not-current case are the menu train's (missingStep test).
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
  // r37 meet with the menu train: "stays hidden once a menu is read" is gone.
  // OB-1 (ADR 0193) moved "activated" to a CURRENT menu, so a read menu that
  // is not current is nudged to be chosen (SetupNudgeBanner.missingStep.test).
  // The primary button now names the missing step ("Read your menu").
  it('shows while no menu is read, keeps snooze and dismiss, and asks in plain words', () => {
    state.progress = { menu_uploaded: false, threshold_configured: false, activated: false }
    banner()
    fireEvent.click(screen.getByRole('button', { name: 'Read your menu' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Read your menu' }))
    expect(navigate).toHaveBeenCalledWith('/menu')
  })

  it('is never shown to staff', () => {
    state.role = 'staff'
    state.progress = { menu_uploaded: false, threshold_configured: false, activated: false }
    banner()
    expect(screen.queryByRole('button', { name: 'Read your menu' })).toBeNull()
  })
})
