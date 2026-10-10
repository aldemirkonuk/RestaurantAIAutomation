/**
 * The role tapped on step 01 is kept with the house (F-899, ADR 0213 row 9).
 *
 * It used to live in sessionStorage only: no request carried it, so the page
 * asked and dropped the answer. Now opening the house sends it, and a person
 * who tapped none sends none (row 9: none preselected).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const createFirstHouse = vi.fn()

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', name: 'Selin Kaya', emailVerified: true },
    createFirstHouse,
  }),
}))
vi.mock('../../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/client')>()),
  apiClient: { patch: vi.fn().mockResolvedValue({}) },
}))
vi.mock('../../lib/firstProof', () => ({ writeProof: vi.fn() }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => true }))
vi.mock('../../components/brand/BrandMark', () => ({
  BrandMark: () => <span>Mudavym</span>,
}))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({
  PlacesAutocomplete: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Find your restaurant" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock('../../components/ui/CountryCombobox', () => ({
  CountryCombobox: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Country" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import GetStarted from '../GetStarted'

async function openHouse(tap?: string) {
  render(
    <MemoryRouter>
      <GetStarted />
    </MemoryRouter>,
  )
  if (tap) fireEvent.click(screen.getByRole('button', { name: tap }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'Your restaurant' })
  fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Tuzlu Rüzgar' } })
  fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 Kordon' } })
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'İzmir' } })
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Turkey' } })
  fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
  await waitFor(() => expect(createFirstHouse).toHaveBeenCalledTimes(1))
  return createFirstHouse.mock.calls[0][0]
}

describe('GetStarted — the role on step 01', () => {
  beforeEach(() => {
    createFirstHouse.mockReset()
    createFirstHouse.mockResolvedValue({ detailsLoaded: true })
    sessionStorage.clear()
    localStorage.clear()
  })

  it('opening the house sends the role that was tapped', async () => {
    const sent = await openHouse('Beverage lead')
    expect(sent.jobRole).toBe('beverage_lead')
  })

  it('sends no role when none was tapped', async () => {
    const sent = await openHouse()
    expect(sent.jobRole).toBeUndefined()
  })
})
