/**
 * The paper's door (r24, door-count lane): which papers show "The door", what a
 * count of one sends, and when it was last counted. Kept pure so the page's
 * three decisions are tested apart from the page.
 */
import type { CanonicalDocument, DeliverySpine } from '../../../services/api/canonical'
import type { DoorCountLine } from '../../../services/api/deliveries'

/** The papers that come with goods, and so are counted at a door (gateway `door-count-paper.ts`). */
const COUNTABLE_PAPERS = new Set(['invoice', 'packing_slip', 'delivery_note', 'delivery_receipt'])

/**
 * A paper that came WITH goods shows the door, order or no order (r21 walk:
 * a paper with no order had no way to its count). A door count shows it as
 * itself; any document on a counted delivery shows it.
 */
export function showsTheDoor(doc: CanonicalDocument, doorDelivery: DeliverySpine | undefined): boolean {
  if (doc.docType === 'receiving_advice' || doorDelivery) return true
  return COUNTABLE_PAPERS.has(doc.docType ?? '') && doc.layer1.lines.length > 0
}

/**
 * The body of a count of THIS paper. The gateway books by the paper's own
 * lines and puts the paper, and its one order, on the delivery. The paper's
 * one delivery is reused; with none, or several, the gateway finds or refuses.
 */
export function paperCountBody(
  input: { lines: DoorCountLine[]; signedBy?: string; note?: string },
  paper: { documentId: string; jurisdiction: string | null; soleDeliveryId: string | null },
) {
  return {
    ...input,
    ...(paper.soleDeliveryId ? { deliveryId: paper.soleDeliveryId } : { createDelivery: true }),
    ...(paper.jurisdiction ? { jurisdiction: paper.jurisdiction } : {}),
    forDocumentId: paper.documentId,
  }
}

/** When the paper's delivery was last counted at the door: its newest count. */
export function lastCountedAt(doorDelivery: DeliverySpine | undefined): string | null {
  return (
    (doorDelivery?.documents ?? [])
      .filter((d) => d.role === 'door_count' && d.createdAt)
      .map((d) => d.createdAt as string)
      .sort()
      .pop() ?? null
  )
}
