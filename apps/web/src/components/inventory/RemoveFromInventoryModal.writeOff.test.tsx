import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RemoveFromInventoryModal } from './RemoveFromInventoryModal'
import type { InventoryItem } from '../../pages/inventory/useInventoryPage'
import { useRestaurantSettingsStore } from '../../stores/restaurantSettingsStore'

const api = vi.hoisted(() => ({
  adjustStock: vi.fn(),
  deleteInventoryItem: vi.fn(),
  reconcileItem: vi.fn(),
}))
vi.mock('../../services/api/inventory', () => api)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The real select renders a popover; a native one stands in so a reason can be picked.
vi.mock('../ui/ThemedSelect', () => ({
  ThemedSelect: (p: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; 'aria-label'?: string }) => (
    <select aria-label={p['aria-label']} value={p.value} onChange={(e) => p.onChange(e.target.value)}>
      {p.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

function wine(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'w',
    inventoryId: 'inv',
    name: 'Wine',
    price: 40,
    wac: 10,
    liveStock: 3,
    shadowStock: 0,
    openMl: 0,
    ...over,
  } as unknown as InventoryItem
}

function renderModal(items: InventoryItem[], onRemoved = vi.fn()) {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <RemoveFromInventoryModal isOpen items={items} onClose={() => {}} onRemoved={onRemoved} />
    </QueryClientProvider>,
  )
  return onRemoved
}

/**
 * F-1539: removing a wine sent a shelf count of 0. A count is a variance, so
 * the month close listed every removed bottle as missing. It is now a take-off
 * carrying the reason, and breakage goes in as a write-off.
 */
describe('RemoveFromInventoryModal — a removal is a write-off, not a count (F-1539)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.adjustStock.mockResolvedValue({ quantityAfter: 0 })
    api.deleteInventoryItem.mockResolvedValue({})
  })

  it('[REVERT-FAILS] takes the bottles off as a write-off with the reason, and never sends a count', async () => {
    const onRemoved = renderModal([wine()])
    fireEvent.change(screen.getByLabelText('Removal reason'), { target: { value: 'Breakage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove wine' }))

    await waitFor(() => expect(onRemoved).toHaveBeenCalled())
    expect(api.reconcileItem).not.toHaveBeenCalled()
    expect(api.adjustStock).toHaveBeenCalledWith(
      'inv',
      expect.objectContaining({
        quantityChange: -3,
        transactionType: 'waste',
        reason: 'Removed from inventory — Breakage',
      }),
    )
    expect(api.deleteInventoryItem).toHaveBeenCalledWith('inv')
  })

  it('a bottle sent back to the vendor is an adjustment, never a return coming in', async () => {
    renderModal([wine()])
    fireEvent.change(screen.getByLabelText('Removal reason'), { target: { value: 'Return to vendor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove wine' }))
    await waitFor(() => expect(api.adjustStock).toHaveBeenCalled())
    expect(api.adjustStock.mock.calls[0][1].transactionType).toBe('adjustment')
  })

  it('does not remove the wine when bottles were booked in since the page loaded, and says so', async () => {
    api.adjustStock.mockResolvedValue({ quantityAfter: 2 })
    const onRemoved = renderModal([wine()])
    fireEvent.click(screen.getByRole('button', { name: 'Remove wine' }))

    expect(await screen.findByText(/2 more bottles were booked in since this page loaded/)).toBeInTheDocument()
    expect(api.deleteInventoryItem).not.toHaveBeenCalled()
    expect(onRemoved).not.toHaveBeenCalled()
  })

  it('sends nothing to the ledger for a wine with no bottles on the shelf', async () => {
    const onRemoved = renderModal([wine({ liveStock: 0 } as Partial<InventoryItem>)])
    fireEvent.click(screen.getByRole('button', { name: 'Remove wine' }))
    await waitFor(() => expect(onRemoved).toHaveBeenCalled())
    expect(api.adjustStock).not.toHaveBeenCalled()
  })
})

/** F-1543: the open bottle is shown in the house's unit. */
describe("RemoveFromInventoryModal — the open bottle in the house's unit (F-1543)", () => {
  afterEach(() => useRestaurantSettingsStore.setState({ measurementUnit: 'ml' }))

  it('[REVERT-FAILS] says oz in a house that measures in oz', () => {
    useRestaurantSettingsStore.setState({ measurementUnit: 'oz' })
    renderModal([wine({ openMl: 250 } as Partial<InventoryItem>)])
    expect(document.body.textContent).toContain('8.5oz open')
    expect(document.body.textContent).not.toContain('250ml')
  })
})
