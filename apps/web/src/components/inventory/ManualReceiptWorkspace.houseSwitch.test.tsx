/**
 * F-1708: the manual receipt stays mounted on /inventory, and a switch of
 * house does not remount it. "Is KDV inside the costs on this receipt?" was
 * read once, so it followed the house just left: asked at a house whose till
 * prices exclude tax, missing at one whose prices include it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const bulkCreateInventoryItems = vi.fn()
vi.mock('../../services/api/inventory', () => ({
  bulkCreateInventoryItems: (...args: unknown[]) => bulkCreateInventoryItems(...args),
}))
const auth = vi.hoisted(() => ({ house: 'house-tr' }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'u1', restaurantId: 'house-tr' }, activeRestaurantId: auth.house }),
}))
vi.mock('../../hooks/queries', () => ({
  useWines: () => ({ data: [{ id: 'w1', name: 'Barolo Cannubi', producer: 'Brezza' }], isFetching: false }),
}))
vi.mock('../../hooks/queries/useProviderQueries', () => ({ useProviders: () => ({ data: [] }) }))
vi.mock('../../hooks/useStorageLocations', () => ({ useStorageLocations: () => ({ locations: [] }) }))
vi.mock('../../hooks/useMayActForTheHouse', () => ({ useMayActForTheHouse: () => true }))
// Each house's own terms, as the gateway answers for the active house.
const tax = vi.hoisted(() => ({
  getTaxBasis: vi.fn(async () =>
    auth.house === 'house-tr'
      ? { readable: true, basis: 'prices_include_tax', taxWord: 'KDV' }
      : { readable: true, basis: 'prices_exclude_tax', taxWord: 'tax' },
  ),
}))
vi.mock('../../pages/settings/next/TaxBasisSection', () => tax)

import { ManualReceiptWorkspace } from './ManualReceiptWorkspace'

const QUESTION = 'Is KDV inside the costs on this receipt?'

function workspace(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <ManualReceiptWorkspace isOpen onClose={() => {}} />
    </QueryClientProvider>
  )
}

describe('ManualReceiptWorkspace: the tax question belongs to the active house (F-1708)', () => {
  beforeEach(() => {
    auth.house = 'house-tr'
    // A receipt is kept per person and house; each case starts with none.
    window.localStorage.clear()
    window.sessionStorage.clear()
    tax.getTaxBasis.mockClear()
    bulkCreateInventoryItems.mockReset()
    bulkCreateInventoryItems.mockResolvedValue({
      results: [{ index: 0, status: 'stock_added', inventoryItemId: 'i1', wineId: 'w1' }],
    })
  })

  it('[REVERT-FAILS] reads the new house\'s terms after a switch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    const view = render(workspace(client))
    await user.type(screen.getByPlaceholderText(/Search the Master Wine Library/), 'Ba')
    await user.click(await screen.findByText('Barolo Cannubi'))
    await user.type(screen.getByLabelText('Cost per bottle for Barolo Cannubi'), '420')
    expect(await screen.findByText(QUESTION)).toBeTruthy()
    await user.click(screen.getByLabelText('Yes, KDV is inside'))

    // The switch: same mounted screen, another house whose prices exclude tax.
    auth.house = 'house-us'
    view.rerender(workspace(client))

    await waitFor(() => expect(tax.getTaxBasis).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(QUESTION)).toBeNull())
    expect(screen.queryByTestId('cost-tax-choice')).toBeNull()
  })

  it('does not carry the answer given at one house into another\'s save', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    const view = render(workspace(client))
    await user.type(screen.getByPlaceholderText(/Search the Master Wine Library/), 'Ba')
    await user.click(await screen.findByText('Barolo Cannubi'))
    await user.type(screen.getByLabelText('Cost per bottle for Barolo Cannubi'), '420')
    await user.click(await screen.findByLabelText('Yes, KDV is inside'))

    // Away and back: the answer given before the switch is gone.
    auth.house = 'house-us'
    view.rerender(workspace(client))
    await waitFor(() => expect(tax.getTaxBasis).toHaveBeenCalledTimes(2))
    auth.house = 'house-tr'
    view.rerender(workspace(client))
    await waitFor(() => expect(tax.getTaxBasis).toHaveBeenCalledTimes(3))
    expect(await screen.findByText(QUESTION)).toBeTruthy()
    expect((screen.getByLabelText('Yes, KDV is inside') as HTMLInputElement).checked).toBe(false)
  })
})
