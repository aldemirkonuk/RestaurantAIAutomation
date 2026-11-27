/**
 * r109 onboarding g2 (ADR 0144 §1): the last invoice dropped on /house
 * proposes its vendor. Reads only; the person presses to add.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  upload: vi.fn(),
  detail: vi.fn(),
  canonical: vi.fn(),
  addCustomProvider: vi.fn(),
  addProviderFromCatalogue: vi.fn(),
  matchVendorCatalogue: vi.fn(),
  getOnboardingProgress: vi.fn(),
  houseCurrency: vi.fn(),
}))
vi.mock('../../services/api/documents', () => ({ documentsApi: { upload: h.upload, detail: h.detail } }))
vi.mock('../../services/api/canonical', () => ({ canonicalApi: { document: h.canonical } }))
vi.mock('../../services/api/arrival', () => ({ skipFolio: vi.fn() }))
vi.mock('../../services/api/vendors', () => ({
  addCustomProvider: h.addCustomProvider,
  addProviderFromCatalogue: h.addProviderFromCatalogue,
  matchVendorCatalogue: h.matchVendorCatalogue,
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: h.getOnboardingProgress }))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency: h.houseCurrency } }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'owner', restaurantId: 'h1' } }) }))

import HouseContents from '../HouseContents'
import { LAST_INVOICE_KEY } from '../../lib/houseLastInvoice'

const status = (s: string) => ({ document: { status: s, doc_date: '2026-11-02', currency: 'USD' } })
const env = (value: string | null) => ({ value, source: 'extracted', confidence: 0.9, revision: 1 })
const canonical = (seller: string | null, currency: string | null = null) => ({
  canonical: { layer1: { seller: { name: env(seller) }, issueDate: env('2026-11-12'), currency: env(currency) } },
})
const metro = { id: 'cat-1', name: 'Metro Gross', name_similarity: 0.82, address_similarity: null }

const page = () => render(<MemoryRouter><HouseContents /></MemoryRouter>)
const keep = (houseId: string, docId = 'doc-1') =>
  sessionStorage.setItem(LAST_INVOICE_KEY, JSON.stringify({ houseId, docId }))
const beat = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  setVisibility('visible')
  h.getOnboardingProgress.mockResolvedValue({ vendor_added: false, next_steps: { money_set: true } })
  h.houseCurrency.mockResolvedValue(null)
  h.matchVendorCatalogue.mockResolvedValue([])
  h.detail.mockResolvedValue(status('needs_review'))
  h.canonical.mockResolvedValue(canonical('Metro Gross'))
  h.addProviderFromCatalogue.mockResolvedValue({ email: 'orders@metro.example' })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('/house: the last invoice proposes its vendor', () => {
  it('the upload keeps {houseId, docId} for this tab', async () => {
    h.upload.mockResolvedValue({ documentId: 'doc-9' })
    page()
    fireEvent.change(screen.getByLabelText('Your last invoice'), {
      target: { files: [new File(['X'], 'inv.pdf', { type: 'application/pdf' })] },
    })
    await screen.findByText(/Your last invoice is on Receipts\./)
    expect(JSON.parse(sessionStorage.getItem(LAST_INVOICE_KEY) ?? '{}')).toEqual({ houseId: 'h1', docId: 'doc-9' })
    await waitFor(() => expect(h.detail).toHaveBeenCalledWith('doc-9'))
  })

  it('reads while extracting, then proposes the curated vendor; nothing is written before the press', async () => {
    vi.useFakeTimers()
    h.detail.mockResolvedValueOnce(status('extracting')).mockResolvedValue(status('needs_review'))
    h.matchVendorCatalogue.mockResolvedValue([metro])
    keep('h1')
    page()
    await beat(0)
    expect(screen.getByText('Reading the seller off your invoice…')).toBeInTheDocument()
    expect(h.canonical).not.toHaveBeenCalled()
    await beat(4000)
    expect(screen.getByText(/From your invoice of 12 November 2026:/)).toBeInTheDocument()
    const offer = screen.getByRole('button', { name: 'Make Metro Gross your vendor' })
    expect(offer).toHaveClass('min-h-11')
    expect(h.addProviderFromCatalogue).not.toHaveBeenCalled()
    expect(h.addCustomProvider).not.toHaveBeenCalled()
    fireEvent.click(offer)
    await beat(0)
    expect(h.addProviderFromCatalogue).toHaveBeenCalledWith('cat-1')
    expect(h.addCustomProvider).not.toHaveBeenCalled()
  })

  it('a weak catalogue hit is not offered; the seller fills the vendor box and takes the focus', async () => {
    vi.useFakeTimers()
    h.matchVendorCatalogue.mockResolvedValue([{ ...metro, name_similarity: 0.3 }])
    keep('h1')
    page()
    await beat(0)
    await beat(0)
    expect(screen.queryByRole('button', { name: /your vendor$/ })).not.toBeInTheDocument()
    const box = screen.getByLabelText('Vendor') as HTMLInputElement
    expect(box.value).toBe('Metro Gross')
    expect(document.activeElement).toBe(box)
    expect(h.addCustomProvider).not.toHaveBeenCalled()
  })

  it('names the money only from the extracted currency, never from the row column', async () => {
    vi.useFakeTimers()
    h.getOnboardingProgress.mockResolvedValue({ vendor_added: false, next_steps: { money_set: false } })
    keep('h1')
    page()
    await beat(0)
    await beat(0)
    expect(screen.getByText(/Metro Gross/, { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByTestId('house-invoice-currency')).not.toBeInTheDocument()
  })

  it('with the extracted currency and no house money, says it with a Settings link', async () => {
    vi.useFakeTimers()
    h.getOnboardingProgress.mockResolvedValue({ vendor_added: false, next_steps: { money_set: false } })
    h.canonical.mockResolvedValue(canonical('Metro Gross', 'eur'))
    keep('h1')
    page()
    await beat(0)
    await beat(0)
    expect(screen.getByTestId('house-invoice-currency')).toHaveTextContent('This invoice is in EUR.')
    expect(screen.getByRole('link', { name: "Set the house's money in Settings" })).toHaveAttribute(
      'href',
      '/settings?tab=currency',
    )
  })

  it('a house that already has a vendor gets the seller line only', async () => {
    vi.useFakeTimers()
    h.getOnboardingProgress.mockResolvedValue({ vendor_added: true, next_steps: { money_set: true } })
    h.matchVendorCatalogue.mockResolvedValue([metro])
    keep('h1')
    page()
    await beat(0)
    await beat(0)
    expect(screen.getByText(/From your invoice of/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /your vendor$/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/vendor box above/)).not.toBeInTheDocument()
  })

  it('a failed seller read, or no seller on the paper, says so in words', async () => {
    vi.useFakeTimers()
    h.canonical.mockRejectedValue(new Error('down'))
    keep('h1')
    const first = page()
    await beat(0)
    await beat(0)
    expect(screen.getByText(/We could not read the seller off that invoice\./)).toBeInTheDocument()
    first.unmount()
    h.canonical.mockResolvedValue(canonical(null))
    page()
    await beat(0)
    await beat(0)
    expect(screen.getByText(/We could not read the seller off that invoice\. Add the vendor above\./)).toBeInTheDocument()
  })

  it('stops reading at a terminal state', async () => {
    vi.useFakeTimers()
    keep('h1')
    page()
    await beat(0)
    await beat(0)
    const calls = h.detail.mock.calls.length
    await beat(20000)
    expect(h.detail.mock.calls.length).toBe(calls)
    expect(h.canonical).toHaveBeenCalledTimes(1)
  })

  it('reads only while the tab is visible, and gives up at 3 minutes', async () => {
    vi.useFakeTimers()
    h.detail.mockResolvedValue(status('extracting'))
    keep('h1')
    page()
    await beat(0)
    expect(h.detail).toHaveBeenCalledTimes(1)
    setVisibility('hidden')
    await beat(40000)
    expect(h.detail).toHaveBeenCalledTimes(1) // the armed beat finds the tab hidden and reads nothing
    setVisibility('visible')
    await beat(0)
    expect(h.detail).toHaveBeenCalledTimes(2)
    await beat(180000)
    expect(screen.getByText(/Your invoice is still being read\./)).toBeInTheDocument()
    const calls = h.detail.mock.calls.length
    expect(calls).toBeLessThanOrEqual(2 + Math.ceil(140000 / 4000))
    await beat(20000)
    expect(h.detail.mock.calls.length).toBe(calls)
  })

  it('a paper kept under another house is ignored', async () => {
    keep('h2')
    page()
    expect(screen.getByLabelText('Your last invoice')).toBeInTheDocument()
    expect(screen.queryByTestId('house-invoice-proposal')).not.toBeInTheDocument()
    expect(h.detail).not.toHaveBeenCalled()
  })

  it('the swap fades only under motion (motion-safe), with no exit', async () => {
    vi.useFakeTimers()
    keep('h1')
    page()
    await beat(0)
    await beat(0)
    const slot = screen.getByTestId('house-invoice-proposal')
    expect(slot).toHaveClass('min-h-[5.5rem]')
    const animated = slot.querySelectorAll('[class*="animate-"]')
    expect(animated.length).toBeGreaterThan(0)
    animated.forEach((node) =>
      node.className.split(/\s+/).filter((c) => c.includes('animate-')).forEach((c) => expect(c).toBe('motion-safe:animate-swap-in')),
    )
  })
})
