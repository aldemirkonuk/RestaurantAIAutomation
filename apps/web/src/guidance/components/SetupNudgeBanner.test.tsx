import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({
  guidance: null as null | Record<string, unknown>,
  progress: null as null | { activated: boolean },
  role: 'owner' as string,
}))
vi.mock('../GuidanceProvider', () => ({ useGuidanceOptional: () => h.guidance }))
vi.mock('../../hooks/queries/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ progress: h.progress, isLoading: false }),
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: h.role } }),
}))
import { SetupNudgeBanner } from './SetupNudgeBanner'

const mount = (path = '/inventory') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SetupNudgeBanner />
    </MemoryRouter>,
  )

beforeEach(() => {
  h.guidance = {
    setupNudgeDismissedThisSession: false,
    isSetupNudgeDue: true,
    markSetupNudgeShown: vi.fn(),
    snoozeSetupNudge: vi.fn(),
    dismissSetupNudgeForever: vi.fn(),
  }
  h.progress = { activated: false }
  h.role = 'owner'
})
afterEach(cleanup)

it('asks an owner of an unfinished house for the menu, not a wine list', () => {
  mount()
  const strip = screen.getByRole('region', { name: 'Finish setup' })
  expect(strip).toHaveTextContent('menu')
  expect(strip).not.toHaveTextContent(/wine list/i)
})

it('stays away from staff, a finished house, a failed read and the setup pages', () => {
  h.role = 'staff'
  mount()
  expect(screen.queryByRole('region', { name: 'Finish setup' })).toBeNull()
  cleanup()
  h.role = 'owner'
  h.progress = { activated: true }
  mount()
  expect(screen.queryByRole('region', { name: 'Finish setup' })).toBeNull()
  cleanup()
  h.progress = null
  mount()
  expect(screen.queryByRole('region', { name: 'Finish setup' })).toBeNull()
  cleanup()
  h.progress = { activated: false }
  mount('/get-started')
  expect(screen.queryByRole('region', { name: 'Finish setup' })).toBeNull()
})
