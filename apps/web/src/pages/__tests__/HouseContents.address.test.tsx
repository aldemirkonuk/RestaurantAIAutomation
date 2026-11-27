/**
 * onboarding-r110-g1: /house shows an owner or manager the house's invoice
 * address, with Copy. A forward from their own verified email lands on
 * Receipts (gateway member-forward path).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getVendorEmail, auth } = vi.hoisted(() => ({
  getVendorEmail: vi.fn(),
  auth: { user: { role: 'owner', email: 'ayse@house.test' } as { role: string; email: string } | null },
}))

vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency: vi.fn(async () => null) } }))
vi.mock('../../services/api/vendors', () => ({ addCustomProvider: vi.fn() }))
vi.mock('../../services/api/menus', () => ({
  updateOnboardingProgress: vi.fn(),
  getOnboardingProgress: vi.fn(async () => null),
  getVendorEmail,
}))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }))

import HouseContents from '../HouseContents'
import { COPIED_HOLD_MS } from '../../components/onboarding/HouseInvoiceAddress'

const ADDRESS = 'r-7f3k2q@in.mudavym.test'
const page = () => render(<MemoryRouter><HouseContents /></MemoryRouter>)
const writeText = vi.fn(async () => undefined)

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = { role: 'owner', email: 'ayse@house.test' }
  sessionStorage.clear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => vi.useRealTimers())

describe("/house shows the house's invoice address", () => {
  it('shows the address, a 44 px Copy, and the forwarding line with the person’s own email', async () => {
    getVendorEmail.mockResolvedValue({ address: ADDRESS })
    page()
    expect(await screen.findByTestId('house-invoice-address-value')).toHaveTextContent(ADDRESS)
    expect(screen.getByText("Your house's invoice address")).toBeInTheDocument()
    const copy = screen.getByRole('button', { name: 'Copy' })
    expect(copy.className).toMatch(/min-h-\[44px\]/)
    expect(copy.className).toMatch(/min-w-\[44px\]/)
    expect(
      screen.getByText(
        'Forward an invoice from ayse@house.test and it lands on Receipts. Give it to your vendors too.',
      ),
    ).toBeInTheDocument()
  })

  it('Copy puts the address on the clipboard; "Copied" holds its slot for 1.6 s, with no motion', async () => {
    getVendorEmail.mockResolvedValue({ address: ADDRESS })
    page()
    const copy = await screen.findByRole('button', { name: 'Copy' })
    vi.useFakeTimers()
    const animate = vi.fn()
    ;(Element.prototype as any).animate = animate
    await act(async () => {
      fireEvent.click(copy)
    })
    expect(writeText).toHaveBeenCalledWith(ADDRESS)
    const slot = screen.getByTestId('house-invoice-address-copied')
    expect(slot).toHaveTextContent('Copied')
    expect(slot).toHaveAttribute('aria-live', 'polite')
    expect(slot.className).toMatch(/min-w-/)
    expect(slot.className).not.toMatch(/animate|transition/)
    act(() => vi.advanceTimersByTime(COPIED_HOLD_MS - 1))
    expect(slot).toHaveTextContent('Copied')
    act(() => vi.advanceTimersByTime(1))
    expect(slot).toHaveTextContent('')
    // The slot stays in the page, empty, so nothing moves.
    expect(screen.getByTestId('house-invoice-address-copied')).toBe(slot)
    expect(COPIED_HOLD_MS).toBe(1600)
    expect(animate).not.toHaveBeenCalled()
  })

  it('a null address (domain not set) shows no row at all', async () => {
    getVendorEmail.mockResolvedValue({ address: null })
    page()
    await waitFor(() => expect(getVendorEmail).toHaveBeenCalledTimes(1))
    await new Promise((settle) => setTimeout(settle, 0))
    expect(screen.queryByTestId('house-invoice-address')).toBeNull()
    expect(screen.queryByText(/invoice address/)).toBeNull()
  })

  it('a failed read says so in words, and Look again reads again', async () => {
    getVendorEmail.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce({ address: ADDRESS })
    page()
    expect(await screen.findByText(/We could not read the house's address just now\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Look again for the invoice address' }))
    expect(await screen.findByTestId('house-invoice-address-value')).toHaveTextContent(ADDRESS)
    expect(getVendorEmail).toHaveBeenCalledTimes(2)
  })

  it('staff see no row and the address is never asked for', async () => {
    auth.user = { role: 'staff', email: 'cem@house.test' }
    getVendorEmail.mockResolvedValue({ address: ADDRESS })
    page()
    await new Promise((settle) => setTimeout(settle, 0))
    expect(getVendorEmail).not.toHaveBeenCalled()
    expect(screen.queryByTestId('house-invoice-address')).toBeNull()
  })
})
