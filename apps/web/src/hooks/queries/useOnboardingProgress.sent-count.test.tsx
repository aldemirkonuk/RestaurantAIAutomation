/**
 * A count held on the device and sent later is the house's count from then on.
 * The setup read must be asked again then, not on the next focus.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const getOnboardingProgress = vi.hoisted(() => vi.fn())
vi.mock('../../services/api/menus', () => ({
  getOnboardingProgress,
  updateOnboardingProgress: vi.fn(),
}))

import { useOnboardingProgress } from './useOnboardingProgress'
import { SPOT_COUNT_SENT_EVENT } from '../../lib/spotCountOutbox'

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, ...renderHook(() => useOnboardingProgress(), { wrapper }) }
}

beforeEach(() => {
  getOnboardingProgress.mockReset()
  getOnboardingProgress.mockResolvedValue({ steps: [] })
})

describe('useOnboardingProgress — a held count that is sent later', () => {
  it('reads the setup again when the outbox says it sent a count', async () => {
    const { result } = setup()
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(getOnboardingProgress).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new CustomEvent(SPOT_COUNT_SENT_EVENT, { detail: { sent: 1 } }))
    })

    await vi.waitFor(() => expect(getOnboardingProgress).toHaveBeenCalledTimes(2))
  })

  it('stops listening when the rail goes away', async () => {
    const { result, unmount } = setup()
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false))
    unmount()

    window.dispatchEvent(new CustomEvent(SPOT_COUNT_SENT_EVENT, { detail: { sent: 1 } }))
    await new Promise((r) => setTimeout(r, 20))

    expect(getOnboardingProgress).toHaveBeenCalledTimes(1)
  })
})
