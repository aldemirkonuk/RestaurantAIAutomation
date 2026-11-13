import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '../../../stores/authStore'

const A = '10ca1c4e-0000-4000-8000-00000000000a'
const B = '10ca1c4e-0000-4000-8000-00000000000b'
const CODE: Record<string, string> = { [A]: 'TRY', [B]: 'EUR' }

// The gateway answers for the house the session names, as it does live.
const { houseCurrency } = vi.hoisted(() => ({ houseCurrency: vi.fn() }))
vi.mock('../../../services/api/settings', () => ({ settingsApi: { houseCurrency } }))

import { houseCurrencyKey, useHouseCurrency } from './house-money'

describe('useHouseCurrency is keyed by house (r7, 2026-11-12)', () => {
  beforeEach(() => {
    houseCurrency.mockReset()
    houseCurrency.mockImplementation(async () => ({
      readable: true,
      code: CODE[useAuthStore.getState().activeRestaurantId ?? ''] ?? null,
      country: null,
    }))
    useAuthStore.setState({ activeRestaurantId: A })
  })

  it('puts the house in the key', () => {
    expect(houseCurrencyKey(A)).toEqual(['settings', 'currency', A])
    expect(houseCurrencyKey(null)).toEqual(['settings', 'currency', null])
  })

  it("never shows the last house's currency after a switch, even with the cache kept", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useHouseCurrency(), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ state: 'recorded', code: 'TRY' }))

    // A switch whose cache reset did not reach this read (a read in flight, or
    // a path that forgets nothing): the old house's answer is still cached.
    act(() => useAuthStore.setState({ activeRestaurantId: B }))
    expect(result.current).not.toEqual({ state: 'recorded', code: 'TRY' })
    await waitFor(() => expect(result.current).toEqual({ state: 'recorded', code: 'EUR' }))
    expect(houseCurrency).toHaveBeenCalledTimes(2)
  })
})
