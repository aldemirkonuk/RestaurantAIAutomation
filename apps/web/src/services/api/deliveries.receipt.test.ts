/**
 * `receiptForOrder` — an order carries no document id, so its receipt is found
 * through the deliveries that fulfil it (`GET /procurement/deliveries?orderId=`)
 * and the documents each one lists (`GET /procurement/deliveries/:id`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deliveriesApi } from './deliveries'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }
})

const http = vi.mocked(apiClient) as unknown as { get: ReturnType<typeof vi.fn> }

beforeEach(() => {
  http.get.mockReset()
})

const doc = (documentId: string, role: string, docDate: string | null = null) => ({
  documentId,
  role,
  docNumber: null,
  docDate,
})

function answer(deliveries: Record<string, ReturnType<typeof doc>[]>) {
  http.get.mockImplementation(async (url: string) => {
    if (url === '/procurement/deliveries')
      return { data: { deliveries: Object.keys(deliveries).map((id) => ({ id })) } }
    const id = url.split('/').pop() as string
    return { data: { delivery: { documents: deliveries[id] ?? [] } } }
  })
}

describe('deliveriesApi.receiptForOrder', () => {
  it('asks for the deliveries of THIS order, then picks the vendor’s invoice', async () => {
    answer({
      'del-1': [doc('po-1', 'purchase_order'), doc('dn-1', 'despatch_advice'), doc('inv-1', 'invoice')],
    })
    const out = await deliveriesApi.receiptForOrder('ord-9')
    expect(http.get).toHaveBeenCalledWith('/procurement/deliveries', {
      params: { orderId: 'ord-9', limit: 200 },
    })
    expect(out).toEqual({ state: 'found', document: doc('inv-1', 'invoice') })
  })

  it('never offers the house’s own purchase order or door count as the receipt', async () => {
    answer({ 'del-1': [doc('po-1', 'purchase_order'), doc('dc-1', 'door_count')] })
    expect(await deliveriesApi.receiptForOrder('ord-9')).toEqual({ state: 'none' })
  })

  it('is "none" when no delivery fulfils the order', async () => {
    answer({})
    expect(await deliveriesApi.receiptForOrder('ord-9')).toEqual({ state: 'none' })
  })

  it('takes the latest invoice across two deliveries', async () => {
    answer({
      'del-1': [doc('inv-old', 'invoice', '2026-09-01')],
      'del-2': [doc('inv-new', 'invoice', '2026-09-08')],
    })
    const out = await deliveriesApi.receiptForOrder('ord-9')
    expect(out.state === 'found' && out.document.documentId).toBe('inv-new')
  })

  it('throws when a read fails, rather than answering "none"', async () => {
    http.get.mockRejectedValue(new Error('503'))
    await expect(deliveriesApi.receiptForOrder('ord-9')).rejects.toThrow('503')
  })
})
