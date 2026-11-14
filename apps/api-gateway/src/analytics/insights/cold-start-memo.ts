/**
 * A house with nothing notable stops paying a full insight compute on every
 * page load (r36 reports audit, gap 8).
 *
 * `GET /analytics/insights/:rid` serves stored rows when any exist and
 * otherwise computes live with `persist: true` (the cold start). A compute
 * that finds nothing stores nothing, so the next read is a cold start again:
 * every /reports load (its feed is fresh for 60 s) and every ⌘K feed reran the
 * whole bundle (whole-window consumption and checks). That is day 1 to day N
 * of every new house, the reader the page most needs to be quick for.
 *
 * The call (r38, under the 2026-11-07 /goal "fast loading"):
 * - Only an EMPTY answer is held, and only a clean one: every bundle read
 *   answered (`sourcesUnread` empty) and the persist landed (`persisted`
 *   true). A compute whose read failed is retried on the next load, because
 *   its silence may be the failure's.
 * - Held for `COLD_EMPTY_TTL_MS` (10 minutes), per house and category set. The
 *   answer keeps its own `generatedAt`, so it is never passed off as newer.
 *   `refresh=true` clears it and computes.
 * - Two reads that land together share one compute (the page and the palette
 *   open together), held or not.
 * - In process memory, bounded to `COLD_EMPTY_MAX` houses. Another gateway
 *   instance computes once for itself; nothing is written anywhere.
 *
 * Rejected: a sentinel row in `analytics_insights` (a row that is not an
 * insight, which every reader of the table would have to learn to skip);
 * writing the sweep's `last_run_at` from the read path (it would make the
 * daily sweep skip a category the read computed under different options);
 * holding every answer (a non-empty one is already stored, and served from
 * the table).
 */

export const COLD_EMPTY_TTL_MS = 10 * 60 * 1000;
export const COLD_EMPTY_MAX = 2000;

interface ColdAnswer {
  insights?: unknown[];
  sourcesUnread?: unknown[];
  persisted?: boolean | null;
}

/** True for an answer worth holding: nothing to say, said cleanly. */
export function isCleanEmpty(answer: ColdAnswer): boolean {
  return (
    Array.isArray(answer.insights) &&
    answer.insights.length === 0 &&
    Array.isArray(answer.sourcesUnread) &&
    answer.sourcesUnread.length === 0 &&
    answer.persisted === true
  );
}

export class ColdStartMemo<T extends ColdAnswer> {
  private readonly held = new Map<string, { at: number; answer: T }>();
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = COLD_EMPTY_TTL_MS,
    private readonly max = COLD_EMPTY_MAX,
  ) {}

  static keyOf(restaurantId: string, categories?: readonly string[]): string {
    return `${restaurantId}|${categories?.length ? [...categories].sort().join(",") : "*"}`;
  }

  /** Forget what is held for a house (every category set). */
  clear(restaurantId: string): void {
    for (const k of [...this.held.keys()])
      if (k.startsWith(`${restaurantId}|`)) this.held.delete(k);
  }

  async run(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = this.held.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.answer;
    if (hit) this.held.delete(key);
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const p = (async () => {
      try {
        const answer = await compute();
        if (isCleanEmpty(answer)) {
          if (this.held.size >= this.max) {
            // The oldest entry goes first: a Map iterates in insertion order.
            const oldest = this.held.keys().next().value;
            if (oldest !== undefined) this.held.delete(oldest);
          }
          this.held.set(key, { at: this.now(), answer });
        }
        return answer;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, p);
    return p;
  }
}
