import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RECEIVING_PRICE_CURRENCY_RUNGS } from '../../../../../api-gateway/src/procurement/price-currency'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ReceivingWorkspace } from './ReceivingWorkspace'

// A variable, not a literal: scripts/check_money_states_its_currency.py.
const FIXTURE_CURRENCY = 'USD'

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
/*
 * F-805: the price, the override and the freight are an owner's or a manager's.
 * Every test below is a manager unless it says otherwise.
 */
const mayAct = vi.hoisted(() => ({ value: true }))
vi.mock('../../../hooks/useMayActForTheHouse', () => ({
  useMayActForTheHouse: () => mayAct.value,
}))
vi.mock('../../../services/api/documents', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/documents')>(
    '../../../services/api/documents',
  )
  return { ...actual, documentsApi: { forOrder, forOrderWithCurrency } }
})
vi.mock('../../../stores', () => ({
  useNotificationStore: () => ({ success: toastSuccess, error: toastError }),
}))
/*
 * The house's own reporting currency, read by the screen since batch 67 so it
 * can OFFER a code beside a typed price. Stubbed rather than left to axios: an
 * unmocked read here would reach the network in a unit test and the screen would
 * silently render the un-offered case, which is exactly the state these tests
 * need to be able to set on purpose.
 */
const houseCurrency = vi.hoisted(() => vi.fn())
vi.mock('../../../services/api/settings', () => ({ settingsApi: { houseCurrency } }))
// ADR 0341 F3: the house's tax basis, unset unless a case says otherwise.
const getTaxBasis = vi.hoisted(() => vi.fn())
vi.mock('../../settings/next/TaxBasisSection', () => ({ getTaxBasis }))
// The real select renders a portal/popover that this test has no reason to drive.
vi.mock('../../../components/ui/ThemedSelect', () => ({
  ThemedSelect: () => null,
}))

/** The gateway's ledger block (ADR 0192), readable, with every field stated. */
const shelf = (over: Record<string, unknown> = {}) => ({
  readable: true,
  why: null,
  quantityInStockUom: 24,
  stockUom: 'bottle',
  packUnit: null,
  packSize: null,
  packs: null,
  looseInStockUom: null,
  words: '24 bottles',
  rejectedAtDoorBottles: 0,
  countedNotBookedBottles: 0,
  ...over,
})

