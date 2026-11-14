/**
 * The goods list behind a paper's names is the HOUSE's, read once and shared
 * by every paper in that house (r41 invoices audit, gap 1).
 *
 * Before: the list was keyed by the paper, so every paper opened downloaded the
 * house's whole list of goods again. These tests count the reads.
 *
 * All data is SYNTHETIC.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const documentMock = vi.fn()
const inventoryMock = vi.fn()
vi.mock('../../../services/api/canonical', () => ({
  canonicalApi: {
    document: (id: string) => documentMock(id),
    delivery: vi.fn(),
  },
}))
vi.mock('../../../services/api/inventory', () => ({
  getInventory: () => inventoryMock(),
}))

import { AuthContext } from '@/contexts/AuthContext'
import { CanonicalDocumentPage } from './CanonicalDocumentPage'

const env = (value: unknown, extra: Record<string, unknown> = {}) => ({
  value,
  source: 'extracted',
  confidence: null,
  revision: 1,
  ...extra,
})

const party = () => ({
  name: env('SYNTHETIC Vendor A.Ş.'),
  vatIdentifier: env('0000000000'),
  identifier: env(null),
  address: env(null),
  electronicAddress: env(null),
})

function response(over: Record<string, unknown> = {}) {
  return {
    canonical: {
      documentId: 'doc-syn',
      restaurantId: 'rest-syn',
      docType: 'invoice',
      direction: 'issued_by_vendor',
      jurisdiction: 'TR',
      revision: 1,
      layer1: {
        documentNumber: env('SYN-A-88214'),
        issueDate: env('2026-08-14'),
        typeCode: env('380'),
        currency: env('TRY'),
        paymentDueDate: env(null),
        paymentTerms: env(null),
        seller: party(),
        buyer: party(),
        purchaseOrderReference: env(null),
        despatchAdviceReference: env(null),
        precedingInvoiceReference: env(null),
        actualDeliveryDate: env('2026-08-12'),
        deliveryLocation: env(null),
        lines: [
          {
            lineId: env(null),
            description: env('SYNTHETIC Öküzgözü'),
            sellerItemId: env(null),
            quantity: env(12),
            unit: env('bottle'),
            netPrice: env(142, { as_printed: '142,00 / KS(12)' }),
            priceBaseQuantity: env(12, { as_printed: 'KS(12)' }),
            priceBaseUnit: env('bottle'),
            netAmount: env(142),
            allowancesCharges: [],
            vatCategory: env(null),
            vatRate: env(null),
            vintage: env(2021),
            lot: env(null),
            formatMl: env(750),
            freeGoodsQty: env(0),
          },
        ],
        allowancesCharges: [],
        totals: {
          linesNetTotal: env(142),
          allowancesTotal: env(0),
          chargesTotal: env(0),
          taxExclusiveAmount: env(142),
          taxAmount: env(28.4),
          taxInclusiveAmount: env(170.4),
          paidAmount: env(null),
          roundingAmount: env(null),
          amountDue: env(170.4),
        },
        vatBreakdown: [],
      },
      layer2: { providerId: null, vendorResolution: null, lines: [] },
      layer3: {
        lines: [
          {
            lineIndex: 0,
            ordered: 12,
            shipped: 12,
            received: 'not_counted',
            billed: 12,
            verdict: 'ok',
            reason: null,
            moneyAtRisk: null,
          },
        ],
        tiesOut: true,
        tieOutDeltaCents: 0,
        verdicts: [],
      },
    },
    deliveries: [],
    siblings: [],
    // ADR 0104 D5. `[]` = nobody has corrected anything; `null` = the log could
    // not be READ, which the page must not render as the same thing.
    corrections: [],
    original: {
      imageUrl: null,
      reason: 'no original was stored for this document',
      contentType: null,
      filename: null,
      pages: null,
    },
    intake: {
      status: 'needs_review',
      verdict: null,
      reason: null,
      sourceChannel: 'upload',
      extractionModel: null,
      sha256: 'abc123',
      createdAt: '2026-08-14T09:12:00Z',
    },
    ...over,
  }
}

/** One resolved line naming `inventoryId` (and optionally a proposal). */
function naming(inventoryId: string | null, proposedInventoryId: string | null = null) {
  return {
    lineIndex: 0,
    lineId: 'line-syn',
    inventoryId,
    inventoryIdSource: inventoryId ? 'line' : null,
    proposedInventoryId,
    proposedSentence: null,
    proposalUnavailable: false,
    proposalUnavailableReason: null,
  }
}

function paper(documentId: string, lines: unknown[]) {
  const r = response() as { canonical: Record<string, unknown> }
  r.canonical = {
    ...r.canonical,
    documentId,
    layer2: { providerId: null, vendorResolution: null, lines },
  }
  return r
}

const good = (id: string, wineName: string) => ({ id, wineName, wineVintage: null, bottleSizeMl: null })

