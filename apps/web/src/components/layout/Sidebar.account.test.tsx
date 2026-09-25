/**
 * Profile / Settings / Connections / Help fold into the lower-left account
 * mark (founder, 2026-09-22). They used to pin under the rail forever.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'

vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react')
  return {
    AuthContext: React.createContext(null),
    useAuth: () => ({
      user: { userId: 'user-1', name: 'Aldemir', role: 'manager', restaurantId: 'rest-1' },
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
  useUnreadCount: () => ({ data: 0 }),
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

describe('Sidebar — account cluster', () => {
  it('does not pin Profile, Settings, Connections or Help on the rail', () => {
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Connections' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Help & Support' })).toBeNull()
  })

  it('opens those four from the lower-left account mark', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const menu = screen.getByRole('menu', { name: 'Account' })
    expect(menu.querySelector('a[href="/profile"]')).toBeTruthy()
    expect(menu.querySelector('a[href="/settings"]')).toBeTruthy()
    expect(menu.querySelector('a[href="/connections"]')).toBeTruthy()
    expect(menu.querySelector('a[href="/help"]')).toBeTruthy()
  })

  it('keeps the 24px wordmark and a smaller industry line', () => {
    renderSidebar()
    expect(screen.getByRole('img', { name: 'Mudavym' })).toBeInTheDocument()
    expect(screen.getByText('for restaurants')).toBeInTheDocument()
    expect(screen.queryByText('Inventory Intelligence')).toBeNull()
  })
})
