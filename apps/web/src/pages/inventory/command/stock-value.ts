/**
 * Stock value when a cost may be unknown (ADR 0051). The gateway leaves `wac`
 * out when no cost is recorded. This page used to read `wac ?? price ?? 0`,
 * where `price` is the library's reference figure (0 when unloaded), so an
 * unknown cost became $0 or a price nobody paid. Here unknown stays null, and
 * a total counts the wines it leaves out instead of summing them as 0.
 */
import type { InventoryItem } from '../useInventoryPage'

export const COST_NOT_KNOWN = 'cost not known yet'

type Costed = Pick<InventoryItem, 'wac' | 'liveStock' | 'shadowStock'>

/** The recorded unit cost, or null. Never the library price, never 0 for "unknown". */
export function unitCostOf(item: Pick<InventoryItem, 'wac'>): number | null {
  const c = item.wac
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : null
}

export function bottlesOnHand(item: Costed): number {
  return (item.liveStock ?? 0) + (item.shadowStock ?? 0)
}

/** Unit cost × bottles. Null when bottles are on hand and their cost is unknown. */
export function stockValue(item: Costed): number | null {
  const bottles = bottlesOnHand(item)
  if (bottles === 0) return 0
  const cost = unitCostOf(item)
  return cost == null ? null : cost * bottles
}

export interface StockValueTotal {
  /** Sum over the wines whose cost is known. */
  known: number
  /** Wines with bottles on hand and no known cost: left out of `known`. */
  unknownItems: number
}

export function totalStockValue(items: readonly Costed[]): StockValueTotal {
  let known = 0
  let unknownItems = 0
  for (const i of items) {
    const v = stockValue(i)
    if (v == null) unknownItems += 1
    else known += v
  }
  return { known, unknownItems }
}

export function stockValueText(value: number | null, fmt: (n: number) => string): string {
  return value == null ? COST_NOT_KNOWN : fmt(value)
}

/** "$1,240", or "$1,240 + 3 wines whose cost is not known yet", never a total that hides them. */
export function totalStockValueText(t: StockValueTotal, fmt: (n: number) => string): string {
  if (t.unknownItems === 0) return fmt(t.known)
  const wines = `${t.unknownItems} wine${t.unknownItems === 1 ? '' : 's'}`
  if (t.known === 0) return `${COST_NOT_KNOWN} (${wines})`
  return `${fmt(t.known)} + ${wines} whose cost is not known yet`
}
