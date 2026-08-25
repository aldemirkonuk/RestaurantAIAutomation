import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReceivingWorkspace } from './ReceivingWorkspace'

const verifyOrderReceipt = vi.hoisted(() => vi.fn())
const forOrder = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock('../../../services/api/orders', () => ({ verifyOrderReceipt }))
vi.mock('../../../services/api/documents', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/documents')>(
    '../../../services/api/documents',
  )
  return { ...actual, documentsApi: { forOrder } }
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
    <QueryClientProvider client={client}>
      <ReceivingWorkspace order={order} items={[]} onClose={onClose} {...props} />
    </QueryClientProvider>,
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
})

describe('ReceivingWorkspace — canonical WineOps invoice', () => {
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
    expect(body.invoiceQuantity).toBeUndefined()
  })

  it('submits the counts as evidence and closes', async () => {
    const user = userEvent.setup()
    const { onClose } = renderWorkspace()

    await enterInvoice(user)
    await user.click(submit())

    expect(verifyOrderReceipt).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({
        invoiceQuantity: 24,
        invoiceUnitPrice: 22,
        acceptedQuantity: 24,
        rejectedQuantity: 0,
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
      expect.objectContaining({ acceptedQuantity: 23, rejectedQuantity: 1 }),
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
      expect.objectContaining({ shippedQuantity: 22, invoiceQuantity: 24 }),
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
