/**
 * /house leads to the desk (QA BL-2) and keeps no invoice it cannot keep
 * (QA H-1). Every case here fails on origin/main.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { addCustomProvider, updateOnboardingProgress } = vi.hoisted(() => ({
  addCustomProvider: vi.fn(),
  updateOnboardingProgress: vi.fn(),
}))

vi.mock('../../services/api/vendors', () => ({ addCustomProvider }))
vi.mock('../../services/api/menus', () => ({ updateOnboardingProgress }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))

import HouseContents from '../HouseContents'

beforeEach(() => {
  vi.clearAllMocks()
  addCustomProvider.mockResolvedValue({ id: 'vendor-1', name: 'Suvla' })
  updateOnboardingProgress.mockResolvedValue({})
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
    expect(await screen.findByText('Suvla is on the book.')).toBeInTheDocument()
    await waitFor(() => expect(addCustomProvider).toHaveBeenCalledTimes(1))
    expect(updateOnboardingProgress).not.toHaveBeenCalled()
  })
})
