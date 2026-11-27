/**
 * r41 invoices gap 2: the list screens ask for summary rows (no parsed paper,
 * no EDI text); the order's documents stay full rows, because the receiving
 * workspace pre-fills what the vendor billed from `extracted.lines`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { documentsApi } from './documents'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...actual,
    apiClient: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
  }
})

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  get.mockReset()
  get.mockResolvedValue({ data: { items: [] } })
})

describe('documentsApi.list — summary rows', () => {
  it('asks for the summary view, with the filters it was given', async () => {
    await documentsApi.list({ status: 'needs_review', limit: 100 })
    expect(get).toHaveBeenCalledWith('/procurement/documents', {
      params: { status: 'needs_review', docType: undefined, limit: 100, view: 'summary' },
    })
  })

  it('asks for the summary view with no options too', async () => {
    await documentsApi.list()
    expect(get.mock.calls[0][1].params.view).toBe('summary')
  })

  it("keeps the order's documents full, for the receiving pre-fill", async () => {
    await documentsApi.forOrder('o-1')
    await documentsApi.forOrderWithCurrency('o-1')
    for (const call of get.mock.calls) expect(call[1].params).not.toHaveProperty('view')
  })
})
