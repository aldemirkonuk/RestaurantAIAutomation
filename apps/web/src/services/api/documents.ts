/**
 * Vendor documents API.
 *
 * The receiving screen reads these to pre-fill what the vendor billed and what
 * their packing slip says shipped, so a manager confirms numbers instead of
 * transcribing them.
 */

import axios from 'axios'
import { apiClient, getErrorMessage } from './client'

/**
 * The header every sealed write in this product carries its proof back in.
 *
 * One name, one shape, across orders, payment methods, text credits and — since
 * 2026-09-06 (batch 64) — the three procurement document acts. The seal is not
 * one of the arguments it is a seal OVER, so it never travels in the body.
 */
const SEAL_HEADER = 'X-Seal-Challenge'

const sealed = (challenge?: string | null) =>
  challenge ? { headers: { [SEAL_HEADER]: challenge } } : undefined

/**
 * THE REFUSAL HAS TO SURVIVE THE TRIP.
 *
 * The gateway answers a refused seal with a whole sentence naming what did not
 * match and saying that nothing was changed. An axios error carries that in
 * `response.data.message` and puts "Request failed with status code 403" in
 * `.message`, which is what every call site here reads. So the server's sentence
 * is promoted onto `.message` and the SAME error object is rethrown — `response`,
 * `status` and `isAxiosError` all intact, because callers branch on
 * `err.response?.status` elsewhere. (`orders.ts` states the same rule for the
 * order seal; this is that rule, not a second copy of the policy.)
 */
function rethrowSpoken(error: unknown): never {
  if (axios.isAxiosError(error)) {
    const spoken = getErrorMessage(error)
    if (spoken) error.message = spoken
  }
  throw error
}

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
  /**
   * Whether this document's money may be read, and the sentence saying why not.
   *
   * DERIVED BY THE GATEWAY, never here. `documentMoneyState` in
   * `procurement/documents/invoice-currency.ts` is the same function
   * `verifyReceipt` refuses a keyed-in unit price with, so the screen and the
   * gate cannot disagree about whether a document is held — a second
   * implementation in the browser is how a page comes to show an enabled field
   * the server will reject. Absent on responses from a gateway that predates it.
   */
  moneyState?: { priced: true } | { priced: false; reason: string }
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

/**
 * What the ORDER a document is filed against was placed in (B4, founder
 * 2026-09-06 batch 65: "we will have time To make sure that the invoice is good
 * with the order we had").
 *
 * `failure` is not decoration. A read that broke and an order that named no
 * currency both arrive as `currency: null`, and only one of them means the
 * comparison can be trusted (ADR 0067).
 */
export interface OrderCurrencyBlock {
  id: string
  currency: string | null
  currencySource: 'vendor_usual' | 'typed' | null
  orderNumber: string | null
  failure: string | null
}

