import { describe, expect, it } from 'vitest'
import type { CanonicalDocument, DeliverySpine } from '../../../services/api/canonical'
import { lastCountedAt, paperCountBody, showsTheDoor } from './door-paper'

/** r24: the paper's door — which papers show it, what a count sends, when it was counted. */
const paper = (docType: string, lines = 1) =>
  ({ docType, layer1: { lines: Array.from({ length: lines }, () => ({})) } }) as unknown as CanonicalDocument
const delivery = (docs: { role: string; createdAt: string | null }[]) =>
  ({ documents: docs.map((d, i) => ({ documentId: `d${i}`, ...d })) }) as unknown as DeliverySpine

describe('showsTheDoor', () => {
  it.each(['invoice', 'packing_slip', 'delivery_note', 'delivery_receipt'])(
    'a %s with lines and no count yet shows the door, order or no order',
    (t) => expect(showsTheDoor(paper(t), undefined)).toBe(true),
  )
  it.each(['credit_memo', 'price_list', 'statement'])('a %s does not', (t) =>
    expect(showsTheDoor(paper(t), undefined)).toBe(false),
  )
  it('a paper with no lines does not; a count, or a counted delivery, always does', () => {
    expect(showsTheDoor(paper('invoice', 0), undefined)).toBe(false)
    expect(showsTheDoor(paper('receiving_advice', 0), undefined)).toBe(true)
    expect(showsTheDoor(paper('credit_memo'), delivery([]))).toBe(true)
  })
})

describe('paperCountBody', () => {
  const input = { lines: [{ lineNo: 1, qty: 5, uom: 'liter', sourceLineId: 'l-1' }] }
  it('names the paper, and makes a delivery when the paper is on none', () => {
    expect(paperCountBody(input, { documentId: 'p-1', jurisdiction: 'TR', soleDeliveryId: null })).toEqual({
      ...input,
      createDelivery: true,
      jurisdiction: 'TR',
      forDocumentId: 'p-1',
    })
  })
  it("counts onto the paper's one delivery", () => {
    const body = paperCountBody(input, { documentId: 'p-1', jurisdiction: null, soleDeliveryId: 'del-1' })
    expect(body).toEqual({ ...input, deliveryId: 'del-1', forDocumentId: 'p-1' })
  })
})

describe('lastCountedAt', () => {
  it("is the newest door count's time; other papers' times are not counts", () => {
    expect(
      lastCountedAt(
        delivery([
          { role: 'door_count', createdAt: '2026-11-13T09:00:00Z' },
          { role: 'invoice', createdAt: '2026-11-13T12:00:00Z' },
          { role: 'door_count', createdAt: '2026-11-13T10:05:00Z' },
        ]),
      ),
    ).toBe('2026-11-13T10:05:00Z')
    expect(lastCountedAt(undefined)).toBeNull()
    expect(lastCountedAt(delivery([{ role: 'invoice', createdAt: '2026-11-13T12:00:00Z' }]))).toBeNull()
  })
})
