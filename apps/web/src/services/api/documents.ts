/**
 * Vendor documents API.
 *
 * The receiving screen reads these to pre-fill what the vendor billed and what
 * their packing slip says shipped, so a manager confirms numbers instead of
 * transcribing them.
 */

import { apiClient } from './client'

export interface ProcurementDocument {
  id: string
  doc_type:
    | 'invoice'
    | 'packing_slip'
    | 'delivery_receipt'
    | 'credit_memo'
    | 'purchase_order'
    | 'statement'
    | 'unknown'
  source_channel: string
  doc_number: string | null
  doc_date: string | null
  status: 'received' | 'extracting' | 'needs_review' | 'verified' | 'rejected' | 'superseded'
  /**
   * ISO 4217 code the document is denominated in. Real column
   * (`procurement_documents.currency`, `varchar(3)`, defaulted to 'USD' but
   * NOT NULL-free), returned by the `select("*")` list endpoint and simply
   * absent from this type — which is why every money figure this client fed a
   * screen was printed with a hardcoded `$`. Nullable here because the column
   * is: a row inserted with an explicit NULL records no unit, and that is a
   * fact to state, not a dollar sign to assume.
   */
  currency?: string | null
  total: number | null
  freight: number | null
  fuel_surcharge: number | null
  split_case_fee: number | null
  delivery_fee: number | null
  tax: number | null
  other_charges: number | null
  ties_out: boolean | null
  tie_out_delta: number | null
  extraction_confidence: number | null
  notes: string | null
  created_at: string
  storage_path?: string | null
  /** Short-lived signed URL for the stored photo/PDF (detail endpoint only). */
  imageUrl?: string | null
  provider_id?: string | null
  order_id?: string | null
  filename?: string | null
}

export interface ProcurementDocumentLine {
  id: string
  line_no: number
  vendor_sku: string | null
  description: string | null
  vintage: number | null
  qty: number
  uom: string
  pack_size: number
  qty_bottles: number
  free_goods_qty: number
  unit_price: number | null
  line_total: number | null
  allowance: number | null
  order_line_id: string | null
  /**
   * How sure the pairing is, 0–1 (`numeric(4,3)`). `1` after a human confirms
   * (documents.controller.ts:244). Null when nothing is paired — and null is
   * NOT zero: "no pairing" and "a pairing nobody scored" are different facts.
   */
  match_confidence?: number | null
  /** vendor_sku | description | qty_price | manual | edi_reference. */
  match_method?: 'vendor_sku' | 'description' | 'qty_price' | 'manual' | 'edi_reference' | null
}

/** One pairing the matcher produced, applied or merely suggested. */
export interface DocumentLineMatch {
  documentLineId: string
  orderLineId: string
  confidence: number
  substitution: boolean
  reason: string
  method?: string
}

/** Decision E49 — absence is never agreement. Render nulls as an em dash, never as a pass. */
export function dashNull(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  return String(value)
}

