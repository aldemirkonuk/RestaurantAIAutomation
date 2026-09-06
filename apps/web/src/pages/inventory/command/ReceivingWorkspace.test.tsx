import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ReceivingWorkspace } from './ReceivingWorkspace'

const verifyOrderReceipt = vi.hoisted(() => vi.fn())
const forOrder = vi.hoisted(() => vi.fn())
const forOrderWithCurrency = vi.hoisted(() => vi.fn())
/** What the gateway says the ORDER was placed in, per test. */
let orderBlock: {
  id: string
  currency: string | null
  currencySource: 'vendor_usual' | 'typed' | null
  orderNumber: string | null
  failure: string | null
} | null = null
const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock('../../../services/api/orders', () => ({ verifyOrderReceipt }))
vi.mock('../../../services/api/documents', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/documents')>(
    '../../../services/api/documents',
  )
  return { ...actual, documentsApi: { forOrder, forOrderWithCurrency } }
})
vi.mock('../../../stores', () => ({
  useNotificationStore: () => ({ success: toastSuccess, error: toastError }),
}))
// The real select renders a portal/popover that this test has no reason to drive.
vi.mock('../../../components/ui/ThemedSelect', () => ({
  ThemedSelect: () => null,
}))

// 24 bottles agreed at $22, all 24 already stocked in at delivery.
const order = {
  id: 'order-1',
  orderNumber: 'PO-1042',
  inventoryId: 'inv-1',
  wineName: 'Produttori Barbaresco 2019',
  providerName: 'Vino Distributors',
  quantity: 24,
  finalPrice: 22,
  quantityReceived: 24,
}

/** A document as the API returns it, with the extraction the screen reads. */
const doc = (
  docType: string,
  lines: Array<{ qtyBottles: number; unitPrice?: number; freeGoodsQty?: number }>,
  extra: Record<string, unknown> = {},
) => ({
  id: `${docType}-1`,
  doc_type: docType,
  doc_number: `${docType.toUpperCase()}-99`,
  status: 'received',
  ties_out: true,
  created_at: '2026-07-27T10:00:00.000Z',
  extracted: { lines },
  ...extra,
})

function renderWorkspace(props: Partial<Parameters<typeof ReceivingWorkspace>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ReceivingWorkspace order={order} items={[]} onClose={onClose} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { onClose }
}

const plusButtons = () => screen.getAllByRole('button', { name: '+' })
const minusButtons = () => screen.getAllByRole('button', { name: '-' })
const submit = () => screen.getByRole('button', { name: /Accept|Reason required/ })

/** The match inputs, addressed by their accessible names. */
const invoiceQtyInput = () => screen.getByLabelText('Quantity invoiced')
const invoicePriceInput = () => screen.getByLabelText('Invoice unit price')

/** Enter an invoice by hand, the way a manager does when no document is attached. */
async function enterInvoice(
  user: ReturnType<typeof userEvent.setup>,
  qty = 24,
  price = 22,
) {
  await user.type(invoiceQtyInput(), String(qty))
  await user.type(invoicePriceInput(), String(price))
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyOrderReceipt.mockResolvedValue({ ...order, status: 'COMPLETED' })
  forOrder.mockResolvedValue([])
  orderBlock = null
  /*
   * The screen now reads documents AND the order's own currency in one request
   * (B4). `forOrderWithCurrency` is derived from `forOrder` rather than stubbed
   * separately so that every existing test's `forOrder.mockResolvedValue([...])`
   * keeps meaning what it meant — one place to set documents, not two that can
   * disagree.
   */
  forOrderWithCurrency.mockImplementation(async (id: string) => ({
    documents: await forOrder(id),
    order: orderBlock,
  }))
})

