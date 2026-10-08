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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CanonicalSheet } from '../CanonicalSheet'
import { VerdictBlock } from '../VerdictBlock'
import { DeliverySpine } from '../DeliverySpine'
import { DegradedNotice, degradedReasons } from '../DegradedNotice'
import { DoorFrame } from '../DoorFrame'
import { ProposalThread } from '../ProposalThread'
import { DeliveryGates } from '../DeliveryGates'
import type { DeliveryEvent, Proposal } from '../../../services/api/deliveries'
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
  layer2: { providerId: null, vendorResolution: null, lines: [] },
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
    expect(getByTestId('price-base').textContent).toMatch(/per 12 bottles$/)
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
    expect(container.textContent).toMatch(/billed 12 bottles, received 10 bottles/)
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

  /**
   * THE SHEET MUST FLAG ITS OWN INCONSISTENCY.
   *
   * Measured on screen 2026-09-05 against the Turkish invoice `b1e02edf`: the
   * deposit was counted both inside Lines (₺9.352,00) and again as a ₺180,00
   * charge, so the printed ladder came to ₺11.366,40 while the total row said
   * ₺11.186,40 — and this block said "The lines add up to the stated total",
   * because `layer3.tiesOut` grades the DOOR's line sum, not the ladder the
   * sheet renders.
   */
  it('names the ladder that does not reach the stated total', () => {
    const d = doc()
    d.layer1.totals = {
      ...totals(),
      linesNetTotal: env(9352),
      chargesTotal: env(180),
      taxExclusiveAmount: env(9532),
      taxAmount: env(1834.4),
      taxInclusiveAmount: env(11186.4, { as_printed: '11.186,40' }),
      amountDue: env(11186.4),
    }
    // The door tied out — that is exactly the state that used to hide this.
    d.layer3.tiesOut = true
    d.layer3.tieOutDeltaCents = 0
    const { getByTestId } = render(<VerdictBlock doc={d} />)
    const said = getByTestId('tie-out-sentence').textContent ?? ''
    expect(said).toMatch(/The stated total ₺11\.186,40 does not match/)
    expect(said).toMatch(/₺11\.366,40/)
    expect(said).toMatch(/off by ₺180,00/)
    expect(said).not.toMatch(/The lines add up to the stated total/)
  })

  it('says the lines add up once the ladder reaches the stated total', () => {
    // The same document after the BT-106 fix: the deposit has left Lines and is
    // carried once as a charge, so the ladder reaches the printed total.
    const d = doc()
    d.layer1.totals = {
      ...totals(),
      linesNetTotal: env(9172),
      chargesTotal: env(180),
      taxExclusiveAmount: env(9352),
      taxAmount: env(1834.4),
      taxInclusiveAmount: env(11186.4, { as_printed: '11.186,40' }),
      amountDue: env(11186.4),
    }
    d.layer3.tiesOut = true
    const { getByTestId } = render(<VerdictBlock doc={d} />)
    expect(getByTestId('tie-out-sentence').textContent).toMatch(
      /The lines add up to the stated total/,
    )
  })

  it('does not call an ABSENT total a disagreement', () => {
    // A delivery note prints no money. An absent number is not a mismatch, and
    // claiming one would be the same absence-as-health fault facing the other
    // way.
    const d = doc()
    d.layer1.totals = { ...totals(), taxInclusiveAmount: env<number>(null) }
    d.layer3.tiesOut = null
    const { getByTestId } = render(<VerdictBlock doc={d} />)
    expect(getByTestId('tie-out-sentence').textContent).toMatch(
      /could not be checked/,
    )
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
describe('VerdictBlock — unit words (walk-through W6, 2026-10-01)', () => {
  it('says one bottle, and two split cases, never a stored code', () => {
    const d = doc()
    d.layer3.lines = [adjudicated({ verdict: 'short_ship', received: 0, billed: 1, moneyAtRisk: 70 })]
    const one = render(<VerdictBlock doc={d} />)
    expect(one.container.textContent).toMatch(/billed 1 bottle, received 0 bottles/)
    one.unmount()

    const e = doc()
    e.layer1.lines = [line({ unit: env('split_case') })]
    e.layer3.lines = [adjudicated({ verdict: 'short_ship', received: 1, billed: 2, moneyAtRisk: 70 })]
    const { container } = render(<VerdictBlock doc={e} />)
    expect(container.textContent).toMatch(/billed 2 split cases, received 1 split case/)
    expect(container.textContent).not.toMatch(/split_case/)
  })
})

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

  it('draws no card per line when no line was compared, and never says ADJUDICATED', () => {
    // Said once (walk-through W26, 2026-10-01): four cards repeating the
    // heading added nothing the four-way table does not already show.
    const { queryAllByTestId, container } = render(<VerdictBlock doc={uncompared()} />)
    expect(queryAllByTestId('not-compared-card')).toHaveLength(0)
    expect(queryAllByTestId('exception-card')).toHaveLength(0)
    // ADJUDICATED asserts something was judged. Nothing was.
    expect(container.textContent?.toLowerCase()).not.toMatch(/adjudicated/)
    expect(container.textContent?.match(/not compared/gi)).toHaveLength(1)
  })

  it('claims no amount, and does not print a zero at risk', () => {
    const { getByTestId, queryByTestId, container } = render(<VerdictBlock doc={uncompared()} />)
    // The note says it once; the money line no longer repeats it (W26).
    expect(queryByTestId('money-at-risk')).toBeNull()
    expect(container.textContent).not.toMatch(/at risk/)
    expect(getByTestId('not-compared-note').textContent).toMatch(
      /^That is not a discrepancy: no amount is claimed, and none is ruled\s+out\.$/,
    )
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
    const cards = queryAllByTestId('not-compared-card')
    expect(cards).toHaveLength(3)
    expect(cards[0].textContent).toMatch(/not compared/)
    expect(cards[0].textContent).toMatch(/nothing was compared/i)
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

// ---------------------------------------------------------------------------
// Slice 3 stop 2 — the door writes, the thread keeps, the gates explain.
// ---------------------------------------------------------------------------

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'p-1',
  delivery_id: 'del-1',
  document_id: null,
  line_no: 1,
  side: 'restaurant',
  reason: 'SHORT_SHIP',
  qty_proposed: 10,
  unit_price_proposed: null,
  money_at_risk: 284,
  evidence: [],
  note: 'we counted ten of twelve',
  status: 'open',
  counters_proposal_id: null,
  proposed_by: 'u1',
  proposed_at: '2026-08-14T09:40:00Z',
  responded_at: null,
  responded_by: null,
  ...over,
})

const event = (over: Partial<DeliveryEvent> = {}): DeliveryEvent => ({
  id: 'del-1',
  providerId: 'prov-1',
  orderId: 'ord-1',
  state: 'RECONCILING',
  provenance: 'ORDERED',
  jurisdiction: 'TR',
  deliveredAt: '2026-08-14T07:41:00Z',
  agreedAt: null,
  agreedRule: null,
  verifiedAt: null,
  verifiedBy: null,
  lapsedAt: null,
  lapseDeemed: null,
  amendedAt: null,
  ...over,
})

describe('DoorFrame — the count is a write, and an untouched line is not a zero', () => {
  it('submits ONLY the lines somebody touched', async () => {
    const submitted: unknown[] = []
    render(
      <DoorFrame
        doc={doc({
          layer1: { ...doc().layer1, lines: [line(), line({ description: env('SYNTHETIC Kalecik Karası') })] },
          layer3: {
            ...doc().layer3,
            lines: [adjudicated(), adjudicated({ lineIndex: 1 })],
          },
        })}
        onSubmitCount={async (input) => {
          submitted.push(input)
        }}
      />,
    )
    // Count line 1 only; line 2 is never touched.
    const inputs = screen.getAllByTestId('door-count-input')
    await userEvent.type(inputs[0], '10')
    await userEvent.click(screen.getByTestId('door-submit'))

    expect(submitted).toHaveLength(1)
    const lines = (submitted[0] as { lines: { lineNo: number; qty: number }[] }).lines
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ lineNo: 1, qty: 10 })
  })

  it('refuses to submit when nothing has been counted, and says why', () => {
    render(<DoorFrame doc={doc()} onSubmitCount={async () => {}} />)
    const button = screen.getByTestId('door-submit') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByTestId('door-frame').textContent).toMatch(
      /A line you do not touch is not a zero/,
    )
  })

  it('carries the door signature, which is what ADR 0103 D3 rule B reads', async () => {
    const submitted: { signedBy?: string }[] = []
    render(
      <DoorFrame
        doc={doc()}
        onSubmitCount={async (input) => {
          submitted.push(input)
        }}
      />,
    )
    await userEvent.click(screen.getByTestId('door-plus'))
    await userEvent.type(screen.getByTestId('door-signed-by'), 'Ayşe')
    await userEvent.click(screen.getByTestId('door-submit'))
    expect(submitted[0].signedBy).toBe('Ayşe')
  })

  it('shows no prices at the door, in either mode (D11)', () => {
    const { container } = render(<DoorFrame doc={doc()} onSubmitCount={async () => {}} />)
    expect(container.textContent).not.toMatch(/₺|142|170/)
  })

  it('stays read-only with no submit handler, and says a count is never edited', () => {
    render(<DoorFrame doc={doc()} />)
    expect(screen.queryByTestId('door-submit')).toBeNull()
    expect(screen.getByTestId('door-received')).toBeTruthy()
  })
})

