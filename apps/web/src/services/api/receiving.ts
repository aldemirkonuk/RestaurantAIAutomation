/**
 * Receiving API — the door stage of a delivery.
 *
 * Two calls, deliberately. Photograph whatever paper the driver handed over, and
 * say how many boxes arrived. Everything else about the delivery — the invoice
 * quantities, the prices, the four-way match — happens later at a desk, because
 * the person at the door is a porter holding a hand truck while a driver
 * double-parks, and a question they cannot answer becomes a wrong vendor claim.
 */

import { apiClient } from './client'

export interface DoorReceiptRequest {
  countedQty: number
  countedUom?: string
  packSize?: number
  /**
   * Units refused, IN THE SAME UNIT AS `countedQty`.
   *
   * The unit is in the name because it was previously stated nowhere: the door
   * sends both numbers in boxes, the gateway converted only `countedQty`, and
   * `countedBottles - rejectedQty` subtracted boxes from bottles. Three refused
   * boxes at pack 12 booked 33 bottles of live stock for wine turned away at
   * the door.
   */
  rejectedQtyInCountedUom?: number
  /**
   * DEPRECATED — the same number under its old unitless name. Nothing in this
   * app sends it any more; it stays in the type only because receipts written
   * by an older client may still be sitting in a phone's outbox, and the
   * gateway still reads it so those book their refusal.
   */
  rejectedQty?: number
  /** How the delivery stands, in the receiver's own word. */
  outcome?: 'accepted' | 'short' | 'refused'
  /** Only ever sent with `outcome: 'refused'`. */
  refusalReason?: 'wrong_wine' | 'broken_case' | 'temperature' | 'other' | null
  signedByInitials?: string | null
  driverName?: string | null
  /** What the order expected, IN THE SAME UNIT AS `countedQty`. */
  expectedQtyInCountedUom?: number | null
  damagePhotoPath?: string
  documentId?: string
  /** Stable across retries. The same tap must never book stock twice. */
  idempotencyKey: string
  /** When the tap happened, which may be long before it reached the server. */
  clientCapturedAt?: string
  notes?: string

  /**
   * What the machine read off the photographed paper, in countedUom, at the
   * moment the count screen was pre-filled (ADR 0059).
   *
   * Omitted entirely when no suggestion was offered — offline, unreadable, or
   * no photo taken. That is different from a suggestion of zero, and the two
   * must not collapse into the same value.
   */
  suggestedQtyInCountedUom?: number
  /**
   * TRUE when the receiver sealed the number the machine proposed, FALSE when
   * they overrode it. Omitted when there was nothing to accept.
   *
   * This is the highest-value label the door can produce: a person holding the
   * physical cases, grading a vision model against the paper in their other
   * hand. It never left the browser before ADR 0059.
   */
  suggestionAccepted?: boolean
}

export interface DoorReceiptResponse {
  alreadyRecorded: boolean
  eventId?: string | null
  countedQtyBottles: number
  /** Every door receipt for this order so far, in bottles. */
  receivedQtyBottles?: number
  /** Null — never 0 — when the movement did not happen. */
  stockDelta?: number | null
  /**
   * Whether the shelf count actually moved. The gateway used to write
   * `quantity_received` and return a delta after a FAILED stock movement, so a
   * receipt whose bottles never reached the shelf was indistinguishable from
   * one that worked.
   */
  stockBooked?: boolean
  /** A sentence for the receiver when it did not. Never a code. */
  stockIssue?: string
}

/**
 * What earlier trucks on this order already brought — summed from the door's
 * own events (ADR 0062 D3), in bottles, never rounded to boxes (ADR 0192). The
 * stock ledger's count travels beside it.
 */
export interface DoorReceivedSoFar {
  /** What the door's own events accepted, every truck, in bottles. */
  receivedQtyBottles: number
  /** The stock ledger's count (ADR 0192), in bottles; null when it could not be read. */
  onShelfBottles?: number | null
  /** Counted at the door and not on the shelf yet, in bottles; null when not comparable or unread. */
  countedNotBookedBottles?: number | null
  doorEventCount: number
  /** Bottles per box, exact. Null — never a guess — when the order states no pack. */
  packSize: number | null
  /** WHOLE boxes. Null — never 0 — when the pack size is not knowable. */
  receivedBoxes: number | null
  /** What is left after the whole boxes, in bottles; null with `receivedBoxes`. */
  receivedLooseBottles?: number | null
}

