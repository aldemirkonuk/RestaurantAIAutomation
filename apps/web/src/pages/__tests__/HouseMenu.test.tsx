/**
 * The first proof keeps its places (walk 2026-11-11): placing a line saved it
 * on the gateway but only in page state, so a reload put it back to "needs a
 * place" and /house still counted it pencilled.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { reviewMenuItem, addMenuItem } = vi.hoisted(() => ({
  reviewMenuItem: vi.fn(),
  addMenuItem: vi.fn(),
}))
vi.mock('../../services/api/menus', () => ({ reviewMenuItem, addMenuItem, readWarningSentence: (w: unknown) => String(w) }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
// r37 meet with the menu train: the proof now asks who reads it (the
// current-menu choice) and reads the house money. Staff, and a money read
// left pending, keep these tests on what they test.
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'staff', user: { role: 'staff' } }),
}))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency: vi.fn(() => new Promise(() => {})) } }))

import HouseMenu from '../HouseMenu'
import { FIRST_PROOF_KEY, readProof } from '../../lib/firstProof'

const typedProof = (items: unknown[]) =>
  sessionStorage.setItem(
    FIRST_PROOF_KEY,
    JSON.stringify({
      menuId: 'm1',
      itemsExtracted: items.length,
      submissionsCreated: 0,
      items,
      source: { kept: false, failure: null },
    }),
  )
const unplaced = (id: string, name: string) => ({
  menuItemId: id,
  name,
  category: null,
  matched: false,
  needsReview: true,
})
const page = () => render(<MemoryRouter><HouseMenu /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  reviewMenuItem.mockResolvedValue({})
})

describe('HouseMenu: the first proof keeps its places', () => {
  it('counts a kitchen line as a dish, never as set (read = set + pencilled + dishes)', () => {
    typedProof([
      unplaced('a', 'House Red'),
      { menuItemId: 'k', name: 'Tiramisu', category: 'dessert', matched: false, needsReview: false, kitchen_line: true },
    ])
    page()
    const count = screen.getByRole('group', { name: 'The reading count' })
    expect(count).toHaveTextContent('2read0in ink1in pencil1dish')
    expect(screen.getByText(/1 dish kept on your menu as read/)).toBeInTheDocument()
  })

  it('a placed line stays placed after a reload', async () => {
    typedProof([unplaced('a', 'Kavaklidere Yakut')])
    page()
    fireEvent.click(screen.getByRole('button', { name: /Kavaklidere Yakut/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Red wine' }))
    await waitFor(() => expect(reviewMenuItem).toHaveBeenCalledWith('a', 'category', 'red'))
    await waitFor(() => expect(readProof()?.items[0]).toMatchObject({ category: 'red', needsReview: false }))

    cleanup()
    page()
    expect(screen.getByRole('heading', { name: 'Red wine' })).toBeInTheDocument()
    expect(screen.queryByText('No section yet', { selector: 'span' })).toBeNull()
  })

  it('heads unplaced lines "No section yet" and claims no absent section while none is placed', () => {
    typedProof([unplaced('a', 'Kavaklidere Yakut')])
    page()
    expect(screen.getByRole('heading', { name: 'No section yet' })).toBeInTheDocument()
    expect(screen.queryByText(/Not on this menu/)).toBeNull()
  })

  it('a typed line says it was typed, not that a page was lost', () => {
    typedProof([unplaced('a', 'Kavaklidere Yakut')])
    page()
    fireEvent.click(screen.getByRole('button', { name: /Kavaklidere Yakut/ }))
    expect(screen.getByText(/this line was typed, not read from a photo/)).toBeInTheDocument()
    expect(screen.queryByText(/the original page was not kept/)).toBeNull()
  })

  it('a refused placement is said, and the line stays unplaced', async () => {
    reviewMenuItem.mockRejectedValue(new Error('409'))
    typedProof([unplaced('a', 'Kavaklidere Yakut')])
    page()
    fireEvent.click(screen.getByRole('button', { name: /Kavaklidere Yakut/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Red wine' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That line was not placed. Try again.')
    expect(readProof()?.items[0]).toMatchObject({ category: null })
  })
})
