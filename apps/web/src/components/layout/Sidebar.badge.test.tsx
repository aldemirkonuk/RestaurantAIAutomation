/**
 * The rail's Notifications badge and the bell print the same number (F-266).
 *
 * The bell (components/mudavym/HouseBell.tsx) prints the unread count whole.
 * The rail capped at "99+", so with 150 unread the bell said 150 and the rail
 * said 99+ — two answers to one question on one screen.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar, railBadgeLabel } from './Sidebar'

vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react')
  return {
    AuthContext: React.createContext(null),
    useAuth: () => ({
      user: { userId: 'user-1', name: 'Ada', role: 'manager', restaurantId: 'rest-1' },
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

vi.mock('../../hooks/queries/useNotificationQueries', () => ({
  useUnreadCount: () => ({ data: 150 }),
}))

vi.mock('../../hooks/queries/useOrderQueries', () => ({
  usePendingOrdersCount: () => ({ data: 0 }),
}))

vi.mock('../../hooks/queries/useInventoryQueries', () => ({
  useLowStockItems: () => ({ data: [] }),
}))

describe('rail badge count', () => {
  it('prints the whole number, as the bell does', () => {
    expect(railBadgeLabel(150)).toBe('150')
    expect(railBadgeLabel(7)).toBe('7')
    expect(railBadgeLabel(0)).toBeNull()
  })

  it('shows 150 unread on the Notifications link, not 99+', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /^Notifications/ })
    expect(link).toHaveTextContent('150')
    expect(link).not.toHaveTextContent('99+')
  })
})
