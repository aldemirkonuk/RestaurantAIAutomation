/**
 * The delivery desk on /documents/:id is offered only to an owner or a manager
 * (ADR 0312). The gateway refuses agree, verify, propose, counter and accept to
 * anyone else, so the page does not show those buttons to staff, and says why
 * in one sentence. The door count is not part of this.
 *
 * The fixture is copied from `CanonicalDocumentPage.test.tsx`, with one
 * delivery on the document so the gates and the thread render. All data is
 * SYNTHETIC.
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
    correctField: vi.fn(),
    verifyField: vi.fn(),
    mintCorrectFieldSeal: vi.fn(),
    mintVerifyFieldSeal: vi.fn(),
  },
}))

const eventMock = vi.fn()
const proposalsMock = vi.fn()
vi.mock('../../../services/api/deliveries', () => ({
  deliveriesApi: {
    event: (id: string) => eventMock(id),
    proposals: (id: string) => proposalsMock(id),
    propose: vi.fn(),
    counter: vi.fn(),
    accept: vi.fn(),
    agree: vi.fn(),
    verify: vi.fn(),
    recordDoorCount: vi.fn(),
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

const SPINE = {
  deliveryId: 'del-syn',
  state: 'AGREED',
  provenance: 'ORDERED',
  deliveredAt: '2026-08-14T07:41:00Z',
  agreedAt: '2026-08-15T10:00:00Z',
  verifiedAt: null,
  jurisdiction: 'TR',
  providerId: 'prov-syn',
  selectedRole: 'invoice',
  documents: [],
}

const EVENT = (over: Record<string, unknown> = {}) => ({
  id: 'del-syn',
  providerId: 'prov-syn',
  orderId: 'ord-syn',
  state: 'AGREED',
  provenance: 'ORDERED',
  jurisdiction: 'TR',
  deliveredAt: '2026-08-14T07:41:00Z',
  agreedAt: '2026-08-15T10:00:00Z',
  agreedRule: 'both_sides_recorded',
  verifiedAt: null,
  verifiedBy: null,
  lapsedAt: null,
  lapseDeemed: null,
  amendedAt: null,
  ...over,
})

const OPEN_PROPOSAL = {
  id: 'prop-syn',
  delivery_id: 'del-syn',
  document_id: 'doc-syn',
  line_no: 1,
  side: 'vendor',
  reason: 'PRICE_VARIANCE',
  qty_proposed: null,
  unit_price_proposed: 140,
  money_at_risk: 24,
  evidence: [],
  note: 'SYNTHETIC: the list price moved',
  status: 'open',
  counters_proposal_id: null,
  proposed_by: null,
  proposed_at: '2026-08-14T09:00:00Z',
  responded_at: null,
  responded_by: null,
}

/** The first render pulls in the lazy sheet; the default 1 s is tight under a full run. */
const WAIT = { timeout: 5000 }

function mountAs(activeRole: string | null, userRole: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AuthContext.Provider
      value={{ activeRestaurantId: 'rest-syn', activeRole, user: userRole ? { role: userRole } : null } as never}
    >
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/documents/doc-syn']}>
          <Routes>
            <Route path="/documents/:id" element={<CanonicalDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  )
}

describe('the delivery desk on /documents/:id is the money holders\' (ADR 0312)', () => {
  beforeEach(() => {
    documentMock.mockReset()
    eventMock.mockReset()
    proposalsMock.mockReset()
    documentMock.mockResolvedValue(response({ deliveries: [SPINE] }))
    eventMock.mockResolvedValue(EVENT())
    proposalsMock.mockResolvedValue([OPEN_PROPOSAL])
  })

  it.each([
    ['owner', null],
    ['manager', null],
    [' Manager ', null],
    [null, 'owner'],
  ])('offers verify, accept, counter and a new position to %s (account role %s)', async (active, account) => {
    mountAs(active, account)
    await waitFor(() => expect(screen.getByTestId('verify-button')).toBeTruthy(), WAIT)
    await waitFor(() => expect(screen.getByTestId('accept-proposal')).toBeTruthy(), WAIT)
    expect(screen.getByTestId('counter-proposal')).toBeTruthy()
    expect(screen.getByTestId('open-proposal-form')).toBeTruthy()
    expect(screen.queryByTestId('delivery-desk-note')).toBeNull()
  })

  it.each([
    ['staff', null],
    [null, null],
    [null, 'staff'],
    ['admin', null],
  ])('offers no desk button to %s (account role %s), and says why', async (active, account) => {
    mountAs(active, account)
    await waitFor(() => expect(screen.getByTestId('delivery-gates')).toBeTruthy(), WAIT)
    await waitFor(() => expect(screen.getByTestId('proposal-row')).toBeTruthy(), WAIT)
    expect(screen.queryByTestId('verify-button')).toBeNull()
    expect(screen.queryByTestId('agree-button')).toBeNull()
    expect(screen.queryByTestId('accept-proposal')).toBeNull()
    expect(screen.queryByTestId('counter-proposal')).toBeNull()
    expect(screen.queryByTestId('open-proposal-form')).toBeNull()
    const note = screen.getByTestId('delivery-desk-note').textContent ?? ''
    expect(note).toMatch(/owner’s or a manager’s acts/)
    expect(note).toMatch(/door count and its photograph still go through/)
  })

  it('offers agree to a manager on a delivery not yet agreed, and not to staff', async () => {
    eventMock.mockResolvedValue(EVENT({ state: 'RECONCILING', agreedAt: null, agreedRule: null }))
    const { unmount } = mountAs('manager')
    await waitFor(() => expect(screen.getByTestId('agree-button')).toBeTruthy(), WAIT)
    unmount()
    mountAs('staff')
    await waitFor(() => expect(screen.getByTestId('delivery-gates')).toBeTruthy(), WAIT)
    expect(screen.queryByTestId('agree-button')).toBeNull()
  })

  it('says nothing about the desk on a document that is on no delivery', async () => {
    documentMock.mockResolvedValue(response())
    mountAs('staff')
    await waitFor(() => expect(screen.getByTestId('received-cell')).toBeTruthy(), WAIT)
    expect(screen.queryByTestId('delivery-desk-note')).toBeNull()
  })
})
