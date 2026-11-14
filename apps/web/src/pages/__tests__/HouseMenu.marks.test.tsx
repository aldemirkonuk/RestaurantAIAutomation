/**
 * Onboarding walk 2026-11-12: "THE FIRST PROOF", "set", "pencilled" and
 * "Needs a place" were never explained, and nothing showed that a line could
 * be opened. ADR 0213 F6 keeps the ink / pencil words; the proof now says what
 * each mark means, and only a line worth a look is a button that says so.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api/menus', () => ({ reviewMenuItem: vi.fn().mockResolvedValue({}), addMenuItem: vi.fn(), readWarningSentence: (w: unknown) => String(w) }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
// r37 meet with the menu train: the proof now asks who reads it (the
// current-menu choice) and reads the house money. Staff, and a money read
// left pending, keep these tests on what they test.
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'staff', user: { role: 'staff' } }),
}))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency: vi.fn(() => new Promise(() => {})) } }))

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

/**
 * r13 walk 2026-11-12: "3 READ" sat over 2 in ink + 0 in pencil (the kitchen
 * line was read but shown in neither), and "In ink: set as read." was the only
 * key line while the one ink line was set by the owner.
 */
describe('the first proof counts and keys only what is true', () => {
  const kitchen = (id: string) => ({ menuItemId: id, name: `Pizza ${id}`, category: 'food', rawText: 'pizza', matched: false, needsReview: false })
  const n = (id: string, row: Record<string, unknown>) => ({ ...row, menuItemId: id, name: `${String(row.name)} ${id}` })
  const cells = () =>
    [...screen.getByRole('group', { name: 'The reading count' }).querySelectorAll('strong')].map((cell) =>
      Number(cell.textContent),
    )

  it('read = in ink + in pencil + set aside, for every mix of up to 2 of each', () => {
    for (let i = 0; i <= 2; i++) for (let p = 0; p <= 2; p++) for (let r = 0; r <= 1; r++) for (let k = 0; k <= 2; k++) {
      const rows = [
        ...Array.from({ length: i }, (_, x) => n(`i${x}`, ink)),
        ...Array.from({ length: p }, (_, x) => n(`p${x}`, pencil)),
        ...Array.from({ length: r }, (_, x) => n(`r${x}`, ring)),
        ...Array.from({ length: k }, (_, x) => kitchen(`k${x}`)),
      ]
      if (rows.length === 0) continue
      sessionStorage.clear()
      proof(rows)
      page()
      const [read, inInk, inPencil, setAside = 0] = cells()
      expect([read, inInk, inPencil, setAside]).toEqual([rows.length, i, p + r, k])
      expect(read).toBe(inInk + inPencil + setAside)
      cleanup()
    }
  })

  it('shows no "set aside" cell when nothing was set aside', () => {
    proof([ink, pencil])
    page()
    expect(screen.getByRole('group', { name: 'The reading count' })).not.toHaveTextContent(/set aside/)
  })

  it('a line the owner placed is keyed "set by you", never "set as read"', async () => {
    proof([ring])
    page()
    fireEvent.click(screen.getByRole('button', { name: /Mystery Pour/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Red wine' }))
    const key = screen.getByRole('list', { name: 'What the marks mean' })
    await waitFor(() => expect(within(key).getByText('In ink: set by you.')).toBeInTheDocument())
    expect(within(key).queryByText('In ink: set as read.')).toBeNull()
  })

  it('keys both when one ink line was read and one was set by the owner, and keeps it after a reload', async () => {
    proof([ink, ring])
    page()
    fireEvent.click(screen.getByRole('button', { name: /Mystery Pour/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Red wine' }))
    await waitFor(() => expect(screen.getByText('In ink: set by you.')).toBeInTheDocument())
    cleanup()
    page()
    const key = screen.getByRole('list', { name: 'What the marks mean' })
    expect(within(key).getByText('In ink: set as read.')).toBeInTheDocument()
    expect(within(key).getByText('In ink: set by you.')).toBeInTheDocument()
  })

  it('a typed menu keys its ink lines as typed, not read', () => {
    sessionStorage.setItem(
      FIRST_PROOF_KEY,
      JSON.stringify({ menuId: 'm1', itemsExtracted: 1, submissionsCreated: 0, items: [ink], source: { kept: false, failure: null } }),
    )
    page()
    const key = screen.getByRole('list', { name: 'What the marks mean' })
    expect(within(key).getByText('In ink: set as you typed it.')).toBeInTheDocument()
    expect(within(key).queryByText('In ink: set as read.')).toBeNull()
  })
})
