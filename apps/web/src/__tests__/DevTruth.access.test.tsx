import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * /dev/truth is for developers only (founder, 2026-09-29: "only devs can open
 * it"; option text "Gate it like /dev-sandbox so only developers (your earlier
 * F3 answer: devs approve and certify) can open it; customers never see it.").
 *
 * The gate is the Studio `developer` role through ProtectedRoute, the same
 * mechanism /studio/queue and /studio/certify (where devs approve and certify)
 * use, with the developer role only (they also admit review_admin; this page
 * does not). The gateway refuses non-developers too (dev-truth.controller.spec.ts);
 * this file pins the browser half and the two request-shape hardenings.
 */

let mockUser: Record<string, unknown> = {}
const mockGet = vi.fn()
vi.mock('../services/api/client', () => ({
  apiClient: { get: (...a: unknown[]) => mockGet(...a) },
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, loading: false, isAuthenticated: true }),
}))

import DevTruth, { DEV_TRUTH_STUDIO_ROLES } from '../pages/DevTruth'
import { ProtectedRoute } from '../components/ProtectedRoute'

const HOUSE = '11111111-1111-4111-8111-111111111111'

const renderGated = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/dev/truth${search}`]}>
      <ProtectedRoute requiredStudioRole={[...DEV_TRUTH_STUDIO_ROLES]}>
        <DevTruth />
      </ProtectedRoute>
    </MemoryRouter>,
  )

beforeEach(() => {
  mockGet.mockReset()
  mockGet.mockImplementation(() => new Promise(() => {}))
})

describe('/dev/truth is developers only', () => {
  it('the route in App.tsx is wrapped in the developer gate', () => {
    // App.tsx lazy-loads DevTruth, so it spells the roles out rather than
    // importing the constant (a static import would un-lazy the page); this
    // pins the two to each other.
    const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8')
    const line = app.split('\n').find((l) => l.includes('path="/dev/truth"')) ?? ''
    expect(line).toContain(
      "<ProtectedRoute requiredStudioRole={['developer']}><DevTruth /></ProtectedRoute>",
    )
    expect([...DEV_TRUTH_STUDIO_ROLES]).toEqual(['developer'])
  })

  it.each([
    ['an owner with no studio role', { role: 'owner', studioRoles: [] }],
    ['a manager', { role: 'manager', studioRoles: [] }],
    ['a certified contributor', { role: 'staff', studioRoles: ['certified_contributor'] }],
  ])('%s is refused and nothing is requested', (_n, extra) => {
    mockUser = { restaurantId: HOUSE, emailVerified: true, ...extra }
    renderGated()
    expect(screen.getByText(/Studio Access Required/i)).toBeInTheDocument()
    expect(screen.queryByText(/dev \/ truth/)).not.toBeInTheDocument()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('a developer opens it', async () => {
    mockUser = { restaurantId: HOUSE, emailVerified: true, role: 'owner', studioRoles: ['developer'] }
    renderGated()
    expect(screen.getByText(/dev \/ truth/)).toBeInTheDocument()
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(`/analytics/dev/reach/${HOUSE}`),
    )
  })
})

describe('/dev/truth request shape', () => {
  beforeEach(() => {
    mockUser = { restaurantId: HOUSE, emailVerified: true, studioRoles: ['developer'] }
  })

  it('an unknown ?tab never reaches the URL; it falls back to reach', async () => {
    renderGated('?tab=../x')
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    for (const [url] of mockGet.mock.calls) {
      expect(String(url)).not.toContain('..')
      expect(String(url)).toBe(`/analytics/dev/reach/${HOUSE}`)
    }
  })

  it('?r is encoded as one path segment', async () => {
    renderGated('?tab=swallow&r=' + encodeURIComponent('../../auth/me?x=1'))
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    expect(mockGet.mock.calls[0][0]).toBe(
      `/analytics/dev/swallow/${encodeURIComponent('../../auth/me?x=1')}`,
    )
  })
})