function tree(qc: QueryClient, rid: string, documentId: string) {
  return (
    <AuthContext.Provider value={{ activeRestaurantId: rid, user: null } as never}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/receipts']}>
          <CanonicalDocumentPage documentId={documentId} embedded />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>
  )
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('CanonicalDocumentPage — one goods read per house, not per paper', () => {
  beforeEach(() => {
    documentMock.mockReset()
    inventoryMock.mockReset()
  })

  it('opening three papers in one house reads the goods list once', async () => {
    documentMock.mockImplementation((id: string) => Promise.resolve(paper(id, [naming('inv-1')])))
    inventoryMock.mockResolvedValue([good('inv-1', 'SYNTHETIC Red')])
    const qc = newClient()
    const { rerender } = render(tree(qc, 'rest-A', 'doc-1'))
    await waitFor(() => expect(inventoryMock).toHaveBeenCalledTimes(1))
    for (const doc of ['doc-2', 'doc-3']) {
      rerender(tree(qc, 'rest-A', doc))
      await waitFor(() => expect(documentMock).toHaveBeenCalledWith(doc))
      await waitFor(() => expect(screen.getByTestId('received-cell')).toBeTruthy())
    }
    expect(documentMock).toHaveBeenCalledTimes(3)
    expect(inventoryMock).toHaveBeenCalledTimes(1)
    expect(qc.getQueryCache().findAll({ queryKey: ['canonical-document-items'] })).toHaveLength(1)
    expect(qc.getQueryCache().find({ queryKey: ['canonical-document-items', 'rest-A'], exact: true })).toBeTruthy()
  })

  it('another house reads its own list (the key still names the house)', async () => {
    documentMock.mockImplementation((id: string) => Promise.resolve(paper(id, [])))
    inventoryMock.mockResolvedValue([])
    const qc = newClient()
    const { rerender } = render(tree(qc, 'rest-A', 'doc-1'))
    await waitFor(() => expect(inventoryMock).toHaveBeenCalledTimes(1))
    rerender(tree(qc, 'rest-B', 'doc-1'))
    await waitFor(() => expect(inventoryMock).toHaveBeenCalledTimes(2))
    expect(qc.getQueryCache().find({ queryKey: ['canonical-document-items', 'rest-B'], exact: true })).toBeTruthy()
  })

  it('a paper naming a good the shared list lacks reads the list again, once', async () => {
    documentMock.mockImplementation((id: string) =>
      Promise.resolve(id === 'doc-1' ? paper(id, [naming('inv-1')]) : paper(id, [naming(null, 'inv-new')])),
    )
    // The good is never in the list (taken off the shelves): one more read, not a loop.
    inventoryMock.mockResolvedValue([good('inv-1', 'SYNTHETIC Red')])
    const qc = newClient()
    const { rerender } = render(tree(qc, 'rest-A', 'doc-1'))
    await waitFor(() => expect(inventoryMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('received-cell')).toBeTruthy())
    // Let the cached read be strictly older than the next paper's opening.
    await new Promise((r) => setTimeout(r, 5))
    rerender(tree(qc, 'rest-A', 'doc-2'))
    await waitFor(() => expect(documentMock).toHaveBeenCalledWith('doc-2'))
    await waitFor(() => expect(inventoryMock).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 50))
    expect(inventoryMock).toHaveBeenCalledTimes(2)
  })

  it('a good added since the list was read gets its name on the next paper', async () => {
    documentMock.mockImplementation((id: string) =>
      Promise.resolve(id === 'doc-1' ? paper(id, [naming('inv-1')]) : paper(id, [naming('inv-new')])),
    )
    inventoryMock
      .mockResolvedValueOnce([good('inv-1', 'SYNTHETIC Red')])
      .mockResolvedValue([good('inv-1', 'SYNTHETIC Red'), good('inv-new', 'SYNTHETIC Added White')])
    const qc = newClient()
    const { rerender } = render(tree(qc, 'rest-A', 'doc-1'))
    await waitFor(() => expect(inventoryMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('received-cell')).toBeTruthy())
    await new Promise((r) => setTimeout(r, 5))
    rerender(tree(qc, 'rest-A', 'doc-2'))
    await waitFor(() => expect(inventoryMock).toHaveBeenCalledTimes(2))
    const items = qc.getQueryData<{ id: string }[]>(['canonical-document-items', 'rest-A'])
    expect(items?.map((x) => x.id)).toContain('inv-new')
  })

  it('a paper whose goods the list already has reads nothing more', async () => {
    documentMock.mockImplementation((id: string) => Promise.resolve(paper(id, [naming('inv-1', 'inv-2')])))
    inventoryMock.mockResolvedValue([good('inv-1', 'SYNTHETIC Red'), good('inv-2', 'SYNTHETIC White')])
    const qc = newClient()
    const { rerender } = render(tree(qc, 'rest-A', 'doc-1'))
    await waitFor(() => expect(inventoryMock).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 5))
    rerender(tree(qc, 'rest-A', 'doc-2'))
    await waitFor(() => expect(documentMock).toHaveBeenCalledWith('doc-2'))
    await waitFor(() => expect(screen.getByTestId('received-cell')).toBeTruthy())
    await new Promise((r) => setTimeout(r, 50))
    expect(inventoryMock).toHaveBeenCalledTimes(1)
  })
})
