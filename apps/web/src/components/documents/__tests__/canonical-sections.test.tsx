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
  lineKind: env('goods'),
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

/**
 * The first render against real documents (findings 1, 2, 5 and 9 of
 * `v3.0-TECH-DEBT.md`, 2026-09-04). Every name and number below is SYNTHETIC.
 */
describe('VerdictBlock — not compared is not a difference (finding 1, ADR 0103 A6)', () => {
  /** No order line, no despatch line, nobody at the door. */
  const uncompared = () => {
    const d = doc()
    d.layer1.lines = [line(), line(), line(), line()]
    d.layer3.lines = [0, 1, 2, 3].map((i) =>
      adjudicated({
        lineIndex: i,
        ordered: null,
        shipped: null,
        received: 'not_counted',
        billed: 12,
        verdict: 'not_adjudicated',
      }),
    )
    return d
  }

  it('says NOT COMPARED, never "4 lines differ"', () => {
    const { container } = render(<VerdictBlock doc={uncompared()} />)
    expect(container.textContent).toMatch(
      /Not compared — no order or door count to compare against/,
    )
    expect(container.textContent).not.toMatch(/lines differ/)
    expect(container.textContent).not.toMatch(/Nothing on this document differs/)
  })

  it('labels every line card `not compared`, never NOT ADJUDICATED', () => {
    const { queryAllByTestId, container } = render(<VerdictBlock doc={uncompared()} />)
    const cards = queryAllByTestId('not-compared-card')
    expect(cards).toHaveLength(4)
    expect(queryAllByTestId('exception-card')).toHaveLength(0)
    // ADJUDICATED asserts something was judged. Nothing was.
    expect(container.textContent?.toLowerCase()).not.toMatch(/adjudicated/)
    expect(cards[0].textContent).toMatch(/not compared/)
    expect(cards[0].textContent).toMatch(/nothing was compared/i)
  })

  it('claims no amount, and does not print a zero at risk', () => {
    const { getByTestId, container } = render(<VerdictBlock doc={uncompared()} />)
    expect(getByTestId('money-at-risk').textContent).toMatch(/nothing is being claimed/)
    expect(container.textContent).not.toMatch(/at risk/)
    expect(getByTestId('not-compared-note').textContent).toMatch(/missing counterpart/)
  })

  it('still says "1 line differs" the moment ONE line has a comparison source', () => {
    const d = uncompared()
    d.layer3.lines[2] = adjudicated({
      lineIndex: 2,
      ordered: 12,
      shipped: 12,
      received: 10,
      billed: 12,
      verdict: 'short_ship',
      moneyAtRisk: 840,
    })
    const { container, queryAllByTestId } = render(<VerdictBlock doc={d} />)
    expect(container.textContent).toMatch(/1 line differs from the delivery/)
    expect(queryAllByTestId('exception-card')).toHaveLength(1)
    // …and the three uncompared lines still say so rather than joining the count.
    expect(queryAllByTestId('not-compared-card')).toHaveLength(3)
  })

  it('is still clean when every line WAS compared and none differs', () => {
    const d = doc()
    d.layer3.lines = [adjudicated({ received: 12, verdict: 'ok' })]
    const { container } = render(<VerdictBlock doc={d} />)
    expect(container.textContent).toMatch(/Nothing on this document differs/)
  })
})

describe('CanonicalSheet — the totals ladder (finding 5)', () => {
  it('never prints "Charges —" beneath a listed charge', () => {
    const d = doc()
    d.layer1.allowancesCharges = [
      {
        isCharge: env(true),
        amount: env(45),
        reasonCode: env('FC'),
        reason: env('Freight'),
      },
      {
        isCharge: env(true),
        amount: env(3.6),
        reasonCode: env('7161'),
        reason: env('Returnable container / deposit'),
      },
    ]
    // The hole the mapper used to leave behind.
    d.layer1.totals.chargesTotal = env<number>(null)
    const { getByTestId } = render(<CanonicalSheet doc={d} />)
    const charges = getByTestId('total-charges')
    expect(charges.textContent).not.toMatch(/Charges\s*—/)
    expect(charges.textContent).toMatch(/48,60/)
    // And a number WE added up says it is ours, not the paper's.
    expect(charges.textContent).toMatch(/summed from the 2 above/)
  })

  it('leaves a genuinely absent charge total as the em dash when nothing is listed', () => {
    const d = doc()
    d.layer1.allowancesCharges = []
    d.layer1.totals.chargesTotal = env<number>(null)
    const { getByTestId } = render(<CanonicalSheet doc={d} />)
    expect(getByTestId('total-charges').textContent).toMatch(/—/)
    expect(getByTestId('total-charges').textContent).not.toMatch(/summed from/)
  })
})

describe('CanonicalSheet — layout and locale (finding 9)', () => {
  it('gives the line-table caption its own full-width row, not the first column', () => {
    // KICK sets `display: block`, and a caption with display:block stops being
    // a caption: it becomes an anonymous cell in the 22px `#` column and wraps
    // one word per line. That is how it rendered on 2026-09-04.
    const { getByTestId } = render(<CanonicalSheet doc={doc()} />)
    const caption = getByTestId('line-table-caption')
    expect(caption.tagName.toLowerCase()).toBe('caption')
    expect(caption.style.display).toBe('table-caption')
  })

  it('renders a Turkish document dd.MM.yyyy and a Californian one MMM d, yyyy', () => {
    const tr = render(<CanonicalSheet doc={doc({ jurisdiction: 'TR' })} />)
    expect(tr.container.textContent).toMatch(/14\.08\.2026/)
    expect(tr.container.textContent).not.toMatch(/Aug 14, 2026/)

    const us = doc({ jurisdiction: 'US-CA' })
    us.layer1.currency = env('USD')
    const ca = render(<CanonicalSheet doc={us} />)
    expect(ca.container.textContent).toMatch(/Aug 14, 2026/)
  })

  it('falls back to the CURRENCY when the jurisdiction column is null', () => {
    // All three documents read on 2026-09-04 had a null jurisdiction and two
    // of them were Turkish; every date printed in US format.
    const d = doc({ jurisdiction: null })
    const { container } = render(<CanonicalSheet doc={d} />)
    expect(container.textContent).toMatch(/14\.08\.2026/)
    expect(container.textContent).not.toMatch(/Aug 14, 2026/)
  })
})

describe('CanonicalSheet — the seller (finding 2)', () => {
  it('says "not named on this document" only when the name really is absent', () => {
    const named = render(<CanonicalSheet doc={doc()} />)
    expect(named.container.textContent).not.toMatch(
      /The seller is not named on this document/,
    )
    expect(named.container.textContent).toMatch(/SYNTHETIC Vendor A\.Ş\./)

    const d = doc()
    d.layer1.seller = { ...party(), name: env<string>(null) }
    const anonymous = render(<CanonicalSheet doc={d} />)
    expect(anonymous.container.textContent).toMatch(
      /The seller is not named on this document/,
    )
  })

  it('does not let a name from our own records claim the paper printed it', async () => {
    const d = doc()
    d.layer1.seller = {
      ...party(),
      name: env('SYNTHETIC Glazers Wine & Spirits', {
        source: 'human_entered',
        as_printed: null,
      }),
    }
    render(<CanonicalSheet doc={d} />)
    await userEvent.click(screen.getByLabelText('Where Seller came from'))
    expect(screen.getByRole('tooltip').textContent).toMatch(
      /From your own records in Mudavym · not printed on this document/,
    )
  })
})