describe('ReceivingWorkspace — canonical Mudavym invoice', () => {
  it('renders all four documents side by side', () => {
    renderWorkspace()

    expect(screen.getByText('Match invoice')).toBeInTheDocument()
    expect(screen.getByText('Ordered')).toBeInTheDocument()
    expect(screen.getByText('Shipped')).toBeInTheDocument()
    expect(screen.getByText('Invoiced')).toBeInTheDocument()
    expect(screen.getByText('Accepted')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByText('PO-1042', { exact: false })).toBeInTheDocument()
  })

  it('opens as UNMATCHED with nothing pre-filled from the order', () => {
    // The behaviour this replaces defaulted the invoice to the stocked quantity,
    // which made the headline check compare a number to itself and recorded a
    // price as verified that nobody had looked at.
    renderWorkspace()

    expect(screen.getByText('No invoice yet')).toBeInTheDocument()
    expect(invoiceQtyInput()).toHaveValue(null)
    expect(screen.getByText(/No paperwork attached/)).toBeInTheDocument()
  })

  it('omits the invoice quantity entirely when none was entered', async () => {
    // undefined, not 0 and not the order quantity — the server reads absence as
    // unknown and holds the order open until the paperwork turns up.
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(submit())

    const [, body] = verifyOrderReceipt.mock.calls[0]
    expect(body.invoiceQuantityInInvoiceUom).toBeUndefined()
  })

  it('submits the counts as evidence and closes', async () => {
    const user = userEvent.setup()
    const { onClose } = renderWorkspace()

    await enterInvoice(user)
    await user.click(submit())

    expect(verifyOrderReceipt).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({
        invoiceQuantityInInvoiceUom: 24,
        invoiceUnitPrice: 22,
        acceptedQuantityInCountedUom: 24,
        rejectedQuantityInCountedUom: 0,
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('blocks completion on a price deviation until a reason is given', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await enterInvoice(user, 24, 24)

    expect(screen.getByText('Price variance')).toBeInTheDocument()
    expect(submit()).toBeDisabled()
    expect(submit()).toHaveTextContent('Reason required')

    await user.type(
      screen.getByPlaceholderText(/freight surcharge/),
      'agreed with rep by phone',
    )

    expect(submit()).not.toBeDisabled()
    await user.click(submit())
    expect(verifyOrderReceipt).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ priceOverrideReason: 'agreed with rep by phone' }),
    )
  })

  it('reads a rejected bottle as damage, not a short ship, and holds the order open', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await enterInvoice(user)
    await user.click(minusButtons()[0]) // accepted 24 -> 23
    await user.click(plusButtons()[1]) // rejected 0 -> 1

    expect(screen.getByText('Units rejected')).toBeInTheDocument()
    expect(screen.getAllByText(/credit due/i).length).toBeGreaterThan(0)
    expect(submit()).toHaveTextContent('Accept & keep open')

    await user.click(submit())
    expect(verifyOrderReceipt).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ acceptedQuantityInCountedUom: 23, rejectedQuantityInCountedUom: 1 }),
    )
  })

  it('reads a missing bottle as a short ship', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await enterInvoice(user)
    await user.click(minusButtons()[0])

    expect(screen.getByText('Short shipment')).toBeInTheDocument()
  })

  it('is inert as a read-only audit record', () => {
    renderWorkspace({ readOnly: true })

    expect(screen.getByText('Receipt record')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument()
  })
})

describe('reading the vendor’s own paperwork', () => {
  it('pre-fills the invoice column from an extracted document', async () => {
    // The wedge: a manager confirms a transcription instead of performing one.
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24, unitPrice: 22 }]),
    ])
    renderWorkspace()

    expect(await screen.findByText(/Read from their paperwork/)).toBeInTheDocument()
    expect(await screen.findByLabelText('Quantity invoiced')).toHaveValue(24)
    expect(screen.getByText(/Invoice INVOICE-99/)).toBeInTheDocument()
  })

  it('proves an overbill from the vendor’s own two documents', async () => {
    // Their packing slip says 22 left the warehouse; their invoice bills 24.
    // Nothing we counted is involved, so there is nothing to dispute.
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24, unitPrice: 22 }]),
      doc('packing_slip', [{ qtyBottles: 22 }]),
    ])
    renderWorkspace()

    expect(await screen.findByText('Overbilled vs their slip')).toBeInTheDocument()
    expect(
      screen.getByText(/packing slip and their invoice disagree/),
    ).toBeInTheDocument()
  })

  it('sends the packing slip quantity to the server, not just the invoice', async () => {
    const user = userEvent.setup()
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24, unitPrice: 22 }]),
      doc('packing_slip', [{ qtyBottles: 22 }]),
    ])
    renderWorkspace()

    // No price deviation here, so nothing blocks submission — the discrepancy is
    // purely between the vendor's own two documents.
    await screen.findByText(/Overbilled vs their slip/)
    await user.click(submit())

    expect(verifyOrderReceipt).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ shippedQuantityInShippedUom: 22, invoiceQuantityInInvoiceUom: 24 }),
    )
  })

  it('warns loudly when an extracted invoice does not add up to its own total', async () => {
    // The cheapest hallucination detector there is: a misread quantity or price
    // nearly always breaks the arithmetic.
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24, unitPrice: 22 }], { ties_out: false }),
    ])
    renderWorkspace()

    expect(await screen.findByText(/do not add up to its own total/)).toBeInTheDocument()
  })

  it('nets declared free goods out instead of reporting an overage', async () => {
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24, unitPrice: 22, freeGoodsQty: 1 }]),
    ])
    renderWorkspace()

    await screen.findByText(/Read from their paperwork/)
    // 25 in hand, 24 billed, 1 of them free -> a clean match, not qty_over.
    const user = userEvent.setup()
    await user.click(plusButtons()[0])

    expect(screen.queryByText('Over-delivered')).not.toBeInTheDocument()
  })
})

