import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReceivingWorkspace } from './ReceivingWorkspace'

const verifyOrderReceipt = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock('../../../services/api/orders', () => ({ verifyOrderReceipt }))
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

/** The accepted/rejected steppers are the 1st/2nd "+" buttons in the quantities row. */
const plusButtons = () => screen.getAllByRole('button', { name: '+' })
const minusButtons = () => screen.getAllByRole('button', { name: '-' })
const submit = () => screen.getByRole('button', { name: /Accept|Reason required/ })

beforeEach(() => {
  vi.clearAllMocks()
  verifyOrderReceipt.mockResolvedValue({ ...order, status: 'COMPLETED' })
})

describe('ReceivingWorkspace — canonical WineOps invoice', () => {
  it('renders all three documents side by side', () => {
    renderWorkspace()

    expect(screen.getByText('Match invoice')).toBeInTheDocument()
    expect(screen.getByText('Ordered')).toBeInTheDocument()
    expect(screen.getByText('Invoiced')).toBeInTheDocument()
    expect(screen.getByText('Accepted')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByText('PO-1042', { exact: false })).toBeInTheDocument()
  })

  it('opens on a clean match, pre-filled from the order', () => {
    renderWorkspace()

    expect(screen.getByText('Clean match')).toBeInTheDocument()
    expect(screen.getByText('Matches agreed price')).toBeInTheDocument()
    expect(submit()).toHaveTextContent('Accept & complete')
    expect(submit()).not.toBeDisabled()
  })

  it('submits the counts as evidence and closes', async () => {
    const user = userEvent.setup()
    const { onClose } = renderWorkspace()

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

    const invoicePrice = screen.getByDisplayValue('22')
    await user.clear(invoicePrice)
    await user.type(invoicePrice, '24')

    expect(screen.getByText('Price variance')).toBeInTheDocument()
    expect(screen.getByText(/over agreed/)).toBeInTheDocument()
    expect(submit()).toBeDisabled()
    expect(submit()).toHaveTextContent('Reason required')

    await user.type(
      screen.getByPlaceholderText(/freight surcharge/),
      'agreed with rep by phone',
    )

    expect(submit()).not.toBeDisabled()
    expect(submit()).toHaveTextContent('Accept with override')

    await user.click(submit())
    expect(verifyOrderReceipt).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ priceOverrideReason: 'agreed with rep by phone' }),
    )
  })

  it('reads a rejected bottle as damage, not a short ship, and holds the order open', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    // One bottle arrived broken: accepted 23, rejected 1 -> 24 still physically arrived.
    await user.click(minusButtons()[0]) // accepted 24 -> 23
    await user.click(plusButtons()[1]) // rejected 0 -> 1

    expect(screen.getByText('Units rejected')).toBeInTheDocument()
    // "credit due" appears twice: once in the verdict summary, once as its own badge.
    expect(screen.getAllByText(/credit due/i).length).toBeGreaterThan(0)
    expect(submit()).toHaveTextContent('Accept & keep open')
    expect(screen.getByText(/1 bottle stays on backorder/)).toBeInTheDocument()

    await user.click(submit())
    expect(verifyOrderReceipt).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ acceptedQuantity: 23, rejectedQuantity: 1 }),
    )
  })

  it('reads a missing bottle as a short ship', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(minusButtons()[0]) // accepted 24 -> 23, nothing rejected

    expect(screen.getByText('Short shipment')).toBeInTheDocument()
    expect(screen.getByText(/only 23 arrived/)).toBeInTheDocument()
  })

  it('surfaces the real per-bottle cost when free goods arrive', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(plusButtons()[0]) // accepted 24 -> 25, still billed for 24

    expect(screen.getByText('Over-delivered')).toBeInTheDocument()
    // 24 x $22 spread over 25 bottles in hand = $21.12
    expect(screen.getByText('$21.12')).toBeInTheDocument()
  })

  it('is inert as a read-only audit record', () => {
    renderWorkspace({ readOnly: true })

    expect(screen.getByText('Receipt record')).toBeInTheDocument()
    expect(screen.getByText('Read-only audit record')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument()
  })
})
