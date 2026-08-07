/**
 * Vendor price intelligence API.
 *
 * Goes through `apiClient` rather than a bare axios call. The page previously
 * read `localStorage.accessToken` itself and passed it as a header, which
 * skipped the shared client's reactive 401 refresh — so an expired token
 * rendered as "could not load the comparison" instead of silently refreshing,
 * and looked like a broken feature rather than an old session.
 */

import { apiClient } from './client'

export type PriceSourceType =
  | 'invoice'
  | 'quote'
  | 'api_catalog'
  | 'website_scrape'
  | 'chat'
  | 'social'
  | 'manual'

/** The subset a human may legitimately attest to; see ManualObservationDto. */
export type ManualSourceType = Extract<
  PriceSourceType,
  'quote' | 'chat' | 'social' | 'manual'
>

export interface VendorQuote {
  vendorId: string | null
  vendorName: string | null
  unitPrice: number
  sourceType: PriceSourceType
  ageDays: number
  isOutlier: boolean
}

export interface PriceTrend {
  windowDays: number
  current: number | null
  previous: number | null
  absoluteChange: number | null
  pctChange: number | null
  note: string
}

export interface VendorCompareResponse {
  productName: string | null
  consensus: {
    consensusPrice: number | null
    bestPrice: number | null
    bestVendorName: string | null
    observationCount: number
    admittedCount: number
    outlierCount: number
    sourceBreakdown: Record<string, number>
    ladder: VendorQuote[]
    confidence: number
    notes: string[]
  }
  trends: PriceTrend[]
}

export async function compareVendorPrices(params: {
  masterWineId?: string
  signatureHash?: string
  windowDays?: number
}): Promise<VendorCompareResponse> {
  const res = await apiClient.get<VendorCompareResponse>(
    '/vendor-intel/compare',
    { params },
  )
  return res.data
}

export interface ManualObservationInput {
  masterWineId?: string
  productName?: string
  producer?: string
  vintage?: number
  providerId?: string
  vendorName?: string
  price: number
  packSize?: number
  unitVolumeMl?: number
  sourceType?: ManualSourceType
  sourceUrl?: string
  observedAt?: string
  note?: string
}

export async function recordVendorPrice(input: ManualObservationInput) {
  const res = await apiClient.post('/vendor-intel/observations', input)
  return res.data as { success: boolean; observation: { id: string } }
}

/**
 * The server's message, not axios's.
 *
 * `error.message` on a failed request is "Request failed with status code 400",
 * which tells the user nothing they can act on. The API's own message — "pick a
 * wine from the list rather than typing a name" — is the whole point of having
 * returned a 400.
 */
/**
 * Retry the network, never the request.
 *
 * The global default retries once. For a 4xx that costs a round trip and buys
 * nothing — the server has already said the request itself is wrong, and it
 * will say so again. Worse, it leaves the UI in a hole: between attempts
 * react-query reports neither `isLoading` (nothing is in flight) nor `isError`
 * (the query has not given up), so a page that renders loading / error / data
 * and nothing else renders NOTHING. Hitting /vendor-prices with a bad id
 * showed a blank panel under the search box for exactly that reason.
 */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  return failureCount < 1
}

export function apiErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  const body = (error as { response?: { data?: { message?: unknown } } })?.response?.data
  const message = body?.message
  if (Array.isArray(message)) return message.join('. ')
  if (typeof message === 'string' && message) return message
  const plain = (error as { message?: string })?.message
  return plain || fallback
}
