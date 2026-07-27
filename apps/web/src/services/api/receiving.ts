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
