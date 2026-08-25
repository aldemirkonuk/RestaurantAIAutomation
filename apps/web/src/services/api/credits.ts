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

export interface ProcurementCredit {
  id: string
  restaurant_id: string
  provider_id: string | null
  order_id: string | null
  document_id: string | null
  state: CreditState
  claimed_amount: number
  credited_amount: number | null
  credit_document_id: string | null
  reason: string | null
  notes: string | null
  self_evidenced: boolean
  opened_at: string
  requested_at: string | null
  promised_at: string | null
  settled_at: string | null
}

export interface CreditStats {
  recovered: number
  outstanding: number
  promised: number
  rejected: number
  openClaims: number
  oldestOpenDays: number | null
  settlementRate: number | null
  selfEvidencedOpen: number
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
