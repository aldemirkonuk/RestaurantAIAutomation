/**
 * The owner's way through /register is account-only (ADR 0213): the account
 * is made, the mail outcome is noted by registerAccount, and the house is
 * opened afterwards on /get-started. The page once also carried a second,
 * restaurant-details step (registerRestaurant) that nothing ever opened -
 * setPathBStep(2) was never called - so the mail-outcome note beside it never
 * ran from the UI either. These two checks keep that dead path from coming
 * back unreachable again.
 */
import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  registerAccount: vi.fn(),
  get: vi.fn(),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ registerAccount: h.registerAccount, joinViaInvite: vi.fn(), error: null }),
}))
vi.mock('../../services/api/client', () => ({ apiClient: { get: h.get } }))
vi.mock('../../components/auth/GoogleSignInButton', () => ({ GoogleSignInButton: () => null }))

import { Register } from '../Register'

describe('the owner path through /register', () => {
  it('makes the account, then goes to verify-email - no restaurant form in between', async () => {
    h.get.mockResolvedValue({ data: { available: true, email: 'x' } })
    h.registerAccount.mockResolvedValue(undefined)
    render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/register?type=new'] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/register', element: createElement(Register) }),
          createElement(Route, { path: '/verify-email', element: createElement('p', null, 'VERIFY PAGE') }),
        ),
      ),
    )
    fireEvent.change(await screen.findByLabelText('Full Name *'), { target: { value: 'Deniz Kaya' } })
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'deniz@house.test' } })
    fireEvent.change(screen.getByLabelText('Password *'), { target: { value: 'long-enough-1' } })
    fireEvent.change(screen.getByLabelText('Confirm Password *'), { target: { value: 'long-enough-1' } })
    await screen.findByText('Email is available', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    await screen.findByText('VERIFY PAGE', undefined, { timeout: 3000 })
    await waitFor(() =>
      expect(h.registerAccount).toHaveBeenCalledWith({
        name: 'Deniz Kaya',
        email: 'deniz@house.test',
        password: 'long-enough-1',
      }),
    )
    expect(screen.queryByText(/create restaurant/i)).toBeNull()
  })

  it('carries no restaurant step of its own: registerRestaurant is not called from this page', () => {
    const src = readFileSync(resolve(__dirname, '../Register.tsx'), 'utf8')
    expect(src).not.toMatch(/registerRestaurant/)
    expect(src).not.toMatch(/PathBStep/)
  })
})
