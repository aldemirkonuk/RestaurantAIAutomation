import { apiClient } from './client'

/**
 * Analytics API client — POS-backed sales revenue (OD-85).
 *
 * `/analytics/*` sits behind a class-level `JwtAuthGuard`, so these calls MUST
 * go through the shared axios client: a raw `fetch` sends no Authorization
 * header and 401s. `src/__tests__/no-raw-gateway-fetch.test.ts` enforces it.
 *
 * The contract that matters here is the null. A restaurant with no POS wired
 * has no revenue data, and `revenue: null` says exactly that. It is NOT `0` —
 * zero would be a claim about the restaurant's trading rather than a statement
 * about ours. Every surface reading this branches on `posConnected` and renders
 * an empty state, never a figure. See ADR 0020 (no fabricated answers).
 */

/** One wine's measured POS sales over the window. */
export interface PosConsumptionRow {
  inventoryId: string | null
  wineName: string
  bottlesSold: number
  /** Summed real revenue of bottle lines; null when none carried a price. */
  bottleRevenue: number | null
  bottleVolumeMl: number
  /** Measured ml per bottle sold; null when nothing sold by the bottle. */
  avgBottleMl: number | null
  /** False when at least one bottle line had no price — the total understates. */
  bottleRevenueComplete: boolean
  glassesSold: number
  glassRevenue: number | null
  glassVolumeMl: number
  /** Measured pour size; null when nothing sold by the glass. */
  avgPourMl: number | null
  glassRevenueComplete: boolean
  /** Recorded purchase cost; null means margin cannot be computed at all. */
  costPerBottle: number | null
}

export interface PosRevenueWindow {
  restaurantId: string
  /** Inclusive first day, YYYY-MM-DD. */
  from: string
  /** Inclusive last day, YYYY-MM-DD. */
  to: string
  days: number
  /** False when this restaurant has never had a POS check land. */
  posConnected: boolean
  /** Non-voided `pos_checks.total`. Null — never 0 — when no POS is connected. */
  revenue: number | null
  checkCount: number | null
  /** Sparse: only days that had revenue appear. */
  dailySeries: Array<{ date: string; revenue: number }>
  consumption: PosConsumptionRow[]
}

/** The shape used before the first response lands and after a failure. */
export const NO_POS_REVENUE: PosRevenueWindow = {
  restaurantId: '',
  from: '',
  to: '',
  days: 0,
  posConnected: false,
  revenue: null,
  checkCount: null,
  dailySeries: [],
  consumption: [],
}

/**
 * GET /analytics/pos-revenue/:restaurantId
 *
 * @param days window length; the caller's time-range selector maps onto it.
 */
export async function getPosRevenue(
  restaurantId: string,
  days = 30,
): Promise<PosRevenueWindow> {
  const { data } = await apiClient.get<PosRevenueWindow>(
    `/analytics/pos-revenue/${restaurantId}`,
    { params: { days } },
  )
  return {
    ...NO_POS_REVENUE,
    ...data,
    dailySeries: Array.isArray(data?.dailySeries) ? data.dailySeries : [],
    consumption: Array.isArray(data?.consumption) ? data.consumption : [],
  }
}
