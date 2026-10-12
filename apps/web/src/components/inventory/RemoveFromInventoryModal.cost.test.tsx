import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RemoveFromInventoryModal } from './RemoveFromInventoryModal'
import type { InventoryItem } from '../../pages/inventory/useInventoryPage'

vi.mock('../../services/api/inventory', () => ({
  deleteInventoryItem: vi.fn(),
  adjustStock: vi.fn(),
}))

function wine(over: Partial<InventoryItem>): InventoryItem {
  return {
    id: 'w',
    inventoryId: 'inv',
    name: 'Wine',
    price: 40,
    liveStock: 3,
    shadowStock: 0,
    openMl: 0,
    ...over,
  } as unknown as InventoryItem
}

function renderModal(items: InventoryItem[]) {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <RemoveFromInventoryModal isOpen items={items} onClose={() => {}} onRemoved={() => {}} />
    </QueryClientProvider>,
  )
}

/**
 * F-1311: the write-off read `wac ?? price`, so a wine with no recorded cost
 * was written off at the library's reference price, not what the house paid.
 */
describe('RemoveFromInventoryModal — writes off only what the house paid (F-1311)', () => {
  it('[REVERT-FAILS] values an uncosted wine at nothing borrowed and says its cost is not recorded', () => {
    renderModal([wine({ id: 'a', inventoryId: 'a', name: 'Uncosted', wac: undefined, price: 40 })])
    expect(screen.getByText('no cost recorded')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/write off/)
    expect(document.body.textContent).not.toContain('120')
    expect(document.body.textContent).toContain('1 wine has no recorded cost, so its value is not shown.')
  })

  it('totals only the costed wines and says how many it left out', () => {
    renderModal([
      wine({ id: 'a', inventoryId: 'a', name: 'Costed', wac: 10 }),
      wine({ id: 'b', inventoryId: 'b', name: 'Uncosted', wac: undefined, price: 40 }),
    ])
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/write off .*30/)
    expect(text).not.toContain('150')
    expect(text).toContain('1 wine has no recorded cost, so its value is left out of that figure.')
  })
})
