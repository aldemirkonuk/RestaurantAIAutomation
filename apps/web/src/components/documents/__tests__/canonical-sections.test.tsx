/**
 * The canonical document's conditional sections (ADR 0104 D2, D4, D13;
 * ADR 0103 A6). EVERY name, number and id below is SYNTHETIC.
 *
 * These are the assertions the design is, rather than the ones the code happens
 * to make true today:
 *   · a delivery note has NO money block
 *   · a credit memo HAS a claim block
 *   · `not_counted` renders as the WORDS "not counted"
 *   · nothing anywhere renders a confidence as a number
 *   · an empty layer 1 raises the NOT EXTRACTED banner
 *   · the spine collapses at ≤ 2 documents and is ABSENT at none
 *   · a failed spine read is not an empty spine
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CanonicalSheet } from '../CanonicalSheet'
import { VerdictBlock } from '../VerdictBlock'
import { DeliverySpine } from '../DeliverySpine'
import { DegradedNotice, degradedReasons } from '../DegradedNotice'
import { DoorFrame } from '../DoorFrame'
import type {
  AdjudicatedLine,
  CanonicalDocument,
  DeliverySpine as Spine,
  ExtractedLine,
  FieldEnvelope,
} from '../../../services/api/canonical'

const env = <T,>(value: T | null, extra: Partial<FieldEnvelope<T>> = {}): FieldEnvelope<T> => ({
  value,
  source: 'extracted',
  confidence: null,
  revision: 1,
  ...extra,
})

const line = (over: Partial<ExtractedLine> = {}): ExtractedLine => ({
  lineId: env<string>(null),
  description: env('SYNTHETIC Öküzgözü'),
  sellerItemId: env<string>(null),
  quantity: env(12),
  unit: env('bottle'),
  netPrice: env(142, { as_printed: '142,00 / KS(12)' }),
  priceBaseQuantity: env(12, { as_printed: 'KS(12)' }),
  priceBaseUnit: env('bottle'),
  netAmount: env(142),
  allowancesCharges: [],
  vatCategory: env<string>(null),
  vatRate: env<number>(null),
  vintage: env(2021),
  lot: env<string>(null),
  formatMl: env(750),
  freeGoodsQty: env(0),
  ...over,
})

const adjudicated = (over: Partial<AdjudicatedLine> = {}): AdjudicatedLine => ({
  lineIndex: 0,
  ordered: 12,
  shipped: 12,
  received: 'not_counted',
  billed: 12,
  verdict: 'ok',
  reason: null,
  moneyAtRisk: null,
  ...over,
})

const party = () => ({
  name: env('SYNTHETIC Vendor A.Ş.'),
  vatIdentifier: env('0000000000'),
  identifier: env<string>(null),
  address: env<string>(null),
  electronicAddress: env<string>(null),
})

const totals = () => ({
  linesNetTotal: env(142),
  allowancesTotal: env(0),
  chargesTotal: env(0),
  taxExclusiveAmount: env(142),
  taxAmount: env(28.4),
  taxInclusiveAmount: env(170.4, { as_printed: '170,40 TL' }),
  paidAmount: env<number>(null),
  roundingAmount: env<number>(null),
  amountDue: env(170.4),
})

const doc = (over: Partial<CanonicalDocument> = {}): CanonicalDocument => ({
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
    paymentDueDate: env<string>(null),
    paymentTerms: env<string>(null),
    seller: party(),
    buyer: party(),
    purchaseOrderReference: env<string>(null),
    despatchAdviceReference: env<string>(null),
    precedingInvoiceReference: env<string>(null),
    actualDeliveryDate: env('2026-08-12'),
    deliveryLocation: env<string>(null),
    lines: [line()],
    allowancesCharges: [],
    totals: totals(),
    vatBreakdown: [],
  },
  layer2: { providerId: null, lines: [] },
  layer3: {
    lines: [adjudicated()],
    tiesOut: true,
    tieOutDeltaCents: 0,
    verdicts: [],
  },
  ...over,
})

const spineDoc = (id: string, role: string) => ({
  documentId: id,
  role,
  docType: 'invoice',
  docNumber: `SYN-${id}`,
  docDate: '2026-08-14',
  status: 'needs_review',
  total: 170.4,
  currency: 'TRY',
  createdAt: '2026-08-14T09:12:00Z',
  isSelected: id === 'doc-syn',
})

const spine = (documents: ReturnType<typeof spineDoc>[], over: Partial<Spine> = {}): Spine => ({
  deliveryId: 'dl-1',
  state: 'RECONCILING',
  provenance: 'ORDERED',
  deliveredAt: '2026-08-12T07:41:00Z',
  agreedAt: null,
  verifiedAt: null,
  jurisdiction: 'TR',
  providerId: null,
  selectedRole: 'invoice',
  documents,
  ...over,
})

/** No percentage, and no bare 0–1 decimal, anywhere in the rendered text. */
function assertNoConfidenceNumber(container: HTMLElement) {
  const text = container.textContent ?? ''
  expect(text).not.toMatch(/\d+\s?%/)
  expect(text).not.toMatch(/\b0\.\d{1,3}\b/)
}

