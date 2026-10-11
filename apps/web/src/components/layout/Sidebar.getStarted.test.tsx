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
  menu_current: true,
  threshold_configured: false,
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
    expect(getStarted()).toHaveTextContent('2/5')
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

/**
 * The rail and the Finish setup nudge read one "set up" (F-1239). The rail
 * used to close Get started on completed_at (a menu read, a supplier, an
 * invite) while the nudge still said the house was not set up: no current
 * menu, no low-stock number.
 */
describe('Sidebar — Get started reads the same "set up" as the nudge (F-1239)', () => {
  const readNotCurrent = {
    menu_uploaded: true,
    menu_current: false,
    threshold_configured: false,
    vendor_added: true,
    team_member_invited: true,
    checklist_dismissed: false,
    completed_at: '2026-10-01T09:00:00Z',
    activated: false,
  }

  it('stays open, with what is left, while the house is not set up', () => {
    h.onboarding = { progress: readNotCurrent, isLoading: false, isError: false }
    renderSidebar()
    expect(getStarted()).toHaveTextContent('3/5')
    fireEvent.click(getStarted()!)
    expect(screen.getByText('Make your menu current')).toBeInTheDocument()
    expect(screen.getByText('Set a low-stock number')).toBeInTheDocument()
    expect(screen.getByText('3/5 complete')).toBeInTheDocument()
  })

  it('closes once every step is done, whether or not the row was stamped', () => {
    h.onboarding = {
      progress: { ...readNotCurrent, menu_current: true, threshold_configured: true, activated: true, completed_at: null },
      isLoading: false,
      isError: false,
    }
    renderSidebar()
    expect(getStarted()).toBeNull()
    expect(screen.getByRole('button', { name: /Learn & Help/ })).toBeInTheDocument()
  })
})
