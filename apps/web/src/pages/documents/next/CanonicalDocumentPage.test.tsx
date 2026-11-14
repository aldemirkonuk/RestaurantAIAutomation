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
const mintCorrectMock = vi.fn()
const mintVerifyMock = vi.fn()
/** Every call, in order, so the mint's TIMING is asserted rather than assumed. */
const calls: string[] = []
const linkMock = vi.fn()
const inventoryMock = vi.fn()
const doorCountMock = vi.fn()
vi.mock('../../../services/api/deliveries', () => ({
  deliveriesApi: {
    event: vi.fn().mockResolvedValue(null),
    proposals: vi.fn().mockResolvedValue([]),
    recordDoorCount: (body: unknown) => doorCountMock(body),
  },
}))
vi.mock('../../../services/api/inventory', () => ({
  getInventory: () => inventoryMock(),
}))
vi.mock('../../../services/api/canonical', () => ({
  canonicalApi: {
    document: (id: string) => documentMock(id),
    delivery: vi.fn(),
    lineMappings: vi.fn().mockResolvedValue([]),
    linkLineToItem: (...a: unknown[]) => linkMock(...a),
    correctField: (id: string, body: unknown, challenge?: string | null) => {
      calls.push('correctField')
      return correctMock(id, body, challenge)
    },
    verifyField: (id: string, path: string, challenge?: string | null) => {
      calls.push('verifyField')
      return verifyMock(id, path, challenge)
    },
    mintCorrectFieldSeal: (id: string, body: unknown) => {
      calls.push('mintCorrectFieldSeal')
      return mintCorrectMock(id, body)
    },
    mintVerifyFieldSeal: (id: string, path: string) => {
      calls.push('mintVerifyFieldSeal')
      return mintVerifyMock(id, path)
    },
  },
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
    mintCorrectMock.mockReset()
    mintVerifyMock.mockReset()
    linkMock.mockReset()
    inventoryMock.mockReset()
    inventoryMock.mockResolvedValue([])
    calls.length = 0
    mintCorrectMock.mockResolvedValue('seal-correct')
    mintVerifyMock.mockResolvedValue('seal-tick')
  })

  it('draws the given document inside a sheet, without the page’s own chrome (the /orders receipt)', async () => {
    documentMock.mockResolvedValue(response())
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/orders']}>
          <CanonicalDocumentPage documentId="doc-syn" embedded />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('received-cell')).toBeTruthy())
    expect(documentMock).toHaveBeenCalledWith('doc-syn')
    expect(screen.queryByText(/Back to the documents/)).toBeNull()
    expect(container.querySelector('.cd-page')?.getAttribute('data-embedded')).toBe('true')
  })

  it('keys every read by the house, so a house switch reads afresh (ADR 0051, RECEIPTS-W47)', async () => {
    documentMock.mockResolvedValue(response())
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Only the house fields are read; the rest of the auth value is not.
    const tree = (rid: string) => (
      <AuthContext.Provider value={{ activeRestaurantId: rid, user: null } as never}>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/orders']}>
            <CanonicalDocumentPage documentId="doc-syn" embedded />
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>
    )
    const { rerender } = render(tree('rest-A'))
    await waitFor(() => expect(screen.getByTestId('received-cell')).toBeTruthy())
    for (const k of ['canonical-document', 'canonical-document-items', 'canonical-document-mappings']) {
      expect(qc.getQueryCache().find({ queryKey: [k, 'rest-A', 'doc-syn'], exact: true })).toBeTruthy()
    }
    expect(documentMock).toHaveBeenCalledTimes(1)
    // Within the 30s stale window a house-less key would answer from the cache.
    rerender(tree('rest-B'))
    await waitFor(() => expect(documentMock).toHaveBeenCalledTimes(2))
    expect(qc.getQueryCache().find({ queryKey: ['canonical-document', 'rest-B', 'doc-syn'], exact: true })).toBeTruthy()
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

  it('says where the paper came from in the house’s words, with the model on hover', async () => {
    const r = response({ intake: { ...response().intake, extractionModel: 'model-syn-1' } })
    ;(r.canonical as { jurisdiction: string | null }).jurisdiction = null
    documentMock.mockResolvedValue(r)
    const { container } = mount()
    await waitFor(() => expect(screen.getByTestId('received-cell')).toBeTruthy())
    const read = screen.getByText('read automatically')
    expect(read.getAttribute('title')).toBe('model-syn-1')
    expect(container.textContent).toMatch(/file fingerprint abc123/)
    expect(container.textContent).not.toMatch(/sha256|read by|jurisdiction not set/)
  })

  it('names the jurisdiction only when one is set', async () => {
    documentMock.mockResolvedValue(response())
    const { container } = mount()
    await waitFor(() => expect(screen.getByTestId('received-cell')).toBeTruthy())
    expect(container.textContent).toMatch(/file fingerprint abc123… · TR/)
    expect(container.textContent).toMatch(/no record of how it was read/)
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

  /**
   * Complete the hold on a `HoldToApprove`.
   *
   * The keyboard path: Enter arms it, a second Enter within three seconds
   * approves. Used rather than a pointer hold because jsdom has no
   * requestAnimationFrame clock worth timing a thumb against — the same helper
   * `ReceiptsSeal.test.tsx` uses for the other three acts.
   */
  const hold = (name: RegExp) => {
    const control = screen.getByRole('button', { name })
    fireEvent.keyDown(control, { key: 'Enter' })
    fireEvent.keyDown(control, { key: 'Enter' })
  }

  /** Open the popover on line 1's unit price and press "Correct this". */
  const openCorrectionOnUnitPrice = async () => {
    const cells = await screen.findAllByLabelText(/Where Unit price, line 1 came from/)
    fireEvent.focus(cells[0])
    const button = await screen.findByTestId('correct-field')
    fireEvent.mouseDown(button)
    return screen.findByTestId('correction-dialog')
  }

  /** Open the popover on line 1's unit price and press "I have checked this". */
  const openTickOnUnitPrice = async () => {
    const cells = await screen.findAllByLabelText(/Where Unit price, line 1 came from/)
    fireEvent.focus(cells[0])
    fireEvent.mouseDown(await screen.findByTestId('verify-field'))
    return screen.findByTestId('field-verify-dialog')
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
    hold(/Hold to seal this correction/)

    await waitFor(() => expect(correctMock).toHaveBeenCalledTimes(1))
    expect(correctMock).toHaveBeenCalledWith(
      'doc-syn',
      {
        path: 'lines[0].netPrice',
        // A NUMBER, not the string the input held: the gateway types this field
        // and would refuse "132" with a 400.
        value: 132,
        reason: 'the paper says 132,00',
      },
      'seal-correct',
    )
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
    hold(/Hold to seal this correction/)
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
    hold(/Hold to seal this correction/)
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

  it('opens the tick as its OWN hold, never the correction form', async () => {
    documentMock.mockResolvedValue(response())
    verifyMock.mockResolvedValue({ revision: 2, entry: {}, document: {} })
    mount()
    await openTickOnUnitPrice()
    // The value the person is standing behind is on screen, and it is the
    // document's, not a placeholder.
    expect(screen.getByTestId('field-verify-value').textContent).toMatch(/142/)
    expect(screen.queryByTestId('correction-dialog')).toBeNull()

    hold(/Hold to stand behind Unit price, line 1/)
    await waitFor(() =>
      expect(verifyMock).toHaveBeenCalledWith('doc-syn', 'lines[0].netPrice', 'seal-tick'),
    )
  })

  // -------------------------------------------------------------------------
  // Batch 69 (founder, 2026-09-11): "Seal corrections and fields/verify too."
  //
  // Two things only the browser can get wrong, and the gateway's own specs
  // cannot see: the TIMING of the mint, and the fallback that must not exist.
  // -------------------------------------------------------------------------

  it('mints the correction seal BEFORE the correction is sent', async () => {
    documentMock.mockResolvedValue(response())
    correctMock.mockResolvedValue({ revision: 2, entry: {}, document: {} })
    mount()
    await openCorrectionOnUnitPrice()
    fireEvent.change(screen.getByTestId('correction-value'), { target: { value: '132' } })
    hold(/Hold to seal this correction/)
    await waitFor(() => expect(correctMock).toHaveBeenCalled())
    expect(calls).toEqual(['mintCorrectFieldSeal', 'correctField'])
    // The mint is taken over the SAME correction the write carries, or the
    // gateway's args_hash would refuse every honest one.
    expect(mintCorrectMock).toHaveBeenCalledWith('doc-syn', {
      path: 'lines[0].netPrice',
      value: 132,
    })
  })

  it('mints the tick seal BEFORE the tick is sent', async () => {
    documentMock.mockResolvedValue(response())
    verifyMock.mockResolvedValue({ revision: 2, entry: {}, document: {} })
    mount()
    await openTickOnUnitPrice()
    hold(/Hold to stand behind Unit price, line 1/)
    await waitFor(() => expect(verifyMock).toHaveBeenCalled())
    expect(calls).toEqual(['mintVerifyFieldSeal', 'verifyField'])
  })

  it('does not correct a field when the mint refuses', async () => {
    documentMock.mockResolvedValue(response())
    mintCorrectMock.mockRejectedValue(
      Object.assign(new Error('This document changed after the seal was issued'), {
        response: { status: 403 },
      }),
    )
    mount()
    await openCorrectionOnUnitPrice()
    fireEvent.change(screen.getByTestId('correction-value'), { target: { value: '132' } })
    hold(/Hold to seal this correction/)
    expect(await screen.findByText(/The seal could not be issued/)).toBeTruthy()
    expect(correctMock).not.toHaveBeenCalled()
  })

  it('does not tick a field when the mint resolves null', async () => {
    documentMock.mockResolvedValue(response())
    mintVerifyMock.mockResolvedValue(null)
    mount()
    await openTickOnUnitPrice()
    hold(/Hold to stand behind Unit price, line 1/)
    expect(await screen.findByText(/The seal could not be issued/)).toBeTruthy()
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('seals the figure the HOLD was begun over, not one typed during it', async () => {
    // The keyboard path arms on Enter and commits on a second Enter up to three
    // seconds later. A dialog that re-read its input at the write would seal one
    // figure and post another, which is the whole mechanism defeated in the UI.
    documentMock.mockResolvedValue(response())
    correctMock.mockResolvedValue({ revision: 2, entry: {}, document: {} })
    mount()
    await openCorrectionOnUnitPrice()
    fireEvent.change(screen.getByTestId('correction-value'), { target: { value: '132' } })
    const control = screen.getByRole('button', { name: /Hold to seal this correction/ })
    fireEvent.keyDown(control, { key: 'Enter' })
    fireEvent.change(screen.getByTestId('correction-value'), { target: { value: '1320' } })
    fireEvent.keyDown(control, { key: 'Enter' })
    await waitFor(() => expect(correctMock).toHaveBeenCalled())
    expect(mintCorrectMock.mock.calls[0][1].value).toBe(132)
    expect(correctMock.mock.calls[0][1].value).toBe(132)
  })

  it('refuses to hold at all on a figure the field cannot take', async () => {
    // A number the browser cannot read is not sent as 0, and the control says
    // why rather than looking alive and doing nothing.
    documentMock.mockResolvedValue(response())
    mount()
    await openCorrectionOnUnitPrice()
    fireEvent.change(screen.getByTestId('correction-value'), { target: { value: 'abc' } })
    expect(screen.getByTestId('correction-unreadable').textContent).toMatch(/not a number/)
    const control = screen.getByRole('button', { name: /Type a value this field can take/ })
    expect((control as HTMLButtonElement).disabled).toBe(true)
    hold(/Type a value this field can take/)
    expect(mintCorrectMock).not.toHaveBeenCalled()
    expect(correctMock).not.toHaveBeenCalled()
  })
  describe('pairing a line by hand (#347)', () => {
    const resolved = (over: Record<string, unknown> = {}) => ({
      lineIndex: 0,
      lineId: 'line-syn-1',
      inventoryId: null,
      inventoryIdSource: null,
      proposedInventoryId: null,
      proposedSentence: null,
      proposalUnavailable: false,
      proposalUnavailableReason: null,
      masterWineId: null,
      canonicalUom: null,
      packSize: null,
      qtyBottles: null,
      matchMethod: null,
      matchConfidence: null,
      ...over,
    })
    const withLine = (over: Record<string, unknown> = {}) => {
      const r = response()
      ;(r.canonical.layer2 as { lines: unknown[] }).lines = [resolved(over)]
      return r
    }
    const items = [
      { id: 'inv-1', wineName: 'Şarap Kırmızı', bottleSizeMl: 750 },
      { id: 'inv-2', wineName: 'Öküzgözü Reserve', bottleSizeMl: 750 },
    ]

    it('a line the memory has nothing for offers "Choose an item"', async () => {
      documentMock.mockResolvedValue(withLine())
      mount()
      await waitFor(() => expect(screen.getByTestId('shelf-choose')).toBeTruthy())
      expect(screen.getByTestId('shelf-choose').textContent).toBe('Choose an item')
    })

    it('choosing one links it by hand, with source "chosen"', async () => {
      documentMock.mockResolvedValue(withLine())
      inventoryMock.mockResolvedValue(items)
      linkMock.mockResolvedValue({ lineId: 'line-syn-1', inventoryId: 'inv-1', remembered: true, memoryNote: null })
      mount()
      await waitFor(() => expect(screen.getByTestId('shelf-choose')).toBeTruthy())
      fireEvent.click(screen.getByTestId('shelf-choose'))
      fireEvent.change(screen.getByTestId('chooser-input'), { target: { value: 'sarap' } })
      const match = await screen.findByTestId('chooser-match')
      expect(match.textContent).toMatch(/Şarap Kırmızı/)
      fireEvent.click(match)
      await waitFor(() =>
        expect(linkMock).toHaveBeenCalledWith('doc-syn', 'line-syn-1', 'inv-1', 'chosen'),
      )
      await waitFor(() => expect(screen.queryByTestId('chooser')).toBeNull())
    })

    it('Cancel closes the chooser and calls nothing', async () => {
      documentMock.mockResolvedValue(withLine())
      inventoryMock.mockResolvedValue(items)
      mount()
      await waitFor(() => expect(screen.getByTestId('shelf-choose')).toBeTruthy())
      fireEvent.click(screen.getByTestId('shelf-choose'))
      fireEvent.click(screen.getByTestId('chooser-cancel'))
      expect(linkMock).not.toHaveBeenCalled()
      expect(screen.queryByTestId('chooser')).toBeNull()
      expect(screen.getByTestId('shelf-choose')).toBeTruthy()
    })

    it('a failed item read says so and offers no item to choose', async () => {
      documentMock.mockResolvedValue(withLine())
      inventoryMock.mockRejectedValue(new Error('SYNTHETIC items down'))
      mount()
      await waitFor(() => expect(screen.getByTestId('shelf-choose')).toBeTruthy())
      await waitFor(() => expect(inventoryMock).toHaveBeenCalled())
      // Wait for the query to settle into error before opening the chooser.
      await new Promise((r) => setTimeout(r, 50))
      fireEvent.click(screen.getByTestId('shelf-choose'))
      await waitFor(() => expect(screen.getByTestId('chooser-failed')).toBeTruthy())
      expect(screen.getByTestId('chooser-failed').textContent).toMatch(
        /The house's items could not be read, so none can be chosen\./,
      )
      expect(screen.queryAllByTestId('chooser-match')).toHaveLength(0)
      expect(screen.queryByTestId('chooser-input')).toBeNull()
    })

    it('a line whose memory could not be read can still be chosen by hand', async () => {
      documentMock.mockResolvedValue(withLine({ proposalUnavailable: true, proposalUnavailableReason: 'SYN' }))
      mount()
      await waitFor(() => expect(screen.getByTestId('shelf-unavailable')).toBeTruthy())
      fireEvent.click(screen.getByTestId('shelf-choose'))
      expect(screen.getByTestId('chooser')).toBeTruthy()
    })
  })
})

// r24, door-count lane: the paper's own door counts FOR the paper, and the
// page shows what the count put on the shelf (the r23 walk saw 201 and 0 lots).
describe('CanonicalDocumentPage — counting the paper at its door (r24)', () => {
  beforeEach(() => {
    documentMock.mockReset()
    doorCountMock.mockReset()
    inventoryMock.mockReset()
    inventoryMock.mockResolvedValue([])
  })

  it('sends the paper and its line, and shows what went on the shelf', async () => {
    const r = response()
    const canonical = r.canonical as Record<string, unknown>
    canonical.layer2 = {
      providerId: null,
      vendorResolution: null,
      lines: [{ lineIndex: 0, lineId: 'pl-syn-1', inventoryIdSource: 'line' }],
    }
    documentMock.mockResolvedValue(r)
    doorCountMock.mockResolvedValue({
      documentId: 'door-syn',
      booking: { booked: [{ lineNo: 1, inventoryId: 'inv-syn', delta: 12 }], notBooked: [] },
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'The door' }))
    fireEvent.change(await screen.findByTestId('door-count-input'), { target: { value: '12' } })
    fireEvent.click(screen.getByTestId('door-submit'))
    await waitFor(() => expect(doorCountMock).toHaveBeenCalledTimes(1))
    expect(doorCountMock.mock.calls[0][0]).toMatchObject({
      forDocumentId: 'doc-syn',
      createDelivery: true,
      lines: [{ lineNo: 1, qty: 12, sourceLineId: 'pl-syn-1' }],
    })
    expect(await screen.findByTestId('door-booking')).toHaveTextContent('1 line went on the shelf')
  })
})