describe('ProposalThread — every position stays (ADR 0103 D7)', () => {
  it('renders a failed read as a failure, never as "nobody disputed anything"', () => {
    render(<ProposalThread proposals={null} failedRead="connection reset" />)
    expect(screen.getByTestId('thread-failed').textContent).toMatch(
      /is not .nobody has disputed/i,
    )
    expect(screen.queryByTestId('thread-empty')).toBeNull()
  })

  it('says an EMPTY thread still needs both sides on the record', () => {
    render(<ProposalThread proposals={[]} />)
    expect(screen.getByTestId('thread-empty').textContent).toMatch(
      /both\s+sides on the record/,
    )
  })

  it('marks whose position each row is, and keeps a counter beside what it answers', () => {
    render(
      <ProposalThread
        proposals={[
          proposal(),
          proposal({
            id: 'p-2',
            side: 'vendor',
            note: 'credit of 142,00 issued',
            counters_proposal_id: 'p-1',
            money_at_risk: 142,
          }),
        ]}
        currency="TRY"
      />,
    )
    const rows = screen.getAllByTestId('proposal-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('data-side')).toBe('restaurant')
    expect(rows[1].getAttribute('data-side')).toBe('vendor')
    expect(rows[1].textContent).toMatch(/answers an earlier position/)
  })

  it('warns in the picker that WRONG_VENUE rejects rather than negotiates', async () => {
    render(<ProposalThread proposals={[]} onPropose={async () => {}} />)
    await userEvent.click(screen.getByTestId('open-proposal-form'))
    const select = screen.getByTestId('proposal-reason')
    expect(within(select).getByText(/REJECTS the whole thing/)).toBeTruthy()
  })

  it('sends the selected line and the numbers a person typed', async () => {
    const sent: unknown[] = []
    render(
      <ProposalThread
        proposals={[]}
        selectedLine={0}
        onPropose={async (b) => {
          sent.push(b)
        }}
      />,
    )
    await userEvent.click(screen.getByTestId('open-proposal-form'))
    await userEvent.type(screen.getByTestId('proposal-qty'), '10')
    await userEvent.type(screen.getByTestId('proposal-money'), '284')
    await userEvent.type(screen.getByTestId('proposal-note'), 'we counted ten')
    await userEvent.click(screen.getByTestId('submit-proposal'))
    expect(sent[0]).toMatchObject({
      side: 'restaurant',
      reason: 'SHORT_SHIP',
      lineNo: 1,
      qtyProposedBottles: 10,
      moneyAtRisk: 284,
      note: 'we counted ten',
    })
  })
})

describe('DeliveryGates — the two gates, explained before they are pressed', () => {
  it('says what AGREED needs while it is not yet agreed', () => {
    render(<DeliveryGates delivery={event()} onAgree={async () => {}} />)
    const text = screen.getByTestId('delivery-gates').textContent ?? ''
    expect(text).toMatch(/restaurant.s position AND the vendor.s/)
    expect(text).toMatch(/silence is never agreement/i)
    // VERIFIED is not offered before AGREED — the two are never collapsed.
    expect(screen.queryByTestId('verify-button')).toBeNull()
  })

  it('names WHICH rule agreed it, once it is agreed', () => {
    render(
      <DeliveryGates
        delivery={event({
          state: 'AGREED',
          agreedAt: '2026-08-15T10:00:00Z',
          agreedRule: 'signed_ticket_is_final',
        })}
        onVerify={async () => {}}
      />,
    )
    expect(screen.getByTestId('agreed-rule').textContent).toMatch(
      /signed delivery ticket is final/,
    )
    expect(screen.getByTestId('verify-button')).toBeTruthy()
    // ADR 0312: verify is where an agreed price becomes the item's cost, and
    // the sentence is no broader than that.
    const text = screen.getByTestId('delivery-gates').textContent ?? ''
    expect(text).toMatch(/where an agreed price reaches the item, it becomes what the item cost/)
  })

  it('offers neither gate when no handler is passed (a session that does not hold the money)', () => {
    render(<DeliveryGates delivery={event()} />)
    expect(screen.queryByTestId('agree-button')).toBeNull()
    render(<DeliveryGates delivery={event({ state: 'AGREED', agreedAt: '2026-08-15T10:00:00Z' })} />)
    expect(screen.queryByTestId('verify-button')).toBeNull()
  })

  it('does not say a verified delivery posted nothing to cost', () => {
    render(
      <DeliveryGates
        delivery={event({
          state: 'VERIFIED',
          agreedAt: '2026-08-15T10:00:00Z',
          verifiedAt: '2026-08-16T10:00:00Z',
        })}
      />,
    )
    const text = screen.getByTestId('delivery-gates').textContent ?? ''
    expect(text).toMatch(/by a\s+named person\./)
    expect(text).not.toMatch(/Nothing was posted to inventory or cost by this step/)
    expect(text).not.toMatch(/on this build/)
  })

  it('shows the gateway’s refusal verbatim rather than a paraphrase', () => {
    render(
      <DeliveryGates
        delivery={event()}
        onAgree={async () => {}}
        error="This delivery cannot be agreed yet: the vendor's position is not on the record — attach the document they issued."
      />,
    )
    expect(screen.getByTestId('gate-error').textContent).toMatch(
      /attach the document they issued/,
    )
  })

  it('marks an UNORDERED delivery permanently, not as a step to complete', () => {
    render(<DeliveryGates delivery={event({ provenance: 'UNORDERED', orderId: null })} />)
    expect(screen.getByTestId('unordered-mark').textContent).toMatch(
      /mark is permanent/,
    )
  })

  it('prints what the law deems on a lapse, and that no stock moved', () => {
    render(
      <DeliveryGates
        delivery={event({
          state: 'LAPSED',
          lapsedAt: '2026-08-21T00:00:00Z',
          lapseDeemed: 'Turkish practice deems this e-İrsaliye accepted IN FULL.',
        })}
      />,
    )
    const text = screen.getByTestId('lapse-notice').textContent ?? ''
    expect(text).toMatch(/accepted IN FULL/)
    expect(text).toMatch(/Nothing was posted to inventory or cost/)
  })
})

/**
 * v3.0-TECH-DEBT 2026-09-06, finding 3 — our own door count rendered under
 * "Billed" while "Received" read "not counted" on every line.
 */
describe('a receiving_advice is the RECEIVED column, never the BILLED one', () => {
  const ourCount = () =>
    doc({
      docType: 'receiving_advice',
      direction: 'issued_by_us',
      layer3: {
        lines: [
          adjudicated({
            lineIndex: 0,
            ordered: null,
            shipped: null,
            received: 10,
            billed: null,
            verdict: 'not_adjudicated',
          }),
        ],
        tiesOut: null,
        tieOutDeltaCents: null,
        verdicts: [],
      },
    })

  it('prints the count in Received and nothing in Billed', () => {
    const { getAllByTestId } = render(<CanonicalSheet doc={ourCount()} />)
    const cells = getAllByTestId('sheet-line')[0].querySelectorAll('td')
    // # · Item · Ordered · Shipped · Received · Billed · Unit …
    expect(getAllByTestId('received-cell')[0].textContent).toMatch(/10/)
    expect(cells[5].textContent).not.toMatch(/10/)
    expect(getAllByTestId('received-cell')[0].textContent).not.toMatch(/not counted/i)
  })

  it('says COUNTED, not "billed —", when nothing has been compared with it yet', () => {
    const { container } = render(<VerdictBlock doc={ourCount()} />)
    expect(container.textContent).toMatch(/counted/i)
    expect(container.textContent).toMatch(/nothing was compared/i)
    // The old sentence claimed a billed quantity on a document that carries no
    // money at all (ADR 0104 D11).
    expect(container.textContent).not.toMatch(/billed —/)
  })
})

/**
 * ADR 0104 D15 — how the vendor was resolved, on the sheet.
 *
 * Five facts, five renderings. The one that matters most is the LAST: a
 * document nobody resolved renders NOTHING, because a line invented about it
 * would say "no vendor" in the same words as a document we looked at and
 * refused — and only one of those is something a person can act on.
 */
describe('the vendor resolution line (ADR 0104 D15)', () => {
  const withResolution = (
    over: Partial<NonNullable<CanonicalDocument['layer2']['vendorResolution']>> | null,
  ) =>
    doc({
      layer2: {
        providerId: over ? 'prov-1' : null,
        vendorResolution: over
          ? {
              state: 'matched',
              reason: 'Matched on VKN 1234567890 — exactly one provider on file carries it.',
              providerName: 'SENTETİK ŞARAP DAĞITIM A.Ş.',
              matchedOn: '1234567890',
              scheme: 'TR_VKN',
              provisional: false,
              ...over,
            }
          : null,
        lines: [],
      },
    })

  it('names what it matched on, in the scheme the document uses', () => {
    render(<CanonicalSheet doc={withResolution({})} />)
    const el = screen.getByTestId('vendor-resolution')
    expect(el).toHaveTextContent('Matched on VKN 1234567890')
    expect(el).toHaveAttribute('data-state', 'matched')
  })

  it('says a vendor was BORN from this document, and that it is provisional', () => {
    render(
      <CanonicalSheet
        doc={withResolution({ state: 'created', provisional: true })}
      />,
    )
    const el = screen.getByTestId('vendor-resolution')
    expect(el).toHaveTextContent('New vendor, created from this document')
    expect(el).toHaveTextContent('provisional until the first order')
  })

  it('prints the REASON on a refusal, so the reader knows what to do', () => {
    render(
      <CanonicalSheet
        doc={withResolution({
          state: 'unresolved',
          matchedOn: null,
          scheme: null,
          providerName: null,
          reason:
            'This document names no vendor identity we can verify: no tax identity is printed on this document.',
        })}
      />,
    )
    expect(screen.getByTestId('vendor-resolution')).toHaveTextContent(
      'no tax identity is printed on this document',
    )
  })

  it('says WE could not look — never dressed as the document’s fault', () => {
    render(
      <CanonicalSheet
        doc={withResolution({
          state: 'unavailable',
          matchedOn: null,
          scheme: null,
          reason: 'the providers on file could not be read',
        })}
      />,
    )
    const el = screen.getByTestId('vendor-resolution')
    expect(el).toHaveAttribute('data-state', 'unavailable')
    expect(el).toHaveTextContent('Vendor not looked for')
    expect(el).not.toHaveTextContent('names no vendor identity')
  })

  it('renders NOTHING for a document resolution never ran on', () => {
    render(<CanonicalSheet doc={withResolution(null)} />)
    expect(screen.queryByTestId('vendor-resolution')).toBeNull()
  })

  it('never prints a confidence number beside any of it', () => {
    const { container } = render(<CanonicalSheet doc={withResolution({})} />)
    expect(container.textContent).not.toMatch(/\b0\.\d+\b/)
  })
})

/* The sheet in words (walk-through W22, 2026-10-01): a year said once, units
 * in the plural, no bare charge code. */
describe('CanonicalSheet — the sheet in words (W22)', () => {
  it('adds the year only when the printed name does not already carry it', () => {
    const d = doc()
    d.layer1.lines = [line({ description: env('SYNTHETIC Öküzgözü 2021 · 750 ml') })]
    const once = render(<CanonicalSheet doc={d} />)
    expect(once.container.textContent).toContain('SYNTHETIC Öküzgözü 2021 · 750 ml')
    expect(once.container.textContent).not.toContain('750 ml · 2021')
    once.unmount()
    const { container } = render(<CanonicalSheet doc={doc()} />)
    expect(container.textContent).toContain('SYNTHETIC Öküzgözü · 2021')
  })

  it('names a charge by its reason, and prints the code only when no reason came', () => {
    const d = doc()
    d.layer1.allowancesCharges = [
      { isCharge: env(true), amount: env(180), reasonCode: env('7161'), reason: env('Returnable container / deposit') },
    ]
    const named = render(<CanonicalSheet doc={d} />)
    expect(named.container.textContent).toContain('Returnable container / deposit')
    expect(named.container.textContent).not.toContain('7161')
    named.unmount()
    d.layer1.allowancesCharges = [
      { isCharge: env(true), amount: env(180), reasonCode: env('7161'), reason: env<string>(null) },
    ]
    const { container } = render(<CanonicalSheet doc={d} />)
    expect(container.textContent).toContain('reason code 7161')
  })
})

/*
 * ON A PHONE, EACH LINE IS A SHORT BLOCK (walk-through RECEIPTS-W35,
 * 2026-10-01). Measured at 375px, the eight-column line table was 395px wide in
 * a 343px box, so the line total started past the edge. Below 640px each row
 * becomes a grid and every figure carries its column's word. jsdom applies no
 * media query, so the layout half is read from the stylesheet; the labels and
 * the roles — which a change of display drops in some screen readers — are read
 * from the rendered table.
 */
describe('CanonicalSheet — the line table on a phone (W35)', () => {
  it('names every figure and keeps the table\'s roles spelled out', () => {
    const { container } = render(<CanonicalSheet doc={doc()} />)
    const table = container.querySelector('table.cd-lines') as HTMLTableElement
    expect(table.getAttribute('role')).toBe('table')
    expect([...table.querySelectorAll('thead, tbody')].map((g) => g.getAttribute('role'))).toEqual([
      'rowgroup',
      'rowgroup',
    ])
    expect([...table.querySelectorAll('th')].every((th) => th.getAttribute('role') === 'columnheader')).toBe(true)
    const row = table.querySelector('tbody tr') as HTMLTableRowElement
    expect(row.getAttribute('role')).toBe('row')
    const cells = [...row.querySelectorAll('td')]
    expect(cells.every((td) => td.getAttribute('role') === 'cell')).toBe(true)
    expect(cells.map((td) => td.dataset.cell)).toEqual([
      'n', 'item', 'ordered', 'shipped', 'received', 'billed', 'unit', 'line',
    ])
    expect(cells.filter((td) => td.dataset.label).map((td) => td.dataset.label)).toEqual([
      'Ordered', 'Shipped', 'Received', 'Billed', 'Unit', 'Line',
    ])
  })

  it('stacks the rows below the phone width, on screen only', () => {
    const css = readFileSync(
      join(__dirname, '../../../pages/documents/next/canonical-document.css'),
      'utf8',
    )
    const phone = css.slice(css.indexOf('@media screen and (max-width: 639px) {'), css.indexOf('@media print {'))
    expect(phone).toMatch(/\.cd-lines thead \{\s*display: none;/)
    expect(phone).toMatch(/\.cd-lines tr \{\s*display: grid;\s*grid-template-columns: 18px repeat\(3, minmax\(0, 1fr\)\);/)
    expect(phone).toMatch(/\.cd-lines td\[data-label\]::before \{\s*content: attr\(data-label\);/)
    // Paper keeps the table: nothing in the print block stacks it.
    expect(css.slice(css.indexOf('@media print {'))).not.toMatch(/cd-lines/)
  })
})

/* ─── walk-through RECEIPTS-W41 (2026-10-01) — paper against page ───────── */

describe('CanonicalSheet — what the reader kept, said as such (W41)', () => {
  const billedCell = (c: HTMLElement, i = 0) =>
    c.querySelectorAll('td[data-cell="billed"]')[i]?.textContent ?? ''

  it('puts the unit beside the billed count when the count IS the printed quantity', () => {
    const { container } = render(<CanonicalSheet doc={doc()} />)
    expect(billedCell(container)).toBe('12 bottles')
  })

  it('says one in the singular, and a deposit piece in its own word', () => {
    const d = doc()
    d.layer1.lines = [line({ quantity: env(1), unit: env('bottle') }), line({ quantity: env(2), unit: env('each') })]
    d.layer3.lines = [adjudicated({ billed: 1 }), adjudicated({ lineIndex: 1, billed: 2 })]
    const { container } = render(<CanonicalSheet doc={d} />)
    expect(billedCell(container, 0)).toBe('1 bottle')
    expect(billedCell(container, 1)).toBe('2 each')
  })

  it('leaves a converted count bare rather than call 12 bottles "12 cases"', () => {
    const d = doc()
    d.layer1.lines = [line({ quantity: env(1), unit: env('case') })]
    d.layer3.lines = [adjudicated({ billed: 12 })]
    const { container } = render(<CanonicalSheet doc={d} />)
    expect(billedCell(container)).toBe('12')
  })

  it('leaves the count bare when the unit was not read — never a guessed unit', () => {
    const d = doc()
    d.layer1.lines = [line({ unit: env<string>(null) })]
    const { container } = render(<CanonicalSheet doc={d} />)
    expect(billedCell(container)).toBe('12')
  })

  it('says the VAT rate was not read, rather than that the paper stated none', () => {
    const { container } = render(<CanonicalSheet doc={doc()} />)
    expect(container.textContent).toContain('Tax of ₺28,40 was read, but not its rate or what it was charged on.')
    expect(container.textContent).not.toMatch(/states no VAT breakdown/)
  })

  it('with no tax read at all, says no breakdown was read', () => {
    const d = doc()
    d.layer1.totals = { ...totals(), taxAmount: env<number>(null) }
    const { container } = render(<CanonicalSheet doc={d} />)
    expect(container.textContent).toContain('No VAT breakdown was read from this document.')
  })
})

describe('CanonicalSheet — the letterhead (W45, frame A)', () => {
  it('frames the sheet with a control-strength edge and near-square corners', () => {
    const { container } = render(<CanonicalSheet doc={doc()} />)
    const sheet = container.querySelector('article.cd-sheet') as HTMLElement
    expect(sheet.getAttribute('style')).toContain('var(--line-control, #8F8674)')
    expect(sheet.style.borderRadius).toBe('4px')
  })

  it('carries the Mudavym mark in the header, at the 24px brand minimum', () => {
    const { container } = render(<CanonicalSheet doc={doc()} />)
    const header = container.querySelector('article.cd-sheet > header') as HTMLElement
    const mark = within(header).getByRole('img', { name: 'Mudavym' })
    expect(mark.querySelector('svg')?.getAttribute('height')).toBe('24')
    expect(mark.textContent).toBe('Mudavym.')
  })

  it("takes the paper's own colours, never the theme's dark: classes", () => {
    const { container } = render(<CanonicalSheet doc={doc()} />)
    const mark = within(container.querySelector('header') as HTMLElement).getByRole('img', { name: 'Mudavym' })
    expect(mark.outerHTML).not.toMatch(/dark:/)
    expect(mark.getAttribute('style')).toContain('var(--ink-1, #211C16)')
    expect(mark.querySelector('svg')?.getAttribute('style')).toContain('var(--seal, #1A5E6B)')
    expect(mark.querySelector(':scope > span > span')?.getAttribute('style')).toContain('var(--seal, #1A5E6B)')
  })

  it('keeps the document number whole rather than break it at a hyphen', () => {
    render(<CanonicalSheet doc={doc()} />)
    expect(screen.getByText('SYN-A-88214').style.whiteSpace).toBe('nowrap')
  })

  it('keeps the issued-by-us note beside the mark', () => {
    const { container } = render(<CanonicalSheet doc={doc({ direction: 'issued_by_us' })} />)
    const header = container.querySelector('header') as HTMLElement
    expect(within(header).getByTestId('direction-ours')).toBeTruthy()
    expect(within(header).getByRole('img', { name: 'Mudavym' })).toBeTruthy()
  })
})
