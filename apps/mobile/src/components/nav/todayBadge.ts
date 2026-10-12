import type { FeedResponse } from "@/api/types";

/**
 * The number on the Today tab: decisions waiting, the same count the strip
 * names (F-1499). Alerts are news, not decisions (F-1450), so a night with
 * only alerts shows no badge while the strip says "All clear". An older
 * gateway sends no `decisions` count; it is summed from its parts.
 */
export function todayBadgeCount(feed: FeedResponse | undefined | null): number {
  if (!feed) return 0;
  const c = feed.counts;
  return c.decisions ?? c.orderApprovals + c.draftApprovals + c.receiptVerifications;
}
