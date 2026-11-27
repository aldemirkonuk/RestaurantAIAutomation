/**
 * r41 onboarding gaps 1, 2 and 8 (/house and /house/menu).
 *
 * 1. The vendor ask was drawn before the setup read landed, then folded into
 *    one line when the house already had a vendor: the page jumped, typed
 *    text was lost, and a fast owner could save a second vendor.
 * 2. A failed setup read was said as "No menu read yet", whose link went to
 *    /get-started, which saw the current menu and sent the owner back.
 * 8. /house asked `/settings/currency` beside the setup read, which already
 *    carries `next_steps.money_set`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { addCustomProvider, getOnboardingProgress, houseCurrency } = vi.hoisted(() => ({
  addCustomProvider: vi.fn(),
  getOnboardingProgress: vi.fn(),
  houseCurrency: vi.fn(),
}))

vi.mock('../../services/api/vendors', () => ({ addCustomProvider }))
vi.mock('../../services/api/menus', () => ({
  getOnboardingProgress,
  updateOnboardingProgress: vi.fn(),
  addMenuItem: vi.fn(),
  reviewMenuItem: vi.fn(),
}))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency } }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'owner' } }) }))

import HouseContents from '../HouseContents'
import HouseMenu from '../HouseMenu'

const at = (element: JSX.Element) => render(<MemoryRouter>{element}</MemoryRouter>)
const SAID = 'The house’s money is not set yet.'

/** A read the test answers by hand. */
function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  houseCurrency.mockResolvedValue({ readable: true, code: 'TRY' })
})

describe('/house waits for its setup read before asking for a vendor (gap 1)', () => {
  it('draws no vendor form while the read is out, and says it is looking', () => {
    getOnboardingProgress.mockReturnValue(new Promise(() => undefined))
    at(<HouseContents />)
    expect(screen.queryByLabelText('Vendor')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add this vendor' })).toBeNull()
    expect(screen.getByTestId('house-vendor-reading')).toHaveTextContent('Looking for your vendor…')
    expect(screen.getByText('Looking at your menu…')).toBeInTheDocument()
  })

  it('a house with a vendor never shows the form, before or after the read', async () => {
    const read = pending<unknown>()
    getOnboardingProgress.mockReturnValue(read.promise)
    at(<HouseContents />)
    expect(screen.queryByLabelText('Vendor')).toBeNull()
    read.resolve({ vendor_added: true, menu_uploaded: true, menu_current: true })
    expect(await screen.findByText(/Your vendor is saved\./)).toBeInTheDocument()
    expect(screen.queryByLabelText('Vendor')).toBeNull()
    expect(screen.queryByTestId('house-vendor-reading')).toBeNull()
  })

  it('a house with no vendor gets the form once the read says so', async () => {
    const read = pending<unknown>()
    getOnboardingProgress.mockReturnValue(read.promise)
    at(<HouseContents />)
    read.resolve({ vendor_added: false })
    expect(await screen.findByLabelText('Vendor')).toBeInTheDocument()
    expect(screen.queryByTestId('house-vendor-reading')).toBeNull()
  })

  it('a failed read still asks for the vendor', async () => {
    getOnboardingProgress.mockRejectedValue(new Error('offline'))
    at(<HouseContents />)
    expect(await screen.findByLabelText('Vendor')).toBeInTheDocument()
  })
})

describe('/house never takes a failed read for "no menu" (gap 2)', () => {
  it('says it could not see, and never links to /get-started', async () => {
    getOnboardingProgress.mockRejectedValue(new Error('busy'))
    at(<HouseContents />)
    expect(await screen.findByTestId('house-menu-unread')).toHaveTextContent(
      'We could not see where your menu stands just now.',
    )
    expect(document.body.textContent).not.toContain('No menu read yet')
    expect(screen.queryByRole('link', { name: 'Read your menu' })).toBeNull()
    expect(document.querySelector('a[href="/get-started"]')).toBeNull()
    expect(screen.getByRole('link', { name: 'open Menu' })).toHaveAttribute('href', '/menu')
  })

  it('"Look again" reads once more and says what the house answers', async () => {
    getOnboardingProgress
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce({ menu_uploaded: true, menu_current: true, vendor_added: true })
    at(<HouseContents />)
    fireEvent.click(await screen.findByRole('button', { name: 'Look again' }))
    expect(await screen.findByText(/Your menu is the current one\./)).toBeInTheDocument()
    expect(getOnboardingProgress).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('house-menu-unread')).toBeNull()
  })

  it('a house the record says has no menu is still asked to read one', async () => {
    getOnboardingProgress.mockResolvedValue({ menu_uploaded: false, menu_current: false })
    at(<HouseContents />)
    expect(await screen.findByText(/No menu read yet\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Read your menu' })).toHaveAttribute('href', '/get-started')
    expect(screen.queryByTestId('house-menu-unread')).toBeNull()
  })
})

describe('/house/menu never takes a failed read for "no menu" (gap 2)', () => {
  it('"Look again" reads once more', async () => {
    getOnboardingProgress
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce({ menu_uploaded: true, menu_current: true })
    at(<HouseMenu />)
    fireEvent.click(await screen.findByRole('button', { name: 'Look again' }))
    expect(await screen.findByRole('heading', { name: 'Your menu is the current one.' })).toBeInTheDocument()
    expect(getOnboardingProgress).toHaveBeenCalledTimes(2)
  })
})

describe('/house asks for the money only when the setup read does not say (gap 8)', () => {
  it('money_set false: says it, with no second request', async () => {
    getOnboardingProgress.mockResolvedValue({ vendor_added: true, next_steps: { money_set: false } })
    at(<HouseContents />)
    expect(await screen.findByTestId('house-money-unset')).toHaveTextContent(SAID)
    expect(houseCurrency).not.toHaveBeenCalled()
  })

  it('money_set true: says nothing, with no second request', async () => {
    getOnboardingProgress.mockResolvedValue({ vendor_added: true, next_steps: { money_set: true } })
    at(<HouseContents />)
    await screen.findByText(/Your vendor is saved\./)
    expect(screen.queryByTestId('house-money-unset')).toBeNull()
    expect(houseCurrency).not.toHaveBeenCalled()
  })

  it('an older gateway (no next_steps) asks the money on its own', async () => {
    getOnboardingProgress.mockResolvedValue({ vendor_added: true })
    houseCurrency.mockResolvedValue({ readable: true, code: null })
    at(<HouseContents />)
    expect(await screen.findByTestId('house-money-unset')).toBeInTheDocument()
    expect(houseCurrency).toHaveBeenCalledTimes(1)
  })

  it('money_set null (not read there) asks the money on its own', async () => {
    getOnboardingProgress.mockResolvedValue({ vendor_added: true, next_steps: { money_set: null } })
    at(<HouseContents />)
    await waitFor(() => expect(houseCurrency).toHaveBeenCalledTimes(1))
  })

  it('a failed setup read asks the money on its own', async () => {
    getOnboardingProgress.mockRejectedValue(new Error('busy'))
    houseCurrency.mockResolvedValue({ readable: true, code: null })
    at(<HouseContents />)
    expect(await screen.findByTestId('house-money-unset')).toBeInTheDocument()
    expect(houseCurrency).toHaveBeenCalledTimes(1)
  })
})
