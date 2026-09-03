/**
 * SimPOS terminal API — talks only to /simpos/:restaurantId.
 * Never reads Mudavym tables directly; the signed webhook on check close
 * is the only channel into Mudavym (decision C25).
 */

import { apiClient } from './client'

export interface SimposCatalogItem {
  id: string
  restaurant_id: string
  external_item_id: string
  wine_name: string
  producer: string | null
  vintage: number | null
  size_ml: number
  price: number
  is_active: boolean
}

export interface SimposCheckLine {
  id: string
  check_id: string
  catalog_id: string
  item_name_snapshot: string
  unit_price_snapshot: number
  qty: number
  status: 'active' | 'voided' | 'comped' | 'discounted'
  status_reason: string | null
  discount_amount: number
  added_at: string
}

export interface SimposCheck {
  id: string
  restaurant_id: string
  status: 'open' | 'closed'
  opened_at: string
  closed_at: string | null
  webhook_status: string | null
  webhook_error: string | null
  lines: SimposCheckLine[]
  lossTotal: number
}

export interface SimposOrder extends SimposCheck {
  // listOrders returns the same shape as a check with lines + lossTotal
}

// ===========================================================================
// Scenario harness (ADR 0093)
// ===========================================================================

export interface ScenarioStory {
  id: string
  title: string
  story: string
  check_ids?: string[]
}

export interface ScenarioTotals {
  checks?: number
  posted_checks?: number
  wine_lines?: number
  food_lines?: number
  revenue?: number
}

export interface ScenarioRunSummary {
  id: string
  scenario: string | null
  seed: number | null
  service_date: string | null
  timezone: string | null
  posted_at: string | null
  created_at: string | null
  totals: ScenarioTotals | null
  scenarios: ScenarioStory[] | null
}

export interface ScenarioRunList {
  runs: ScenarioRunSummary[]
  /** The server's row cap. A full page is a FLOOR, never a total. */
  cap: number
  capped: boolean
}

export interface ScenarioRun extends ScenarioRunSummary {
  restaurant_id: string
  archetype_id: string | null
  operating_hours: unknown
  params: unknown
  expected: Record<string, unknown> | null
}

/**
 * `unverifiable` is a THIRD outcome, not a soft pass and not a soft fail: the
 * product could not be asked, so the page must not answer for it (ADR 0020).
 */
export type ScenarioCheckStatus = 'pass' | 'fail' | 'unverifiable'

export interface ScenarioCheckRow {
  id: string
  title: string
  status: ScenarioCheckStatus
  expected: unknown
  actual: unknown
  detail: string
  samples?: unknown[]
}

export interface ScenarioReadRecord {
  table: string
  ok: boolean
  error?: string
  rows?: number
}

export interface ScenarioVerifyResult {
  runId: string
  restaurantId: string
  scenario: string | null
  seed: number | null
  serviceDate: string | null
  postedAt: string | null
  verifiedAt: string
  summary: { pass: number; fail: number; unverifiable: number; total: number }
  checks: ScenarioCheckRow[]
  reads: ScenarioReadRecord[]
}

export interface EmailDeliveryOutcome {
  attempted_at: string
  ok: boolean
  error: string | null
  recipients: number
  mode: 'instant' | 'digest'
}

export interface ScenarioSweepResult {
  swept_at: string
  since: string
  notifications: Array<{
    id: string
    type: string
    title: string
    message: string
    priority: string
    created_at: string
    delivery_status: { email?: EmailDeliveryOutcome } | null
    metadata: Record<string, unknown> | null
  }>
}

export interface ScenarioInsightsResult {
  generated_at: string
  count: number
  availability: string[]
  /** UPPER BOUND on types with the data to fire — not a promise of delivery. */
  candidateTypesAvailable: number
  candidateTypesTotal: number
  sample: string[]
}

function base(restaurantId: string) {
  return `/simpos/${restaurantId}`
}

export const simposApi = {
  async seedCatalog(restaurantId: string) {
    const { data } = await apiClient.post(`${base(restaurantId)}/catalog/seed`)
    return data as { seeded: boolean; count: number }
  },

  async listCatalog(restaurantId: string) {
    const { data } = await apiClient.get(`${base(restaurantId)}/catalog`)
    return data as SimposCatalogItem[]
  },

  async upsertCatalogItem(
    restaurantId: string,
    body: {
      id?: string
      wineName: string
      producer?: string | null
      vintage?: number | null
      sizeMl?: number
      price: number
    },
  ) {
    const { data } = await apiClient.post(`${base(restaurantId)}/catalog`, body)
    return data as SimposCatalogItem
  },

  async removeCatalogItem(restaurantId: string, catalogId: string) {
    await apiClient.delete(`${base(restaurantId)}/catalog/${catalogId}`)
  },

  async listTables(restaurantId: string) {
    const { data } = await apiClient.get(`${base(restaurantId)}/tables`)
    return data as Array<{ id: string; table_number: number; label: string | null }>
  },

  async getOrCreateOpenCheck(restaurantId: string) {
    const { data } = await apiClient.get(`${base(restaurantId)}/check`)
    return data as SimposCheck
  },

  async listOrders(restaurantId: string) {
    const { data } = await apiClient.get(`${base(restaurantId)}/orders`)
    return data as SimposOrder[]
  },

  async addLine(
    restaurantId: string,
    checkId: string,
    catalogId: string,
    qty = 1,
  ) {
    const { data } = await apiClient.post(
      `${base(restaurantId)}/check/${checkId}/lines`,
      { catalogId, qty },
    )
    return data
  },

  async setLineStatus(
    restaurantId: string,
    lineId: string,
    body: {
      status: 'active' | 'voided' | 'comped' | 'discounted'
      reason?: string
      discountAmount?: number
    },
  ) {
    const { data } = await apiClient.patch(
      `${base(restaurantId)}/lines/${lineId}`,
      body,
    )
    return data
  },

  async closeCheck(restaurantId: string, checkId: string) {
    const { data } = await apiClient.post(
      `${base(restaurantId)}/check/${checkId}/close`,
    )
    return data as { check: SimposCheck; lines: SimposCheckLine[]; webhook: { ok: boolean; error?: string } }
  },

  // -- Scenario harness (ADR 0093) -----------------------------------------

  async listScenarioRuns(restaurantId: string) {
    const { data } = await apiClient.get(`${base(restaurantId)}/scenarios/runs`)
    return data as ScenarioRunList
  },

  async getScenarioRun(restaurantId: string, runId: string) {
    const { data } = await apiClient.get(
      `${base(restaurantId)}/scenarios/runs/${runId}`,
    )
    return data as ScenarioRun
  },

  async verifyScenarioRun(restaurantId: string, runId: string) {
    const { data } = await apiClient.get(
      `${base(restaurantId)}/scenarios/runs/${runId}/verify`,
    )
    return data as ScenarioVerifyResult
  },

  async runLowStockSweep(restaurantId: string, runId: string) {
    const { data } = await apiClient.post(
      `${base(restaurantId)}/scenarios/runs/${runId}/sweep`,
    )
    return data as ScenarioSweepResult
  },

  async generateInsights(restaurantId: string, runId: string) {
    const { data } = await apiClient.post(
      `${base(restaurantId)}/scenarios/runs/${runId}/insights`,
    )
    return data as ScenarioInsightsResult
  },
}

export default simposApi
