/**
 * F-179: an AI draft waiting for approval sends the owner somewhere. Both
 * places it sent them were 404s: the browser notification opened
 * `/conversations/<id>` and the toast's Review button opened `/dashboard`.
 * Each target must be a route App.tsx declares.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const h = vi.hoisted(() => ({
  handlers: {} as Record<string, (data: unknown) => void>,
  toastInfo: vi.fn(),
  notifications: [] as Array<{ onclick: (() => void) | null }>,
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: '11111111-1111-4111-8111-111111111111' },
    activeRestaurantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }),
}))

vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), {
    info: h.toastInfo,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  })
  return { toast }
})

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn((e: string, fn: (data: unknown) => void) => (h.handlers[e] = fn)),
    off: vi.fn(),
    emit: vi.fn(),
    close: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    connected: false,
    io: { on: vi.fn(), off: vi.fn() },
  })),
}))

import { WebSocketProvider } from './websocket'

const realLocation = window.location
const realNotification = (globalThis as { Notification?: unknown }).Notification

beforeEach(() => {
  localStorage.setItem('accessToken', 'a')
  h.toastInfo.mockReset()
  h.notifications.length = 0
  Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/' } })
  class FakeNotification {
    static permission = 'granted'
    onclick: (() => void) | null = null
    constructor() {
      h.notifications.push(this)
    }
  }
  vi.stubGlobal('Notification', FakeNotification)
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  vi.unstubAllGlobals()
  if (realNotification === undefined) delete (globalThis as { Notification?: unknown }).Notification
  localStorage.clear()
})

function approvalArrives() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WebSocketProvider>
        <div />
      </WebSocketProvider>
    </QueryClientProvider>,
  )
  h.handlers['ai:conversation_approval']({
    conversation_id: 'c1',
    provider_name: 'Vinoteca',
    ai_message: 'Could you hold two cases of the Rioja for Friday?',
    wine_name: 'Rioja',
  })
}

const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')
const routed = (path: string) => app.includes(`<Route path="${path}"`)

describe('an AI draft waiting for approval', () => {
  it('the browser notification opens /communications, a page that exists', () => {
    approvalArrives()
    expect(h.notifications).toHaveLength(1)
    h.notifications[0].onclick!()
    expect(window.location.href).toBe('/communications')
    expect(routed('/communications')).toBe(true)
  })

  it('the toast’s Review opens the dashboard at /, a page that exists', () => {
    approvalArrives()
    const [, opts] = h.toastInfo.mock.calls.find(([title]) => title === '🤖 AI Needs Your Approval')!
    opts.action.onClick()
    expect(window.location.href).toBe('/')
    expect(routed('/')).toBe(true)
  })
})
