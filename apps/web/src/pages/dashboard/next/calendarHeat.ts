/**
 * The sales calendar's shading, in one place so the squares and the legend
 * cannot disagree (c2 need 15): how dark a day is, the scale that explains it,
 * and how far apart the squares draw in.
 */

/** One square draws in this long after the one before it. */
export const HEAT_STEP_MS = 36;

/** The legend's steps, as a share of the month's busiest day. 0 is a quiet day. */
export const LEGEND_STEPS = [0, 0.25, 0.5, 0.75, 1] as const;

/**
 * How much of the seal colour a day carries, 0 to 36: none for a quiet or
 * unknown day, a faint 6 for the smallest, 36 for the busiest of the month.
 */
export function heatPercent(head: number | null | undefined, max: number): number {
  if (head == null || !(head > 0)) return 0;
  return Math.round((0.06 + 0.3 * (head / Math.max(max, 1))) * 100);
}

/**
 * color-mix keeps the shade on the seal TOKEN, so both grounds (İznik on paper,
 * lifted teal on charcoal) resolve; null leaves the square's own ground.
 */
export function heatGround(percent: number): string | null {
  return percent > 0 ? `color-mix(in srgb, var(--seal) ${percent}%, transparent)` : null;
}

/** The square at `index` waits this long; under reduced motion none waits. */
export function drawDelay(index: number, reduced: boolean): number {
  return reduced ? 0 : index * HEAT_STEP_MS;
}
