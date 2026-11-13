/**
 * r26 walk: an owner whose house exists, sent back to /get-started by "Read a
 * menu", enters at the menu step with no country typed. The typed lines then
 * hinted "14.00" in a lira house, because the money came only from the
 * country box. The house's stored money is read instead.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, houseCurrency } = vi.hoisted(() => ({
  auth: { user: null as Record<string, unknown> | null, loading: false },
  houseCurrency: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ ...auth, createFirstHouse: vi.fn(), signInWithSession: vi.fn(), logout: vi.fn() }),
}))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency } }))
vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../lib/googleMaps', () => ({ isMapsConfigured: () => true }))
vi.mock('../../components/ui/PlacesAutocomplete', () => ({ PlacesAutocomplete: () => null }))
vi.mock('../../components/onboarding/MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('../../components/onboarding/MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('../../components/onboarding/MenuManualEntry', () => ({
  MenuManualEntry: ({ currency }: { currency?: string | null }) => (
    <p data-testid="typed-money">{currency ?? 'no money'}</p>
  ),
}))

import GetStarted from '../GetStarted'

const owner = { name: 'Selin Kaya', restaurantId: 'house-1', role: 'owner', emailVerified: true }
const typed = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Type a few lines/ }))
  return screen.getByTestId('typed-money')
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = owner
  sessionStorage.clear()
  localStorage.clear()
})

describe('GetStarted reads the house money when the house exists (r26 walk)', () => {
  it('a lira house resumed at the menu step types its lines in TRY', async () => {
    houseCurrency.mockResolvedValue({ restaurantId: 'house-1', code: 'TRY', country: 'TR', readable: true, reason: null, statedAt: null })
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    const money = await typed()
    expect(await screen.findByText('TRY')).toBe(money)
    expect(houseCurrency).toHaveBeenCalledTimes(1)
  })

  it('an unreadable money read names no money, never a guess', async () => {
    houseCurrency.mockResolvedValue({ restaurantId: 'house-1', code: 'TRY', country: null, readable: false, reason: 'down', statedAt: null })
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    const money = await typed()
    await Promise.resolve()
    expect(money.textContent).toBe('no money')
  })

  it('a failed read leaves the page working, with no money named', async () => {
    houseCurrency.mockRejectedValue(new Error('network'))
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect((await typed()).textContent).toBe('no money')
  })

  it('a new owner with no house reads no house money', () => {
    auth.user = { ...owner, restaurantId: null }
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    expect(houseCurrency).not.toHaveBeenCalled()
  })
})