export const documentsApi = {
  /** Documents linked to one order. Empty when none are attached yet. */
  async forOrder(orderId: string): Promise<ProcurementDocument[]> {
    const { data } = await apiClient.get('/procurement/documents', {
      params: { orderId, limit: 50 },
    })
    return data.items ?? []
  },

  /** All documents for the restaurant, optionally filtered by status (needs_review / verified). */
  async list(opts: {
    status?: string
    docType?: string
    limit?: number
  } = {}): Promise<ProcurementDocument[]> {
    const { data } = await apiClient.get('/procurement/documents', {
      params: {
        status: opts.status,
        docType: opts.docType,
        limit: opts.limit ?? 100,
      },
    })
    return data.items ?? []
  },

  async detail(id: string): Promise<{
    document: ProcurementDocument
    lines: ProcurementDocumentLine[]
    links: unknown[]
  }> {
    const { data } = await apiClient.get(`/procurement/documents/${id}`)
    return data
  },

  /** Confirm the extraction is a faithful transcription of the paper document. */
  async verify(id: string): Promise<void> {
    await apiClient.post(`/procurement/documents/${id}/verify`, {})
  },

  /**
   * Correct one extracted line by hand (pre-verification only). Returns the
   * updated line and the document's recomputed tie-out, so the caller can
   * show the arithmetic move immediately.
   *
   * NO CONCURRENCY PRECONDITION, and there is nothing to build one from.
   * `procurement_document_lines` carries `created_at` and no `updated_at`
   * (baseline_from_production.sql:4377-4400), so there is no version, no
   * etag, and no mtime to send an `If-Match` on. Two managers on one document
   * are last-write-wins. Rather than invent a column here, the page detects
   * the collision AFTER the fact: it sends one field per PATCH and compares
   * every field it did NOT send against its own cached copy of the row, so a
   * value that moved underneath is said out loud instead of silently winning.
   * A real precondition needs a migration; filed as a page-note gap.
   */
  async editLine(
    documentId: string,
    lineId: string,
    patch: Partial<
      Pick<
        ProcurementDocumentLine,
        'qty' | 'description' | 'vintage' | 'uom'
      > & { unitPrice: number | null; lineTotal: number | null }
    >,
  ): Promise<{
    line: ProcurementDocumentLine
    tieOut: { computedLinesTotal: number; tieOutDelta: number | null; tiesOut: boolean | null }
  }> {
    const { data } = await apiClient.patch(
      `/procurement/documents/${documentId}/lines/${lineId}`,
      patch,
    )
    return data
  },

  /**
   * Run the line matcher.
   *
   * `applied` pairings were **written to the database** by this call —
   * unambiguous vendor-SKU matches above the auto threshold
   * (line-matcher.ts:282-296, documents.controller.ts:209-224). They are a
   * fait accompli, not a proposal, so a caller that shows them must also offer
   * to undo them (`linkLine(…, null)`). `suggested` is the half that is never
   * persisted until a human confirms it.
   */
  async match(id: string): Promise<{
    applied: DocumentLineMatch[]
    suggested: DocumentLineMatch[]
    unmatchedDocumentLineIds: string[]
    unmatchedOrderLineIds: string[]
  }> {
    const { data } = await apiClient.post(`/procurement/documents/${id}/match`, {})
    return data
  },

  /** Confirm (or clear) one suggested line pairing. */
  async linkLine(documentId: string, lineId: string, orderLineId: string | null): Promise<void> {
    await apiClient.post(`/procurement/documents/${documentId}/lines/${lineId}/link`, {
      orderLineId,
    })
  },
}

/**
 * Pick the document to trust for each role.
 *
 * Newest wins, and a human-verified document beats an unverified one regardless
 * of age — a manager who has checked a transcription against the paper has said
 * something stronger than "this arrived more recently".
 */
export function pickDocuments(docs: ProcurementDocument[]) {
  const usable = docs.filter((d) => d.status !== 'rejected' && d.status !== 'superseded')
  const best = (type: ProcurementDocument['doc_type']) =>
    usable
      .filter((d) => d.doc_type === type)
      .sort((a, b) => {
        const av = a.status === 'verified' ? 1 : 0
        const bv = b.status === 'verified' ? 1 : 0
        if (av !== bv) return bv - av
        return b.created_at.localeCompare(a.created_at)
      })[0] ?? null

  return {
    invoice: best('invoice'),
    packingSlip: best('packing_slip'),
    creditMemo: best('credit_memo'),
  }
}

/**
 * Charges to fold into landed cost.
 *
 * Freight, fuel surcharge and split-case fees are cost components, not price
 * variances — treating them as a price deviation makes every delivery from a
 * house that charges freight look like a vendor error. Tax is excluded on
 * purpose: it is not part of the cost of the goods.
 */
export function allocatedChargesFor(doc: ProcurementDocument | null): number {
  if (!doc) return 0
  return (
    (doc.freight ?? 0) +
    (doc.fuel_surcharge ?? 0) +
    (doc.split_case_fee ?? 0) +
    (doc.delivery_fee ?? 0) +
    (doc.other_charges ?? 0)
  )
}

export default documentsApi
