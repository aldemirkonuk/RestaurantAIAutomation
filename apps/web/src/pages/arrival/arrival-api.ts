import { apiClient } from '../../services/api/client'

export type Folio =
  | 'evidence'
  | 'currency'
  | 'pour'
  | 'vendors'
  | 'notifications'
  | 'assistant'
export type Input = {
  target:
    | 'currency'
    | 'cellar'
    | 'threshold'
    | 'vendor_terms'
    | 'vendor_currency'
    | 'notifications'
    | 'menu_item'
  field: string
  value: unknown
  subjectId?: string
}
export type BatchRow = Input & {
  id: string
  before: unknown
  beforeValue?: unknown
  provenance: 'spoken' | 'inferred' | 'invoice' | 'menu'
  status:
    | 'pending'
    | 'applying'
    | 'written'
    | 'refused'
    | 'not_attempted'
    | 'unconfirmed'
    | 'undone'
  reason: string | null
}
export type Batch = {
  id: string
  revision: number
  status:
    | 'draft'
    | 'applying'
    | 'applied'
    | 'applied_with_issues'
    | 'undoing'
    | 'undone'
    | 'undone_with_issues'
  rows: BatchRow[]
  sealed_at: string | null
  undo_until: string | null
}
export type Source<T> = {
  readable: boolean
  data: T | null
  reason: string | null
}
export type Register = {
  id: string
  carried: boolean | null
  decidedBy: string
  basis: string
  evidence: { inventoryRows: number; menuRows: number }
}
export type Term = { value: unknown; source: string; reason?: string }
export type Vendor = {
  providerId: string
  providerName: string
  paymentTerms: Term
  deliveryWeekdays: Term
  leadTimeDays: Term
  minimumOrder: Term
  orderCutoff: Term
  notes: string | null
}
export type Preferences = {
  email: boolean
  push: boolean
  sms: boolean
  categories: Record<string, boolean>
  quietHours: { enabled: boolean; startTime: string; endTime: string }
  updatedAt: string | null
}
export type Book = {
  restaurantId: string
  canManage: boolean
  house: Source<{
    name: string
    default_threshold_min: number | null
    threshold_configured: boolean
  }>
  currency: Source<{
    code: string | null
    readable: boolean
    country: string | null
    reason: string | null
    statedAt: string | null
  }>
  cellar: Source<{
    registers: Register[]
    sources: {
      answers: { readable: boolean }
      inventory: { readable: boolean }
      menu: { readable: boolean }
    }
  }>
  vendors: Source<{
    terms: {
      vendors: Vendor[]
      sources: {
        providers: { readable: boolean }
        statedTerms: { readable: boolean }
      }
    }
    currencies: Array<{
      id: string
      name: string
      usual_currency: string | null
    }>
  }>
  preferences: Source<Preferences>
  folios: Source<
    Array<{
      folio: Folio
      state: 'open' | 'posted' | 'skipped'
      actor_id: string
      updated_at: string
    }>
  >
  batches: Source<Batch[]>
  openingMenu: Source<{
    menuId: string | null
    items: Array<{ id: string; name: string }>
  }>
}
export const arrivalApi = {
  read: async () => (await apiClient.get<Book>('/arrival')).data,
  skip: async (folio: Folio) =>
    (await apiClient.post('/arrival/skip', { folio })).data,
  typed: async (
    input: Input,
  ): Promise<{ written: boolean; recorded: boolean; reason: string | null }> =>
    (await apiClient.post('/arrival/typed', input)).data,
  propose: async (
    rows: Input[],
    provenance: 'spoken' | 'inferred',
  ): Promise<Batch> =>
    (
      await apiClient.post('/arrival/config/propose_batch', {
        rows,
        provenance,
      })
    ).data,
  menuEvidence: async (
    method: 'scan' | 'csv',
    content: string,
    binary: boolean,
  ): Promise<Batch> =>
    (
      await apiClient.post('/arrival/menu-evidence', {
        method,
        content,
        binary,
      })
    ).data,
  evidence: async (documentId: string, providerId?: string) =>
    (
      await apiClient.post<{ batch: Batch | null; reason: string | null }>(
        '/arrival/evidence',
        { documentId, ...(providerId ? { providerId } : {}) },
      )
    ).data,
  /**
   * Mint the one-time seal `HoldToApprove`'s `onChallenge` calls when the hold
   * BEGINS (ADR 0113; mirrors `mintOrderSeal` in `services/api/orders.ts`). A
   * mint that fails or returns null must not approve — `HoldToApprove` already
   * enforces that; this only ever resolves the token or null, never throws.
   */
  mintApplySeal: async (batchId: string): Promise<string | null> => {
    try {
      const { data } = await apiClient.post<{ challenge: string }>(
        `/arrival/batches/${batchId}/seal-challenge`,
      );
      return data.challenge ?? null;
    } catch {
      return null;
    }
  },
  apply: async (batch: Batch, challenge?: string | null): Promise<Batch> =>
    (
      await apiClient.post(
        `/arrival/batches/${batch.id}/apply`,
        { revision: batch.revision },
        // The seal travels in a header, never in the body: it is not one of
        // the arguments it is a seal OVER.
        challenge ? { headers: { "X-Seal-Challenge": challenge } } : undefined,
      )
    ).data,
  discard: async (batch: Batch, rowId: string): Promise<Batch> =>
    (
      await apiClient.post(
        `/arrival/batches/${batch.id}/rows/${rowId}/discard`,
        { revision: batch.revision },
      )
    ).data,
  undo: async (batch: Batch): Promise<Batch> =>
    (
      await apiClient.post(`/arrival/batches/${batch.id}/undo`, {
        revision: batch.revision,
      })
    ).data,
}
export function arrivalError(error: unknown): string {
  const e = error as {
    response?: { data?: { message?: string | string[] } }
    message?: string
  }
  const message = e?.response?.data?.message
  return Array.isArray(message)
    ? message.join(' ')
    : (message ?? e?.message ?? 'The book could not be recorded. Try again.')
}
