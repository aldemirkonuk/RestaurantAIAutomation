/**
 * F-256 — the rail's Notifications badge and the bell print one count.
 *
 * The rail ran its own 30 s poll that nothing invalidated: after "Rule all off"
 * the bell was empty while the rail still read 99+, and a failed read turned
 * into 0, so the badge vanished while the bell drew its hollow "unknown" mark.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { publishUnreadCount, resetSharedUnreadCount } from '../../lib/mudavym/unreadCount'

vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react')
  return {
    AuthContext: React.createContext(null),
    useAuth: () => ({
      user: { userId: 'user-1', name: 'Ada', role: 'manager', restaurantId: 'rest-1' },
      activeRestaurantId: 'rest-1',
      logout: vi.fn(),
    }),
  }
})

vi.mock('../../hooks/queries/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({
    progress: { completed_at: '2026-01-01', checklist_dismissed: true },
    update: vi.fn(),
  }),
}))

const railPoll = vi.hoisted(() => ({ current: { data: 140 } as Record<string, unknown> }))
vi.mock('../../hooks/queries/useNotificationQueries', () => ({
  useUnreadCount: () => railPoll.current,
}))

vi.mock('../../hooks/queries/useOrderQueries', () => ({
  usePendingOrdersCount: () => ({ data: 0 }),
}))

vi.mock('../../hooks/queries/useInventoryQueries', () => ({
  useLowStockItems: () => ({ data: [] }),
}))

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  resetSharedUnreadCount()
  railPoll.current = { data: 140 }
})

describe('Sidebar — the Notifications badge', () => {
  it('follows the count the bell last read, not its own older poll', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Notifications, 140 pending' })).toBeInTheDocument()

    // The bell rules everything off and re-reads: zero.
    act(() => publishUnreadCount({ restaurantId: 'rest-1', count: 0, note: null }))
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.queryByText('99+')).not.toBeInTheDocument()
  })

  it('says the count could not be read when the bell could not read it', () => {
    renderSidebar()
    act(() =>
      publishUnreadCount({ restaurantId: 'rest-1', count: null, note: 'The unread count could not be read.' }),
    )
    expect(
      screen.getByRole('link', { name: 'Notifications, the count could not be read' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('nav-badge-unknown')).toBeInTheDocument()
  })

  it('shows unknown, not nothing, when its own read fails', () => {
    railPoll.current = { data: undefined, isError: true }
    renderSidebar()
    expect(
      screen.getByRole('link', { name: 'Notifications, the count could not be read' }),
    ).toBeInTheDocument()
  })

  it('ignores a count read for another house', () => {
    renderSidebar()
    act(() => publishUnreadCount({ restaurantId: 'rest-2', count: 3, note: null }))
    expect(screen.getByRole('link', { name: 'Notifications, 140 pending' })).toBeInTheDocument()

    // ...while a count read for this house still lands
    act(() => publishUnreadCount({ restaurantId: 'rest-1', count: 5, note: null }))
    expect(screen.getByRole('link', { name: 'Notifications, 5 pending' })).toBeInTheDocument()
  })
})