// 24 bottles agreed at $22, all 24 already on the shelf per the stock ledger.
const order = {
  id: 'order-1',
  orderNumber: 'PO-1042',
  inventoryId: 'inv-1',
  wineName: 'Produttori Barbaresco 2019',
  providerName: 'Vino Distributors',
  quantity: 24,
  unitType: 'bottle',
  finalPrice: 22,
  received: shelf(),
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

const plusButtons = () => screen.getAllByRole('button', { name: /^Increase / })
const minusButtons = () => screen.getAllByRole('button', { name: /^Decrease / })
const submit = () =>
  screen.getByRole('button', { name: /Accept|Reason required|Currency required/ })

/** The match inputs, addressed by their accessible names. */
const invoiceQtyInput = () => screen.getByLabelText('Quantity invoiced')
const invoicePriceInput = () => screen.getByLabelText('Invoice unit price')
const currencySelect = () =>
  screen.getByLabelText('Invoice currency') as HTMLSelectElement

/**
 * Enter an invoice by hand, the way a manager does when no document is attached.
 *
 * The CURRENCY is part of that since 2026-09-06 (founder batch 67): the gateway
 * refuses a price with no code, so a helper that typed only a figure would leave
 * every test below driving a screen a real desk cannot submit.
 */
async function enterInvoice(
  user: ReturnType<typeof userEvent.setup>,
  qty = 24,
  price = 22,
  currency: string | null = 'USD',
) {
  await user.type(invoiceQtyInput(), String(qty))
  await user.type(invoicePriceInput(), String(price))
  if (currency) await user.selectOptions(currencySelect(), currency)
}

beforeEach(() => {
  vi.clearAllMocks()
  mayAct.value = true
  verifyOrderReceipt.mockResolvedValue({ ...order, status: 'COMPLETED' })
  getTaxBasis.mockResolvedValue({ readable: true, basis: 'unset', taxWord: 'KDV' })
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
  // A house that HAS answered the currency question, readably. Individual tests
  // override this to cover the unanswered and the unreadable cases.
  houseCurrency.mockResolvedValue({
    restaurantId: 'rest-1',
    code: 'TRY',
    country: 'Turkiye',
    readable: true,
    reason: null,
    statedAt: '2026-09-05T00:00:00.000Z',
  })
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
    expect(invoiceQtyInput()).toHaveValue('')
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

  it('F-341: says a euro order and a euro invoice in euros, never under a dollar sign', async () => {
    orderBlock = {
      id: 'order-1',
      currency: 'EUR',
      currencySource: 'vendor_usual',
      orderNumber: 'PO-1042',
      failure: null,
    }
    const user = userEvent.setup()
    renderWorkspace()

    await enterInvoice(user, 24, 24, 'EUR')

    expect(await screen.findByText('Billed €24.00 against an agreed €22.00.')).toBeInTheDocument()
    expect(screen.getByText('€22.00')).toBeInTheDocument()
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument()
  })

  it('F-341: holds a price billed in another money instead of asking for an override', async () => {
    // Agreed 22 EUR, billed 770 TRY. Before, the screen printed a euro "over agreed" figure
    // across the two moneys and refused to accept without a reason.
    orderBlock = {
      id: 'order-1',
      currency: 'EUR',
      currencySource: 'vendor_usual',
      orderNumber: 'PO-1042',
      failure: null,
    }
    const user = userEvent.setup()
    renderWorkspace()

    await enterInvoice(user, 24, 770, 'TRY')

    expect(await screen.findByText(/Not compared — agreed in EUR, billed in TRY/)).toBeInTheDocument()
    expect(screen.queryByText(/over agreed/)).not.toBeInTheDocument()
    expect(screen.queryByText('Why accept this price?')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reason required/ })).not.toBeInTheDocument()
    expect(screen.getByText(/The price was not compared/)).toBeInTheDocument()
  })

  it('reads a rejected bottle as damage, not a short ship, and does not hold the order open for it', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await enterInvoice(user)
    await user.click(minusButtons()[0]) // accepted 24 -> 23
    await user.click(plusButtons()[1]) // rejected 0 -> 1

    expect(screen.getByText('Units rejected')).toBeInTheDocument()
    expect(screen.getAllByText(/credit due/i).length).toBeGreaterThan(0)
    // The broken bottle was delivered: a claim, not a backorder (F-875).
    expect(submit()).toHaveTextContent('Accept & complete')

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

describe('ReceivingWorkspace — refused bottles are never still owed (F-875, F-876)', () => {
  // 24 ordered; 2 refused at the door, 22 on the shelf.
  const doorRefusedOrder = {
    ...order,
    received: shelf({
      quantityInStockUom: 22,
      words: '22 bottles',
      rejectedAtDoorBottles: 2,
      backorderBottles: 2,
    }),
  }

  it('closes the order when the only bottles missing were refused at the door', async () => {
    const user = userEvent.setup()
    renderWorkspace({ order: doorRefusedOrder })

    await enterInvoice(user, 22)
    expect(submit()).toHaveTextContent('Accept & complete')
    expect(screen.queryByTestId('receiving-backorder-footer')).not.toBeInTheDocument()
  })

  it('does not say refused bottles are still owed on the order', () => {
    renderWorkspace({ order: doorRefusedOrder })
    expect(screen.getByTestId('receiving-shelf-note')).toHaveTextContent('2 bottles were rejected at the door')
    expect(screen.queryByTestId('receiving-shelf-backorder')).not.toBeInTheDocument()
  })

  it('still says the bottles that never came', () => {
    renderWorkspace({
      order: {
        ...order,
        received: shelf({
          quantityInStockUom: 20,
          words: '20 bottles',
          rejectedAtDoorBottles: 1,
          rejectedAtDeskBottles: 1,
          backorderBottles: 4,
        }),
      },
    })
    expect(screen.getByTestId('receiving-shelf-backorder')).toHaveTextContent(
      '2 bottles are still owed on this order.',
    )
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
    expect(await screen.findByLabelText('Quantity invoiced')).toHaveValue('24')
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
    // The document pre-filled a PRICE and states no currency, and this order
    // names none either — so the desk says what the money is before it goes.
    await user.selectOptions(currencySelect(), 'USD')
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
    await user.selectOptions(currencySelect(), 'USD')
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

    const user = userEvent.setup()
    await user.selectOptions(currencySelect(), 'USD')
    await user.click(submit())

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
    expect(invoicePriceInput()).toHaveValue('')
  })

  it('leaves the quantity alone — only the price is refused', async () => {
    forOrder.mockResolvedValue([heldInvoice()])
    renderWorkspace()
    await screen.findByTestId('receiving-money-hold')
    // The count came off the same document and is untouched by a money question.
    expect(invoiceQtyInput()).toHaveValue('24')
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

/* ===========================================================================
 * ITEM B — A TYPED PRICE STATES ITS CURRENCY OR IS REFUSED.
 *
 * Founder, 2026-09-06 batch 67: *"a price without money is not a price: the
 * receiving screen requires a code (the order's, the house's, or one typed)
 * before a unit price is accepted; price_history never gains a currency-null
 * row from that door again."*
 *
 * The gateway refuses the pair (`VerifyReceiptDto.priceStatesItsCurrency` and
 * `verifyReceipt`), so these tests are about the screen not SENDING one — a
 * request that 400s is a worse version of the same refusal, delivered later and
 * as a red toast.
 *
 * These fail against the tree as it stood this morning: the price field had no
 * code beside it and the button submitted a currency-less price happily.
 * ======================================================================== */
describe('ReceivingWorkspace — a price says what it is in', () => {
  it('will not submit a typed price with no currency, and says why', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await enterInvoice(user, 24, 22, null) // no code chosen

    const panel = screen.getByTestId('receiving-price-needs-currency')
    expect(panel).toHaveTextContent('A price without a currency is not a price')
    // The promise: nothing else is blocked.
    expect(panel).toHaveTextContent('the count, the rejection and the stock movement')
    expect(submit()).toBeDisabled()
    expect(submit()).toHaveTextContent('Currency required')

    await user.click(submit())
    expect(verifyOrderReceipt).not.toHaveBeenCalled()
  })

  it('sends the code beside the price once one is chosen', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await enterInvoice(user, 24, 22, 'TRY')

    expect(screen.queryByTestId('receiving-price-needs-currency')).toBeNull()
    await user.click(submit())
    expect(verifyOrderReceipt).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ invoiceUnitPrice: 22, invoiceCurrency: 'TRY' }),
    )
  })

  it('PRE-FILLS the code from the order, when only the order names one', async () => {
    orderBlock = {
      id: 'order-1',
      currency: 'GBP',
      currencySource: 'typed',
      orderNumber: 'PO-1042',
      failure: null,
    }
    renderWorkspace()

    await screen.findByDisplayValue('GBP')
    const user = userEvent.setup()
    await user.type(invoicePriceInput(), '22')
    // Nothing to ask: the order already said it, and the desk can change it.
    expect(screen.queryByTestId('receiving-price-needs-currency')).toBeNull()
  })

  /* ---------------------------------------------------------------------
   * THE ORDER OF THE RUNGS (founder, 2026-09-11, batch 69):
   * "Invoice's filed code first, then the order's" — "A reading of the
   * document, like the quantities and prices on that screen already are;
   * when the two disagree the comparison banner already says so."
   * ------------------------------------------------------------------- */

  it('PRE-FILLS the INVOICE\u2019s filed code ahead of the order\u2019s', async () => {
    // The rung that changed. The field is literally the invoice's unit price,
    // so the code the invoice is filed in is a reading of the paper in front of
    // the desk rather than a fact about what was ordered.
    orderBlock = {
      id: 'order-1',
      currency: 'GBP',
      currencySource: 'typed',
      orderNumber: 'PO-1042',
      failure: null,
    }
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24 }], {
        currency: 'EUR',
        moneyState: { priced: true },
      }),
    ])
    renderWorkspace()

    await screen.findByDisplayValue('EUR')
    expect(currencySelect().value).toBe('EUR')
  })

  it('still says the two disagree, with the invoice\u2019s code in the field', async () => {
    // The comparison banner is what makes the invoice-first pre-fill safe: the
    // desk sees the code it is about to submit AND that the order named another.
    orderBlock = {
      id: 'order-1',
      currency: 'GBP',
      currencySource: 'typed',
      orderNumber: 'PO-1042',
      failure: null,
    }
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24 }], {
        currency: 'EUR',
        moneyState: { priced: true },
      }),
    ])
    renderWorkspace()

    await screen.findByDisplayValue('EUR')
    const panel = await screen.findByTestId('receiving-currency-compare')
    expect(panel).toHaveTextContent('The order was placed in GBP')
    expect(panel).toHaveTextContent('this invoice states EUR')
  })

  it('falls to the ORDER when the invoice states no code of its own', async () => {
    orderBlock = {
      id: 'order-1',
      currency: 'GBP',
      currencySource: 'typed',
      orderNumber: 'PO-1042',
      failure: null,
    }
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24 }], { currency: null }),
    ])
    renderWorkspace()

    await screen.findByDisplayValue('GBP')
    expect(currencySelect().value).toBe('GBP')
  })

  it('pre-fills NOTHING when neither the invoice nor the order states one', async () => {
    // Rung three is not a rung. The house reports in TRY (the beforeEach stub)
    // and that is still only ever a labelled chip, never the field.
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24 }], { currency: null }),
    ])
    const user = userEvent.setup()
    renderWorkspace()

    await screen.findByText(/Read from their paperwork/)
    await user.type(invoicePriceInput(), '22')
    expect(currencySelect().value).toBe('')
    expect(
      await screen.findByRole('button', { name: /this house reports in TRY/ }),
    ).toBeTruthy()
  })

  it('skips a rung naming a code this product cannot offer', async () => {
    // A withdrawn code is HELD, never filed as live money (batch 67). Writing it
    // into the field would offer a value the picker does not hold and the
    // gateway refuses, so the next rung answers instead.
    orderBlock = {
      id: 'order-1',
      currency: 'GBP',
      currencySource: 'typed',
      orderNumber: 'PO-1042',
      failure: null,
    }
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24 }], { currency: 'HRK' }),
    ])
    renderWorkspace()

    await screen.findByDisplayValue('GBP')
    expect(currencySelect().value).toBe('GBP')
  })

  it('NEVER assumes the house currency — it offers it, labelled', async () => {
    // The house reports in TRY (the beforeEach stub). That is a fact about the
    // HOUSE, not about what this vendor billed, so it arrives as a one-tap
    // choice that says where it came from — never in the field.
    const user = userEvent.setup()
    renderWorkspace()

    await user.type(invoicePriceInput(), '22')
    expect(currencySelect().value).toBe('')

    const offer = await screen.findByRole('button', { name: /this house reports in TRY/ })
    await user.click(offer)
    expect(currencySelect().value).toBe('TRY')
    expect(screen.queryByTestId('receiving-price-needs-currency')).toBeNull()
  })

  it('offers every rung as a labelled chip, nearest paper first, once the desk clears the field', async () => {
    // Since batch 69 the invoice's code pre-fills, so the chips appear only when
    // the desk CLEARS it (they live inside the "does not say what it is in"
    // panel) -- and they are offered in the same order the pre-fill tries them:
    // the invoice's filed code, then the order's, then the house's.
    orderBlock = {
      id: 'order-1',
      currency: 'GBP',
      currencySource: 'typed',
      orderNumber: 'PO-1042',
      failure: null,
    }
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24 }], {
        currency: 'EUR',
        moneyState: { priced: true },
      }),
    ])
    const user = userEvent.setup()
    renderWorkspace()

    await screen.findByDisplayValue('EUR')
    await user.selectOptions(currencySelect(), '')
    await user.type(invoicePriceInput(), '22')
    const panel = await screen.findByTestId('receiving-price-needs-currency')
    expect(within(panel).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'this invoice is filed in EUR',
      'the order was placed in GBP',
      'this house reports in TRY',
    ])
    await user.click(within(panel).getByRole('button', { name: /this invoice is filed in EUR/ }))
    expect(currencySelect().value).toBe('EUR')
  })

  it('a receipt with NO price submits with no currency at all', async () => {
    // The count is not a money question. This is the sentence the refusal
    // makes, kept by the screen as well as by the gateway.
    const user = userEvent.setup()
    renderWorkspace()

    expect(screen.queryByTestId('receiving-price-needs-currency')).toBeNull()
    expect(submit()).not.toBeDisabled()
    await user.click(submit())
    const [, body] = verifyOrderReceipt.mock.calls[0]
    expect(body.invoiceUnitPrice).toBeUndefined()
    expect(body.invoiceCurrency).toBeUndefined()
  })

  it('offers a currency the old 96-code list did not hold — HKD', async () => {
    // Batch 67's own example. Before today this option did not exist at all.
    const user = userEvent.setup()
    renderWorkspace()

    await enterInvoice(user, 24, 22, 'HKD')
    await user.click(submit())
    expect(verifyOrderReceipt).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ invoiceCurrency: 'HKD' }),
    )
  })

  it('prints the SAME sentence the gateway refuses with, naming every rung, even with no chip to offer', async () => {
    // Pinned after the audit of b6d2e4b4 (3 of 3 verifiers): the commit said the
    // DTO, verifyReceipt AND this screen share one sentence naming the rungs, and
    // this screen printed its own, naming none. It now renders the gateway's
    // shared half by import. The state below has NO chip (no order code, no
    // invoice, an unreadable house), which is exactly where the chips could
    // never name a rung and the sentence has to.
    houseCurrency.mockResolvedValue({
      restaurantId: 'rest-1',
      code: null,
      country: null,
      readable: false,
      reason: 'connection reset',
      statedAt: null,
    })
    const user = userEvent.setup()
    renderWorkspace()

    await user.type(invoicePriceInput(), '22')
    const panel = await screen.findByTestId('receiving-price-needs-currency')
    expect(within(panel).queryAllByRole('button')).toHaveLength(0)
    const said = within(panel).getByTestId('receiving-price-currency-rungs').textContent ?? ''
    expect(said).toBe(RECEIVING_PRICE_CURRENCY_RUNGS)
    expect(said).toContain('the matched invoice is filed in')
    expect(said).toContain('this order was placed in')
    expect(said).toContain("house's own reporting currency")
    expect(said).toContain('typed on the spot')
    expect(said).toContain('the count, the rejection and the stock movement')
  })

  it('a house whose currency could not be READ is not offered as a choice', async () => {
    // A failed read is not "no currency". Offering a code from an unreadable
    // register would be the absence-reported-as-health shape on a money field.
    houseCurrency.mockResolvedValue({
      restaurantId: 'rest-1',
      code: null,
      country: null,
      readable: false,
      reason: 'connection reset',
      statedAt: null,
    })
    const user = userEvent.setup()
    renderWorkspace()

    await user.type(invoicePriceInput(), '22')
    await screen.findByTestId('receiving-price-needs-currency')
    expect(screen.queryByRole('button', { name: /this house reports in/ })).toBeNull()
  })
})