describe('CanonicalSheet — conditional sections (ADR 0104 D2)', () => {
  it('renders no money block on a delivery note', () => {
    const { queryByTestId, getByTestId } = render(
      <CanonicalSheet doc={doc({ docType: 'delivery_note' })} />,
    )
    expect(queryByTestId('money-block')).toBeNull()
    // And it SAYS why, rather than leaving a hole a reader must interpret.
    expect(getByTestId('no-money-note').textContent).toMatch(/No money on this document/)
  })

  it('renders the money block on an invoice', () => {
    const { getByTestId } = render(<CanonicalSheet doc={doc()} />)
    expect(getByTestId('money-block')).toBeTruthy()
  })

  it('renders a claim block on a credit memo, and on nothing else', () => {
    const { queryByTestId } = render(<CanonicalSheet doc={doc()} />)
    expect(queryByTestId('claim-block')).toBeNull()

    const memo = render(<CanonicalSheet doc={doc({ docType: 'credit_memo' })} />)
    expect(memo.getByTestId('claim-block')).toBeTruthy()
  })

  it('renders `not_counted` as the words "not counted", never as 0', () => {
    const { getByTestId } = render(<CanonicalSheet doc={doc()} />)
    const cell = getByTestId('received-cell')
    expect(cell.textContent).toBe('not counted')
    expect(cell.textContent).not.toBe('0')
  })

  it('renders a counted quantity as the number it was', () => {
    const d = doc()
    d.layer3.lines = [adjudicated({ received: 10 })]
    const { getByTestId } = render(<CanonicalSheet doc={d} />)
    expect(getByTestId('received-cell').textContent).toBe('10')
  })

  it('prints the price base as a sub-line when the paper stated one', () => {
    const { getByTestId } = render(<CanonicalSheet doc={doc()} />)
    // `142,00 / KS(12)` — the factor of twelve, on screen.
    expect(getByTestId('price-base').textContent).toMatch(/per 12 bottle/)
  })

  it('prints no price-base sub-line when the paper printed none', () => {
    const d = doc()
    d.layer1.lines = [
      line({ priceBaseQuantity: env(1), netPrice: env(22, { as_printed: null }) }),
    ]
    const { queryByTestId } = render(<CanonicalSheet doc={d} />)
    expect(queryByTestId('price-base')).toBeNull()
  })

  it('prints no line table and no totals when nothing was read', () => {
    // `Lines $0.00` on a document with no lines is a computed sum of nothing
    // wearing a currency the intake defaulted to. Two fabrications in one row.
    const d = doc()
    d.layer1.lines = []
    d.layer3.lines = []
    const { queryByTestId, container } = render(<CanonicalSheet doc={d} />)
    expect(queryByTestId('sheet-line')).toBeNull()
    expect(queryByTestId('money-block')).toBeNull()
    expect(queryByTestId('nothing-read-note')).toBeTruthy()
    expect(container.textContent).not.toMatch(/\$0\.00|₺0,00/)
  })

  it('never renders a confidence as a number', async () => {
    const d = doc()
    // A genuinely low confidence, which must still not print as 0.42 or 42%.
    d.layer1.lines = [line({ netPrice: env(142, { confidence: 0.42, as_printed: '142,00' }) })]
    const { container } = render(<CanonicalSheet doc={d} />)
    assertNoConfidenceNumber(container)

    // …including inside the provenance popover.
    await userEvent.click(screen.getByLabelText('Where Unit price, line 1 came from'))
    assertNoConfidenceNumber(container)
    expect(container.textContent).toMatch(/read with difficulty/)
  })

  it('says "as printed: not kept" rather than inventing a literal', async () => {
    const d = doc()
    d.layer1.lines = [line({ netPrice: env(142, { as_printed: null }) })]
    render(<CanonicalSheet doc={d} />)
    await userEvent.click(screen.getByLabelText('Where Unit price, line 1 came from'))
    expect(screen.getByRole('tooltip').textContent).toMatch(/as printed: not kept/)
  })
})

