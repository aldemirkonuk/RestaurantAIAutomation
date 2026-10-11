/**
 * The sidebar's "Get started" checklist is the house owner's own (F-1210).
 *
 * An invited manager or staff member has no checklist row, so the progress
 * read answers null. The rail used to count that as "1 of 4" and show the
 * block forever, to everyone; and "Don't show again" failed in silence, so
 * the badge came straight back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'

const h = vi.hoisted(() => ({
  role: 'owner',
  onboarding: {} as Record<string, unknown>,
  update: vi.fn(),
}))

vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react')
  return {
    AuthContext: React.createContext(null),
    useAuth: () => ({
      user: { userId: 'user-1', name: 'Ada', role: h.role, restaurantId: 'rest-1' },
      logout: vi.fn(),
    }),
  }
})

vi.mock('../../hooks/queries/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ update: h.update, ...h.onboarding }),
}))

vi.mock('../../hooks/queries/useNotificationQueries', () => ({
  useUnreadCount: () => ({ data: 0 }),
}))

vi.mock('../../hooks/queries/useOrderQueries', () => ({
  usePendingOrdersCount: () => ({ data: 0 }),
}))

vi.mock('../../hooks/queries/useInventoryQueries', () => ({
  useLowStockItems: () => ({ data: [] }),
}))

const openList = {
  menu_uploaded: true,
  vendor_added: false,
  team_member_invited: false,
  checklist_dismissed: false,
  completed_at: null,
}

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  )
}

const getStarted = () => screen.queryByRole('button', { name: /Get started/ })

beforeEach(() => {
  h.role = 'owner'
  h.onboarding = {}
  h.update.mockReset()
})

describe('Sidebar — Get started is the owner’s own checklist (F-1210)', () => {
  it('shows an owner their open checklist', () => {
    h.onboarding = { progress: openList, isLoading: false, isError: false }
    renderSidebar()
    expect(getStarted()).toHaveTextContent('2/4')
  })

  it('does not show it to an invited person with no checklist in this house', () => {
    h.role = 'manager'
    h.onboarding = { progress: null, isLoading: false, isError: false }
    renderSidebar()
    expect(getStarted()).toBeNull()
    expect(screen.getByRole('button', { name: /Learn & Help/ })).toBeInTheDocument()
  })

  it('does not show it to an owner whose house has no checklist for them', () => {
    h.onboarding = { progress: null, isLoading: false, isError: false }
    renderSidebar()
    expect(getStarted()).toBeNull()
  })

  it('does not show it to staff, even with a row', () => {
    h.role = 'staff'
    h.onboarding = { progress: openList, isLoading: false, isError: false }
    renderSidebar()
    expect(getStarted()).toBeNull()
  })

  it('says so when "Don’t show again" is not kept, and stays open', () => {
    h.onboarding = { progress: openList, isLoading: false, isError: false }
    h.update.mockImplementation((_body, options) => options?.onError?.(new Error('404')))
    renderSidebar()
    fireEvent.click(getStarted()!)
    fireEvent.click(screen.getByRole('button', { name: /Don.t show again/ }))
    expect(h.update).toHaveBeenCalledWith(
      { checklist_dismissed: true },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('We could not hide this list just now.')
    expect(screen.getByRole('button', { name: /Don.t show again/ })).toBeInTheDocument()
  })
})
