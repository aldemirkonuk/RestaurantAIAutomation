/**
 * /house leads to the desk (QA BL-2) and keeps no invoice it cannot keep
 * (QA H-1). Every case here fails on origin/main.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'Suvla' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add this vendor' }))
    expect(await screen.findByText('Suvla is saved as your vendor.')).toBeInTheDocument()
    await waitFor(() => expect(addCustomProvider).toHaveBeenCalledTimes(1))
    expect(updateOnboardingProgress).not.toHaveBeenCalled()
  })

  // Walk 2026-11-11: after a reload the page asked "Who supplies you?" again
  // although the supplier was on the book (vendor_added on the house's row).
  it('a house whose supplier is on the book does not ask again after a reload', async () => {
    getOnboardingProgress.mockResolvedValue({ vendor_added: true })
    page()
    expect(await screen.findByText(/Your vendor is saved\./)).toBeInTheDocument()
    expect(screen.queryByLabelText('Vendor')).toBeNull()
    expect(screen.getByRole('link', { name: 'See vendors' })).toHaveAttribute('href', '/vendors')
  })

  // r28 gap 13: the gateway's own message was printed as it came, and a
  // validation refusal is an array of field notes.
  describe('a vendor that is not added is said in the house\'s words', () => {
    const refuse = async (cause: unknown) => {
      addCustomProvider.mockRejectedValue(cause)
      page()
      fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'Suvla' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add this vendor' }))
      return screen.findByRole('alert')
    }
    const status = (code: number, message: unknown) =>
      Object.assign(new Error('Request failed'), { response: { status: code, data: { message } } })

    it('a validation refusal (an array of notes) is one sentence, with the way to Vendors', async () => {
      const alert = await refuse(status(400, ['name must be shorter than or equal to 120 characters']))
      expect(alert.textContent).toBe('That name could not be saved as it is. Try it shorter, or add the vendor on Vendors. Open Vendors')
      expect(alert.textContent).not.toMatch(/must be shorter|characters/)
      expect(within(alert).getByRole('link', { name: 'Open Vendors' })).toHaveAttribute('href', '/vendors')
    })

    it('a vendor already on the book says so', async () => {
      const alert = await refuse(status(409, 'duplicate key value violates unique constraint "providers_name_key"'))
      expect(alert.textContent).toMatch(/^Suvla is already on your vendors\./)
      expect(alert.textContent).not.toMatch(/constraint/)
    })

    it('a folded duplicate names the vendor the house already keeps, not the typed spelling', async () => {
      const cause = Object.assign(new Error('Request failed'), {
        response: { status: 409, data: { message: 'A vendor with this name is already on this house.', existingId: 'p-1', existingName: 'Suvla Wines' } },
      })
      const alert = await refuse(cause)
      expect(alert.textContent).toMatch(/^Suvla Wines is already on your vendors\./)
    })

    it('a duplicate refusal without a stored name falls back to the typed one', async () => {
      const cause = Object.assign(new Error('Request failed'), {
        response: { status: 409, data: { message: 'conflict', existingName: '   ' } },
      })
      const alert = await refuse(cause)
      expect(alert.textContent).toMatch(/^Suvla is already on your vendors\./)
    })

    it('a session that may not add vendors is told who can', async () => {
      const alert = await refuse(status(403, 'Forbidden resource'))
      expect(alert.textContent).toMatch(/^This account cannot add vendors to this house\. An owner or a manager can\./)
    })

    it('a server error does not claim nothing was saved', async () => {
      const alert = await refuse(status(500, 'insert failed: relation "providers"'))
      expect(alert.textContent).toMatch(/^We could not tell whether Suvla was saved: the connection dropped\. Look on Vendors before adding it again\./)
      expect(alert.textContent).not.toMatch(/relation/)
    })

    it('anything else asks to try again', async () => {
      const alert = await refuse(new Error('boom'))
      expect(alert.textContent).toMatch(/^We could not add Suvla just now\. Try again, or add it on Vendors\./)
      expect(alert.textContent).not.toContain('boom')
    })

    it('a 422 reads as a validation refusal too', async () => {
      const alert = await refuse(status(422, 'x'))
      expect(alert.textContent).toMatch(/^That name could not be saved as it is\./)
    })
  })

  it('a failed progress read keeps the ask', async () => {
    getOnboardingProgress.mockRejectedValue(new Error('offline'))
    page()
    await waitFor(() => expect(getOnboardingProgress).toHaveBeenCalled())
    expect(screen.getByLabelText('Vendor')).toBeInTheDocument()
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

  // r28 onboarding gap 6: a proof that read only dishes counted 0 in pencil
  // (kitchen lines are not counted) and was called "set in ink".
  it('never calls a proof of only dishes "set in ink"', () => {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({
        menuId: 'm1',
        itemsExtracted: 2,
        submissionsCreated: 0,
        items: [
          { menuItemId: 'a', name: 'Tiramisu', category: 'food', matched: false, needsReview: false },
          { menuItemId: 'b', name: 'Adana kebab', category: 'food', matched: false, needsReview: false },
        ],
      }),
    )
    page()
    expect(
      screen.getByRole('button', { name: '2 dishes read, set aside from the drinks. No drink was read.' }),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('set in ink')
  })

  it('still says "set in ink" when every drink on the proof is certain', () => {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({
        menuId: 'm1',
        itemsExtracted: 2,
        submissionsCreated: 0,
        items: [
          { menuItemId: 'a', name: 'Rioja', category: 'red', matched: true, needsReview: false },
          { menuItemId: 'b', name: 'Tiramisu', category: 'food', matched: false, needsReview: false },
        ],
      }),
    )
    page()
    expect(screen.getByRole('button', { name: 'The first proof is set in ink.' })).toBeInTheDocument()
  })

  it('says a proof with no lines holds none', () => {
    sessionStorage.setItem(
      'mudavym:first-proof',
      JSON.stringify({ menuId: 'm1', itemsExtracted: 0, submissionsCreated: 0, items: [] }),
    )
    page()
    expect(screen.getByRole('button', { name: 'The first proof holds no lines yet.' })).toBeInTheDocument()
  })
})
