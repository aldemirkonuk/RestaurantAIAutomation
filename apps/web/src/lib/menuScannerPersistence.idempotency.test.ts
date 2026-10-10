/**
 * F-566: the bulk stock save carries an Idempotency-Key, the key survives a
 * re-save of the very same batch, and a changed batch gets a new one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/client')>()
  return {
    ...actual,
    apiClient: { post: vi.fn() },
    getActiveRestaurantId: vi.fn(() => 'r1'),
  }
})

import { apiClient } from '../services/api/client'
import {
  keyForBatchSave,
  persistBatchToInventory,
  stockSaveErrorMessage,
  UNCONFIRMED_STOCK_SAVE,
} from './menuScannerPersistence'

const line = { wineId: 'w1', quantity: 6 } as never

describe('bulk stock save idempotency (F-566)', () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset()
    vi.mocked(apiClient.post).mockResolvedValue({ data: { results: [] } })
  })

  it('sends the key as the Idempotency-Key header', async () => {
    await persistBatchToInventory([line], { source: 'manual_receipt', idempotencyKey: 'bulk-stock:abc' })
    expect(apiClient.post).toHaveBeenCalledWith(
      '/inventory/r1/items/bulk',
      { items: [line], source: 'manual_receipt' },
      { headers: { 'Idempotency-Key': 'bulk-stock:abc' } },
    )
  })

  it('reuses the key for the same batch and makes a new one when the lines change', () => {
    const first = keyForBatchSave(null, [line], { source: 'menu_scan' })
    expect(keyForBatchSave(first, [line], { source: 'menu_scan' }).key).toBe(first.key)
    const changed = keyForBatchSave(first, [{ wineId: 'w1', quantity: 7 } as never], { source: 'menu_scan' })
    expect(changed.key).not.toBe(first.key)
  })

  it('treats a 5xx as not confirmed and a 4xx as the server’s refusal', () => {
    expect(stockSaveErrorMessage({ response: { status: 502, data: { message: 'Bad gateway' } } }, 'x')).toBe(
      UNCONFIRMED_STOCK_SAVE,
    )
    expect(stockSaveErrorMessage({ response: { status: 409, data: { message: 'Refused.' } } }, 'x')).toBe('Refused.')
  })
})
