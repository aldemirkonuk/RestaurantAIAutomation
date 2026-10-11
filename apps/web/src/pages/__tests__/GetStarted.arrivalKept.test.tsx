/**
 * What a half-finished arrival keeps, and for whom (F-983, F-984), and the
 * low-stock step the "Finish setup" nudge sends an open house to (F-985).
 *
 * - The currency picked on step 02 comes back after a reload, as the
 *   restaurant's name and address already did; it used to fall back to the
 *   country's.
 * - The role chip one account tapped is not selected for the next account
 *   in the same tab (ADR 0213 row 9: none preselected).
 * - /get-started?step=threshold asks the threshold and saves it, so
 *   threshold_configured — half of "activated" — can be reached.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const auth = vi.hoisted(() => ({
  user: { userId: 'u-a', name: 'Selin Kaya', emailVerified: true } as Record<string, unknown>,
}))
const api = vi.hoisted(() => ({
  setDefaultThreshold: vi.fn(),
  getOnboardingProgress: vi.fn(),
  getCarriedCount: vi.fn(),
  listMenuVersions: vi.fn(),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, createFirstHouse: vi.fn() }),
}))
vi.mock('../../services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/client')>()),
  apiClient: { patch: vi.fn().mockResolvedValue({}) },
}))
vi.mock('../../services/api/menus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api/menus')>()),
  setDefaultThreshold: api.setDefaultThreshold,
  getOnboardingProgress: api.getOnboardingProgress,
  getCarriedCount: api.getCarriedCount,
  listMenuVersions: api.listMenuVersions,
}))
vi.mock('../../lib/firstProof', () => ({ writeProof: vi.fn(), readProof: () => null }))
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
import HouseContents from '../HouseContents'

function mount(path = '/get-started') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/get-started" element={<GetStarted />} />
          <Route path="/house" element={<p>The house</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('GetStarted — what an arrival keeps', () => {
  beforeEach(() => {
    auth.user = { userId: 'u-a', name: 'Selin Kaya', emailVerified: true }
    api.setDefaultThreshold.mockReset().mockResolvedValue({ default_threshold_min: 6, threshold_configured: true })
    api.getOnboardingProgress.mockReset()
    api.getCarriedCount.mockReset().mockResolvedValue(0)
    sessionStorage.clear()
    localStorage.clear()
  })

  it('a reload keeps the currency picked on step 02 (F-983)', async () => {
    const first = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Turkey' } })
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } })
    expect(screen.getByTestId('currency-statement').textContent).toContain('We will record EUR')
    first.unmount()

    mount()
    await screen.findByRole('heading', { name: 'Your restaurant' })
    expect((screen.getByLabelText('Currency') as HTMLSelectElement).value).toBe('EUR')
    expect(screen.getByTestId('currency-statement').textContent).toContain('We will record EUR')
  })

  it("one account's role chip is not selected for the next account (F-984)", async () => {
    const first = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Owner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your restaurant' })
    first.unmount()

    auth.user = { userId: 'u-b', name: 'Deniz Ak', emailVerified: true }
    mount()
    const owner = screen.getByRole('button', { name: 'Owner' })
    expect(owner.className).not.toContain('bg-[#1a5e6b]')
  })

  it('the nudge target asks the low-stock threshold and saves it (F-985)', async () => {
    auth.user = { userId: 'u-a', name: 'Selin Kaya', emailVerified: true, restaurantId: 'r-1', role: 'owner' }
    api.getOnboardingProgress.mockResolvedValue({ menu_uploaded: true, threshold_configured: true, activated: true })
    mount('/get-started?step=threshold')
    expect(screen.getByRole('heading', { name: 'When should we say an item is running low?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(api.setDefaultThreshold).toHaveBeenCalledWith(6, false))
    expect(await screen.findByText('The house')).toBeTruthy()
  })

  it('a house with no menu yet goes on to the menu step after the threshold (F-985)', async () => {
    auth.user = { userId: 'u-a', name: 'Selin Kaya', emailVerified: true, restaurantId: 'r-1', role: 'manager' }
    api.getOnboardingProgress.mockResolvedValue({ menu_uploaded: false, threshold_configured: true, activated: false })
    mount('/get-started?step=threshold')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Your menu' })).toBeTruthy()
  })
})

/**
 * The low-stock step (integ9 first week, S160): asked of an owner or a manager
 * only (F-1060), drawn inside the arrival with no "step 3" (F-1062), honest
 * that the number reaches items added from now on, and offering a counted,
 * explicit tick for the items carried now (F-1059).
 */
describe('the low-stock step', () => {
  beforeEach(() => {
    api.setDefaultThreshold.mockReset().mockResolvedValue({ default_threshold_min: 6, threshold_configured: true })
    api.getOnboardingProgress.mockReset().mockResolvedValue({ menu_uploaded: true })
    api.getCarriedCount.mockReset().mockResolvedValue(133)
    sessionStorage.clear()
    localStorage.clear()
  })

  function openThreshold(role: string) {
    auth.user = { userId: 'u-a', name: 'Selin Kaya', emailVerified: true, restaurantId: 'r-1', role }
    mount('/get-started?step=threshold')
  }

  it('is drawn inside the arrival, and says the number reaches items added from now on', async () => {
    openThreshold('owner')
    expect(screen.getByText('Mudavym')).toBeTruthy()
    expect(screen.getAllByText('Low stock').length).toBeGreaterThan(0)
    expect(screen.getByText(/Every item you add from now on starts with it/)).toBeTruthy()
    expect(screen.queryByText(/any wine/)).toBeNull()
    expect(screen.queryByText(/bottles per wine/)).toBeNull()
    expect(await screen.findByText(/Also set it on the 133 items you carry now/)).toBeTruthy()
  })

  it('changes no carried item unless the counted tick is given', async () => {
    openThreshold('manager')
    await screen.findByText(/Also set it on the 133 items/)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(api.setDefaultThreshold).toHaveBeenCalledWith(6, false))
  })

  it('sets the number on the items carried now only after the tick', async () => {
    openThreshold('owner')
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(api.setDefaultThreshold).toHaveBeenCalledWith(6, true))
  })

  it('offers no count it could not read', async () => {
    api.getCarriedCount.mockRejectedValue(new Error('403'))
    openThreshold('owner')
    await waitFor(() => expect(api.getCarriedCount).toHaveBeenCalled())
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('is not asked of staff, who start on the menu step (F-1060)', () => {
    openThreshold('staff')
    expect(screen.queryByText(/Every item you add from now on/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Your menu' })).toBeTruthy()
    expect(api.getCarriedCount).not.toHaveBeenCalled()
  })
})

describe('the house page with no menu read (F-1063)', () => {
  it('offers a way to read one when the house holds none (F-1211 asks the books first)', async () => {
    sessionStorage.clear()
    api.getOnboardingProgress.mockReset().mockResolvedValue(null)
    api.listMenuVersions.mockReset().mockResolvedValue({ current: null, lastUsed: null, versions: [] })
    render(
      <MemoryRouter initialEntries={['/house']}>
        <Routes>
          <Route path="/house" element={<HouseContents />} />
          <Route path="/get-started" element={<p>Get started</p>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('No menu read yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Read your menu' }))
    expect(screen.getByText('Get started')).toBeTruthy()
  })
})
