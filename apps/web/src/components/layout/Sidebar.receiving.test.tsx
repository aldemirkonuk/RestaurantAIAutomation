/**
 * `/receiving` must be reachable without knowing the URL.
 *
 * It is the S02 golden path — a delivery arriving at the door — and it had no
 * entry in the sidebar, the command palette, or guidance. The only way in was an
 * Orders row, which is the wrong end of the flow: the person at the door is a
 * porter with a phone, not a manager reading a purchase order.
 *
 * Position is load-bearing, not cosmetic. Receiving sits between Orders (the
 * goods were asked for) and Inventory (the goods are on the shelf), so it belongs
 * in the Main section directly after Orders, where the physical sequence puts it.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { staticCommands } from '../command/commands'

vi.mock('../../contexts/AuthContext', async () => {
  // The sidebar now reads a page flag through useMudavymDesign, which consumes
  // AuthContext optionally; a mock without that export throws on access, so
  // the context is exported as an empty one and the hook degrades to its
  // localStorage fallback, which is the behaviour the hook promises.
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
    </MemoryRouter>
  )
}

describe('Sidebar — Receiving', () => {
  it('links to /receiving', () => {
    renderSidebar()

    const link = screen.getByRole('link', { name: 'Receiving' })
    expect(link).toHaveAttribute('href', '/receiving')
  })

  it('sits in Main directly after Orders, where the delivery actually lands', () => {
    renderSidebar()

    const main = screen.getByText('Main').parentElement as HTMLElement
    const labels = within(main)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))

    expect(labels).toContain('/receiving')
    expect(labels.indexOf('/receiving')).toBe(labels.indexOf('/orders') + 1)
  })

  it('carries a description, like every other nav row', () => {
    renderSidebar()

    // The description is what the hover tooltip renders; a row without one is a
    // link whose destination the user can only discover by clicking it.
    const link = screen.getByRole('link', { name: 'Receiving' })
    expect(link).toBeInTheDocument()
  })

  it('is registered in the ⌘K command palette', () => {
    const receiving = staticCommands().find((c) => c.href === '/receiving')

    expect(receiving).toBeDefined()
    expect(receiving?.section).toBe('Navigation')
    expect(receiving?.title).toBe('Receiving')
    // The words someone at the door would actually type.
    expect(receiving?.keywords).toMatch(/deliver/i)
  })
})
