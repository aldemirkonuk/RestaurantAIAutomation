import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RemoveFromInventoryModal } from './RemoveFromInventoryModal'
import type { InventoryItem } from '../../pages/inventory/useInventoryPage'

// The real select renders a popover this test has no reason to drive.
vi.mock('../ui/ThemedSelect', () => ({ ThemedSelect: () => null }))

// r56 (2026-11-12): the modal prints the house's own money. The house's
// currency read is served here; a test switches it to lira or to none.
const house = vi.hoisted(() => ({ code: 'USD' as string | null }))
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

/**
 * The write-off sentence used to sum `(wac ?? price ?? 0) × bottles`, so a
 * wine with no recorded cost was written off as $0 (or at the wine library's
 * reference price) and the total said nothing about it.
 */
const base = {
  id: 'wine',
  name: 'x',
  producer: 'p',
  price: 0,
  liveStock: 0,
  shadowStock: 0,
  threshold: 0,
  openMl: 0,
} as unknown as InventoryItem

function wine(id: string, name: string, extra: Record<string, unknown>): InventoryItem {
  return { ...base, id, inventoryId: id, name, ...extra } as InventoryItem
}

async function open(items: InventoryItem[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RemoveFromInventoryModal isOpen items={items} onClose={() => {}} onRemoved={() => {}} />
    </QueryClientProvider>,
  )
  // The figures wait for the currency read: a dash until then, never a borrowed `$`.
  await waitFor(() => expect(screen.getByText(/This will write off/).textContent).not.toMatch(/write off - /))
}

describe('RemoveFromInventoryModal — an unknown cost is never written off as $0', () => {
  it('a wine with bottles and no recorded cost says "cost not known yet", and the total counts it', async () => {
    house.code = 'USD'
    await open([
      wine('a', 'Known', { wac: 10, liveStock: 6 }),
      wine('b', 'Unknown', { wac: undefined, liveStock: 4, price: 30 }),
    ])
    const unknownRow = screen.getByText('Unknown').parentElement as HTMLElement
    expect(unknownRow).toHaveTextContent('cost not known yet')
    expect(unknownRow).not.toHaveTextContent('$120')
    expect(screen.getByText(/This will write off/)).toHaveTextContent(
      'This will write off US$60 + 1 wine whose cost is not known yet in on-hand value.',
    )
  })

  it('only unknown costs: the write-off says it is not known, never $0', async () => {
    house.code = 'USD'
    await open([wine('b', 'Unknown', { wac: undefined, liveStock: 4 })])
    const sentence = screen.getByText(/This will write off/)
    expect(sentence).toHaveTextContent('cost not known yet (1 wine)')
    expect(sentence).not.toHaveTextContent('$0')
  })

  it('every cost known: the plain total', async () => {
    house.code = 'USD'
    await open([wine('a', 'Known', { wac: 10, liveStock: 6 })])
    expect(screen.getByText(/This will write off/)).toHaveTextContent('This will write off US$60 in on-hand value.')
  })

  it("a lira house writes off lira, and no line carries a dollar sign", async () => {
    house.code = 'TRY'
    await open([wine('a', 'Known', { wac: 10, liveStock: 6 })])
    expect(screen.getByText(/This will write off/)).toHaveTextContent('This will write off TRY 60 in on-hand value.')
    expect(screen.getByText('Known').parentElement).toHaveTextContent('TRY 60')
    expect(document.body.textContent).not.toContain('$')
  })

  it('a house with no recorded currency gets a plain number, never a dollar sign', async () => {
    house.code = null
    await open([wine('a', 'Known', { wac: 10, liveStock: 6 })])
    expect(screen.getByText(/This will write off/)).toHaveTextContent('This will write off 60 in on-hand value.')
    expect(document.body.textContent).not.toContain('$')
  })
})
