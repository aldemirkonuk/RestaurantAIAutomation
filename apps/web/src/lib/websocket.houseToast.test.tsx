/**
 * ADR 0262 (scope, F-124): a toast is raised by the client that did the act,
 * never by a room broadcast. Every business event on this socket is a room
 * broadcast, so none of them toasts; each still nudges what it nudged before.
 * F-522 (another house's notice never toasted here) is the narrower case of
 * the same rule and stays pinned.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import { toast } from 'sonner'
import { WebSocketProvider } from './websocket'

const HERE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: '11111111-1111-4111-8111-111111111111' },
    activeRestaurantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }),
}))

const handlers = vi.hoisted(() => ({} as Record<string, (p: unknown) => void>))
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn((e: string, h: (p: unknown) => void) => (handlers[e] = h)),
    off: vi.fn(),
    emit: vi.fn(),
    close: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    connected: false,
    io: { on: vi.fn(), off: vi.fn() },
  })),
}))

vi.mock('sonner', () => {
  const t = Object.assign(vi.fn(), {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  })
  return { toast: t }
})

const shown = () =>
  [toast.info, toast.success, toast.warning, toast.error].flatMap((f) =>
    vi.mocked(f).mock.calls.map((c) => c[0]),
  )

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('accessToken', 'tok')
  vi.mocked(io).mockClear()
  for (const f of [toast.info, toast.success, toast.warning, toast.error]) vi.mocked(f).mockClear()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WebSocketProvider>
        <div />
      </WebSocketProvider>
    </QueryClientProvider>,
  )
})

const notice = (house: string | undefined, title: string) => ({
  event: 'NewNotification',
  data: {
    title,
    message: 'The delivery is late.',
    type: 'warning',
    action_url: '/orders/o1',
    ...(house ? { restaurant_id: house } : {}),
  },
  timestamp: '2026-10-09T12:00:00Z',
})

describe('notification:new is the bell\'s, never a toast (ADR 0262, F-124 / F-522)', () => {
  it('does not toast a notification of the house this tab is in, and nudges the bell', () => {
    const nudged = vi.fn()
    window.addEventListener('notification_sent', nudged)
    handlers['notification:new'](notice(HERE, 'Schedule published'))
    window.removeEventListener('notification_sent', nudged)
    expect(shown()).toEqual([])
    expect(nudged).toHaveBeenCalledTimes(1)
  })

  it('does not toast a notification of another house, and still nudges the bell', () => {
    const nudged = vi.fn()
    window.addEventListener('notification_sent', nudged)
    handlers['notification:new'](notice(OTHER, 'Delivery overdue there'))
    window.removeEventListener('notification_sent', nudged)
    expect(shown()).toEqual([])
    expect(nudged).toHaveBeenCalledTimes(1)
  })

  it('does not toast the flat low-stock shape, nor one that names no house', () => {
    handlers['notification:new']({
      type: 'low_stock',
      title: 'Low Stock: Chablis',
      body: 'Only 2 bottles remaining',
      data: { restaurantId: HERE },
    })
    handlers['notification:new'](notice(undefined, 'No house named'))
    expect(shown()).toEqual([])
  })
})

describe('room events never toast (ADR 0262, F-124)', () => {
  it('another member\'s order, its status change and a low-stock crossing stay off the screen', () => {
    const changed = vi.fn()
    window.addEventListener('order_change', changed)
    handlers['order:created']({
      event: 'OrderCreated',
      data: { order_id: 'o1', wine_name: 'Chablis', quantity: 6, provider_name: 'Kavaklıdere' },
      timestamp: '2026-10-09T12:00:00Z',
    })
    handlers['order:status_changed']({
      event: 'OrderStatusChanged',
      data: { order_id: 'o1', status: 'confirmed', previous_status: 'pending' },
      timestamp: '2026-10-09T12:01:00Z',
    })
    window.removeEventListener('order_change', changed)
    handlers['stock:low']({
      event: 'LowStockAlert',
      data: { wine_id: 'w1', wine_name: 'Chablis', stock_after: 1, threshold: 6, urgency: 'critical' },
      timestamp: '2026-10-09T12:02:00Z',
    })
    expect(shown()).toEqual([])
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('a report, a calendar entry and a system message stay off the screen too', () => {
    handlers['report:ready']({ event: 'ReportReady', data: { report_type: 'weekly', download_url: '/r.pdf' } })
    handlers['calendar:event_created']({ event: 'CalendarEventCreated', data: { title: 'Tasting' } })
    handlers['system:message']({ level: 'error', message: 'Down for upkeep' })
    expect(shown()).toEqual([])
  })
})
