/**
 * Regression test for the exhaustive-deps fix on RecurringOrders.
 *
 * The mount effect depends on [restaurantId, fetchRecurringOrders], and
 * fetchRecurringOrders is a useCallback([restaurantId]). If that memoization
 * regressed (e.g. fetchRecurringOrders became a per-render function in the
 * dep array), the effect would re-run on every render the fetch's setState
 * triggers — an infinite fetch loop. This test locks in "fetch exactly once".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'rest-1' } }),
}))

vi.mock('../../components/layout/Header', () => ({
  Header: () => null,
}))

import axios from 'axios'
import { RecurringOrders } from '../../pages/RecurringOrders'

describe('RecurringOrders — exhaustive-deps regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(axios.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] })
  })

  it('fetches recurring orders exactly once on mount (no render loop)', async () => {
    render(<RecurringOrders />)

    // Wait until the initial fetch has fired.
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledTimes(1)
    })

    // Let any state-driven re-renders settle; a mis-keyed effect would keep
    // firing here. The count must remain exactly 1.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(axios.get).toHaveBeenCalledTimes(1)
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/recurring-orders/rest-1'),
    )
  })
})
