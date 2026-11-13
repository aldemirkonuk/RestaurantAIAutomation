/**
 * /house and /house/menu ask the house, not the tab, whether a menu is read
 * (r21, 2026-11-13). The first proof lives only in the tab that read it; a
 * new tab, a reload elsewhere, or "Skip for now" used to leave "No menu read
 * yet." with nothing to press (/house) or "Read a menu" → /get-started, which
 * read the menu again into a second draft (/house/menu).
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getOnboardingProgress } = vi.hoisted(() => ({ getOnboardingProgress: vi.fn() }))

vi.mock('../../services/api/vendors', () => ({ addCustomProvider: vi.fn() }))
vi.mock('../../services/api/menus', () => ({
  getOnboardingProgress,
  addMenuItem: vi.fn(),
  reviewMenuItem: vi.fn(),
}))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))

import HouseContents from '../HouseContents'
import HouseMenu from '../HouseMenu'

const at = (element: JSX.Element) => render(<MemoryRouter>{element}</MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe('/house/menu with no first proof in this tab', () => {
  it('sends a house whose menu is read to /menu, never to read it again', async () => {
    getOnboardingProgress.mockResolvedValue({ menu_uploaded: true })
    at(<HouseMenu />)
    expect(await screen.findByRole('heading', { name: 'Your menu is read and kept.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the menu' })).toHaveAttribute('href', '/menu')
    expect(screen.getByRole('link', { name: 'Go to the desk' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('link', { name: /Read/ })).toBeNull()
    expect(document.body.textContent).not.toContain('No menu has been read yet.')
  })

  it('asks a house with no menu to read one, with the desk as the other way', async () => {
    getOnboardingProgress.mockResolvedValue({ menu_uploaded: false })
    at(<HouseMenu />)
    expect(await screen.findByRole('heading', { name: 'No menu has been read yet.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Read your menu' })).toHaveAttribute('href', '/get-started')
    expect(screen.getByRole('link', { name: 'Go to the desk' })).toHaveAttribute('href', '/')
  })

  it('keeps the old ask when the house cannot be read, or has no record', async () => {
    for (const answer of [Promise.reject(new Error('down')), Promise.resolve(null)]) {
      answer.catch(() => undefined)
      getOnboardingProgress.mockReturnValueOnce(answer)
      const view = at(<HouseMenu />)
      expect(await screen.findByRole('link', { name: 'Read your menu' })).toHaveAttribute('href', '/get-started')
      view.unmount()
    }
  })

  it('says nothing until the answer is in', () => {
    getOnboardingProgress.mockReturnValue(new Promise(() => undefined))
    at(<HouseMenu />)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('link', { name: /Read|Open the menu/ })).toBeNull()
  })
})

describe('/house menu row with no first proof in this tab', () => {
  it('says the menu is kept and links to it', async () => {
    getOnboardingProgress.mockResolvedValue({ menu_uploaded: true, vendor_added: false })
    at(<HouseContents />)
    expect(await screen.findByText(/Your menu is read and kept\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See it on Menu' })).toHaveAttribute('href', '/menu')
    expect(document.body.textContent).not.toContain('No menu read yet.')
  })

  it('after "Skip for now", offers the way back to reading the menu', async () => {
    getOnboardingProgress.mockResolvedValue({ menu_uploaded: false, vendor_added: false })
    at(<HouseContents />)
    expect(await screen.findByText(/No menu read yet\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Read your menu' })).toHaveAttribute('href', '/get-started')
  })

  it('names no menu state before the house answers', () => {
    getOnboardingProgress.mockReturnValue(new Promise(() => undefined))
    at(<HouseContents />)
    expect(document.body.textContent).not.toMatch(/No menu read yet|read and kept/)
  })

  it('speaks in house words: no "on the book", "one ask" or "Cellar registers"', async () => {
    getOnboardingProgress.mockResolvedValue({ menu_uploaded: true, vendor_added: true })
    at(<HouseContents />)
    expect(await screen.findByText(/Your supplier is saved\./)).toBeInTheDocument()
    expect(screen.getByText('The house is open')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set it in Settings' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/on the book|one ask|Cellar registers|Open later|Contents/)
  })
})