/**
 * ADR 0059 — the pre-fill is a machine proposal, and the manager's edit is the
 * answer to it. Both must reach the server.
 *
 * Before this, a manager correcting a misread invoice quantity from 22 to 24
 * left no trace whatsoever: the submitted 24 was byte-identical to a 24 the
 * model had read correctly. Every extraction correction — the most valuable
 * label this screen can produce — was invisible in the only corpus that could
 * grade the extractor.
 *
 * These fail against pristine origin/main: `verifyOrderReceipt` was called with
 * no prefilled_* fields at all.
 */
describe('ReceivingWorkspace — ADR 0059, the correction is visible', () => {
  it('sends what the extraction proposed alongside what the manager submitted', async () => {
    // The paper says 22. The manager, holding the cases, says 24.
    forOrder.mockResolvedValue([doc('invoice', [{ qtyBottles: 22, unitPrice: 22 }])])
    renderWorkspace()
    await screen.findByText(/Read from their paperwork/)

    const user = userEvent.setup()
    await user.clear(invoiceQtyInput())
    await user.type(invoiceQtyInput(), '24')
    await user.click(submit())

    expect(verifyOrderReceipt).toHaveBeenCalledTimes(1)
    const [, body] = verifyOrderReceipt.mock.calls[0]
    // The answer.
    expect(body.invoiceQuantityInInvoiceUom).toBe(24)
    // The proposal it overrode — frozen at pre-fill time, unmoved by the edit.
    expect(body.prefilledInvoiceQuantityInInvoiceUom).toBe(22)
    expect(body.prefilledInvoiceUnitPrice).toBe(22)
  })

  it('records agreement too, not only correction', async () => {
    forOrder.mockResolvedValue([doc('invoice', [{ qtyBottles: 24, unitPrice: 22 }])])
    renderWorkspace()
    await screen.findByText(/Read from their paperwork/)

    await userEvent.setup().click(submit())

    const [, body] = verifyOrderReceipt.mock.calls[0]
    // Equal values are not a redundant write: "the human looked and agreed" is
    // a positive label, and it is only visible because both halves are sent.
    expect(body.invoiceQuantityInInvoiceUom).toBe(24)
    expect(body.prefilledInvoiceQuantityInInvoiceUom).toBe(24)
  })

  it('sends no proposal when no document pre-filled the form', async () => {
    forOrder.mockResolvedValue([])
    renderWorkspace()

    const user = userEvent.setup()
    await enterInvoice(user)
    await user.click(submit())

    const [, body] = verifyOrderReceipt.mock.calls[0]
    // A hand-keyed invoice is an original answer, not a correction of one.
    // Sending 0 or null here would fabricate a proposal nobody made.
    expect(body.prefilledInvoiceQuantityInInvoiceUom).toBeUndefined()
    expect(body.prefilledShippedQuantityInShippedUom).toBeUndefined()
  })
})

/**
 * ITEM A + B4 — a held invoice refuses the price at the door, and the order's
 * currency is printed beside the invoice's (founder, 2026-09-06 batch 64/65).
 *
 * The verdict itself is the GATEWAY's: `moneyState` arrives on the document,
 * computed by the same function `verifyReceipt` refuses with. These tests pin
 * that the screen renders that verdict rather than re-deriving one — a second
 * implementation in the browser is how a page comes to show an enabled field
 * over a request the server will reject.
 */
