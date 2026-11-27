// A tip already dismissed on the account must not draw its strip while the
// preferences answer is still the `{}` placeholder (the strip flashed ~1 s and
// was then removed, a 0.1 layout shift on /mail and /inventory).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const prefs = vi.hoisted(() => ({
  value: { preferences: {} as Record<string, unknown>, isPlaceholderData: true },
}))

vi.mock('../hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: prefs.value.preferences,
    isPlaceholderData: prefs.value.isPlaceholderData,
    updatePreferences: vi.fn(),
  }),
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: vi.fn() }) }))
vi.mock('../stores', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { userId: 'u1' } }),
}))
vi.mock('./tours/TourEngine', () => ({
  useTourEngine: () => ({ start: vi.fn(), stop: vi.fn(), isRunning: false }),
}))
vi.mock('./analytics', () => ({ trackGuidance: vi.fn() }))
vi.mock('./announce', () => ({ announceGuidance: vi.fn(), focusTourHelpButton: vi.fn() }))

import { GuidanceProvider, useGuidance } from './GuidanceProvider'

function Probe() {
  const g = useGuidance()
  return <p data-testid="tip">{String(g.tipVisibleFor)}</p>
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/communications']}>
      <GuidanceProvider>
        <Probe />
      </GuidanceProvider>
    </MemoryRouter>,
  )
}

describe('tip offered only after the account has answered', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('offers no tip while the preferences answer is the placeholder', () => {
    prefs.value = { preferences: {}, isPlaceholderData: true }
    mount()
    expect(screen.getByTestId('tip').textContent).toBe('null')
  })

  it('offers the tip once the real answer says unseen', () => {
    prefs.value = { preferences: {}, isPlaceholderData: false }
    mount()
    expect(screen.getByTestId('tip').textContent).toBe('communications')
  })

  it('does not offer a tip the account says is dismissed', () => {
    prefs.value = {
      preferences: { guidance: { pages: { communications: { tip: 'dismissed' } } } },
      isPlaceholderData: false,
    }
    mount()
    expect(screen.getByTestId('tip').textContent).toBe('null')
  })
})
