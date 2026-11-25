/**
 * r107 mail-gap g5: the sidebar tells you mail is waiting. The Communications
 * entry carries the number of people waiting on the house, read from the SAME
 * GET /mail/summary the Mail tab reads (one cache entry, no new endpoint), says
 * "waiting on the house" to every role and never "on you", hides at 0, and adds
 * no request when the summary is already cached.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../services/api/client', () => ({ apiClient: api }))

const auth = vi.hoisted(() => ({ role: 'manager' }))
vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react')
  return {
    AuthContext: React.createContext(null),
    useAuth: () => ({
      user: { userId: 'user-1', name: 'Ada', role: auth.role, restaurantId: 'rest-1' },
      activeRestaurantId: 'rest-1',
      activeRole: auth.role,
      logout: vi.fn(),
    }),
  }
})
vi.mock('../../hooks/queries/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ progress: { completed_at: '2026-01-01', checklist_dismissed: true }, update: vi.fn() }),
}))
vi.mock('../../hooks/queries/useNotificationQueries', () => ({ useUnreadCount: () => ({ data: 0 }) }))
vi.mock('../../hooks/queries/useOrderQueries', () => ({ usePendingOrdersCount: () => ({ data: 0 }) }))
vi.mock('../../hooks/queries/useInventoryQueries', () => ({ useLowStockItems: () => ({ data: [] }) }))

import { Sidebar } from './Sidebar'
import { mailKeys } from '../../pages/communications/next/useMailData'
import { waitingOn } from '../../pages/communications/next/mail-format'
import { SIDEBAR_WAITING_ON } from '../../pages/communications/next/useMailWaiting'

const summary = (waitingPeople: number) => ({ waitingPeople })

function mount(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return qc
}

const summaryCalls = () => api.get.mock.calls.filter(([u]) => u === '/mail/summary').length

beforeEach(() => {
  auth.role = 'manager'
  api.get.mockReset()
})

describe('Sidebar — Communications badge', () => {
  it('shares the Mail tab cache entry and the house-words', () => {
    expect(mailKeys.summary('rest-1')).toEqual(['mail-summary', 'rest-1'])
    expect(SIDEBAR_WAITING_ON).toBe(waitingOn(false))
  })

  it('shows how many are waiting on the house, in the link name', async () => {
    api.get.mockResolvedValue({ data: summary(3) })
    mount()
    expect(await screen.findByRole('link', { name: 'Communications, 3 waiting on the house' })).toBeInTheDocument()
  })

  it('says "on the house" to staff too, never "on you"', async () => {
    auth.role = 'staff'
    api.get.mockResolvedValue({ data: summary(2) })
    mount()
    const link = await screen.findByRole('link', { name: 'Communications, 2 waiting on the house' })
    expect(link.getAttribute('aria-label')).not.toMatch(/on you|pending/)
  })

  it('draws no badge at 0 or when the summary could not be read', async () => {
    api.get.mockResolvedValue({ data: summary(0) })
    mount()
    await waitFor(() => expect(summaryCalls()).toBe(1))
    expect(screen.getByRole('link', { name: 'Communications' })).toBeInTheDocument()
  })

  it('a failed summary draws no badge', async () => {
    api.get.mockRejectedValue(new Error('503'))
    mount()
    await waitFor(() => expect(summaryCalls()).toBe(1))
    expect(screen.getByRole('link', { name: 'Communications' })).toBeInTheDocument()
  })

  it('adds no request when the summary is already cached', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(mailKeys.summary('rest-1'), summary(4))
    mount(qc)
    expect(await screen.findByRole('link', { name: 'Communications, 4 waiting on the house' })).toBeInTheDocument()
    expect(summaryCalls()).toBe(0)
  })

  it('says what Communications is now, in its hover note', async () => {
    api.get.mockResolvedValue({ data: summary(0) })
    mount()
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Communications' }))
    expect(await screen.findByText('Mail with vendors, your team and guests, and the letters you send.', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/classified and ready to reply/)
  })
})
