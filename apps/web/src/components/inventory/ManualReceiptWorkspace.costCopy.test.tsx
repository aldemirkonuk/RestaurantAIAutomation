/**
 * F-780 (2026-10-10): F-312 hid the cost cells from staff, so the empty
 * receipt must not tell them to set a cost per row. A manager is still asked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ManualReceiptWorkspace } from './ManualReceiptWorkspace'

const mayAct = vi.hoisted(() => ({ value: true }))
vi.mock('../../hooks/useMayActForTheHouse', () => ({
  useMayActForTheHouse: () => mayAct.value,
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r1' }, activeRestaurantId: 'r1' }),
}))
vi.mock('../../hooks/queries', () => ({
  useWines: () => ({ data: [], isFetching: false }),
}))
vi.mock('../../hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [] }),
}))
vi.mock('../../hooks/useStorageLocations', () => ({
  useStorageLocations: () => ({ locations: [] }),
}))

function draw() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ManualReceiptWorkspace isOpen onClose={() => {}} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mayAct.value = true
})

describe('ManualReceiptWorkspace — the empty receipt asks only what the person can set (F-780)', () => {
  it('[REVERT-FAILS] does not ask staff for a cost per row', () => {
    mayAct.value = false
    draw()
    expect(screen.getByText(/Set the quantity and location per row/)).toBeInTheDocument()
    expect(screen.queryByText(/quantity, cost and location/)).not.toBeInTheDocument()
  })

  it('asks a manager for the quantity, cost and location per row', () => {
    draw()
    expect(screen.getByText(/Set the quantity, cost and location per row/)).toBeInTheDocument()
  })
})
