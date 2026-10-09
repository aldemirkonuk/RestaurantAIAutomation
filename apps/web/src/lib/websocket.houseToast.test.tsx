/**
 * F-522: a person in two houses gets both houses' notifications on one
 * socket. A notification of another house is never toasted on this one (no
 * label, and a View link into the other house under this house's name); one
 * of this house, or one that names no house, is.
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

describe('notification:new across houses (F-522)', () => {
  it('toasts a notification of the house this tab is in', () => {
    handlers['notification:new'](notice(HERE, 'Delivery overdue here'))
    expect(shown()).toEqual(['Delivery overdue here'])
  })

  it('does not toast a notification of another house, and still nudges the bell', () => {
    const nudged = vi.fn()
    window.addEventListener('notification_sent', nudged)
    handlers['notification:new'](notice(OTHER, 'Delivery overdue there'))
    window.removeEventListener('notification_sent', nudged)
    expect(shown()).toEqual([])
    expect(nudged).toHaveBeenCalledTimes(1)
  })

  it('reads the house off the flat low-stock shape too', () => {
    handlers['notification:new']({
      type: 'low_stock',
      title: 'Low Stock: Chablis',
      body: 'Only 2 bottles remaining',
      data: { restaurantId: OTHER },
    })
    expect(shown()).toEqual([])
  })

  it('a notification that names no house is shown as before', () => {
    handlers['notification:new'](notice(undefined, 'No house named'))
    expect(shown()).toEqual(['No house named'])
  })
})
