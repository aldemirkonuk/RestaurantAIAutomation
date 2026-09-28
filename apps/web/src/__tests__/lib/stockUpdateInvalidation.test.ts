/**
 * `stock:updated` invalidation scope.
 *
 * The handler in lib/websocket.tsx used to blanket-invalidate three whole query
 * trees, so one bottle moving anywhere refetched the inventory table, the
 * dashboard and the wine library under whoever was reading them.
 *
 * These tests pin the narrowed rule against the query keys the app actually
 * registers. The two directions matter equally:
 *   - nothing stock-derived may be dropped (a skipped invalidation shows a
 *     stale row as if it were fresh), and
 *   - the narrowing must still MATCH something — a predicate that selects zero
 *     queries would look like a perfectly quiet fix and refresh nothing.
 */
import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { isQueryAffectedByStockUpdate } from '../../lib/websocket'
import { queryKeys } from '../../lib/query-keys'

const RESTAURANT = 'rest-aaa'
const OTHER_RESTAURANT = 'rest-bbb'
const INVENTORY_ID = 'inv-row-1'
const OTHER_INVENTORY_ID = 'inv-row-2'

const payload = {
  inventory_id: INVENTORY_ID,
  restaurant_id: RESTAURANT,
  wine_name: 'Barolo Riserva',
  stock_before: 12,
  stock_after: 11,
}

/**
 * Every query key shape apps/web registers under one of the three trees the
 * handler used to invalidate. Sourced from:
 *   hooks/queries/useInventoryQueries.ts  (list / summary / low-stock / unmapped-toast)
 *   hooks/queries/useWineQueries.ts       (wines list / detail / search / ids)
 *   pages/SommelierAI.tsx                 (['inventory','sommelier-context'])
 *   pages/inventory/command/RowExpansion.tsx (['inventory','activity',id])
 *   pages/inventory/command/ReceiptDepth.tsx (['inventory','receipt-depth',ids])
 */
const REGISTERED_KEYS: Array<{ key: readonly unknown[]; label: string }> = [
  { key: queryKeys.inventory.list(RESTAURANT), label: 'inventory list (this restaurant)' },
  { key: queryKeys.inventory.summary(RESTAURANT), label: 'inventory summary (this restaurant)' },
  { key: queryKeys.inventory.lowStock(RESTAURANT), label: 'low stock (this restaurant)' },
  { key: ['inventory', 'sommelier-context'], label: 'sommelier stock context' },
  { key: ['inventory', 'activity', INVENTORY_ID], label: 'row activity (this row)' },
  { key: ['inventory', 'activity', OTHER_INVENTORY_ID], label: 'row activity (another row)' },
  { key: [...queryKeys.inventory.all, 'unmapped-toast', RESTAURANT], label: 'unmapped toast items' },
  { key: ['inventory', 'receipt-depth', ['order-1']], label: 'receipt depth' },
  { key: queryKeys.inventory.list(OTHER_RESTAURANT), label: 'inventory list (other restaurant)' },
  { key: queryKeys.inventory.summary(OTHER_RESTAURANT), label: 'inventory summary (other restaurant)' },
  { key: queryKeys.wines.list(), label: 'wine library list' },
  { key: queryKeys.wines.detail('wine-1'), label: 'wine library detail' },
  { key: queryKeys.wines.search('bar'), label: 'wine library search' },
  { key: [...queryKeys.wines.all, 'ids', ['wine-1']], label: 'wine library by ids' },
  { key: queryKeys.dashboard.summary(RESTAURANT), label: 'dashboard summary' },
  { key: queryKeys.orders.list(RESTAURANT), label: 'orders list' },
]

function selected(data: Partial<typeof payload> | undefined): string[] {
  return REGISTERED_KEYS.filter(({ key }) => isQueryAffectedByStockUpdate(key, data)).map(
    (k) => k.label,
  )
}

describe('isQueryAffectedByStockUpdate', () => {
  it('selects exactly the stock-derived queries for the event’s own restaurant', () => {
    expect(selected(payload).sort()).toEqual(
      [
        'inventory list (this restaurant)',
        'inventory summary (this restaurant)',
        'low stock (this restaurant)',
        'row activity (this row)',
        'sommelier stock context',
      ].sort(),
    )
  })

  it('never touches the master wine library', () => {
    // The library has no stock column and no restaurant scope, so a stock event
    // cannot change a field of it. This is the refetch that used to land on a
    // reader of /wines.
    for (const { key, label } of REGISTERED_KEYS) {
      if (key[0] === 'wines') {
        expect(isQueryAffectedByStockUpdate(key, payload), label).toBe(false)
      }
    }
  })

  it('does not select stock-independent inventory subtrees', () => {
    expect(
      isQueryAffectedByStockUpdate(
        [...queryKeys.inventory.all, 'unmapped-toast', RESTAURANT],
        payload,
      ),
    ).toBe(false)
    expect(isQueryAffectedByStockUpdate(['inventory', 'receipt-depth', ['o1']], payload)).toBe(
      false,
    )
  })

  it('selects list queries for this restaurant whatever their filters', () => {
    expect(
      isQueryAffectedByStockUpdate(
        queryKeys.inventory.list(RESTAURANT, { lowStock: true }),
        payload,
      ),
    ).toBe(true)
  })

  it('widens instead of muting when restaurant_id is missing', () => {
    // A payload without a restaurant must not quietly select nothing: every
    // restaurant's list/summary/low-stock is refreshed instead.
    const anonymous = { ...payload, restaurant_id: '' }
    expect(selected(anonymous)).toContain('inventory list (other restaurant)')
    expect(selected(anonymous)).toContain('inventory list (this restaurant)')
    expect(selected(anonymous)).not.toContain('wine library list')
  })

  it('widens instead of muting when inventory_id is missing', () => {
    // The bridge never defaults inventory_id (rabbitmq-bridge.service.ts), so it
    // can arrive undefined; every row's activity feed is refreshed then.
    const { inventory_id: _omitted, ...withoutRow } = payload
    expect(selected(withoutRow)).toContain('row activity (another row)')
  })

  it('selects an unclassified inventory subtree rather than skipping it', () => {
    expect(isQueryAffectedByStockUpdate(['inventory', 'something-new', RESTAURANT], payload)).toBe(
      true,
    )
  })

  it('marks the mounted inventory queries stale through a real QueryClient', () => {
    // Proves the predicate matches live cache entries, not just literals — a
    // rule that compiles and selects nothing is the failure this guards.
    const client = new QueryClient()
    for (const { key } of REGISTERED_KEYS) {
      client.setQueryData(key as unknown[], { marker: true })
    }

    client.invalidateQueries({
      predicate: (query) => isQueryAffectedByStockUpdate(query.queryKey, payload),
    })

    const staleLabels = REGISTERED_KEYS.filter(({ key }) => {
      const state = client.getQueryState(key as unknown[])
      return state?.isInvalidated === true
    }).map((k) => k.label)

    expect(staleLabels.length).toBeGreaterThan(0)
    expect(staleLabels.sort()).toEqual(
      [
        'inventory list (this restaurant)',
        'inventory summary (this restaurant)',
        'low stock (this restaurant)',
        'row activity (this row)',
        'sommelier stock context',
      ].sort(),
    )
    client.clear()
  })
})