describe('VerdictBlock (ADR 0104 D4)', () => {
  it('names each exception in words and numbers', () => {
    const d = doc()
    d.layer3.lines = [
      adjudicated({ verdict: 'short_ship', received: 10, billed: 12, moneyAtRisk: 840 }),
    ]
    const { container } = render(<VerdictBlock doc={d} />)
    expect(container.textContent).toMatch(/1 line differs/)
    expect(container.textContent).toMatch(/billed 12 bottle, received 10 bottle/)
    expect(container.textContent).toMatch(/₺840,00/)
    assertNoConfidenceNumber(container)
  })

  it('does NOT call an unread document clean', () => {
    // Caught on screen 2026-09-04 against three real documents extraction could
    // not read: zero lines produced zero exceptions, and this block announced
    // "Nothing on this document differs from the delivery." A comparison that
    // never ran must never render as a clean bill of health.
    const d = doc()
    d.layer1.lines = []
    d.layer3.lines = []
    const { container } = render(<VerdictBlock doc={d} />)
    expect(container.textContent).toMatch(/Nothing was read from this document/)
    expect(container.textContent).not.toMatch(/Nothing on this document differs/)
    expect(container.textContent).toMatch(/unread/)
    expect(container.textContent).toMatch(/no arithmetic to check/)
  })

  it('keeps the untestable tie-out separate from a passing one', () => {
    const d = doc()
    d.layer3.tiesOut = null
    const { container } = render(<VerdictBlock doc={d} />)
    expect(container.textContent).toMatch(/could not be checked/)
    expect(container.textContent).toMatch(/untested, not correct/)
  })

  it('says the amount is not computed rather than printing a zero at risk', () => {
    const d = doc()
    d.layer3.lines = [adjudicated({ verdict: 'price_variance', moneyAtRisk: null })]
    const { getByTestId } = render(<VerdictBlock doc={d} />)
    expect(getByTestId('money-at-risk').textContent).toMatch(/not yet computed/)
  })
})

