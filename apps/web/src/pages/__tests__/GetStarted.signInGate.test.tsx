/**
 * Opening a house needs a signed-in, verified person (F-439). Signed out, the
 * page used to show step 01 and answer a save with a bare "Unauthorized".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const h = vi.hoisted(() => ({
  auth: { user: null as null | Record<string, unknown>, loading: false, createFirstHouse: vi.fn() },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({ apiClient: { patch: vi.fn() } }))
vi.mock('../../components/brand/BrandMark', () => ({
  BrandMark: () => <span>Mudavym</span>,
}))

import GetStarted from '../GetStarted'

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/get-started']}>
      <Routes>
        <Route path="/get-started" element={<GetStarted />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  h.auth.user = null
  h.auth.loading = false
})

describe('GetStarted — who may open a house', () => {
  it('sends a signed-out visitor to sign in, and back here after', () => {
    mount()
    expect(screen.getByTestId('where').textContent).toBe('/login?redirect=/get-started')
    expect(screen.queryByRole('heading', { name: /Welcome/ })).toBeNull()
  })

  it('sends an unverified person to verify their email first', () => {
    h.auth.user = { name: 'Selin Kaya', emailVerified: false }
    mount()
    expect(screen.getByTestId('where').textContent).toBe('/verify-email')
  })

  it('shows step 01 to a verified person, with their name', () => {
    h.auth.user = { name: 'Selin Kaya', emailVerified: true }
    mount()
    expect(screen.getByRole('heading', { name: /Welcome, Selin/ })).toBeInTheDocument()
  })

  it('waits while the session is still being read', () => {
    h.auth.loading = true
    mount()
    expect(screen.queryByTestId('where')).toBeNull()
  })
})
