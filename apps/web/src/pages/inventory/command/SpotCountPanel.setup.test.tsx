/**
 * The legacy spot-count panel: a count the gateway took is a step of the
 * house's setup, so the setup is read again. A count held on the device is not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const submitSpotCount = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/spotCountOutbox', () => ({
  submitSpotCount,
  newClientCountId: () => 'c-1',
}))
vi.mock('../../../services/api/inventory', () => ({ estimateCountFromPhoto: vi.fn() }))

import { SpotCountPanel } from './SpotCountPanel'

function mount() {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  const onCommitted = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <SpotCountPanel
        item={{ inventoryId: 'inv-1', name: 'Chardonnay', liveStock: 4 } as never}
        onClose={() => {}}
        onCommitted={onCommitted}
      />
    </QueryClientProvider>,
  )
  return { spy, onCommitted }
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /submit count/i }))

beforeEach(() => submitSpotCount.mockReset())

describe('SpotCountPanel — the setup learns of a count', () => {
  it('reads the setup again when the gateway took the count', async () => {
    submitSpotCount.mockResolvedValue({ synced: true })
    const { spy, onCommitted } = mount()
    submit()
    await waitFor(() => expect(onCommitted).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledWith({ queryKey: ['onboarding-progress'] })
  })

  it('does not, for a count held on the device', async () => {
    submitSpotCount.mockResolvedValue({ synced: false })
    const { spy, onCommitted } = mount()
    submit()
    await waitFor(() => expect(onCommitted).toHaveBeenCalled())
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['onboarding-progress'] })
  })
})