export const documentsApi = {
  /** Documents linked to one order. Empty when none are attached yet. */
  async forOrder(orderId: string): Promise<ProcurementDocument[]> {
    const { data } = await apiClient.get('/procurement/documents', {
      params: { orderId, limit: 50 },
    })
    return data.items ?? []
  },

  /**
   * The same list, plus the order's OWN currency, for the surface that
   * reconciles an invoice against its order.
   *
   * One request rather than two so the two halves of the comparison come from
   * one moment: an invoice read now against an order read a second later can
   * show a mismatch that a restatement in between had already resolved.
   */
  async forOrderWithCurrency(orderId: string): Promise<{
    documents: ProcurementDocument[]
    order: OrderCurrencyBlock | null
  }> {
    const { data } = await apiClient.get('/procurement/documents', {
      params: { orderId, limit: 50 },
    })
    return { documents: data.items ?? [], order: data.order ?? null }
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

  /**
   * Mint the one-time seal a VERIFICATION has to carry back — at the moment the
   * confirm gesture BEGINS.
   *
   * THE SEAL IS REDEEMED, NOT ASSERTED (founder, 2026-09-06 batch 64: "Decide as
   * a module: seal all three"). The gateway mints a token bound to (this
   * reviewer, this document, "verify", and the whole transcription as it stands)
   * and redeems it exactly once, so a verification proves a person did it rather
   * than asserting one did — and a line corrected between the gesture and the
   * write refuses the seal instead of putting a reviewer's name on a figure they
   * never read.
   *
   * It MUST be called when the gesture starts, never at the moment of confirm: a
   * token this request fetched for itself is the assertion model with extra
   * steps. `SwipeToConfirm`/`HoldToApprove`'s `onChallenge` is the hook that
   * guarantees the timing, and a mint that fails or returns null does NOT
   * verify.
   */
  async mintVerifySeal(id: string): Promise<string | null> {
    try {
      const { data } = await apiClient.post<{ challenge?: string }>(
        `/procurement/documents/${id}/verify-seal-challenge`,
        {},
      )
      return data?.challenge ?? null
    } catch (error) {
      return rethrowSpoken(error)
    }
  },

  /**
   * Confirm the extraction is a faithful transcription of the paper document,
   * carrying the seal minted when the gesture began.
   *
   * `challenge` is not optional in practice — the gateway refuses a verification
   * without one, in words. It is typed optional so a caller that does not yet
   * mint keeps COMPILING and receives the gateway's refusal sentence rather than
   * a type error. That refusal is the honest outcome: it says, in words, that
   * the seal has to be proven and that nothing was changed.
   */
  async verify(id: string, challenge?: string | null): Promise<void> {
    try {
      await apiClient.post(
        `/procurement/documents/${id}/verify`,
        {},
        sealed(challenge),
      )
    } catch (error) {
      rethrowSpoken(error)
    }
  },

  /**
   * RULE 3 — restate what currency this invoice's money is in.
   *
   * Founder, 2026-09-06: the house may deliberately change it when the invoice
   * is other than their default. Managers and owners only; the gateway refuses
   * anyone else in a sentence, and the page disables the control with that
   * sentence rather than hiding it.
   *
   * The gateway writes the audit row FIRST and does not change the currency if
   * the log cannot be written, so a resolved promise here means both landed.
   * `sentence` is what moved, in the server's own words — rendered verbatim
   * rather than paraphrased, because it names figures this client does not have.
   */
  async restateCurrency(
    id: string,
    currency: string,
    reason?: string,
    challenge?: string | null,
  ): Promise<{
    currency: string
    previousCurrency: string | null
    sentence: string
    moneyRefiled: boolean
    linesRefiled: number
    lineFailures: string[]
  }> {
    try {
      const { data } = await apiClient.patch(
        `/procurement/documents/${id}/currency`,
        { currency, reason },
        sealed(challenge),
      )
      return data
    } catch (error) {
      return rethrowSpoken(error)
    }
  },

  /**
   * Mint the one-time seal a RESTATEMENT has to carry back.
   *
   * The currency is named at the MINT as well as at the write, because the seal
   * is bound to the pair (the code being written, the code the document carries
   * now): a seal obtained to move a held invoice to EUR cannot be spent after
   * somebody else already filed it in USD.
   *
   * It is also the first refusal a person meets. The gateway will not mint a
   * seal for a restatement it would refuse — a caller who is not a manager or an
   * owner, or a code that is not a currency — so the hold fails at its start
   * with the reason rather than at its end after a second of ceremony.
   */
  async mintCurrencySeal(id: string, currency: string): Promise<string | null> {
    try {
      const { data } = await apiClient.post<{ challenge?: string }>(
        `/procurement/documents/${id}/currency-seal-challenge`,
        { currency },
      )
      return data?.challenge ?? null
    } catch (error) {
      return rethrowSpoken(error)
    }
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
   *
   * THE SEAL IS NOW THAT PRECONDITION, and it is stronger than the after-the-fact
   * comparison this comment describes. Since 2026-09-06 the mint hashes the line
   * AS IT STANDS together with the exact patch, so a correction written on top of
   * somebody else's is REFUSED rather than reported once it has already landed.
   * The collision notice below stays: it is what a person reads when the refusal
   * arrives, and it names which field moved.
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
    challenge?: string | null,
  ): Promise<{
    line: ProcurementDocumentLine
    tieOut: { computedLinesTotal: number; tieOutDelta: number | null; tiesOut: boolean | null }
  }> {
    try {
      const { data } = await apiClient.patch(
        `/procurement/documents/${documentId}/lines/${lineId}`,
        patch,
        sealed(challenge),
      )
      return data
    } catch (error) {
      return rethrowSpoken(error)
    }
  },

  /**
   * Mint the one-time seal a LINE CORRECTION has to carry back.
   *
   * THE PATCH GOES TO THE MINT TOO, and that is the point: the seal is taken over
   * the correction about to be made, so a gesture obtained for "qty 14" cannot be
   * spent to write 140. The caller must send the SAME patch object to both — the
   * page does, because both come from one commit.
   */
  async mintLineEditSeal(
    documentId: string,
    lineId: string,
    patch: Record<string, unknown>,
  ): Promise<string | null> {
    try {
      const { data } = await apiClient.post<{ challenge?: string }>(
        `/procurement/documents/${documentId}/lines/${lineId}/edit-seal-challenge`,
        patch,
      )
      return data?.challenge ?? null
    } catch (error) {
      return rethrowSpoken(error)
    }
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
