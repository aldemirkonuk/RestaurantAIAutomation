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

/**
 * The house's own bottle price (ADR 0193 `menuPriceBottle`), or null. Never
 * the library's `menuPrice`, and never 0 for "no price set".
 */
export function menuPriceOf(item: Pick<InventoryItem, 'menuPriceBottle'>): number | null {
  const p = item.menuPriceBottle
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null
}

/**
 * What the bottles on hand sell for at the house's own prices. The page used
 * to sum `menuPrice ?? 0` (the library's figure, absent for almost every
 * wine), so an unpriced wine joined the total as $0. Here it is counted.
 */
export function totalMenuValue(
  items: readonly (Costed & Pick<InventoryItem, 'menuPriceBottle'>)[],
): StockValueTotal {
  let known = 0
  let unknownItems = 0
  for (const i of items) {
    const bottles = bottlesOnHand(i)
    if (bottles === 0) continue
    const price = menuPriceOf(i)
    if (price == null) unknownItems += 1
    else known += price * bottles
  }
  return { known, unknownItems }
}

/** "$3,100 menu", "$3,100 menu + 2 wines with no bottle price", or "no bottle price set (5 wines)". */
export function totalMenuValueText(t: StockValueTotal, fmt: (n: number) => string): string {
  const wines = `${t.unknownItems} wine${t.unknownItems === 1 ? '' : 's'}`
  if (t.unknownItems === 0) return t.known > 0 ? `${fmt(t.known)} menu` : 'cost basis'
  if (t.known === 0) return `no bottle price set (${wines})`
  return `${fmt(t.known)} menu + ${wines} with no bottle price`
}
