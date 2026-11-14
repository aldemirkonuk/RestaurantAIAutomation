/**
 * r36 onboarding gap 1 (desk half). A menu made current lists its drinks at
 * stock 0, so a house can hold a list nobody has counted. The desk read that
 * list as a known cellar: "Nothing is waiting on you.", "Nothing is running
 * low. The cellar holds." and "In the cellar 0".
 *
 * The number of goods waiting for their first count when the house has listed
 * goods and counted none of them; null in every other case, including a
 * gateway that does not send the two counts (then nothing is said).
 */
import type { DashboardStats, InventoryItem } from '@/services/api/types';

export function noneCountedYet(stats: DashboardStats | null | undefined): number | null {
  if (!stats) return null;
  const counted = stats.countedGoods;
  const waiting = stats.goodsNotCounted;
  if (typeof counted !== 'number' || typeof waiting !== 'number') return null;
  return counted === 0 && waiting > 0 ? waiting : null;
}

/** The sentence for that state: one good, or N of them. */
export function noneCountedSaid(waiting: number): string {
  return waiting === 1
    ? 'The one good on the house’s list has not been counted yet.'
    : `None of the ${waiting} goods on the house’s list has been counted yet.`;
}

/**
 * The low-stock list as the desk may read it (r39 walk). A menu made current
 * lists its drinks at stock 0 with a minimum, so every one of them came back
 * "below its minimum", and the desk said "9 low-stock items are waiting on
 * you" beside "None of the 7 goods … has been counted yet". While nothing on
 * the list is counted, a good at 0 is the list's own starting figure, not a
 * reading, so it is left out. A good that receipts put above 0 stays: that
 * figure was read. In every other state the list is passed as it came.
 */
export function lowStockRead(
  stats: DashboardStats | null | undefined,
  items: InventoryItem[] | null | undefined,
): InventoryItem[] | null | undefined {
  if (!Array.isArray(items) || noneCountedYet(stats) === null) return items;
  // getLowStockItems normalizes each row, so `stockLive` is the figure.
  return items.filter((it) => Number(it.stockLive ?? 0) > 0);
}
