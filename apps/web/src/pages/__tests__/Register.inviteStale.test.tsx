/**
 * The invite check must follow the code in the box (r102 review). Two things
 * were wrong in the validation effect: a card kept showing after the code
 * changed (the old house, with Continue enabled, until the new read landed),
 * and a slower answer for an older code landed last and put its house on
 * the newer code for good.
 */
import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ registerAccount: vi.fn(), joinViaInvite: vi.fn(), error: null }),
}))
vi.mock('../../services/api/client', () => ({ apiClient: { get: h.get } }))
vi.mock('../../components/auth/GoogleSignInButton', () => ({ GoogleSignInButton: () => null }))

import { Register } from '../Register'

const valid = (restaurant: string) => ({
  data: { valid: true, restaurant, city: 'Antalya', inviter: 'Ayse', role: 'waiter' },
})

function mount() {
  render(
    createElement(
      MemoryRouter,
      { initialEntries: ['/register?type=join'] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/register', element: createElement(Register) }),
      ),
    ),
  )
}

describe('the invite check follows the code in the box', () => {
  it('drops the old code\'s card and the enabled Continue the moment the code changes', async () => {
    const pending: Record<string, (v: unknown) => void> = {}
    h.get.mockImplementation((url: string) =>
      url.endsWith('/AAAAAAAA')
        ? Promise.resolve(valid('House A'))
        : new Promise((res) => {
            pending[url] = res
          }),
    )
    mount()
    const box = await screen.findByLabelText('Invite Code')
    fireEvent.change(box, { target: { value: 'AAAAAAAA' } })
    await screen.findAllByText(/House A/, undefined, { timeout: 3000 })
    expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled()

    fireEvent.change(box, { target: { value: 'BBBBBBBB' } })
    // B's read never lands in this test, so the card can only go because the
    // code changed (it leaves through a short exit animation, hence waitFor).
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
    await waitFor(() => expect(screen.queryAllByText(/House A/)).toHaveLength(0))
  })

  it('ignores an answer for an older code that lands after the newer code\'s', async () => {
    const pending: Record<string, (v: unknown) => void> = {}
    h.get.mockImplementation(
      (url: string) =>
        new Promise((res) => {
          pending[url.split('/').pop() as string] = res
        }),
    )
    mount()
    const box = await screen.findByLabelText('Invite Code')
    fireEvent.change(box, { target: { value: 'AAAAAAAA' } })
    await waitFor(() => expect(pending.AAAAAAAA).toBeDefined(), { timeout: 3000 })
    fireEvent.change(box, { target: { value: 'BBBBBBBB' } })
    await waitFor(() => expect(pending.BBBBBBBB).toBeDefined(), { timeout: 3000 })

    await act(async () => {
      pending.BBBBBBBB(valid('House B'))
    })
    await screen.findAllByText(/House B/)
    await act(async () => {
      pending.AAAAAAAA(valid('House A'))
    })
    expect(screen.queryAllByText(/House A/)).toHaveLength(0)
    expect(screen.queryAllByText(/House B/).length).toBeGreaterThan(0)
  })
})
