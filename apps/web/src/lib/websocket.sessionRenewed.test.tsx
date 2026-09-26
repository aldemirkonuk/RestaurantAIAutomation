/**
 * ADR 0225: a password change closes this session's socket at the gateway (it
 * was opened with a token the change ended). When the new pair is stored, the
 * provider must open a new socket with the NEW token; a socket.io client does
 * not reconnect by itself after a server-side disconnect.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import { WebSocketProvider } from './websocket'
import { storeRenewedSession } from './sessionRenewed'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: '11111111-1111-4111-8111-111111111111' },
    activeRestaurantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }),
}))

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    const handlers: Record<string, unknown> = {}
    return {
      on: vi.fn((e: string, h: unknown) => (handlers[e] = h)),
      off: vi.fn(),
      emit: vi.fn(),
      close: vi.fn(),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(),
      connected: false,
      io: { on: vi.fn(), off: vi.fn() },
    }
  }),
}))

beforeEach(() => {
  localStorage.clear()
  vi.mocked(io).mockClear()
})

describe('WebSocketProvider after a password change', () => {
  it('opens a new socket with the renewed token', () => {
    localStorage.setItem('accessToken', 'old-access')
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WebSocketProvider>
          <div />
        </WebSocketProvider>
      </QueryClientProvider>,
    )
    const tokens = () =>
      vi.mocked(io).mock.calls.map((c) => (c[1] as { auth: { token: string } }).auth.token)
    expect(tokens()).toEqual(['old-access'])

    act(() => {
      storeRenewedSession({ accessToken: 'new-access', refreshToken: 'new-refresh' })
    })

    expect(tokens()).toEqual(['old-access', 'new-access'])
  })
})
