/**
 * /house leads to the desk (QA BL-2) and keeps no invoice it cannot keep
 * (QA H-1). Every case here fails on origin/main.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { addCustomProvider, updateOnboardingProgress, setup } = vi.hoisted(() => ({
  addCustomProvider: vi.fn(),
  updateOnboardingProgress: vi.fn(),
  setup: { progress: null as Record<string, unknown> | null, refresh: vi.fn() },
}))

vi.mock('../../services/api/vendors', () => ({ addCustomProvider }))
vi.mock('../../services/api/menus', () => ({ updateOnboardingProgress }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../hooks/queries/useOnboardingProgress', () => ({
  useOnboardingProgress: () => setup,
}))

import HouseContents from '../HouseContents'

beforeEach(() => {
  vi.clearAllMocks()
  addCustomProvider.mockResolvedValue({ id: 'vendor-1', name: 'Suvla' })
  updateOnboardingProgress.mockResolvedValue({})
  setup.progress = null
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

  it('re-reads the house setup after a supplier is added, so the checklist and nudge follow', async () => {
    page()
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Suvla' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add this supplier' }))
    await waitFor(() => expect(setup.refresh).toHaveBeenCalledTimes(1))
  })

  it('in a new tab with no proof, a menu the server read but not current leads to the choice', () => {
    setup.progress = { menu_uploaded: true, menu_current: false, vendor_added: false }
    page()
    expect(screen.queryByText('No menu read yet.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Your menu is read. Choose it as the current menu.' })).toBeInTheDocument()
  })

  it('a current menu says so and makes counting the shelf the one next ask', () => {
    setup.progress = { menu_uploaded: true, menu_current: true, vendor_added: false }
    page()
    expect(screen.getByText('The menu is current.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Count the shelf' })).toHaveAttribute('href', '/inventory')
  })

  it('a house with a supplier already on the book is not asked again', () => {
    setup.progress = { menu_uploaded: false, vendor_added: true }
    page()
    expect(screen.queryByLabelText('Supplier')).toBeNull()
    expect(screen.getByText('A supplier is on the book.')).toBeInTheDocument()
  })

  it('with nothing read, leads back to reading the menu', () => {
    setup.progress = { menu_uploaded: false, vendor_added: false }
    page()
    expect(screen.getByRole('link', { name: 'Read your menu' })).toHaveAttribute('href', '/get-started')
  })

  it('wears the house tokens: no hex colour and no slate or gray class', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '../HouseContents.tsx'), 'utf8')
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/)
    expect(src).not.toMatch(/\b(slate|gray)-\d/)
    expect(src).toMatch(/className="mudavym /)
  })
})
