/**
 * A vendor's face (critic N-19): the monogram a name always draws the same way,
 * and the twelve-week order tally behind the card's sparkline.
 *
 * Both are pure: the same name is always the same disc, and an order with no
 * date is left out of the tally rather than guessed into a week.
 */

const SKIP = new Set(['the', 'and', 'of', '&', 'a', 'an']);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const SPARK_WEEKS = 12;

/** One or two capital letters from the name; `?`-free: an empty name is `·`. */
export function initialsOf(name: string): string {
  const words = name
    .split(/[\s\-_/.,]+/)
    .map((w) => w.trim())
    .filter((w) => w !== '' && !SKIP.has(w.toLowerCase()));
  const pick = words.length > 0 ? words : name.trim().split(/\s+/).filter(Boolean);
  if (pick.length === 0) return '·';
  const first = Array.from(pick[0])[0] ?? '';
  const second = pick.length > 1 ? (Array.from(pick[1])[0] ?? '') : '';
  return (first + second).toLocaleUpperCase();
}

/** A hue 0-359 from the name, stable across renders and machines. */
export function hueOf(name: string): number {
  let h = 5381;
  for (const ch of name.trim().toLowerCase()) h = ((h << 5) + h + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % 360;
}

export interface Monogram {
  initials: string;
  /** A soft ground and a deep ink in the same hue (oklch, so every hue reads the same). */
  ground: string;
  ink: string;
}

export function monogramOf(name: string): Monogram {
  const hue = hueOf(name);
  return {
    initials: initialsOf(name),
    ground: `oklch(0.92 0.045 ${hue})`,
    ink: `oklch(0.36 0.07 ${hue})`,
  };
}

/**
 * Orders per week for the last twelve weeks, oldest first. `dates` are each
 * order's own date (ISO); anything unreadable, undated or in the future is
 * skipped, so a total can be lower than the order count but never invented.
 */
export function weeklyOrderCounts(dates: Array<string | null | undefined>, now: Date): number[] {
  const out = new Array<number>(SPARK_WEEKS).fill(0);
  const t0 = now.getTime();
  for (const d of dates) {
    if (!d) continue;
    const t = new Date(d).getTime();
    if (!Number.isFinite(t) || t > t0) continue;
    const ago = Math.floor((t0 - t) / WEEK_MS);
    if (ago >= SPARK_WEEKS) continue;
    out[SPARK_WEEKS - 1 - ago] += 1;
  }
  return out;
}
