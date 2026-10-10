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
    auth.user = { userId: 'u-a', name: 'Selin Kaya', emailVerified: true, restaurantId: 'r-1' }
    api.getOnboardingProgress.mockResolvedValue({ menu_uploaded: true, threshold_configured: true, activated: true })
    mount('/get-started?step=threshold')
    expect(screen.getByRole('heading', { name: 'Set your low-stock threshold' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(api.setDefaultThreshold).toHaveBeenCalledWith(6))
    expect(await screen.findByText('The house')).toBeTruthy()
  })

  it('a house with no menu yet goes on to the menu step after the threshold (F-985)', async () => {
    auth.user = { userId: 'u-a', name: 'Selin Kaya', emailVerified: true, restaurantId: 'r-1' }
    api.getOnboardingProgress.mockResolvedValue({ menu_uploaded: false, threshold_configured: true, activated: false })
    mount('/get-started?step=threshold')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Your menu' })).toBeTruthy()
  })
})