describe('ReceivingWorkspace — a held invoice refuses the price', () => {
  const HOLD =
    'MONEY HELD, NOT FILED. order PO-1042 was placed in EUR, and this document’s printed currency states USD.'

  const heldInvoice = () =>
    doc('invoice', [{ qtyBottles: 24, unitPrice: 22 }], {
      currency: null,
      moneyState: { priced: false, reason: HOLD },
    })

  it('disables the price field and prints the reason, what still works, and the act', async () => {
    forOrder.mockResolvedValue([heldInvoice()])
    renderWorkspace()

    const panel = await screen.findByTestId('receiving-money-hold')
    expect(panel).toHaveTextContent('MONEY HELD, NOT FILED')
    expect(panel).toHaveTextContent('placed in EUR')
    // The founder's "stock proceeds", on the screen.
    expect(panel).toHaveTextContent(/stock movement are unaffected/i)
    expect(panel).toHaveTextContent(/submitted now[\s\S]*without a price/i)
    // The act that clears it, as a link a person can follow — not prose.
    const link = screen.getByRole('link', { name: /Restate or confirm/i })
    expect(link).toHaveAttribute('href', '/receipts?doc=invoice-1')

    // Disabled, never hidden.
    expect(invoicePriceInput()).toBeDisabled()
    expect(invoicePriceInput()).toBeInTheDocument()
  })

  it('does not pre-fill the price from a held invoice', async () => {
    forOrder.mockResolvedValue([heldInvoice()])
    renderWorkspace()
    await screen.findByTestId('receiving-money-hold')
    expect(invoicePriceInput()).toHaveValue(null)
  })

  it('leaves the quantity alone — only the price is refused', async () => {
    forOrder.mockResolvedValue([heldInvoice()])
    renderWorkspace()
    await screen.findByTestId('receiving-money-hold')
    // The count came off the same document and is untouched by a money question.
    expect(invoiceQtyInput()).toHaveValue(24)
    expect(invoiceQtyInput()).not.toBeDisabled()
  })

  it('a document whose money IS filed leaves the price field open', async () => {
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24, unitPrice: 22 }], {
        currency: 'EUR',
        moneyState: { priced: true },
      }),
    ])
    renderWorkspace()
    await screen.findByDisplayValue('22')
    expect(screen.queryByTestId('receiving-money-hold')).toBeNull()
    expect(invoicePriceInput()).not.toBeDisabled()
  })

  it('a gateway that sends no moneyState at all holds nothing', async () => {
    forOrder.mockResolvedValue([doc('invoice', [{ qtyBottles: 24, unitPrice: 22 }])])
    renderWorkspace()
    await screen.findByDisplayValue('22')
    expect(screen.queryByTestId('receiving-money-hold')).toBeNull()
  })
})

describe('ReceivingWorkspace — the order’s currency beside the invoice’s (B4)', () => {
  it('names both when they differ, and converts nothing', async () => {
    orderBlock = {
      id: 'order-1',
      currency: 'EUR',
      currencySource: 'vendor_usual',
      orderNumber: 'PO-1042',
      failure: null,
    }
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24, unitPrice: 22 }], {
        currency: 'GBP',
        moneyState: { priced: true },
      }),
    ])
    renderWorkspace()

    const panel = await screen.findByTestId('receiving-currency-compare')
    expect(panel).toHaveTextContent('The order was placed in EUR')
    expect(panel).toHaveTextContent('this invoice states GBP')
    expect(panel).toHaveTextContent(/Nothing has been converted/i)
  })

  it('says nothing when the two agree', async () => {
    orderBlock = {
      id: 'order-1',
      currency: 'EUR',
      currencySource: 'typed',
      orderNumber: 'PO-1042',
      failure: null,
    }
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24, unitPrice: 22 }], {
        currency: 'EUR',
        moneyState: { priced: true },
      }),
    ])
    renderWorkspace()
    await screen.findByDisplayValue('22')
    expect(screen.queryByTestId('receiving-currency-compare')).toBeNull()
  })

  it('A FAILED READ IS NOT AN AGREEMENT: it says the comparison could not be made', async () => {
    orderBlock = {
      id: 'order-1',
      currency: null,
      currencySource: null,
      orderNumber: null,
      failure:
        "The order's own currency could not be read (connection reset), so the invoice cannot be compared against it here.",
    }
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24, unitPrice: 22 }], {
        currency: 'GBP',
        moneyState: { priced: true },
      }),
    ])
    renderWorkspace()

    const panel = await screen.findByTestId('receiving-currency-compare')
    expect(panel).toHaveTextContent('could not be read')
    expect(panel).not.toHaveTextContent('The order was placed in')
  })
})
