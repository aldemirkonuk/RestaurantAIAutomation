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
  rejectedQty?: number
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
  suggestedQty?: number
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
  stockDelta?: number
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
