/**
 * r65 F2: a session in no house (a first sign-in, before the first house
 * exists) opens no socket; it opens one when a house does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import { WebSocketProvider } from './websocket'

let house: string | null = null
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: '11111111-1111-4111-8111-111111111111' },
    activeRestaurantId: house,
  }),
}))

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    close: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    connected: false,
    io: { on: vi.fn(), off: vi.fn() },
  })),
}))

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <WebSocketProvider>
        <div />
      </WebSocketProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('accessToken', 'a-token')
  vi.mocked(io).mockClear()
})

describe('WebSocketProvider without a house', () => {
  it('opens no socket for a signed-in person in no house', () => {
    house = null
    mount()
    expect(io).not.toHaveBeenCalled()
  })

  it('opens a socket once a house exists', async () => {
    house = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    mount()
    await waitFor(() => expect(io).toHaveBeenCalledTimes(1))
  })
})
