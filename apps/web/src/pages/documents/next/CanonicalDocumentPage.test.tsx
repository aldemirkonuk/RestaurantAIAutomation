/**
 * The page, end to end against a mocked API (ADR 0104 D12 slice 2).
 *
 * The load-bearing case is the FAILED READ: a page that renders an empty sheet
 * when the request breaks is telling a manager the vendor billed nothing. It
 * must render an error and NO sheet at all (ADR 0067).
 *
 * All data is SYNTHETIC.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const documentMock = vi.fn()
vi.mock('../../../services/api/canonical', () => ({
  canonicalApi: {
    document: (id: string) => documentMock(id),
    delivery: vi.fn(),
  },
}))

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
      layer2: { providerId: null, lines: [] },
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

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/documents/doc-syn']}>
        <Routes>
          <Route path="/documents/:id" element={<CanonicalDocumentPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CanonicalDocumentPage', () => {
  beforeEach(() => {
    documentMock.mockReset()
  })

  it('renders the verdict, the sheet and the not-counted words', async () => {
    documentMock.mockResolvedValue(response())
    const { container } = mount()
    await waitFor(() => expect(screen.getByTestId('received-cell')).toBeTruthy())
    expect(screen.getByTestId('received-cell').textContent).toBe('not counted')
    expect(container.textContent).toMatch(/Nothing on this document differs/)
    // The spine is absent — this document is on no delivery.
    expect(screen.queryByTestId('spine')).toBeNull()
  })

  it('renders an ERROR, not an empty sheet, when the read fails', async () => {
    documentMock.mockRejectedValue(new Error('502 from the gateway'))
    mount()
    await waitFor(() => expect(screen.getByTestId('canonical-error')).toBeTruthy())
    expect(screen.getByTestId('canonical-error').textContent).toMatch(
      /could not be read/,
    )
    // No sheet at all — an empty one would read as a document with no lines.
    expect(screen.queryByTestId('money-block')).toBeNull()
    expect(screen.queryByTestId('sheet-line')).toBeNull()
  })

  it('raises the NOT EXTRACTED banner for an empty layer 1', async () => {
    const r = response()
    ;(r.canonical.layer1 as { lines: unknown[] }).lines = []
    ;(r.canonical.layer3 as { lines: unknown[] }).lines = []
    documentMock.mockResolvedValue(r)
    mount()
    await waitFor(() => expect(screen.getByTestId('degraded-notice')).toBeTruthy())
    expect(screen.getByTestId('degraded-notice').textContent).toMatch(/NOT EXTRACTED/)
  })

  it('states a schema-lag note as a fact about the READ', async () => {
    documentMock.mockResolvedValue(
      response({ notes: ['This database has not applied migration 20260904120000.'] }),
    )
    mount()
    await waitFor(() => expect(screen.getByTestId('read-notes')).toBeTruthy())
    expect(screen.getByTestId('read-notes').textContent).toMatch(/20260904120000/)
  })

  it('says a partial read failed instead of hiding it', async () => {
    documentMock.mockResolvedValue(
      response({ deliveries: null, siblings: null, failedRead: ['deliveries read failed'] }),
    )
    mount()
    await waitFor(() => expect(screen.getByTestId('failed-read')).toBeTruthy())
    expect(screen.getByTestId('spine-failed')).toBeTruthy()
  })
})
