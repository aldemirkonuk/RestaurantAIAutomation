/**
 * A house's own price, its target margin, and advice toward it (ADR 0193).
 *
 * The founder, 2026-09-21: "... advise the manager or owner to increase
 * decrease the prices so that the profit margin is where it's needed. We don't
 * want market average because that will be already shown in another column."
 *
 * Every route here takes the house from the signed token; no restaurant id is
 * sent. The two writes are owner/manager only and the gateway refuses anyone
 * else (403) independently of any page.
 */
import { apiClient } from './client'

export type PriceKind = 'bottle' | 'glass'
export type AdviceState = 'no_target' | 'no_price' | 'no_cost' | 'on_target' | 'raise' | 'lower'

export interface PriceAdvice {
  kind: PriceKind
  state: AdviceState
  price: number | null
  unitCost: number | null
  currentMarginPct: number | null
  targetPct: number | null
  bandPts: number | null
  /** Set only for raise / lower: the exact price that reaches the target. */
  advisedPrice: number | null
  sentence: string
}

export interface WineAdvice {
  inventoryId: string
  wineName: string | null
  costBasis: string
  costBasisLabel: string
  bottleCost: number | null
  bottle: PriceAdvice | null
  glass: PriceAdvice | null
}

export interface HouseAdvice {
  restaurantId: string
  generatedAt: string
  target: { bottlePct: number | null; glassPct: number | null; bandPts: number | null; set: boolean }
  wines: WineAdvice[]
  counts: Record<AdviceState, number>
}

export interface TargetMarginReadout {
  restaurantId: string
  bottlePct: number | null
  glassPct: number | null
  bandPts: number | null
  readable: boolean
  reason: string | null
  statedAt: string | null
  statedBy: { userId: string | null; name: string | null } | null
  audited?: boolean
  auditReason?: string | null
}

/** Per-wine advice. A failed read throws; the page says it could not be read. */
export async function getPriceAdvice(): Promise<HouseAdvice> {
  const { data } = await apiClient.get<HouseAdvice>('/pricing/advice')
  return data
}

/** One tap: apply the advice as shown. 409 when it is no longer what was shown. */
export async function acceptPriceAdvice(
  inventoryId: string,
  kind: PriceKind,
  advisedPrice: number
): Promise<{ outcome: 'changed' | 'unchanged' | 'stale'; kind: PriceKind; price: number; previousPrice: number | null }> {
  const { data } = await apiClient.post(`/pricing/advice/${inventoryId}/accept`, { kind, advisedPrice })
  return data
}

export async function getTargetMargin(): Promise<TargetMarginReadout> {
  const { data } = await apiClient.get<TargetMarginReadout>('/pricing/target-margin')
  return data
}

export async function setTargetMargin(body: {
  bottlePct: number | null
  glassPct: number | null
  bandPts: number
}): Promise<TargetMarginReadout> {
  const { data } = await apiClient.put<TargetMarginReadout>('/pricing/target-margin', body)
  return data
}
