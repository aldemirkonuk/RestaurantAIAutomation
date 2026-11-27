/**
 * r108 DD-r108-12: the line under the email field has a slot that is there
 * before the check, while it runs and after it, so "Email is available" (500 ms
 * after blur) moves nothing below it (the r108 walk measured the password box
 * going down 20 px, CLS 0.0077). No exit element, and under reduced motion the
 * line is not drawn from a faded or lifted start. jsdom has no layout: the slot
 * is pinned by its identity, its height class and its place.
 */
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ registerAccount: vi.fn(), joinViaInvite: vi.fn(), error: null }),
}))
const get = vi.hoisted(() => vi.fn())
vi.mock('../../services/api/client', () => ({ apiClient: { get } }))
vi.mock('../../components/auth/GoogleSignInButton', () => ({ GoogleSignInButton: () => null }))

import { Register } from '../Register'

const src = readFileSync(resolve(process.cwd(), 'src/pages/Register.tsx'), 'utf8')

function mountCreate() {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: ['/register?type=new'] },
      createElement(Routes, null, createElement(Route, { path: '/register', element: createElement(Register) })),
    ),
  )
}

function reduced(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('reduce'), media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear() } catch { /* none */ }
  get.mockReset()
  get.mockResolvedValue({ data: { available: true, email: 'x' } })
  reduced(false)
})
afterEach(() => { cleanup(); reduced(false) })

describe('the email availability slot (Register, create)', () => {
  it('is in the page before the check, and the same element holds the line after it', async () => {
    mountCreate()
    const before = screen.getByTestId('email-availability-slot')
    expect(before.className).toMatch(/\bmin-h-5\b/)
    expect(before.textContent).toBe('')
    fireEvent.change(screen.getByPlaceholderText('john@myrestaurant.com'), { target: { value: 'a@b.co' } })
    await waitFor(() => expect(screen.getByText('Email is available')).toBeTruthy(), { timeout: 3000 })
    const after = screen.getByTestId('email-availability-slot')
    expect(after).toBe(before)
    expect(after.contains(screen.getByText('Email is available'))).toBe(true)
    expect(after.className).toBe(before.className)
  })

  it('has no exit: when the address changes the line is gone at once', async () => {
    mountCreate()
    const input = screen.getByPlaceholderText('john@myrestaurant.com')
    fireEvent.change(input, { target: { value: 'a@b.co' } })
    await waitFor(() => expect(screen.getByText('Email is available')).toBeTruthy(), { timeout: 3000 })
    fireEvent.change(input, { target: { value: 'a' } })
    await waitFor(() => expect(screen.queryByText('Email is available')).toBeNull(), { timeout: 3000 })
    expect(screen.getByTestId('email-availability-slot').textContent).toBe('')
  })

  it('under reduced motion the line is first drawn as it stays: no faded or lifted start', async () => {
    reduced(true)
    mountCreate()
    // The style the line carries the moment it enters the page, before any animation frame.
    const seen: string[] = []
    const watch = new MutationObserver(() => {
      const p = Array.from(document.querySelectorAll('p')).find((n) => n.textContent === 'Email is available')
      if (p && seen.length === 0) seen.push(p.getAttribute('style') ?? '')
    })
    watch.observe(document.body, { childList: true, subtree: true })
    fireEvent.change(screen.getByPlaceholderText('john@myrestaurant.com'), { target: { value: 'quiet@b.co' } })
    await screen.findByText('Email is available', {}, { timeout: 3000 })
    watch.disconnect()
    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toMatch(/opacity: 0|translate/)
  })

  it('a taken address says so inside the same slot', async () => {
    get.mockResolvedValue({ data: { available: false, email: 'x' } })
    mountCreate()
    fireEvent.change(screen.getByPlaceholderText('john@myrestaurant.com'), { target: { value: 'a@b.co' } })
    const line = await screen.findByText(/already registered/, {}, { timeout: 3000 })
    expect(screen.getByTestId('email-availability-slot').contains(line)).toBe(true)
  })
})

describe('both forms use the slot, neither keeps an exit', () => {
  it('join and create each draw EmailAvailabilityLine; no AnimatePresence or exit sits on the line', () => {
    expect(src.match(/<EmailAvailabilityLine /g)?.length).toBe(2)
    const line = src.slice(src.indexOf('function EmailAvailabilityLine'), src.indexOf('THE HOUSE PATH'))
    expect(line).not.toMatch(/AnimatePresence|exit=/)
  })
})
