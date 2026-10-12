import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SetupNudgeBanner } from './SetupNudgeBanner'

const { navigate, guidance } = vi.hoisted(() => ({
  navigate: vi.fn(),
  guidance: {
    setupNudgeDismissedThisSession: false,
    isSetupNudgeDue: true,
    markSetupNudgeShown: vi.fn(),
    snoozeSetupNudge: vi.fn(),
    dismissSetupNudgeForever: vi.fn(),
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../GuidanceProvider', () => ({ useGuidanceOptional: () => guidance }))
vi.mock('../../hooks/queries/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ progress: { activated: false } }),
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'house-1' } }),
}))

beforeEach(() => vi.clearAllMocks())

describe('SetupNudgeBanner (SETUP-11)', () => {
  it("leads an owner inside a house to the house's contents, not the sign-up wizard", () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <SetupNudgeBanner />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(navigate).toHaveBeenCalledWith('/house')
    expect(navigate).not.toHaveBeenCalledWith('/get-started')
  })
})
