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

/** What earlier trucks on this order already brought. */
export interface DoorReceivedSoFar {
  receivedQtyBottles: number
  doorEventCount: number
  packSize: number
  /** Null — never 0 — when the pack size is not knowable. */
  receivedBoxes: number | null
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
