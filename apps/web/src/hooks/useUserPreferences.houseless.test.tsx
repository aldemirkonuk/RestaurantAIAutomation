import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/**
 * A person with no house yet (onboarding, /get-started) has no preferences the
 * gateway will serve: it refuses the read (403), twice, on every load. The
 * page now asks only once there is a house, so there is no request and no
 * refusal to explain.
 */

const h = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }))
vi.mock('../services/api/client', () => ({
  apiClient: { get: h.get, patch: h.patch },
}))

import { useUserPreferences } from './useUserPreferences'
import { useAuthStore } from '../stores/authStore'

const U = '11111111-1111-4111-8111-111111111111'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}
const asUser = (restaurantId: string, activeRestaurantId: string | null = null) =>
  useAuthStore.setState({
    user: { userId: U, email: 'p@house.test', restaurantId } as never,
    activeRestaurantId,
  })

beforeEach(() => {
  h.get.mockReset()
  h.get.mockResolvedValue({ data: { preferences: {} } })
})

describe('useUserPreferences for a person with no house', () => {
  it('sends no preferences request until the person has a house', async () => {
    asUser('')
    renderHook(() => useUserPreferences(), { wrapper: wrapper() })
    await new Promise((r) => setTimeout(r, 30))
    expect(h.get).not.toHaveBeenCalled()
  })

  it('asks once the user has a house', async () => {
    asUser(A)
    renderHook(() => useUserPreferences(), { wrapper: wrapper() })
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1))
    expect(h.get).toHaveBeenCalledWith(`/users/${U}/preferences`)
  })

  it('asks once a house is opened in this session (the store user is still the houseless read)', async () => {
    asUser('', A)
    renderHook(() => useUserPreferences(), { wrapper: wrapper() })
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1))
  })
})
