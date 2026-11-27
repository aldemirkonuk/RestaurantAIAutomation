/**
 * How many rows each lane of /receipts held the last time this browser saw the
 * house's queue (r105). A warm reload paints its lane outlines before any read
 * lands; outlines drawn at a fixed guess (3, 1, 0 rows) are shorter than the
 * lists that arrive, and the page jumped (CLS 0.62 at 375). Drawing the last
 * known count holds the height the lists will fill. Per viewer and per house,
 * a convenience only: it can be empty or throw (private window, blocked
 * storage) and the page then draws the old guess.
 */
export interface LaneRows {
  queue: number;
  clean: number;
  verified: number;
}

const KEY = (rid: string) => `receipts.laneRows.${rid}`;
/** A remembered lane never holds more than a screenful: a long list scrolls, it does not need its whole height held. */
const MAX_ROWS = 12;

const clamp = (n: unknown): number => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(v, MAX_ROWS) : 0;
};

export function readLaneRows(rid: string | null | undefined): LaneRows | null {
  if (!rid) return null;
  try {
    const raw = window.localStorage.getItem(KEY(rid));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LaneRows>;
    return { queue: clamp(p.queue), clean: clamp(p.clean), verified: clamp(p.verified) };
  } catch {
    return null;
  }
}

export function writeLaneRows(rid: string | null | undefined, rows: LaneRows): void {
  if (!rid) return;
  try {
    window.localStorage.setItem(KEY(rid), JSON.stringify(rows));
  } catch {
    /* a convenience, never a failure */
  }
}
