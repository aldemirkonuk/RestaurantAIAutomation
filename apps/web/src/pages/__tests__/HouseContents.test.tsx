/**
 * /house leads to the desk (QA BL-2) and keeps no invoice it cannot keep
 * (QA H-1). Every case here fails on origin/main.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { addCustomProvider, updateOnboardingProgress, getOnboardingProgress } = vi.hoisted(() => ({
  addCustomProvider: vi.fn(),
  updateOnboardingProgress: vi.fn(),
  getOnboardingProgress: vi.fn(),
}))

vi.mock('../../services/api/vendors', () => ({ addCustomProvider }))
vi.mock('../../services/api/menus', () => ({ updateOnboardingProgress, getOnboardingProgress }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))

import HouseContents from '../HouseContents'

beforeEach(() => {
  vi.clearAllMocks()
  addCustomProvider.mockResolvedValue({ id: 'vendor-1', name: 'Suvla' })
  updateOnboardingProgress.mockResolvedValue({})
  getOnboardingProgress.mockResolvedValue(null)
  sessionStorage.clear()
})

const page = () => render(<MemoryRouter><HouseContents /></MemoryRouter>)

describe('HouseContents', () => {
  it('leads to the desk from the header mark and from "Go to the desk"', () => {
    page()
    expect(screen.getByRole('link', { name: 'Mudavym, the desk' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Go to the desk' })).toHaveAttribute('href', '/')
  })

  it('never says an invoice is kept, and points to Receipts', () => {
    page()
    expect(document.body.textContent).not.toMatch(/kept for later/i)
    expect(screen.queryByLabelText('Last invoice later')).toBeNull()
    expect(screen.getByRole('link', { name: 'Receipts' })).toHaveAttribute('href', '/receipts')
  })

  it('adds a supplier with one request; the gateway marks vendor_added itself', async () => {
    page()
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Suvla' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add this supplier' }))
    expect(await screen.findByText('Suvla is saved as your supplier.')).toBeInTheDocument()
    await waitFor(() => expect(addCustomProvider).toHaveBeenCalledTimes(1))
    expect(updateOnboardingProgress).not.toHaveBeenCalled()
  })

  // Walk 2026-11-11: after a reload the page asked "Who supplies you?" again
  // although the supplier was on the book (vendor_added on the house's row).
  it('a house whose supplier is on the book does not ask again after a reload', async () => {
    getOnboardingProgress.mockResolvedValue({ vendor_added: true })
    page()
    expect(await screen.findByText(/Your supplier is saved\./)).toBeInTheDocument()
    expect(screen.queryByLabelText('Supplier')).toBeNull()
    expect(screen.getByRole('link', { name: 'See suppliers' })).toHaveAttribute('href', '/vendors')
  })

  it('a failed progress read keeps the ask', async () => {
    getOnboardingProgress.mockRejectedValue(new Error('offline'))
    page()
    await waitFor(() => expect(getOnboardingProgress).toHaveBeenCalled())
    expect(screen.getByLabelText('Supplier')).toBeInTheDocument()
  })

  it('counts the pencilled lines from the proof as it now stands', () => {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({
        menuId: 'm1',
        itemsExtracted: 2,
        submissionsCreated: 0,
        items: [
          { menuItemId: 'a', name: 'Rioja', category: 'red', matched: true, needsReview: false },
          { menuItemId: 'b', name: 'Yakut', category: null, matched: false, needsReview: true },
        ],
      }),
    )
    page()
    expect(screen.getByRole('button', { name: '1 line in pencil, worth a second look' })).toBeInTheDocument()
  })
})
