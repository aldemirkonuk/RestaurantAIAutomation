/**
 * Preview ruling 2026-09-22: Settings / Connections / Help scroll with the
 * rail; the name card is the profile door; the account mark is smaller.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'

vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react')
  return {
    AuthContext: React.createContext(null),
    useAuth: () => ({
      user: { userId: 'user-1', name: 'Aldemir', role: 'owner', restaurantId: 'rest-1' },
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
  it('keeps Settings, Connections and Help inside the scrolling rail', () => {
    renderSidebar()
    const rail = document.querySelector('nav') as HTMLElement
    expect(within(rail).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(within(rail).getByRole('link', { name: 'Connections' })).toHaveAttribute('href', '/connections')
    expect(within(rail).getByRole('link', { name: 'Help & Support' })).toHaveAttribute('href', '/help')
    expect(within(rail).queryByRole('link', { name: 'Profile' })).toBeNull()
  })

  it('opens profile from the name card, not a pinned Profile row', () => {
    renderSidebar()
    const card = screen.getByRole('link', { name: 'Aldemir — your account' })
    expect(card).toHaveAttribute('href', '/profile')
    expect(card.closest('[data-account-cluster]')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull()
  })
})
