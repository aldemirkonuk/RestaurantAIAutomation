/**
 * ADR 0193 (menu versions; the founder, 2026-09-21): after a photo and an
 * extraction, the person chooses whether the menu becomes the current one;
 * either way it is kept. The choice is an owner's or a manager's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MenuReviewScreen } from './MenuReviewScreen'
import { makeMenuCurrent } from '../../services/api/menus'

let role: string | null = 'owner'
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: role, user: { role } }),
}))
vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, makeMenuCurrent: vi.fn(), addMenuItem: vi.fn(), reviewMenuItem: vi.fn() }
})

const mockMake = vi.mocked(makeMenuCurrent)
const RESULT = { menuId: 'm9', itemsExtracted: 0, submissionsCreated: 0, items: [] }

beforeEach(() => {
  mockMake.mockReset()
})

describe('MenuReviewScreen — the current-menu choice after a read', () => {
  it('an owner makes it current, then continues', async () => {
    role = 'owner'
    mockMake.mockResolvedValue({ outcome: 'made_current', menuId: 'm9', previousMenuIds: [], lines: 0, priceSync: {}, flagged: 0, failed: [] })
    const onConfirm = vi.fn()
    render(<MenuReviewScreen result={RESULT} onConfirm={onConfirm} onSkip={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Make this the current menu/ }))
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('m9'))
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
    fireEvent.click(screen.getByRole('button', { name: /Make this the current menu/ }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      /This is now the current menu: 2 lines, 1 price set from this menu, 1 flagged: a blank price kept the last known one\. 1 could not be priced: Opus One \(the price was not saved\)\./,
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
    fireEvent.click(screen.getByRole('button', { name: /Make this the current menu/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('It was not made current: Only managers and owners can choose the current menu. It is kept as a draft.')
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
