/**
 * Onboarding walk 2026-11-12: "THE FIRST PROOF", "set", "pencilled" and
 * "Needs a place" were never explained, and nothing showed that a line could
 * be opened. ADR 0213 F6 keeps the ink / pencil words; the proof now says what
 * each mark means, and only a line worth a look is a button that says so.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api/menus', () => ({ reviewMenuItem: vi.fn(), addMenuItem: vi.fn() }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))

import HouseMenu from '../HouseMenu'
import { FIRST_PROOF_KEY } from '../../lib/firstProof'

const proof = (items: unknown[]) =>
  sessionStorage.setItem(
    FIRST_PROOF_KEY,
    JSON.stringify({ menuId: 'm1', itemsExtracted: items.length, submissionsCreated: 0, items }),
  )
const ink = { menuItemId: 'i', name: 'Rioja Reserva', category: 'red', matched: true, needsReview: false }
const pencil = { menuItemId: 'p', name: 'Yakut', category: 'red', matched: false, needsReview: true }
const ring = { menuItemId: 'r', name: 'Mystery Pour', category: null, matched: false, needsReview: true }
const page = () => render(<MemoryRouter><HouseMenu /></MemoryRouter>)

beforeEach(() => sessionStorage.clear())

describe('the first proof says what its marks mean', () => {
  it('keys every mark on the page in plain words', () => {
    proof([ink, pencil, ring])
    page()
    const key = screen.getByRole('list', { name: 'What the marks mean' })
    expect(within(key).getByText('In ink: set as read.')).toBeInTheDocument()
    expect(within(key).getByText(/In pencil: worth a second look\. Tap the line/)).toBeInTheDocument()
    expect(within(key).getByText(/No section yet: tap the line to choose one/)).toBeInTheDocument()
  })

  it('keys only the marks that are there', () => {
    proof([ink])
    page()
    const key = screen.getByRole('list', { name: 'What the marks mean' })
    expect(within(key).getAllByRole('listitem')).toHaveLength(1)
  })

  it('never says "pencilled" or "Needs a place"', () => {
    proof([ink, pencil, ring])
    page()
    expect(document.body.textContent).not.toMatch(/pencilled/i)
    expect(document.body.textContent).not.toMatch(/needs a place/i)
  })

  it('a line in ink is not a button; a line in pencil is, and says it opens', () => {
    proof([ink, pencil])
    page()
    expect(screen.queryByRole('button', { name: /Rioja Reserva/ })).toBeNull()
    const line = screen.getByRole('button', { name: /Yakut/ })
    expect(line).toHaveAttribute('aria-expanded', 'false')
    expect(within(line).getByText('Check this line')).toBeInTheDocument()
    fireEvent.click(line)
    expect(line).toHaveAttribute('aria-expanded', 'true')
    expect(within(line).getByText('Close')).toBeInTheDocument()
    expect(screen.getAllByText('Choose its section').length).toBeGreaterThan(0)
  })

  it('a line with no section asks to choose one', () => {
    proof([ring])
    page()
    const line = screen.getByRole('button', { name: /Mystery Pour/ })
    expect(within(line).getByText('Choose its section')).toBeInTheDocument()
  })
})