describe('DeliverySpine (ADR 0104 D13)', () => {
  it('is absent when the document sits on no delivery', () => {
    const { container } = render(
      <DeliverySpine deliveries={[]} selectedDocumentId="doc-syn" />,
    )
    expect(container.textContent).toBe('')
  })

  it('collapses by default at two documents and opens on request', async () => {
    const { getByTestId, queryAllByTestId, getByText } = render(
      <DeliverySpine
        deliveries={[spine([spineDoc('doc-syn', 'invoice'), spineDoc('doc-po', 'purchase_order')])]}
        selectedDocumentId="doc-syn"
      />,
    )
    expect(getByTestId('spine-delivery').getAttribute('data-open')).toBe('false')
    expect(queryAllByTestId('spine-card')).toHaveLength(0)

    await userEvent.click(getByText('Show the delivery'))
    expect(queryAllByTestId('spine-card')).toHaveLength(2)
  })

  it('is expanded at three documents, where the event IS the story', () => {
    const { getByTestId, queryAllByTestId } = render(
      <DeliverySpine
        deliveries={[
          spine([
            spineDoc('doc-po', 'purchase_order'),
            spineDoc('doc-irs', 'despatch_advice'),
            spineDoc('doc-syn', 'invoice'),
          ]),
        ]}
        selectedDocumentId="doc-syn"
      />,
    )
    expect(getByTestId('spine-delivery').getAttribute('data-open')).toBe('true')
    expect(queryAllByTestId('spine-card')).toHaveLength(3)
  })

  it('marks an UNORDERED delivery permanently', () => {
    const { getByTestId } = render(
      <DeliverySpine
        deliveries={[spine([spineDoc('doc-syn', 'invoice')], { provenance: 'UNORDERED' })]}
        selectedDocumentId="doc-syn"
      />,
    )
    expect(getByTestId('unordered-mark').textContent).toMatch(/UNORDERED · permanent/)
  })

  it('renders a FAILED spine read as a failure, not as "no delivery"', () => {
    const { getByTestId } = render(
      <DeliverySpine
        deliveries={null}
        failedRead={['document_deliveries read failed: connection reset']}
        selectedDocumentId="doc-syn"
      />,
    )
    const alert = getByTestId('spine-failed')
    expect(alert.textContent).toMatch(/could not be read/)
    expect(alert.textContent).toMatch(/connection reset/)
  })

  it('walks the state ladder and marks where the delivery is', () => {
    const { getByText } = render(
      <DeliverySpine
        deliveries={[spine([spineDoc('doc-syn', 'invoice')])]}
        selectedDocumentId="doc-syn"
      />,
    )
    for (const s of ['DELIVERED', 'RECONCILING', 'AGREED', 'VERIFIED'])
      expect(getByText(s)).toBeTruthy()
  })
})

describe('DegradedNotice (ADR 0104 D6)', () => {
  it('fires when layer 1 has no lines', () => {
    const reasons = degradedReasons({ lineCount: 0 })
    expect(reasons).toHaveLength(1)
    const { getByTestId } = render(
      <DegradedNotice reasons={reasons} lineCount={0} verdict={null} />,
    )
    expect(getByTestId('degraded-notice').textContent).toMatch(/NOT EXTRACTED/)
    expect(getByTestId('degraded-notice').textContent).toMatch(
      /not because the document had nothing on it/,
    )
  })

  it('does NOT fire merely because no intake verdict was recorded', () => {
    // NULL means the gate never ran. Treating it as a failure would flag every
    // readable document and teach the banner to mean nothing.
    expect(degradedReasons({ lineCount: 3, intakeVerdict: null })).toEqual([])
  })

  it('fires on a recorded verdict that is not `ok`, and names it', () => {
    const reasons = degradedReasons({
      lineCount: 3,
      intakeVerdict: 'blank_page',
      intakeReason: 'page 2 of 3 is blank',
    })
    expect(reasons.join(' ')).toMatch(/blank_page/)
    expect(reasons.join(' ')).toMatch(/page 2 of 3 is blank/)
  })

  it('renders nothing when there is nothing wrong', () => {
    const { container } = render(<DegradedNotice reasons={[]} lineCount={3} />)
    expect(container.textContent).toBe('')
  })
})

describe('DoorFrame (ADR 0104 D11, S10)', () => {
  it('shows expected against received and NO money at all', () => {
    const d = doc()
    d.layer3.lines = [adjudicated({ received: 10, shipped: 12 })]
    const { getByTestId, container } = render(<DoorFrame doc={d} />)
    expect(getByTestId('door-received').textContent).toBe('10')
    expect(container.textContent).toMatch(/The paperwork says/)
    // Not one price, not one total, not one currency symbol.
    expect(container.textContent).not.toMatch(/₺|\$|€/)
    expect(container.textContent).not.toMatch(/170,40|142,00/)
  })

  it('says "not counted" in words at a door nobody has counted', () => {
    const { getByTestId, container } = render(<DoorFrame doc={doc()} />)
    expect(getByTestId('door-received').textContent).toBe('not counted')
    expect(container.textContent).toMatch(/none of them is a zero/)
  })

  it("suppresses money by role, not by width — an invoice's own lines, no prices", () => {
    const { container } = render(<DoorFrame doc={doc({ docType: 'invoice' })} />)
    const items = within(container).getAllByTestId('door-line')
    expect(items).toHaveLength(1)
    expect(container.textContent).not.toMatch(/₺/)
  })
})
