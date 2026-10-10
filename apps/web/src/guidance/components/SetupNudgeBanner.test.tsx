/**
 * "Finish setup" goes to the half that is still missing (F-985, F-239).
 * Before, it always went to /get-started, which never asked the low-stock
 * threshold, so a house with its menu in could not finish.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const state = vi.hoisted(() => ({ progress: null as Record<string, boolean> | null }))

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
  useOnboardingProgress: () => ({ progress: state.progress }),
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner' } }),
}))

import { SetupNudgeBanner } from './SetupNudgeBanner'

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function mount() {
  render(
    <MemoryRouter initialEntries={['/house']}>
      <Routes>
        <Route path="/house" element={<SetupNudgeBanner />} />
        <Route path="/get-started" element={<Where />} />
        <Route path="/house/menu" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
  return screen.getByTestId('where').textContent
}

describe('SetupNudgeBanner — where "Finish setup" goes', () => {
  beforeEach(() => {
    state.progress = null
  })

  it('goes to the low-stock step while the threshold is not set', () => {
    state.progress = { menu_uploaded: true, threshold_configured: false, activated: false }
    expect(mount()).toBe('/get-started?step=threshold')
  })

  it('goes to the menu once the threshold is set', () => {
    state.progress = { menu_uploaded: false, threshold_configured: true, activated: false }
    expect(mount()).toBe('/get-started')
  })

  it('goes to make the read menu current when only a draft was read (F-1061)', () => {
    state.progress = { menu_uploaded: true, menu_current: false, threshold_configured: true, activated: false }
    expect(mount()).toBe('/house/menu')
  })

  it('says nothing is locked behind setup, in words for every drink (F-1061)', () => {
    state.progress = { menu_uploaded: false, threshold_configured: false, activated: false }
    render(
      <MemoryRouter initialEntries={['/house']}>
        <SetupNudgeBanner />
      </MemoryRouter>,
    )
    expect(screen.queryByText(/unlock/i)).toBeNull()
    expect(screen.queryByText(/wine list/i)).toBeNull()
    expect(screen.getByText(/so we can flag what is running low/)).toBeTruthy()
  })
})
