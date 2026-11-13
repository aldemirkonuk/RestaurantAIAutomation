/**
 * Walk r21 D6: on the restaurant step every box has a name, and the country
 * box is a combobox named by the words over it (the real control, not a stub).
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const { auth } = vi.hoisted(() => ({
  auth: { user: { name: 'Selin Kaya', restaurantId: '', role: null, emailVerified: true } as Record<string, unknown>, loading: false },
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
vi.mock('../../components/ui/PlacesAutocomplete', () => ({ PlacesAutocomplete: () => null }))

import GetStarted from '../GetStarted'

describe('GetStarted: the restaurant step names its boxes', () => {
  it('names every text box, and the country box is a labelled combobox', async () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Your restaurant' })
    for (const name of ['Restaurant name', 'Address', 'Restaurant phone', 'City']) {
      expect(screen.getByRole('textbox', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('combobox', { name: 'Country · required' })).toHaveAttribute('id', 'arrival-country')
    for (const box of screen.getAllByRole('textbox')) expect(box).toHaveAccessibleName()
  })
})
