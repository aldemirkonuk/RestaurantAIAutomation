import { ObservedWindow, observedWindow } from "./observed-window";

/**
 * A good's demand is read from the day it was added to the house's list, when
 * that is inside the window (r36 reports audit, gap 1, the per-good half).
 *
 * The house's window starts at its first consumption line (#1534). That is
 * per house: in a house older than 90 days, a good added last week still had
 * its week of sales divided by 90 days, so its daily demand, reorder point
 * and stockout risk read about a thirteenth of the truth, and a good selling
 * 2 a day sat off the reorder list with 2 bottles left.
 *
 * The rule:
 * - The good's start is `restaurant_inventory.created_at`, the day the row
 *   was added. It counts only when it falls inside the house's window.
 * - If the good has a line BEFORE that day, the row is younger than the good
 *   (a re-import or a re-created row), so the day it was added is not when
 *   the house started selling it, and the house's window stands.
 * - A good with no added day keeps the house's window.
 * - The rule never starts a good's demand at its own first line. A slow
 *   mover's first line in the window is not when the house began to carry
 *   it, and starting there would read it faster than it sells.
 * - A rate still divides by at least a week (`MIN_RATE_DAYS`).
 */
export function goodWindow(
  house: ObservedWindow,
  lastDay: string,
  addedDay: string | null,
  firstLineDay: string | null,
): ObservedWindow {
  if (!addedDay) return house;
  if (firstLineDay != null && firstLineDay < addedDay) return house;
  if (house.since != null && addedDay <= house.since) return house;
  const own = observedWindow(house.windowDays, lastDay, {
    read: "read",
    day: addedDay,
  });
  // Added before the window began: the house's window is the good's.
  return own.since == null ? house : own;
}

/** The clause the restock basis adds when some goods are read from their added day. */
export function addedWords(count: number): string {
  if (count === 0) return "";
  return `; ${count} ${count === 1 ? "good was" : "goods were"} added to the house's list inside the window and ${count === 1 ? "is" : "are"} read from the day ${count === 1 ? "it was" : "they were"} added, not over days ${count === 1 ? "it was" : "they were"} not on it`;
}
