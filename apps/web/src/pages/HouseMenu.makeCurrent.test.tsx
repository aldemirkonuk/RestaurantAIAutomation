/**
 * The first proof offers the current-menu choice (ADR 0193 item 7, Locked;
 * ADR 0358 F1 step 1e). After the first read an owner or a manager chooses
 * whether it becomes the current menu, neither option preselected (ADR 0213
 * #16); either way it is kept. Making it current goes through the same plan
 * and fingerprint as /menu (L13). Staff are offered no choice.
 *
 * Ported from MenuReviewScreen.choice.test.tsx, whose screen was never
 * mounted; every case it pinned is pinned here against the page the
 * onboarding really shows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HouseMenu from './HouseMenu'
import { writeProof } from '../lib/firstProof'
import { getMenuPlan, makeMenuCurrent, type MenuImportResult } from '../services/api/menus'

let role: string | null = 'owner'
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: role, user: { role } }),
}))
vi.mock('../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../services/api/menus')>('../services/api/menus')
  return { ...actual, makeMenuCurrent: vi.fn(), getMenuPlan: vi.fn(), addMenuItem: vi.fn(), reviewMenuItem: vi.fn() }
})

const mockMake = vi.mocked(makeMenuCurrent)
const mockPlan = vi.mocked(getMenuPlan)

const PROOF: MenuImportResult = {
  menuId: 'm9',
  itemsExtracted: 1,
  submissionsCreated: 0,
  items: [
    {
      menuItemId: 'i1',
      submissionId: null,
      name: 'Barolo',
      producer: 'Vietti',
      category: 'red',
      vintage: '2019',
      region: null,
      grapeVariety: null,
      byGlassPrice: null,
      bottlePrice: 95,
      rawText: null,
      matched: true,
      needsReview: false,
    },
  ],
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HouseMenu />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Open the plan, then confirm it: the only way a menu becomes current. */
async function chooseThroughThePlan() {
  fireEvent.click(screen.getByRole('button', { name: 'Make this the current menu' }))
  expect(await screen.findByTestId('first-proof-plan')).toBeInTheDocument()
  expect(mockMake).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }))
}

beforeEach(() => {
  role = 'owner'
  mockMake.mockReset()
  mockPlan.mockReset()
  mockPlan.mockResolvedValue({
    menuId: 'm9',
    current: false,
    generatedAt: '2026-11-11T12:00:00Z',
    fingerprint: 'fp-m9',
    lines: [],
    counts: { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 0, new_wine: 0 },
    dormantLocks: [],
    namesReadable: true,
    namesReason: null,
  })
  writeProof(PROOF)
})

afterEach(() => sessionStorage.clear())

