/**
 * Recently-viewed store (NEW-034). Tracks the last routes the user visited so
 * ⌘⇧O can jump straight back. Route-level (not per-record) — robust without
 * instrumenting every page, and covers the common "flip between two screens"
 * need. Persisted to localStorage; deduped by path; capped at 10.
 */

const KEY = 'wineops.recentlyViewed';
const MAX = 10;

export interface RecentEntry {
  path: string;
  label: string;
  ts: number;
}

export function getRecentlyViewed(): RecentEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function recordView(path: string, label: string): void {
  try {
    const clean = path || '/';
    const next: RecentEntry[] = [
      { path: clean, label, ts: Date.now() },
      ...getRecentlyViewed().filter((e) => e.path !== clean),
    ].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
