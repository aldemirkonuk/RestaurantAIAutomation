/**
 * F-1590: a house is asked its tax basis inside the arrival, once it is open
 * and before any till is connected. A check stored before the answer is never
 * made pre-tax later (ADR 0341 F2), so the dashboard's line alone came too late
 * for a house that connected its till on day one. Skippable; a failed read or
 * an answered house goes straight on to the menu.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { createFirstHouse, get, put, auth } = vi.hoisted(() => ({
  createFirstHouse: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  // A new arrival by default; F-1686 reloads into an open house.
  auth: { user: { id: 'u-1', name: 'Selin Kaya', emailVerified: true } as Record<string, unknown> },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    createFirstHouse,
  }),
}))
vi.mock('../../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/client')>()),
  apiClient: { patch: vi.fn().mockResolvedValue({}), get, put },
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
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({ MenuManualEntry: () => null }))

import GetStarted from '../GetStarted'

function readout(basis: string, readable = true) {
  return {
    restaurantId: 'r-1',
    readable,
    reason: readable ? null : 'the house could not be read',
    basis,
    answered: basis !== 'unset',
    confirmedAt: null,
    switchDay: null,
    confirmedBy: null,
    country: 'TR',
    taxWord: 'KDV',
    proposal: { basis: 'prices_include_tax', rates: [], why: 'Turkish menu prices are shown with KDV.' },
    rates: [],
    ratesReason: null,
    today: '2027-01-16',
    todayOnHouseClock: true,
  }
}

async function openHouse() {
  render(
    <MemoryRouter>
      <GetStarted />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'Your restaurant' })
  fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Tuzlu Rüzgar' } })
  fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 Kordon' } })
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'İzmir' } })
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Turkey' } })
  fireEvent.click(screen.getByRole('button', { name: 'This is us' }))
  await waitFor(() => expect(createFirstHouse).toHaveBeenCalledTimes(1))
}

describe('GetStarted — the tax basis before the till (F-1590)', () => {
  beforeEach(() => {
    createFirstHouse.mockReset()
    createFirstHouse.mockResolvedValue({ detailsLoaded: true })
    get.mockReset()
    put.mockReset()
    sessionStorage.clear()
    localStorage.clear()
    auth.user = { id: 'u-1', name: 'Selin Kaya', emailVerified: true }
  })

  it('asks an unanswered house, records the answer, then goes on to the menu', async () => {
    get.mockResolvedValue({ data: readout('unset') })
    put.mockResolvedValue({ data: readout('prices_include_tax') })
    await openHouse()
    expect(
      await screen.findByRole('heading', { name: 'Do the prices on your till include KDV?' }),
    ).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/settings/tax-basis')
    // The country suggests; nothing is chosen for the owner.
    expect(screen.getByTestId('arrival-tax-proposal')).toHaveTextContent('Prices on your till include KDV')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Prices on your till include KDV'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(put).toHaveBeenCalledWith('/settings/tax-basis', { basis: 'prices_include_tax' })
  })

  it('can be skipped, recording nothing', async () => {
    get.mockResolvedValue({ data: readout('unset') })
    await openHouse()
    fireEvent.click(await screen.findByRole('button', { name: /Skip for now — the dashboard will ask again/ }))
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(put).not.toHaveBeenCalled()
  })

  it('says why an answer was not saved and keeps the owner on the step', async () => {
    get.mockResolvedValue({ data: readout('unset') })
    put.mockRejectedValue(new Error('Request failed'))
    await openHouse()
    fireEvent.click(await screen.findByLabelText('This house charges no KDV'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The answer was not saved — Request failed.')
    expect(screen.queryByRole('heading', { name: 'Your menu' })).not.toBeInTheDocument()
  })

  it('does not ask a house that has answered', async () => {
    get.mockResolvedValue({ data: readout('prices_exclude_tax') })
    await openHouse()
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(screen.queryByText(/Do the prices on your till include/)).not.toBeInTheDocument()
  })

  it('does not ask when the basis cannot be read; the dashboard line is the fallback', async () => {
    get.mockRejectedValue(new Error('Network Error'))
    await openHouse()
    await screen.findByRole('heading', { name: 'Your menu' })
    expect(put).not.toHaveBeenCalled()
  })

  describe('a reload on the tax step asks it again (F-1686)', () => {
    const DRAFT = {
      userId: 'u-1',
      role: 'Owner',
      restaurantName: 'Tuzlu Rüzgar',
      address: '1 Kordon',
      city: 'İzmir',
      country: 'Turkey',
      stateProvince: '',
      postalCode: '',
      restaurantPhone: '',
      placePoint: null,
    }
    const reload = () => {
      // The house is open; the draft written on the restaurant step is still kept.
      auth.user = { id: 'u-1', userId: 'u-1', name: 'Selin Kaya', emailVerified: true, restaurantId: 'r-1', role: 'owner' }
      localStorage.setItem('mudavym:arrival-draft', JSON.stringify(DRAFT))
      render(
        <MemoryRouter>
          <GetStarted />
        </MemoryRouter>,
      )
    }

    it('an open house whose basis is unset is asked before the menu', async () => {
      get.mockResolvedValue({ data: readout('unset') })
      reload()
      expect(
        await screen.findByRole('heading', { name: 'Do the prices on your till include KDV?' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Your menu' })).not.toBeInTheDocument()
    })

    it('an answered house goes straight to the menu', async () => {
      get.mockResolvedValue({ data: readout('prices_include_tax') })
      reload()
      await screen.findByRole('heading', { name: 'Your menu' })
      expect(screen.queryByText(/Do the prices on your till include/)).not.toBeInTheDocument()
    })

    it('a question skipped in this tab is not asked again on a reload', async () => {
      get.mockResolvedValue({ data: readout('unset') })
      sessionStorage.setItem('mudavym:arrival-tax-passed:u-1', '1')
      reload()
      await screen.findByRole('heading', { name: 'Your menu' })
      expect(get).not.toHaveBeenCalledWith('/settings/tax-basis')
    })
  })
})