describe('the first proof -- the current-menu choice', () => {
  it('offers both choices to an owner, neither preselected, and nothing is chosen until one is pressed', () => {
    mount()
    const make = screen.getByRole('button', { name: 'Make this the current menu' })
    const keep = screen.getByRole('button', { name: 'Keep it, not current' })
    // Same weight: neither carries a pressed or default mark.
    expect(make.className).toBe(keep.className)
    expect(make).not.toHaveAttribute('aria-pressed')
    expect(screen.queryByTestId('first-proof-choice-said')).not.toBeInTheDocument()
    expect(mockPlan).not.toHaveBeenCalled()
    expect(mockMake).not.toHaveBeenCalled()
  })

  it('an owner makes it current through the plan, sending the plan fingerprint', async () => {
    mockMake.mockResolvedValue({ outcome: 'made_current', menuId: 'm9', previousMenuIds: [], lines: 1, priceSync: { changed: 1 }, flagged: 0, failed: [] })
    mount()
    await chooseThroughThePlan()
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('m9', 'fp-m9'))
    expect(await screen.findByTestId('first-proof-choice-said')).toHaveTextContent(
      'This is now the current menu: 1 line, 1 line priced from this menu.',
    )
    // The choice is not offered again once made.
    expect(screen.queryByRole('button', { name: 'Make this the current menu' })).not.toBeInTheDocument()
  })

  it('a price that failed in the switch is said by name', async () => {
    mockMake.mockResolvedValue({
      outcome: 'made_current', menuId: 'm9', previousMenuIds: [], lines: 2,
      priceSync: { changed: 1, failed: 1 }, flagged: 1,
      failed: [{ menuItemId: 'mi-2', name: 'Opus One', error: 'the price was not saved' }],
    })
    mount()
    await chooseThroughThePlan()
    expect(await screen.findByTestId('first-proof-choice-said')).toHaveTextContent(
      /This is now the current menu: 2 lines, 1 line priced from this menu, 1 line with a blank price, noted on the line so a manager can set it on Inventory\. 1 could not be priced: Opus One \(the price was not saved\)\./,
    )
  })

  it('a price a lock held is named (ADR 0193 round 3, L15)', async () => {
    role = 'manager'
    mockMake.mockResolvedValue({
      outcome: 'made_current', menuId: 'm9', previousMenuIds: [], lines: 1,
      priceSync: { locked: 1 }, flagged: 0, failed: [],
      held: [{ menuItemId: 'mi-1', name: 'Barolo', kind: 'bottle', lockId: 'k1', lockedPrice: 95, lockedBy: 'u1', lockedAt: '2026-09-01T00:00:00Z' }],
    })
    mount()
    await chooseThroughThePlan()
    expect(await screen.findByTestId('first-proof-choice-said')).toHaveTextContent(
      'Held by a lock, not changed: Barolo (bottle, locked at 95.00).',
    )
  })

  it('a refused choice is said, and nothing is recorded as chosen', async () => {
    mockMake.mockRejectedValue({ response: { data: { message: 'Only managers and owners can choose the current menu' } } })
    mount()
    await chooseThroughThePlan()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'It was not made current: Only managers and owners can choose the current menu. Nothing has changed.',
    )
    expect(screen.queryByTestId('first-proof-choice-said')).not.toBeInTheDocument()
    expect(sessionStorage.getItem('mudavym:first-proof-choice:m9')).toBeNull()
  })

  it('a manager may keep it without making it current: nothing is switched, and a reload remembers', () => {
    role = 'manager'
    const { unmount } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Keep it, not current' }))
    expect(screen.getByTestId('first-proof-choice-said')).toHaveTextContent(/^Kept, not current\. No price or stock changed\./)
    expect(mockMake).not.toHaveBeenCalled()
    expect(mockPlan).not.toHaveBeenCalled()
    unmount()
    mount()
    expect(screen.getByTestId('first-proof-choice-said')).toHaveTextContent(/^Kept, not current/)
    expect(screen.queryByRole('button', { name: 'Keep it, not current' })).not.toBeInTheDocument()
  })

  it('staff are offered no choice, and are told who makes it', () => {
    role = 'staff'
    mount()
    expect(screen.queryByRole('button', { name: 'Make this the current menu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Keep it, not current' })).not.toBeInTheDocument()
    expect(screen.getByTestId('first-proof-choice')).toHaveTextContent(
      'An owner or a manager chooses whether it becomes the current menu. It is kept either way.',
    )
  })

  it('a read that reopened the current menu offers no choice: it says it is the current menu', () => {
    sessionStorage.clear()
    writeProof({ ...PROOF, current: true } as unknown as MenuImportResult)
    mount()
    expect(screen.getByTestId('first-proof-already-current')).toHaveTextContent('It is the current menu.')
    expect(screen.queryByRole('button', { name: 'Make this the current menu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Keep it, not current' })).not.toBeInTheDocument()
    expect(mockPlan).not.toHaveBeenCalled()
  })

  it('other files sent with it are said to be kept as drafts', () => {
    sessionStorage.clear()
    writeProof({ ...PROOF, otherKept: 2 } as MenuImportResult)
    const { unmount } = mount()
    expect(screen.getByTestId('first-proof-other-kept')).toHaveTextContent(
      'The 2 other files you sent were read too, each kept as its own draft, not current.',
    )
    unmount()
    sessionStorage.clear()
    writeProof({ ...PROOF, otherKept: 1 } as MenuImportResult)
    mount()
    expect(screen.getByTestId('first-proof-other-kept')).toHaveTextContent('The other file you sent was read too')
  })

  it('one file sent says nothing about others', () => {
    mount()
    expect(screen.queryByTestId('first-proof-other-kept')).not.toBeInTheDocument()
    expect(screen.queryByTestId('first-proof-already-current')).not.toBeInTheDocument()
  })
})
