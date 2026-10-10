/**
 * Profile / Settings / Connections / Help fold into the lower-left account
 * mark (founder, 2026-09-22). They used to pin under the rail forever.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'

const h = vi.hoisted(() => ({ logout: vi.fn() }))

vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react')
  return {
    AuthContext: React.createContext(null),
    useAuth: () => ({
      user: { userId: 'user-1', name: 'Aldemir', role: 'manager', restaurantId: 'rest-1' },
      logout: h.logout,
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

describe('Sidebar — a chosen sign-out (F-438)', () => {
  function SignIn() {
    const loc = useLocation()
    return <div data-testid="sign-in">{JSON.stringify(loc.state)}</div>
  }

  it('opens a clean sign-in, carrying no page for the next person', async () => {
    h.logout.mockResolvedValueOnce(true)
    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/login" element={<SignIn />} />
          <Route path="*" element={<Sidebar />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }))
    await waitFor(() => expect(screen.getByTestId('sign-in')).toHaveTextContent('null'))
  })

  it('stays put when the person keeps their unsent changes', async () => {
    h.logout.mockResolvedValueOnce(false)
    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/login" element={<SignIn />} />
          <Route path="*" element={<Sidebar />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }))
    await waitFor(() => expect(h.logout).toHaveBeenCalled())
    expect(screen.queryByTestId('sign-in')).toBeNull()
  })
})
