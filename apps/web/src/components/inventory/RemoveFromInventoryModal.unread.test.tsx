import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InventoryItem } from '../../pages/inventory/useInventoryPage'

vi.mock('../../services/api/inventory', () => ({ deleteInventoryItem: vi.fn(), reconcileItem: vi.fn() }))
vi.mock('../ui/ThemedSelect', () => ({ ThemedSelect: () => null }))

import { RemoveFromInventoryModal } from './RemoveFromInventoryModal'

const open = (item: Partial<InventoryItem>) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RemoveFromInventoryModal
        isOpen
        items={[{ inventoryId: 'i1', name: 'Barolo', liveStock: 2, shadowStock: 0, price: 40, ...item } as InventoryItem]}
        onClose={() => {}}
        onRemoved={() => {}}
      />
    </QueryClientProvider>,
  )

describe('RemoveFromInventoryModal says a value it could not read (G15, ADR 0020)', () => {
  it('a failed rollup read names the open bottle and value as unread, never the price as cost', () => {
    open({ rollupReadable: false, wac: undefined, openMl: undefined })
    const text = document.body.textContent ?? ''
    expect(text).toContain('open bottle and value could not be read')
    expect(text).toContain('The on-hand value could not be read')
    expect(text).not.toContain('$80')
  })

  it('a read row still states its value', () => {
    open({ rollupReadable: true, wac: 30 })
    expect(document.body.textContent).toContain('$60')
  })
})
