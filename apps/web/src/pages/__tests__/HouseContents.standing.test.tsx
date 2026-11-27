/**
 * /house says how much of the house is set (r110 onboarding g5): "{k} of 4 set"
 * over a 4-segment 1 px hairline. The four are the menu being current, a vendor
 * on the book, the last invoice sent or skipped, and the money set. An unknown
 * read is never counted as unset (ADR 0020).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getOnboardingProgress, houseCurrency, upload, skipFolio } = vi.hoisted(() => ({
  getOnboardingProgress: vi.fn(),
  houseCurrency: vi.fn(),
  upload: vi.fn(),
  skipFolio: vi.fn(),
}))

vi.mock('../../services/api/vendors', () => ({
  addCustomProvider: vi.fn(),
  addProviderFromCatalogue: vi.fn(),
  matchVendorCatalogue: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress, updateOnboardingProgress: vi.fn() }))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency } }))
vi.mock('../../services/api/documents', () => ({ documentsApi: { upload } }))
vi.mock('../../services/api/arrival', () => ({ skipFolio }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../components/onboarding/KeepOnPhone', () => ({ KeepOnPhone: () => null }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'owner' } }) }))

import HouseContents from '../HouseContents'

const settled = { menu_uploaded: true, menu_current: true, vendor_added: true, next_steps: { money_set: true } }

beforeEach(() => {
  vi.clearAllMocks()
  houseCurrency.mockResolvedValue({ readable: true, code: 'TRY' })
  upload.mockResolvedValue({ documentId: 'd1' })
  skipFolio.mockResolvedValue(undefined)
  sessionStorage.clear()
})

const page = () => render(<MemoryRouter><HouseContents /></MemoryRouter>)
const sendInvoice = () =>
  fireEvent.change(screen.getByLabelText('Your last invoice'), {
    target: { files: [new File(['x'], 'inv.pdf', { type: 'application/pdf' })] },
  })

describe('HouseContents standing', () => {
  it('counts the four and draws the hairline at that fraction', async () => {
    getOnboardingProgress.mockResolvedValue(settled)
    page()
    expect(await screen.findByText('3 of 4 set')).toBeInTheDocument()
    expect(screen.getByTestId('house-standing-fill')).toHaveStyle({ transform: 'scaleX(0.75)' })
    // Not the primary button until all four are set.
    expect(screen.getByTestId('house-go-to-desk').className).not.toMatch(/bg-\[#1a5e6b\]/)
  })

  it('says "Looking at your house…" and draws no hairline while a read has not come back', () => {
    getOnboardingProgress.mockReturnValue(new Promise(() => {}))
    page()
    expect(screen.getByText('Looking at your house…')).toBeInTheDocument()
    expect(screen.queryByTestId('house-standing-fill')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\d of 4 set/)
  })

  it('a failed setup read is unknown, not 0 of 4', async () => {
    getOnboardingProgress.mockRejectedValue(new Error('down'))
    houseCurrency.mockResolvedValue({ readable: true, code: 'TRY' })
    page()
    await screen.findByTestId('house-menu-unread')
    expect(screen.getByText('Looking at your house…')).toBeInTheDocument()
    expect(screen.queryByTestId('house-standing-fill')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\d of 4 set/)
  })

  it('a money read that does not answer keeps the line at looking', async () => {
    getOnboardingProgress.mockResolvedValue({ ...settled, next_steps: {} })
    houseCurrency.mockRejectedValue(new Error('down'))
    page()
    await screen.findByText(/Your vendor is saved/)
    await waitFor(() => expect(houseCurrency).toHaveBeenCalled())
    expect(screen.getByText('Looking at your house…')).toBeInTheDocument()
  })

  it('reads 0 of 4 on a house with nothing set, and an optional row adds nothing', async () => {
    getOnboardingProgress.mockResolvedValue({
      menu_uploaded: false,
      menu_current: false,
      vendor_added: false,
      next_steps: { money_set: false },
    })
    page()
    expect(await screen.findByText('0 of 4 set')).toBeInTheDocument()
    expect(screen.getByTestId('house-standing-fill')).toHaveStyle({ transform: 'scaleX(0)' })
  })

  it('at 4 of 4 says the house is set, and the desk link becomes the primary button', async () => {
    getOnboardingProgress.mockResolvedValue(settled)
    page()
    await screen.findByText('3 of 4 set')
    sendInvoice()
    expect(await screen.findByText('The house is set.')).toBeInTheDocument()
    expect(screen.getByTestId('house-standing-fill')).toHaveStyle({ transform: 'scaleX(1)' })
    expect(screen.getByTestId('house-go-to-desk').className).toMatch(/bg-\[#1a5e6b\]/)
    expect(document.body.textContent).not.toMatch(/\d of 4 set/)
  })

  it('a skipped invoice counts; a skip the house could not note does not', async () => {
    getOnboardingProgress.mockResolvedValue(settled)
    const first = page()
    await screen.findByText('3 of 4 set')
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(await screen.findByText('The house is set.')).toBeInTheDocument()
    first.unmount()

    skipFolio.mockRejectedValue(new Error('no'))
    page()
    await screen.findByText('3 of 4 set')
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    await screen.findByText(/could not note the skip/)
    expect(screen.getByText('3 of 4 set')).toBeInTheDocument()
  })

  it('moves the fill by scale on the settle curve in 240 ms, never at first paint, and not under reduced motion', async () => {
    getOnboardingProgress.mockResolvedValue(settled)
    page()
    const fill = await screen.findByTestId('house-standing-fill')
    expect(fill.className).toMatch(/transition-transform/)
    expect(fill.className).toMatch(/duration-\[240ms\]/)
    expect(fill.className).toMatch(/cubic-bezier\(0\.16,1,0\.3,1\)/)
    expect(fill.className).toMatch(/motion-reduce:transition-none/)
    expect(fill.className).toMatch(/origin-left/)
    expect(fill.className).toMatch(/rtl:origin-right/)
    // No keyframe animation anywhere on the line: nothing animates at first paint.
    expect(screen.getByTestId('house-standing').innerHTML).not.toMatch(/animate-/)
    expect(fill.getAttribute('style')).not.toMatch(/width|transition/)
  })
})