/*
 * ADR 0192 — the count starts from what the stock LEDGER booked, and a part case
 * is counted in bottles. Every fixture is a CASE OF 12: at pack 1 cases and
 * bottles are the same number and none of these could fail.
 */
describe('ReceivingWorkspace — the count starts from the ledger (ADR 0192)', () => {
  const caseOrder = (received: unknown, over: Record<string, unknown> = {}) => ({
    ...order,
    quantity: 5,
    unitType: 'case',
    finalPrice: 264,
    priceUom: 'case',
    pricePackSize: 12,
    received,
    ...over,
  })

  it('counts a part case in bottles, says so, and declares the unit it sends', async () => {
    const user = userEvent.setup()
    renderWorkspace({
      order: caseOrder(
        shelf({
          quantityInStockUom: 65,
          packUnit: 'case',
          packSize: 12,
          packs: 5,
          looseInStockUom: 5,
          words: '5 cases + 5 bottles',
          rejectedAtDoorBottles: 1,
        }),
      ),
    })

    const note = screen.getByTestId('receiving-shelf-note')
    expect(note).toHaveTextContent('5 cases + 5 bottles')
    expect(note).toHaveTextContent('every number here is in bottles')
    expect(note).toHaveTextContent('1 bottle was rejected at the door')
    expect(screen.getByTestId('receiving-count-unit')).toHaveTextContent('Bottles')
    // The ordered figure is restated in bottles so the screen holds one unit.
    expect(screen.getByText('60')).toBeInTheDocument()

    await user.click(submit())
    const [, body] = verifyOrderReceipt.mock.calls[0]
    expect(body.acceptedQuantityInCountedUom).toBe(65)
    expect(body.countedUom).toBe('bottle')
  })

  it('[REVERT-FAILS] says a case shortfall in cases, not bottles (F-177)', () => {
    renderWorkspace({
      order: caseOrder(
        shelf({
          quantityInStockUom: 48,
          packUnit: 'case',
          packSize: 12,
          packs: 4,
          looseInStockUom: 0,
          words: '4 cases',
        }),
      ),
    })
    expect(screen.getByTestId('receiving-count-unit')).toHaveTextContent('Cases')
    expect(screen.getByTestId('receiving-backorder-footer')).toHaveTextContent(
      '1 case stays on backorder',
    )
  })

  it('counts a whole number of cases in cases, and declares nothing', async () => {
    const user = userEvent.setup()
    renderWorkspace({
      order: caseOrder(
        shelf({
          quantityInStockUom: 60,
          packUnit: 'case',
          packSize: 12,
          packs: 5,
          looseInStockUom: 0,
          words: '5 cases',
        }),
      ),
    })
    expect(screen.getByTestId('receiving-count-unit')).toHaveTextContent('Cases')

    await user.click(submit())
    const [, body] = verifyOrderReceipt.mock.calls[0]
    expect(body.acceptedQuantityInCountedUom).toBe(5)
    expect(body.countedUom).toBeUndefined()
  })

  it('never pre-fills from the retired column — the +660 bottle default is gone', async () => {
    // The door wrote 60 BOTTLES into quantityReceived; this screen read it as 60
    // CASES. With no ledger block the count starts from the ordered 5 and says so.
    const user = userEvent.setup()
    renderWorkspace({ order: caseOrder(undefined, { quantityReceived: 60 }) })
    expect(screen.getByTestId('receiving-shelf-note')).toHaveTextContent(
      'starts from the ordered quantity',
    )

    await user.click(submit())
    const [, body] = verifyOrderReceipt.mock.calls[0]
    expect(body.acceptedQuantityInCountedUom).toBe(5)
    expect(body.acceptedQuantityInCountedUom).not.toBe(60)
  })

  it('an unreadable ledger is said, with its reason, never read as zero', async () => {
    const user = userEvent.setup()
    renderWorkspace({
      order: caseOrder({
        ...shelf(),
        readable: false,
        why: 'The stock ledger could not be read (timeout).',
        quantityInStockUom: null,
        stockUom: null,
        words: null,
      }),
    })
    const note = screen.getByTestId('receiving-shelf-note')
    expect(note).toHaveTextContent('could not be read')
    expect(note).toHaveTextContent('timeout')

    await user.click(submit())
    const [, body] = verifyOrderReceipt.mock.calls[0]
    expect(body.acceptedQuantityInCountedUom).toBe(5)
  })
})

