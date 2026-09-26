/**
 * Vendor credit claims API — the money a distributor owes back.
 *
 * CLAIMED IS NOT RECOVERED. Recovery means a credit memo exists. The
 * `credited` transition requires both the amount allowed and the credit-memo
 * document id; the server refuses anything less.
 */

import { apiClient } from './client'

export type CreditState =
  | 'open'
  | 'requested'
  | 'promised'
  | 'credited'
  | 'rejected'
  | 'written_off'

/** `procurement_credits_reason_check` — the seven reasons a claim can carry. */
export type CreditReason =
  | 'overbilled_vs_ship'
  | 'qty_short'
  | 'short_shipped'
  | 'damaged'
  | 'price_variance'
  | 'never_ordered'
  | 'other'

export interface ProcurementCredit {
  id: string
  restaurant_id: string
  provider_id: string | null
  order_id: string | null
  document_id: string | null
  /** The invoice line the claim was raised on, when it was raised on one. */
  document_line_id?: string | null
  state: CreditState
  claimed_amount: number
  /** Bottles the claim is for, when the discrepancy was a count. */
  claimed_qty?: number | null
  credited_amount: number | null
  credit_document_id: string | null
  /**
   * The claim's own ISO 4217 code (`procurement_credits.currency`, NOT NULL).
   * Always in the `select("*")` payload and absent from this type until the
   * credits lane on the rebuilt /receipts, which is why the legacy tab printed
   * every claim in dollars.
   */
  currency?: string | null
  /** A reason CODE (`CreditReason`), not a sentence — see `summary`. */
  reason: string | null
  /** The matcher's own sentence for the discrepancy, written when the claim opened. */
  summary?: string | null
  notes: string | null
  self_evidenced: boolean
  opened_at: string
  requested_at: string | null
  promised_at: string | null
  settled_at: string | null
}

export interface RecoveryFigures {
  recovered: number
  outstanding: number
  promised: number
  rejected: number
  openClaims: number
  oldestOpenDays: number | null
  settlementRate: number | null
}

export interface CreditStats extends RecoveryFigures {
  selfEvidencedOpen: number
  /**
   * The same figures kept apart by the claim's currency. The top-level ones add
   * every claim together whatever its currency; nothing converts, so a screen
   * that prints money reads these. Absent from a gateway older than this field.
   */
  byCurrency?: Record<string, RecoveryFigures>
  /** Rows the figures were computed from. Absent from an older gateway. */
  rowsCounted?: number
  /** True when those rows filled the server's window, so every figure is a floor. */
  capped?: boolean
}

export const creditsApi = {
  async list(opts: { state?: CreditState; providerId?: string } = {}): Promise<ProcurementCredit[]> {
    const { data } = await apiClient.get('/procurement/credits', {
      params: { state: opts.state, providerId: opts.providerId },
    })
    return data.items ?? []
  },

  async stats(): Promise<CreditStats> {
    const { data } = await apiClient.get('/procurement/credits/stats')
    return data
  },

  async transition(
    id: string,
    body: {
      to: CreditState
      creditedAmount?: number
      creditDocumentId?: string
      notes?: string
    },
  ): Promise<ProcurementCredit> {
    const { data } = await apiClient.post(`/procurement/credits/${id}/transition`, body)
    return data
  },
}

export default creditsApi
