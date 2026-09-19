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

/**
 * The append-only receiving verdict ledger (ADR 0149 row 23; sketch
 * 107-receiving-structure — "The derivation rule"). Mirrors
 * `receiving.service.ts`'s `LineVerdictWord` / `LineVerdictRow` /
 * `LineVerdictLedger` — one verdict word, one quantity, one unit, never
 * abbreviated and never re-multiplied on this side.
 */
export const LINE_VERDICT_WORDS = ['accepted', 'short', 'refused', 'damaged'] as const
export type LineVerdictWord = (typeof LINE_VERDICT_WORDS)[number]

/**
 * The unit vocabulary the gateway accepts (`order-units.ts:ORDER_UNIT_TYPES`).
 * Mirrored here only to populate a picker — the gateway is the one place this
 * is enforced, and it refuses anything else before a write happens.
 */
export const ORDER_UNIT_TYPES = [
  'bottle',
  'case',
  'keg',
  'pack',
  'split_case',
  'each',
  'liter',
] as const

export interface LineVerdictRow {
  id: string
  orderId: string
  lineNo: number
  verdict: LineVerdictWord
  qty: number
  uom: string
  qtyBottles: number
  beyondOrder: boolean
  reason: string
  evidence: unknown
  supersedes: string | null
  supersedesQtyBottles: number | null
  recordedBy: string
  /** Null with a stated reason when the person register cannot be read — never "nobody". */
  recordedByName: string | null
  recordedByNameUnavailable: string | null
  recordedAt: string
  clientCapturedAt: string | null
}

export interface CurrentVerdictLine {
  verdict: LineVerdictWord
  beyondOrder: boolean
  /** 'bottle' for every unit that converts; the opaque unit itself ('keg' | 'liter') otherwise — never merged into a bottle figure. */
  currentUnit: 'bottle' | 'keg' | 'liter'
  /** Quantity in `currentUnit`. Not always bottles. */
  currentQty: number
  entryCount: number
  lastRecordedAt: string
  /** The server's own arithmetic for this bucket ("12 + 6 − 2 = 16"), or null when there is nothing to show. Render as given — never recompute. */
  arithmetic: string | null
}

export interface LineVerdictLedger {
  /** Oldest first — a struck-through (superseded) row stays in the list. */
  entries: LineVerdictRow[]
  /** The derivation, not the latest row. Empty when the line carries no verdict yet. */
  current: CurrentVerdictLine[]
  packSize: number
  orderedUnitType: string | null
  orderedQty: number | null
  orderedBottles: number | null
  /** True when older entries exist beyond this page — page, never grow without end. */
  hasEarlier: boolean
  /** Pass back as `before` to fetch the next page of older entries. */
  earliestCursor: string | null
  totalEntries: number
  /** `orderedBottles` minus every 'bottle'-unit current bucket, floored at 0. Null when `orderedBottles` is null. */
  notCountedBottles: number | null
}

export interface AppendLineVerdictRequest {
  verdict: LineVerdictWord
  /** What was counted, in the unit named by `uom` — never re-multiplied. */
  qty: number
  uom: string
  beyondOrder?: boolean
  reason: string
  evidence?: Record<string, unknown>
  /** The row this portion is taken from, on the same order and line. */
  supersedes?: string
  /** In bottles — the named row's own comparison unit. Omit to take all of it. */
  supersedesQtyBottles?: number
  clientCapturedAt?: string
  /** Stable across retries — the same append must never write twice. */
  idempotencyKey?: string
}

export interface AppendLineVerdictResponse {
  entry: LineVerdictRow
  current: CurrentVerdictLine[]
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

  /**
   * The append-only verdict ledger for one order+line (ADR 0149 row 23).
   * Oldest first; pass `before` (an earlier page's `earliestCursor`) to fetch
   * further back — the desk pages rather than growing without end.
   */
  async listLineVerdicts(
    orderId: string,
    opts: { limit?: number; before?: string | null } = {},
  ): Promise<LineVerdictLedger> {
    const params: Record<string, string | number> = {}
    if (opts.limit != null) params.limit = opts.limit
    if (opts.before) params.before = opts.before
    // The controller lives at @Controller('procurement/receiving') — the
    // 'receiving/' segment is not optional. Dropped once (fixer review,
    // 2026-09-18): every read 404'd and the test that should have caught it
    // asserted the wrong path too. See receiving-route.spec.ts.
    const { data } = await apiClient.get(
      `/procurement/receiving/orders/${orderId}/verdicts`,
      { params },
    )
    return data
  },

  /**
   * Append one verdict to the ledger. Never edits or replaces — the database
   * refuses UPDATE/DELETE on this table from any role.
   */
  async appendLineVerdict(
    orderId: string,
    body: AppendLineVerdictRequest,
  ): Promise<AppendLineVerdictResponse> {
    const { data } = await apiClient.post(
      `/procurement/receiving/orders/${orderId}/verdicts`,
      body,
    )
    return data
  },
}

export default receivingApi
