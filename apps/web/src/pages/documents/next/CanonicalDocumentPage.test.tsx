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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const documentMock = vi.fn()
const correctMock = vi.fn()
const verifyMock = vi.fn()
vi.mock('../../../services/api/canonical', () => ({
  canonicalApi: {
    document: (id: string) => documentMock(id),
    delivery: vi.fn(),
    correctField: (id: string, body: unknown) => correctMock(id, body),
    verifyField: (id: string, path: string) => verifyMock(id, path),
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
    correctMock.mockReset()
    verifyMock.mockReset()
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

  // -------------------------------------------------------------------------
  // ADR 0104 D5, slice 3 — the correction door.
  // -------------------------------------------------------------------------

  /** Open the popover on line 1's unit price and press "Correct this". */
  const openCorrectionOnUnitPrice = async () => {
    const cells = await screen.findAllByLabelText(/Where Unit price, line 1 came from/)
    fireEvent.focus(cells[0])
    const button = await screen.findByTestId('correct-field')
    fireEvent.mouseDown(button)
    return screen.findByTestId('correction-dialog')
  }

  it('opens the correction form on a field and sends path, value and reason', async () => {
    documentMock.mockResolvedValue(response())
    correctMock.mockResolvedValue({ revision: 2, entry: {}, document: {} })
    mount()
    await openCorrectionOnUnitPrice()

    fireEvent.change(screen.getByTestId('correction-value'), { target: { value: '132' } })
    fireEvent.change(screen.getByTestId('correction-reason'), {
      target: { value: 'the paper says 132,00' },
    })
    fireEvent.click(screen.getByTestId('correction-submit'))

    await waitFor(() => expect(correctMock).toHaveBeenCalledTimes(1))
    expect(correctMock).toHaveBeenCalledWith('doc-syn', {
      path: 'lines[0].netPrice',
      // A NUMBER, not the string the input held: the gateway types this field
      // and would refuse "132" with a 400.
      value: 132,
      reason: 'the paper says 132,00',
    })
  })

  it('shows what was there before, and the glyphs the paper printed', async () => {
    documentMock.mockResolvedValue(response())
    mount()
    await openCorrectionOnUnitPrice()
    const before = screen.getByTestId('correction-before').textContent ?? ''
    expect(before).toMatch(/Now: 142/)
    // The provenance trail is the paper's own literal, never our parsed number.
    expect(before).toMatch(/142,00 \/ KS\(12\)/)
  })

  it('sends null — not an empty string — for "the document states nothing here"', async () => {
    documentMock.mockResolvedValue(response())
    correctMock.mockResolvedValue({ revision: 2, entry: {}, document: {} })
    mount()
    await openCorrectionOnUnitPrice()
    fireEvent.click(screen.getByTestId('correction-clear'))
    fireEvent.click(screen.getByTestId('correction-submit'))
    await waitFor(() => expect(correctMock).toHaveBeenCalledTimes(1))
    expect(correctMock.mock.calls[0][1].value).toBeNull()
  })

  it("shows the GATEWAY's own words when it refuses, not a generic failure", async () => {
    documentMock.mockResolvedValue(response())
    correctMock.mockRejectedValue({
      response: {
        data: {
          message:
            'Another correction to this document landed first. Re-open the document and make the change again — nothing was written.',
        },
      },
    })
    mount()
    await openCorrectionOnUnitPrice()
    fireEvent.change(screen.getByTestId('correction-value'), { target: { value: '132' } })
    fireEvent.click(screen.getByTestId('correction-submit'))
    await waitFor(() => expect(screen.getByTestId('correction-error')).toBeTruthy())
    expect(screen.getByTestId('correction-error').textContent).toMatch(
      /landed first/,
    )
  })

  it('prints the correction history on the field it belongs to', async () => {
    documentMock.mockResolvedValue(
      response({
        corrections: [
          {
            revision: 2,
            kind: 'correction',
            path: 'lines[0].netPrice',
            label: 'Unit price, line 1',
            before: { value: 142, as_printed: '142,00 / KS(12)' },
            after: { value: 132 },
            reason: 'the paper says 132,00',
            correctedBy: 'u1',
            correctedByName: 'Ayşe',
            correctedAt: '2026-08-14T09:40:00Z',
          },
        ],
      }),
    )
    mount()
    const cells = await screen.findAllByLabelText(/Where Unit price, line 1 came from/)
    fireEvent.focus(cells[0])
    const line = await screen.findByTestId('provenance-correction')
    expect(line.textContent).toMatch(/Corrected by Ayşe/)
    expect(line.textContent).toMatch(/was as printed/)
    expect(line.textContent).toMatch(/the paper says 132,00/)
  })

  it('turns corrections OFF and says why when the log could not be read', async () => {
    documentMock.mockResolvedValue(
      response({ corrections: null, failedRead: ['document_corrections read failed'] }),
    )
    mount()
    await waitFor(() => expect(screen.getByTestId('corrections-unreadable')).toBeTruthy())
    const cells = await screen.findAllByLabelText(/Where Unit price, line 1 came from/)
    fireEvent.focus(cells[0])
    // The popover still explains the provenance; it offers no handle to change
    // a field whose history this screen could not read.
    expect(screen.queryByTestId('correct-field')).toBeNull()
  })

  it('ticks a field as verified without opening the correction form', async () => {
    documentMock.mockResolvedValue(response())
    verifyMock.mockResolvedValue({ revision: 2, entry: {}, document: {} })
    mount()
    const cells = await screen.findAllByLabelText(/Where Unit price, line 1 came from/)
    fireEvent.focus(cells[0])
    fireEvent.mouseDown(await screen.findByTestId('verify-field'))
    await waitFor(() => expect(verifyMock).toHaveBeenCalledWith('doc-syn', 'lines[0].netPrice'))
    expect(screen.queryByTestId('correction-dialog')).toBeNull()
  })
})