describe('ReceivingWorkspace — named controls (F-402)', () => {
  it('names each stepper by what it counts, and the close icon', async () => {
    const user = userEvent.setup()
    const { onClose } = renderWorkspace()
    expect(screen.getByRole('button', { name: 'Increase quantity accepted' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decrease quantity rejected' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})

/*
 * F-805 (after F-802): the gateway refuses staff a receipt that carries an
 * invoice price, an override reason or freight. The form must not offer staff
 * those fields nor send them, so a count never meets that refusal.
 */
describe('ReceivingWorkspace — the price is a manager\'s (F-805)', () => {
  // The paper bills $24 against an agreed $22, with $6 of freight on top.
  const billed = () =>
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24, unitPrice: 24 }], { freight: 6, currency: FIXTURE_CURRENCY }),
    ])

  it('[REVERT-FAILS] does not offer staff the price, and sends no price, override or freight', async () => {
    mayAct.value = false
    billed()
    renderWorkspace()
    await screen.findByText(/Read from their paperwork/)

    expect(screen.queryByLabelText('Invoice unit price')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Invoice currency')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/freight surcharge/)).not.toBeInTheDocument()
    expect(screen.getByTestId('receiving-price-held')).toHaveTextContent(
      'checked by a manager or an owner',
    )
    // The count stays theirs, and is not held for a reason they cannot give.
    expect(invoiceQtyInput()).toHaveValue('24')
    expect(submit()).not.toBeDisabled()

    const user = userEvent.setup()
    await user.click(submit())

    expect(verifyOrderReceipt).toHaveBeenCalledTimes(1)
    const [, body] = verifyOrderReceipt.mock.calls[0]
    expect(body.invoiceQuantityInInvoiceUom).toBe(24)
    expect(body.acceptedQuantityInCountedUom).toBe(24)
    expect(body.invoiceUnitPrice).toBeUndefined()
    expect(body.priceOverrideReason).toBeUndefined()
    expect(body.allocatedCharges).toBeUndefined()
    expect(body.invoiceCurrency).toBeUndefined()
    expect(body.prefilledInvoiceUnitPrice).toBeUndefined()
  })

  it('offers a manager the price and sends the price, override and freight', async () => {
    billed()
    renderWorkspace()
    await screen.findByText(/Read from their paperwork/)

    expect(screen.queryByTestId('receiving-price-held')).not.toBeInTheDocument()
    expect(invoicePriceInput()).toHaveValue('24')
    expect(submit()).toHaveTextContent('Reason required')

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText(/freight surcharge/), 'new vintage price')
    await user.click(submit())

    const [, body] = verifyOrderReceipt.mock.calls[0]
    expect(body.invoiceUnitPrice).toBe(24)
    expect(body.priceOverrideReason).toBe('new vintage price')
    expect(body.allocatedCharges).toBe(6)
    expect(body.invoiceCurrency).toBe('USD')
  })
})

/*
 * F-1023 (re-hit of F-358): the desk quantities and the unit price were
 * `type="number"` with a bare Number(). "45,50" came back '' on an English
 * browser and the price went out as no price at all.
 */
describe('ReceivingWorkspace — typed figures read by the house marks (F-1023)', () => {
  const billed = () =>
    forOrder.mockResolvedValue([
      doc('invoice', [{ qtyBottles: 24, unitPrice: 24 }], { freight: 6, currency: FIXTURE_CURRENCY }),
    ])

  it('[REVERT-FAILS] sends "45,50" as 45.5 in a lira house, not as no price', async () => {
    billed()
    renderWorkspace()
    await screen.findByText(/Read from their paperwork/)
    const user = userEvent.setup()
    await user.clear(invoicePriceInput())
    await user.type(invoicePriceInput(), '45,50')
    await user.type(screen.getByPlaceholderText(/freight surcharge/), 'new vintage price')
    await user.click(submit())

    const [, body] = verifyOrderReceipt.mock.calls[0]
    expect(body.invoiceUnitPrice).toBe(45.5)
  })

  it('[REVERT-FAILS] says a figure it cannot read and holds the button', async () => {
    billed()
    renderWorkspace()
    await screen.findByText(/Read from their paperwork/)
    const user = userEvent.setup()
    await user.clear(invoiceQtyInput())
    await user.type(invoiceQtyInput(), 'twelve')

    expect(screen.getByTestId('receiving-unread')).toHaveTextContent('“twelve” is not a number')
    expect(screen.getByRole('button', { name: 'Check the figures' })).toBeDisabled()
    expect(verifyOrderReceipt).not.toHaveBeenCalled()
  })
})

describe('ReceivingWorkspace — a keyboard and a screen reader can use it (F-1037)', () => {
  it('opens as a named dialog with focus inside, and Escape closes it', async () => {
    const user = userEvent.setup()
    const { onClose } = renderWorkspace()

    const dialog = screen.getByRole('dialog', { name: 'Match invoice' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    const dialog = screen.getByRole('dialog', { name: 'Match invoice' })

    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await user.tab()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('names the price reason, the rejected reason and the note by their labels', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await enterInvoice(user, 24, 24)
    await user.click(minusButtons()[0])
    await user.click(plusButtons()[1])

    expect(screen.getByRole('textbox', { name: 'Why accept this price?' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Why were 1 rejected?' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Note on this delivery' })).toBeInTheDocument()
  })
})

/**
 * ADR 0341 F3 (founder S218: "Yes, stamp cost basis"); ledger S234, owed by
 * w106-cost-truth. The gateway took `invoicePriceTaxBasis` (lot-cost-truth),
 * but no screen sent it, so every checked price stayed "not stated".
 */
describe('ReceivingWorkspace — whether tax is inside the invoice price (ADR 0341 F3)', () => {
  it('[REVERT-FAILS] asks at a house whose till prices include tax, and sends the answer', async () => {
    getTaxBasis.mockResolvedValue({ readable: true, basis: 'prices_include_tax', taxWord: 'KDV' })
    const user = userEvent.setup()
    renderWorkspace()
    await enterInvoice(user, 24, 22, 'EUR')
    expect(await screen.findByText('Is KDV inside this price?')).toBeInTheDocument()
    await user.click(screen.getByLabelText('No, before KDV'))
    await user.click(submit())
    expect(verifyOrderReceipt).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ invoiceUnitPrice: 22, invoicePriceTaxBasis: 'excludes_tax' }),
    )
  })

  it.each(['prices_include_tax', 'prices_exclude_tax'])(
    'sends nothing for it when not said, or where prices exclude tax (%s)',
    async (basis) => {
      getTaxBasis.mockResolvedValue({ readable: true, basis, taxWord: 'KDV' })
      const user = userEvent.setup()
      renderWorkspace()
      await enterInvoice(user, 24, 22, 'EUR')
      await user.click(submit())
      expect(verifyOrderReceipt).toHaveBeenCalled()
      expect(verifyOrderReceipt.mock.calls[0][1].invoicePriceTaxBasis).toBeUndefined()
    },
  )

  it('never asks staff, and never reads the house for them', async () => {
    mayAct.value = false
    getTaxBasis.mockResolvedValue({ readable: true, basis: 'prices_include_tax', taxWord: 'KDV' })
    renderWorkspace()
    await screen.findByTestId('receiving-price-held')
    expect(screen.queryByTestId('cost-tax-choice')).not.toBeInTheDocument()
    expect(getTaxBasis).not.toHaveBeenCalled()
  })
})

/*
 * F-1705: a 3,000-item house adding a substituted wine. The old picker held the
 * first 200 items and no search, and never said the list was cut.
 */
describe('ReceivingWorkspace — adding an item not on the invoice (F-1705)', () => {
  const many = Array.from({ length: 250 }, (_, n) => ({
    inventoryId: `inv-x${n}`,
    name: n === 230 ? 'Château Musar Rouge' : `House wine ${n}`,
    producer: n === 230 ? 'Musar' : 'Some maker',
    vintage: 2018,
  })) as unknown as Parameters<typeof ReceivingWorkspace>[0]['items']

  it('finds an item past the 200th by typing its name, and adds it', async () => {
    const user = userEvent.setup()
    renderWorkspace({ items: many })

    await user.type(screen.getByLabelText('Add an item not on the invoice'), 'musar')
    await user.click(screen.getByRole('button', { name: /Château Musar Rouge 2018/ }))

    expect(screen.getByText('Château Musar Rouge')).toBeInTheDocument()
    expect(screen.getByText('not on the invoice')).toBeInTheDocument()
  })

  it('says how many more match when it shows only a few', async () => {
    const user = userEvent.setup()
    renderWorkspace({ items: many })

    await user.type(screen.getByLabelText('Add an item not on the invoice'), 'house wine')

    expect(screen.getAllByRole('button', { name: /^House wine \d+ 2018$/ })).toHaveLength(8)
    expect(screen.getByText('241 more match. Type more of the name to find yours.')).toBeInTheDocument()
  })
})
