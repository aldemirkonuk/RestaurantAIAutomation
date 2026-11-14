/**
 * The delivery block on /documents/:id, by who is looking (r30, the web half of
 * r28 invoices G3). The gateway refuses agree, verify, propose, counter and
 * accept to anyone who does not hold the house's money, and withholds the
 * amounts on the proposal thread from them. The page stops offering those acts
 * to staff, says who does them, and says the amounts were withheld.
 *
 * All data is SYNTHETIC.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const threadMock = vi.fn()
vi.mock('../../../services/api/deliveries', async (orig) => {
  const real = await orig<typeof import('../../../services/api/deliveries')>()
  return {
    ...real,
    deliveriesApi: {
      ...real.deliveriesApi,
      event: (id: string) => eventMock(id),
      proposalThread: (id: string) => threadMock(id),
      agree: vi.fn(),
      verify: vi.fn(),
      propose: vi.fn(),
      counter: vi.fn(),
      accept: vi.fn(),
      recordDoorCount: vi.fn(),
    },
  }
})

vi.mock('../../../services/api/inventory', () => ({ getInventory: async () => [] }))

import { AuthContext } from '@/contexts/AuthContext'
import { CanonicalDocumentPage } from './CanonicalDocumentPage'
import { deliveriesApi } from '../../../services/api/deliveries'

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
  state: 'RECONCILING',
  provenance: 'ORDERED',
  deliveredAt: '2026-08-12T08:00:00Z',
  agreedAt: null,
  verifiedAt: null,
  jurisdiction: 'TR',
  providerId: null,
  selectedRole: 'invoice',
  documents: [],
}

function event(over: Record<string, unknown> = {}) {
  return {
    id: 'del-syn',
    providerId: null,
    orderId: null,
    state: 'RECONCILING',
    provenance: 'ORDERED',
    jurisdiction: 'TR',
    deliveredAt: '2026-08-12T08:00:00Z',
    agreedAt: null,
    agreedRule: null,
    verifiedAt: null,
    verifiedBy: null,
    lapsedAt: null,
    lapseDeemed: null,
    amendedAt: null,
    ...over,
  }
}

const PROPOSAL = {
  id: 'prop-1',
  delivery_id: 'del-syn',
  document_id: 'doc-syn',
  line_no: 1,
  side: 'vendor',
  reason: 'SHORT_SHIP',
  qty_proposed: 10,
  unit_price_proposed: null,
  money_at_risk: null,
  evidence: [],
  note: null,
  status: 'open',
  counters_proposal_id: null,
  proposed_by: null,
  proposed_at: '2026-08-12T09:00:00Z',
  responded_at: null,
  responded_by: null,
}

function mount(role: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AuthContext.Provider
      value={{ activeRestaurantId: 'rest-syn', activeRole: role, user: null } as never}
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

describe('the delivery block, by who is looking (r28 G3, web)', () => {
  beforeEach(() => {
    documentMock.mockReset()
    eventMock.mockReset()
    threadMock.mockReset()
    documentMock.mockResolvedValue(response({ deliveries: [SPINE] }))
    eventMock.mockResolvedValue(event())
  })

  it('offers staff no Agree and no position form, and says who does them', async () => {
    threadMock.mockResolvedValue({ proposals: [PROPOSAL], moneyWithheld: true })
    mount('staff')
    await waitFor(() => expect(screen.getByTestId('delivery-gates')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('proposal-row')).toBeTruthy())
    expect(screen.queryByTestId('agree-button')).toBeNull()
    expect(screen.getByTestId('gates-need-a-manager').textContent).toMatch(
      /an owner or a manager does them/,
    )
    expect(screen.queryByTestId('open-proposal-form')).toBeNull()
    expect(screen.queryByTestId('accept-proposal')).toBeNull()
    expect(screen.queryByTestId('counter-proposal')).toBeNull()
    expect(screen.getByTestId('thread-money-withheld').textContent).toMatch(
      /shown to an owner or a manager only/,
    )
    expect(threadMock).toHaveBeenCalledWith('del-syn')
  })

  it('offers a manager every act, with no withheld sentence', async () => {
    threadMock.mockResolvedValue({
      proposals: [{ ...PROPOSAL, money_at_risk: 284 }],
      moneyWithheld: false,
    })
    mount('manager')
    await waitFor(() => expect(screen.getByTestId('agree-button')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('accept-proposal')).toBeTruthy())
    expect(screen.getByTestId('counter-proposal')).toBeTruthy()
    expect(screen.getByTestId('open-proposal-form')).toBeTruthy()
    expect(screen.queryByTestId('gates-need-a-manager')).toBeNull()
    expect(screen.queryByTestId('thread-money-withheld')).toBeNull()
    expect(screen.getByTestId('proposal-row').textContent).toMatch(/284/)
  })

  it('treats a session with no role at the house as not holding the money', async () => {
    threadMock.mockResolvedValue({ proposals: [], moneyWithheld: true })
    mount(null)
    await waitFor(() => expect(screen.getByTestId('delivery-gates')).toBeTruthy())
    expect(screen.queryByTestId('agree-button')).toBeNull()
    expect(screen.getByTestId('gates-need-a-manager')).toBeTruthy()
  })
})

describe('a first verify says what it did to the cost, and the invoice tax (r34 w2 F2)', () => {
  const TAX =
    'Cost posted for 1 item(s); 0 left provisional. On the invoice: nothing is left out of the bottle cost. Its prices include 20% tax, which this house reclaims, so the cost is net.'
  const verify = deliveriesApi.verify as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    documentMock.mockReset()
    eventMock.mockReset()
    threadMock.mockReset()
    verify.mockReset()
    documentMock.mockResolvedValue(response({ deliveries: [SPINE] }))
    eventMock.mockResolvedValue(event({ state: 'AGREED', agreedAt: '2026-08-12T10:00:00Z', agreedRule: 'both_sides_recorded' }))
    threadMock.mockResolvedValue({ proposals: [], moneyWithheld: false })
  })

  const press = async () => {
    mount('manager')
    const button = await screen.findByTestId('verify-button')
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(verify).toHaveBeenCalledWith('del-syn'))
  }

  it('[REVERT-FAILS] shows the gateway\'s cost sentence, tax and all, under the Verified gate', async () => {
    verify.mockResolvedValue({ alreadyVerified: false, costNote: TAX, cost: { finalised: [{}], stillProvisional: [] }, delivery: {} })
    await press()
    const note = await screen.findByTestId('verify-cost-note')
    expect(note.textContent).toBe(TAX)
    expect(note.getAttribute('role')).toBe('status')
    expect(screen.getByTestId('delivery-gates').contains(note)).toBe(true)
    expect(screen.queryByTestId('cost-repair-notice')).toBeNull()
  })

  it('[REVERT-FAILS] a first verify that left an item provisional says its reason once, in the sentence', async () => {
    const held = { inventoryId: 'i2', reason: 'the accepted proposal names no invoice line' }
    verify.mockResolvedValue({
      alreadyVerified: false,
      costNote: 'No cost was posted: 1 item(s) stay provisional. The accepted proposal names no invoice line',
      cost: { finalised: [], stillProvisional: [held] },
      delivery: {},
    })
    await press()
    const note = await screen.findByTestId('verify-cost-note')
    expect(note.textContent).toMatch(/stay provisional\. The accepted proposal names no invoice line$/)
    expect(screen.queryByTestId('cost-repair-notice')).toBeNull()
  })

  it('a later re-check replaces the first verify\'s sentence with its own notice', async () => {
    verify.mockResolvedValueOnce({ alreadyVerified: false, costNote: TAX, cost: { finalised: [{}], stillProvisional: [] }, delivery: {} })
    mount('manager')
    const button = await screen.findByTestId('verify-button')
    // The refetch after the verify reads the delivery as VERIFIED.
    eventMock.mockResolvedValue(event({ state: 'VERIFIED', agreedAt: '2026-08-12T10:00:00Z', agreedRule: 'both_sides_recorded', verifiedAt: '2026-08-12T11:00:00Z' }))
    await act(async () => {
      fireEvent.click(button)
    })
    expect(await screen.findByTestId('verify-cost-note')).toBeTruthy()
    verify.mockResolvedValueOnce({ alreadyVerified: true, costNote: 'already verified', cost: null, repair: { repaired: [], flagged: [] }, delivery: {} })
    const recheck = await screen.findByTestId('recheck-cost-button')
    await act(async () => {
      fireEvent.click(recheck)
    })
    await waitFor(() => expect(screen.getByTestId('cost-repair-notice')).toBeTruthy())
    expect(screen.queryByTestId('verify-cost-note')).toBeNull()
  })

  it('a refused verify shows the refusal and no cost sentence', async () => {
    verify.mockRejectedValue(new Error('Only an agreed delivery can be verified'))
    await press()
    await waitFor(() => expect(screen.getByTestId('gate-error')).toBeTruthy())
    expect(screen.queryByTestId('verify-cost-note')).toBeNull()
  })
})
