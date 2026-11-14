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
import type { DashboardStats } from '@/services/api/types';

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
