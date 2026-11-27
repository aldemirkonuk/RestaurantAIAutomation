/**
 * r105 onboarding g3: the restaurant step warms the Maps library once, ahead of
 * the first keystroke. Rendered, not matched against the source text, so an
 * effect that can never run (a step name that no longer exists) fails here.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const { auth, warmPlaces } = vi.hoisted(() => ({
  auth: { user: { name: 'Selin Kaya', restaurantId: '', role: null, emailVerified: true } as Record<string, unknown>, loading: false },
  warmPlaces: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ ...auth, createFirstHouse: vi.fn(), signInWithSession: vi.fn(), logout: vi.fn() }),
}))
vi.mock('../../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/client')>()),
  apiClient: { patch: vi.fn() },
}))
vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => false }))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({ warmPlaces, PlacesAutocomplete: () => null }))

import GetStarted from '../GetStarted'

describe('GetStarted: warms Places', () => {
  it('warms the Maps library once on the restaurant step', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Your restaurant' })
    expect(warmPlaces).toHaveBeenCalledTimes(1)
  })
})
