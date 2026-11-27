/**
 * r108 g13: the one supplier ask on /house meets the curated catalogue. A pick
 * is a catalogue add, never a custom one; "Add ... as my own" stays custom.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { addCustomProvider, addProviderFromCatalogue, matchVendorCatalogue, getOnboardingProgress, houseCurrency } =
  vi.hoisted(() => ({
    addCustomProvider: vi.fn(),
    addProviderFromCatalogue: vi.fn(),
    matchVendorCatalogue: vi.fn(),
    getOnboardingProgress: vi.fn(),
    houseCurrency: vi.fn(),
  }))

vi.mock('../../services/api/vendors', () => ({ addCustomProvider, addProviderFromCatalogue, matchVendorCatalogue }))
vi.mock('../../services/api/menus', () => ({ updateOnboardingProgress: vi.fn(), getOnboardingProgress }))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency } }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'owner' } }) }))

import HouseContents from '../HouseContents'

const row = (id: string, name: string, city: string | null, email: string | null) => ({ id, name, city, email })

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  getOnboardingProgress.mockResolvedValue({ vendor_added: false })
  houseCurrency.mockResolvedValue({ country: 'TR' })
  addCustomProvider.mockResolvedValue({ id: 'p1', name: 'Mine', email: '' })
  addProviderFromCatalogue.mockResolvedValue({ id: 'p2', name: 'Suvla', email: 'orders@suvla.com' })
  matchVendorCatalogue.mockResolvedValue([row('c1', 'Suvla Wines', 'Antalya', 'orders@suvla.com'), row('c2', 'Suvla Foods', null, null)])
  sessionStorage.clear()
})
afterEach(() => vi.useRealTimers())

const typeName = async (value: string) => {
  render(<MemoryRouter><HouseContents /></MemoryRouter>)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  fireEvent.change(screen.getByLabelText('Vendor'), { target: { value } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
}

describe('HouseContents vendor catalogue', () => {
  it('a pick is a catalogue add, not a custom one, and the saved line says an email is on file', async () => {
    await typeName('Suvla')
    expect(matchVendorCatalogue).toHaveBeenCalledWith('Suvla', undefined, 'TR')
    const box = screen.getByRole('listbox')
    expect(box.className).toContain('motion-safe:animate-popover-in')
    expect(box.className).not.toMatch(/transition|animate-out/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Suvla Wines/ }))
    })
    expect(addProviderFromCatalogue).toHaveBeenCalledWith('c1')
    expect(addCustomProvider).not.toHaveBeenCalled()
    expect(screen.getByText('Suvla Wines is saved as your vendor.')).toBeTruthy()
    expect(screen.getByTestId('house-vendor-email-on-file').textContent).toContain('orders@suvla.com')
  })

  it('does not match before 2 characters or before 250 ms', async () => {
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'S' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'Su' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(matchVendorCatalogue).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(matchVendorCatalogue).toHaveBeenCalledTimes(1)
  })

  it('the typed-own row keeps the custom path', async () => {
    await typeName('Suvla')
    fireEvent.click(screen.getByRole('button', { name: 'Add Suvla as my own' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add this vendor' }))
    })
    expect(addCustomProvider).toHaveBeenCalledWith({ name: 'Suvla' })
    expect(addProviderFromCatalogue).not.toHaveBeenCalled()
  })

  it('a failed match (resolved to []) shows no list', async () => {
    matchVendorCatalogue.mockResolvedValue([])
    await typeName('Suvla')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add this vendor' })).toBeTruthy()
  })

  it('shows at most five rows, each at least 44 px tall', async () => {
    matchVendorCatalogue.mockResolvedValue(Array.from({ length: 8 }, (_, i) => row(`c${i}`, `Vendor ${i}`, 'Izmir', null)))
    await typeName('Ven')
    const rows = screen.getAllByRole('option')
    expect(rows).toHaveLength(6) // five curated + "as my own"
    for (const r of rows) expect(r.querySelector('button')!.className).toContain('min-h-11')
  })

  it('Escape closes the list at once, with no exit animation', async () => {
    await typeName('Suvla')
    fireEvent.keyDown(screen.getByLabelText('Vendor'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
