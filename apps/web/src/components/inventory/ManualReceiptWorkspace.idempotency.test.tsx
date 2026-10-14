/**
 * F-566: a bulk receive whose reply never came back must not invite a plain
 * retry, and saving the same lines again must carry the same Idempotency-Key so
 * the gateway replays the first result instead of adding the stock twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const bulkCreateInventoryItems = vi.fn()
vi.mock('../../services/api/inventory', () => ({
  bulkCreateInventoryItems: (...args: unknown[]) => bulkCreateInventoryItems(...args),
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r1' }, activeRestaurantId: 'r1' }),
}))
vi.mock('../../hooks/queries', () => ({
  useWines: () => ({ data: [{ id: 'w1', name: 'Barolo Cannubi', producer: 'Brezza' }], isFetching: false }),
}))
vi.mock('../../hooks/queries/useProviderQueries', () => ({ useProviders: () => ({ data: [] }) }))
vi.mock('../../hooks/useStorageLocations', () => ({ useStorageLocations: () => ({ locations: [] }) }))
// A manager: the cost cells are shown (F-312).
vi.mock('../../hooks/useMayActForTheHouse', () => ({ useMayActForTheHouse: () => true }))
// ADR 0341 F3: the house's tax basis, unset unless a case says otherwise.
const tax = vi.hoisted(() => ({
  getTaxBasis: vi.fn(async () => ({ readable: true, basis: 'unset', taxWord: 'KDV' }) as Record<string, unknown>),
}))
vi.mock('../../pages/settings/next/TaxBasisSection', () => tax)

import { ManualReceiptWorkspace } from './ManualReceiptWorkspace'

/** What axios throws when the 30 s client timeout fires: a request went out, no response came back. */
function timeoutError() {
  return Object.assign(new Error('timeout of 30000ms exceeded'), {
    isAxiosError: true,
    code: 'ECONNABORTED',
    request: {},
  })
}

function renderWorkspace() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ManualReceiptWorkspace isOpen onClose={() => {}} />
    </QueryClientProvider>,
  )
}

async function addOneLine(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(/Search the Master Wine Library/), 'Ba')
  await user.click(await screen.findByText('Barolo Cannubi'))
}

describe('ManualReceiptWorkspace: a save with no answer (F-566)', () => {
  beforeEach(() => {
    bulkCreateInventoryItems.mockReset()
  })

  it('says the save was not confirmed instead of inviting a retry', async () => {
    bulkCreateInventoryItems.mockRejectedValue(timeoutError())
    const user = userEvent.setup()
    renderWorkspace()
    await addOneLine(user)
    await user.click(screen.getByRole('button', { name: /Record 1 bottle/ }))

    expect(await screen.findByText(/This save was not confirmed/)).toBeTruthy()
    expect(screen.getByText(/Check stock before saving again/)).toBeTruthy()
    expect(screen.queryByText(/try again/i)).toBeNull()
    expect(screen.queryByText(/timeout of 30000ms/)).toBeNull()
  })

  it('sends the same Idempotency-Key when the same lines are saved again', async () => {
    bulkCreateInventoryItems.mockRejectedValueOnce(timeoutError()).mockResolvedValueOnce({
      results: [{ index: 0, status: 'stock_added', inventoryItemId: 'i1', wineId: 'w1' }],
    })
    const user = userEvent.setup()
    renderWorkspace()
    await addOneLine(user)
    await user.click(screen.getByRole('button', { name: /Record 1 bottle/ }))
    await screen.findByText(/This save was not confirmed/)
    await user.click(screen.getByRole('button', { name: /Record 1 bottle/ }))

    await waitFor(() => expect(bulkCreateInventoryItems).toHaveBeenCalledTimes(2))
    const firstKey = bulkCreateInventoryItems.mock.calls[0][2]?.idempotencyKey
    const secondKey = bulkCreateInventoryItems.mock.calls[1][2]?.idempotencyKey
    expect(typeof firstKey).toBe('string')
    expect(firstKey).toBeTruthy()
    expect(secondKey).toBe(firstKey)
  })

  it('keeps a refusal in the server’s own words', async () => {
    bulkCreateInventoryItems.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        request: {},
        response: { status: 400, data: { message: 'That storage spot is gone.' } },
      }),
    )
    const user = userEvent.setup()
    renderWorkspace()
    await addOneLine(user)
    await user.click(screen.getByRole('button', { name: /Record 1 bottle/ }))

    expect(await screen.findByText('That storage spot is gone.')).toBeTruthy()
  })
})

/**
 * ADR 0341 F3 (founder S218: "Yes, stamp cost basis"); ledger S234, owed by
 * w106-cost-truth. A manual receipt at a house whose till prices include tax
 * asks whether KDV is inside its costs, and sends the answer with each cost.
 */
describe('ManualReceiptWorkspace: whether tax is inside the costs (ADR 0341 F3)', () => {
  beforeEach(() => {
    bulkCreateInventoryItems.mockReset()
    bulkCreateInventoryItems.mockResolvedValue({
      results: [{ index: 0, status: 'stock_added', inventoryItemId: 'i1', wineId: 'w1' }],
    })
  })

  it('[REVERT-FAILS] sends the owner\'s answer with the typed cost', async () => {
    tax.getTaxBasis.mockResolvedValue({ readable: true, basis: 'prices_include_tax', taxWord: 'KDV' })
    const user = userEvent.setup()
    renderWorkspace()
    await addOneLine(user)
    await user.type(screen.getByLabelText('Cost per bottle for Barolo Cannubi'), '420')
    expect(await screen.findByText('Is KDV inside the costs on this receipt?')).toBeTruthy()
    await user.click(screen.getByLabelText('Yes, KDV is inside'))
    await user.click(screen.getByRole('button', { name: /Record 1 bottle/ }))
    await waitFor(() => expect(bulkCreateInventoryItems).toHaveBeenCalled())
    expect(bulkCreateInventoryItems.mock.calls[0][0].items[0]).toMatchObject({
      costPerBottle: 420,
      costTaxBasis: 'includes_tax',
    })
  })

  it('sends nothing for it at a house whose till prices do not include tax', async () => {
    tax.getTaxBasis.mockResolvedValue({ readable: true, basis: 'prices_exclude_tax', taxWord: 'tax' })
    const user = userEvent.setup()
    renderWorkspace()
    await addOneLine(user)
    await user.type(screen.getByLabelText('Cost per bottle for Barolo Cannubi'), '420')
    await waitFor(() => expect(tax.getTaxBasis).toHaveBeenCalled())
    expect(screen.queryByTestId('cost-tax-choice')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Record 1 bottle/ }))
    await waitFor(() => expect(bulkCreateInventoryItems).toHaveBeenCalled())
    expect(bulkCreateInventoryItems.mock.calls[0][0].items[0]).not.toHaveProperty('costTaxBasis')
  })
})
