/**
 * ADR 0193 (menu versions; the founder, 2026-09-21): after a photo and an
 * extraction, the person chooses whether the menu becomes the current one;
 * either way it is kept. The choice is an owner's or a manager's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { MenuReviewScreen } from './MenuReviewScreen'
import { getMenuPlan, makeMenuCurrent } from '../../services/api/menus'

// The choice goes through the plan (ADR 0193 round 3, L13), which reads with react-query.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

let role: string | null = 'owner'
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: role, user: { role } }),
}))
vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, makeMenuCurrent: vi.fn(), addMenuItem: vi.fn(), reviewMenuItem: vi.fn(), getMenuPlan: vi.fn() }
})

const mockMake = vi.mocked(makeMenuCurrent)
const mockPlan = vi.mocked(getMenuPlan)
const RESULT = { menuId: 'm9', itemsExtracted: 0, submissionsCreated: 0, items: [] }

beforeEach(() => {
  mockMake.mockReset()
  mockPlan.mockReset()
  mockPlan.mockResolvedValue({
    menuId: 'm9',
    current: false,
    generatedAt: '2026-09-21T12:00:00Z',
    fingerprint: 'fp-m9',
    lines: [],
    counts: { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 0, new_wine: 0 },
    dormantLocks: [],
    namesReadable: true,
    namesReason: null,
  })
})

/** Open the plan, then confirm it: the only way a menu becomes current. */
async function chooseThroughThePlan() {
  fireEvent.click(screen.getByRole('button', { name: /Make this the current menu/ }))
  expect(await screen.findByTestId('onboarding-menu-plan')).toBeInTheDocument()
  expect(mockMake).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }))
}

describe('MenuReviewScreen — the current-menu choice after a read', () => {
  it('an owner makes it current, then continues', async () => {
    role = 'owner'
    mockMake.mockResolvedValue({ outcome: 'made_current', menuId: 'm9', previousMenuIds: [], lines: 0, priceSync: {}, flagged: 0, failed: [] })
    const onConfirm = vi.fn()
    render(<MenuReviewScreen result={RESULT} onConfirm={onConfirm} onSkip={vi.fn()} />)
    await chooseThroughThePlan()
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('m9', 'fp-m9'))
    // `true`: the page after the review may say the inventory is live.
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(true))
  })

  it('a price that failed in the switch is SAID, and the review waits for Continue', async () => {
    role = 'owner'
    mockMake.mockResolvedValue({
      outcome: 'made_current', menuId: 'm9', previousMenuIds: [], lines: 2,
      priceSync: { changed: 1, failed: 1 }, flagged: 1,
      failed: [{ menuItemId: 'mi-2', name: 'Opus One', error: 'the price was not saved' }],
    })
    const onConfirm = vi.fn()
    render(<MenuReviewScreen result={RESULT} onConfirm={onConfirm} onSkip={vi.fn()} />)
    await chooseThroughThePlan()
    expect(await screen.findByText(/^This is now the current menu/)).toHaveTextContent(
      /This is now the current menu: 2 lines, 1 price set from this menu, 1 flagged for a blank price\. 1 could not be priced: Opus One \(the price was not saved\)\./,
    )
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('a manager may keep it without making it current -- nothing is switched', () => {
    role = 'manager'
    const onConfirm = vi.fn()
    render(<MenuReviewScreen result={RESULT} onConfirm={onConfirm} onSkip={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Keep it, not current' }))
    // `false`: a kept draft reached no inventory, and the next page must not say it did.
    expect(onConfirm).toHaveBeenCalledWith(false)
    expect(mockMake).not.toHaveBeenCalled()
  })

  it('a refused choice is said, and the review does not move on', async () => {
    role = 'owner'
    mockMake.mockRejectedValue({ response: { data: { message: 'Only managers and owners can choose the current menu' } } })
    const onConfirm = vi.fn()
    render(<MenuReviewScreen result={RESULT} onConfirm={onConfirm} onSkip={vi.fn()} />)
    await chooseThroughThePlan()
    expect(await screen.findByRole('alert')).toHaveTextContent('It was not made current: Only managers and owners can choose the current menu. Nothing has changed.')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('staff are offered no choice, and are told who makes it', () => {
    role = 'staff'
    render(<MenuReviewScreen result={RESULT} onConfirm={vi.fn()} onSkip={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Make this the current menu/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Looks good, continue/ })).toBeInTheDocument()
    expect(screen.getByText(/which an owner or a manager chooses/)).toBeInTheDocument()
  })
})

describe('MenuReviewScreen -- a price a lock held is said too (ADR 0193 round 3, L15)', () => {
  it('the review waits and names the held price', async () => {
    role = 'manager'
    mockMake.mockResolvedValue({
      outcome: 'made_current', menuId: 'm9', previousMenuIds: [], lines: 1,
      priceSync: { locked: 1 }, flagged: 0, failed: [],
      held: [{ menuItemId: 'mi-1', name: 'Barolo', kind: 'bottle', lockId: 'k1', lockedPrice: 95, lockedBy: 'u1', lockedAt: '2026-09-01T00:00:00Z' }],
    })
    const onConfirm = vi.fn()
    render(<MenuReviewScreen result={RESULT} onConfirm={onConfirm} onSkip={vi.fn()} />)
    await chooseThroughThePlan()
    expect(await screen.findByText(/^This is now the current menu/)).toHaveTextContent(
      'Held by a lock, not changed: Barolo (bottle, locked at 95.00).',
    )
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
