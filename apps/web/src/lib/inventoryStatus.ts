/**
 * inventoryStatus — single source of truth for stock classification (frontend).
 *
 * Phase 1 (D6): the same wine was classified three incompatible ways (page badge,
 * hook filter/stats, Python engine). This unifies the FRONTEND definition so the
 * stat cards, row badges, and filters can never disagree. The Python engine
 * (services/agent-orchestrator) must be aligned to these same bands separately.
 *
 * Bands (ratio = liveStock / threshold):
 *   critical : ratio <= 0.5
 *   low      : 0.5 < ratio <= 1
 *   healthy  : ratio > 1
 *   unknown  : liveStock is null/undefined (data not loaded / fetch failed) —
 *              MUST NOT read as out-of-stock (Phase 1 · 1.8 null-safety).
 */

export type StockStatusKey = 'healthy' | 'low' | 'critical' | 'unknown'

export interface StockStatus {
  key: StockStatusKey
  label: 'Healthy' | 'Low' | 'Critical' | 'Unknown'
  color: string
  bg: string
  text: string
}

const HEALTHY: StockStatus = { key: 'healthy', label: 'Healthy', color: 'emerald', bg: 'bg-emerald-100', text: 'text-emerald-700' }
const LOW: StockStatus = { key: 'low', label: 'Low', color: 'amber', bg: 'bg-amber-100', text: 'text-amber-700' }
const CRITICAL: StockStatus = { key: 'critical', label: 'Critical', color: 'rose', bg: 'bg-rose-100', text: 'text-rose-700' }
const UNKNOWN: StockStatus = { key: 'unknown', label: 'Unknown', color: 'gray', bg: 'bg-gray-100', text: 'text-gray-500' }

export function classifyStock(liveStock: number | null | undefined, threshold: number): StockStatus {
  if (liveStock == null) return UNKNOWN
  const t = threshold > 0 ? threshold : 1
  const ratio = liveStock / t
  if (ratio <= 0.5) return CRITICAL
  if (ratio <= 1) return LOW
  return HEALTHY
}