export interface UnverifiedDelivery {
  orderId: string
  orderNumber: string | null
  countedQtyBottles: number
  countedAt: string
  ageHours: number
  severity: 'fresh' | 'stale' | 'overdue'
}

export interface UploadedDocument {
  documentId: string | null
  duplicate: boolean
  document: {
    docType: string
    docNumber: string | null
    total: number | null
    tiesOut: boolean | null
    confidence: number
    warnings: string[]
    lines: unknown[]
  } | null
}

/**
 * One entry in a line's history on the receiving desk — one door receipt or
 * one desk verification, exactly as recorded (founder, 2026-09-25: the history
 * is built from the door receipts already recorded, never a table of its own).
 */
export interface LineHistoryEntry {
  id: string
  /** door_count · door_refused · desk_verified · other (an unworded stage, shown by `stage`). */
  kind: 'door_count' | 'door_refused' | 'desk_verified' | 'other'
  stage: string
  occurredAt: string
  outcome: string | null
  refusalReason: string | null
  /** What the person counted, in the unit they counted in. */
  countedQty: number | null
  countedUom: string | null
  countedBottles: number | null
  rejectedQty: number | null
  rejectedBottles: number | null
  expectedBottles: number | null
  /** A desk verification only: what the invoice billed, in bottles. */
  invoiceBottles: number | null
  notes: string | null
  driverName: string | null
  signedByInitials: string | null
  recordedBy: string | null
}

/** The line's received block (ADR 0192): the stock ledger's count, never typed in. */
export interface LineReceived {
  readable: boolean
  why: string | null
  words: string | null
  quantityInStockUom: number | null
  stockUom: string | null
  orderedBottles: number | null
  backorderBottles: number | null
  rejectedAtDoorBottles: number | null
  rejectedAtDeskBottles: number | null
  invoicedBottles: number | null
  verifiedAt: string | null
}

export interface LineHistoryPage {
  orderId: string
  orderNumber: string | null
  /** Newest first, ten a page. */
  entries: LineHistoryEntry[]
  /** Every entry this line holds; null when the count could not be read. */
  total: number | null
  hasMore: boolean
  /** Pass back as `before` for the next, older page. */
  nextBefore: string | null
  recordedByUnavailable: boolean
  /** The order's own verification date, which a verification before #436 left no entry for. */
  matchVerifiedAt: string | null
  /** The first page only. */
  received: LineReceived | null
}

export const receivingApi = {
  /** Record the case count and book the stock. Idempotent on `idempotencyKey`. */
  async recordDoorReceipt(
    orderId: string,
    body: DoorReceiptRequest,
  ): Promise<DoorReceiptResponse> {
    const { data } = await apiClient.post(
      `/procurement/receiving/orders/${orderId}/door`,
      body,
    )
    return data
  },

  /**
   * What earlier trucks on this order already brought, summed from the receipt
   * events. Lets the match line say "14 of 16 with the earlier 8" rather than
   * calling a second truck short against the whole purchase order.
   */
  async doorReceivedSoFar(orderId: string): Promise<DoorReceivedSoFar> {
    const { data } = await apiClient.get(
      `/procurement/receiving/orders/${orderId}/received`,
    )
    return data
  },

  /**
   * One line's history, newest first, ten at a time. Owner or manager only
   * (a desk route, ADR 0167). `before` is the previous page's `nextBefore`.
   */
  async lineHistory(orderId: string, before?: string | null): Promise<LineHistoryPage> {
    const { data } = await apiClient.get(
      `/procurement/receiving/orders/${orderId}/history`,
      before ? { params: { before } } : undefined,
    )
    return data
  },

  /**
   * Deliveries counted by case and never counted by bottle.
   * The safety net for booking stock on an approximate number.
   */
  async listUnverified(): Promise<{
    items: UnverifiedDelivery[]
    summary: string | null
    overdue: number
  }> {
    const { data } = await apiClient.get('/procurement/receiving/unverified')
    return data
  },

  /**
   * Send a photographed document for classification and extraction.
   *
   * Returns a proposal. Nothing is written to stock, cost or the order — the
   * document is stored for review, and applying it to a delivery is a separate
   * step where the match runs and a human accepts the outcome.
   */
  async uploadDocument(params: {
    contentBase64: string
    filename?: string
    mimeType?: string
    orderId?: string
    providerId?: string
    source?: 'photo' | 'upload'
  }): Promise<UploadedDocument> {
    const { data } = await apiClient.post('/procurement/documents', {
      ...params,
      source: params.source ?? 'photo',
    })
    return data
  },
}

export default receivingApi
