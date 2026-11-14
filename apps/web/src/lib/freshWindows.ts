import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * The reads that keep their own fresh window on the app's QueryClient.
 *
 * The app refetches every read when a component mounts (`refetchOnMount:
 * 'always'`), so a page never shows a number older than the last screen. That
 * also makes every `staleTime` set below it dead config, and some reads mount
 * many times over the same answer:
 *
 *   - re-opening a good on /inventory re-read all five of its drawer reads,
 *     though they set 30–60 s;
 *   - a KPI card's evidence mounts a nutrition card that re-reads the
 *     nutrition the drawer read a moment before, on the same key;
 *   - every filter, chip or search that brings rows back re-read the house's
 *     item research, because each row's name hint subscribes to it.
 *
 * Measured with the app's own query-core and these defaults (r41 inventory
 * audit gap 5, `probe/refetch-on-mount.mjs`): one read, 300 rows mounting, then
 * 40 rows mounting again cost 3 reads; with `refetchOnMount: true` on the key,
 * 1. A read older than its `staleTime`, or invalidated by a write, is still
 * re-read on mount, on focus and on its interval.
 *
 * [2026-11-14, the session's call under the founder's 2026-11-07 /goal.] Only
 * the keys below keep their window. Rejected:
 *   - flipping the app default to `true`: every page's freshness would change at
 *     once, with no page checked; that is a cross-page decision, not this one.
 *   - `['inventory']` whole: the stock list is written from other pages
 *     (receiving, the floor) that do not all invalidate it, so it keeps
 *     re-reading on every mount.
 *   - `refetchOnMount: true` on each query: the drawer, nutrition card and
 *     name hint live in files many open chains edit, and a query added later
 *     under the same key would quietly miss it.
 */
export const KEYS_THAT_KEEP_THEIR_FRESH_WINDOW: readonly QueryKey[] = [
  // One good's drawer reads: figures, used-in (+ dishes, drinks), nutrition.
  ['inventory', 'item'],
  // The house's item research every row's name hint reads.
  ['inventory', 'research'],
];

/**
 * Gives each key above `refetchOnMount: true` and returns the same client.
 * App.tsx wraps its client in this, so its defaults stay where they were. A
 * query's own `refetchOnMount` still wins over the key's.
 */
export function keepFreshWindows(client: QueryClient): QueryClient {
  for (const queryKey of KEYS_THAT_KEEP_THEIR_FRESH_WINDOW) {
    client.setQueryDefaults(queryKey, { refetchOnMount: true });
  }
  return client;
}
