/**
 * The staff home's swipe rule, pure so it can be tested without a pointer.
 *
 * A row is swiped to the right to recount the bottle. The gesture counts only
 * when it is clearly horizontal (a vertical scroll that drifts sideways must
 * not recount anything) and long enough to be meant.
 */

/** Pixels a row must travel to the right before release counts as a swipe. */
export const SWIPE_COMMIT_PX = 72;
/** A drag is a scroll, not a swipe, once it has moved this far with the wrong slope. */
export const SWIPE_SLOPE = 1.4;
/** Below this the finger has not decided; the row neither follows nor commits. */
export const SWIPE_DEAD_PX = 6;

export type SwipeState = 'idle' | 'follow' | 'scroll';

/** What the movement so far is: undecided, following the finger, or a scroll. */
export function swipeState(dx: number, dy: number): SwipeState {
  if (Math.abs(dx) < SWIPE_DEAD_PX && Math.abs(dy) < SWIPE_DEAD_PX) return 'idle';
  if (dx > 0 && dx >= Math.abs(dy) * SWIPE_SLOPE) return 'follow';
  return 'scroll';
}

/** True when releasing here recounts. */
export function swipeCommits(dx: number, dy: number): boolean {
  return swipeState(dx, dy) === 'follow' && dx >= SWIPE_COMMIT_PX;
}

/** How far the row visibly travels: follows the finger, then resists. */
export function swipeTravel(dx: number): number {
  if (dx <= 0) return 0;
  if (dx <= SWIPE_COMMIT_PX) return dx;
  return SWIPE_COMMIT_PX + (dx - SWIPE_COMMIT_PX) * 0.25;
}
