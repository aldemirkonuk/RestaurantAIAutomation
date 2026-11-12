/**
 * Get started is the house's setup, run by an owner or a manager (OB-1).
 * An invitee on staff lands on a rail with Learn & Help and no "1/4" setup
 * badge, whatever the house's setup says.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'

let role = 'staff'
let progress: Record<string, unknown> | null = null

vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react')
  return {
    AuthContext: React.createContext(null),
    useAuth: () => ({
      user: { userId: 'user-1', name: 'Ada', role, restaurantId: 'rest-1' },
      logout: vi.fn(),
    }),
  }
})

vi.mock('../../hooks/queries/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ progress, update: vi.fn() }),
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

const unfinished = {
  id: null,
  menu_uploaded: true,
  menu_current: false,
  vendor_added: false,
  team_member_invited: true,
  checklist_dismissed: false,
  completed_at: null,
  activated: false,
}

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  )
}

describe('Sidebar — Get started is for the people who run setup', () => {
  beforeEach(() => {
    role = 'staff'
    progress = null
  })

  it('staff in an unfinished house see Learn & Help, not Get started', () => {
    progress = unfinished
    renderSidebar()
    expect(screen.queryByText('Get started')).toBeNull()
    expect(screen.getByText('Learn & Help')).toBeInTheDocument()
  })

  it('staff whose progress read failed still see no setup checklist', () => {
    progress = null
    renderSidebar()
    expect(screen.queryByText('Get started')).toBeNull()
  })

  it('an owner of an unfinished house sees Get started', () => {
    role = 'owner'
    progress = unfinished
    renderSidebar()
    expect(screen.getByText('Get started')).toBeInTheDocument()
    expect(screen.queryByText('Learn & Help')).toBeNull()
  })

  it('a manager who put the checklist away sees Learn & Help', () => {
    role = 'manager'
    progress = { ...unfinished, checklist_dismissed: true }
    renderSidebar()
    expect(screen.queryByText('Get started')).toBeNull()
    expect(screen.getByText('Learn & Help')).toBeInTheDocument()
  })
})
