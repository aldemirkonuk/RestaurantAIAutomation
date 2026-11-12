import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BatchReceiveGrid, type BatchReceiveRow } from './BatchReceiveGrid'

/**
 * r56 (2026-11-12): the batch-receive grid printed its total with a
 * hard-coded `$` and put a `$` beside every cost cell, so a lira house typed
 * lira into a dollar field. Both now come from the house's currency read.
 */
const house = vi.hoisted(() => ({ code: 'TRY' as string | null }))
vi.mock('../../services/api/settings', () => ({
  settingsApi: {
    houseCurrency: async () => ({
      restaurantId: 'r1',
      code: house.code,
      country: null,
      readable: true,
      reason: null,
      statedAt: null,
    }),
  },
}))
vi.mock('../../hooks/useStorageLocations', () => ({ useStorageLocations: () => ({ locations: [] }) }))

const row: BatchReceiveRow = {
  key: 'r1',
  wineId: 'w1',
  name: 'Local Check Rose',
  quantity: 2,
  cost: '125',
  isSample: false,
  selected: false,
}

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BatchReceiveGrid rows={[row]} onChange={() => {}} />
    </QueryClientProvider>,
  )
}

describe('BatchReceiveGrid — the house’s money', () => {
  it('a lira house: the cost cell says TRY, the total is in lira, and no dollar sign anywhere', async () => {
    house.code = 'TRY'
    const { container } = mount()
    await waitFor(() => expect(screen.getByTestId('batch-cost-currency')).toHaveTextContent('TRY'))
    expect(container).toHaveTextContent('TRY 250')
    expect(container.textContent).not.toContain('$')
  })

  it('no recorded currency: no code beside the cost, a plain total, never a dollar sign', async () => {
    house.code = null
    const { container } = mount()
    await waitFor(() => expect(container.textContent).toMatch(/across 1 wine\s*250/))
    expect(screen.queryByTestId('batch-cost-currency')).not.toBeInTheDocument()
    expect(container.textContent).not.toContain('$')
  })
})
