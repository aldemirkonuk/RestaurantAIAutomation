/**
 * Learn the specs (r110 drinks-g4): a staff drill on the house's own cards. Three Leitner boxes; "Knew it" moves a
 * drink up a box, "Not yet" puts it back in box 1, and box 1 is dealt first. The boxes are kept in this browser only,
 * per person per house, and never sent anywhere: a manager's progress table would be staff-monitoring data.
 */
import type { DrinkCard } from '../../../../services/api/recipes';

export type Box = 1 | 2 | 3;
export type Boxes = Record<string, Box>;

export const progressKey = (houseId: string, personId: string) => `mudavym.learnSpecs.v1:${houseId}:${personId}`;

/** The boxes kept for this person in this house; a missing, corrupt or odd value starts fresh (never an error). */
export function readBoxes(key: string): Boxes {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, b]) => b === 1 || b === 2 || b === 3)) as Boxes;
  } catch {
    return {};
  }
}

export function keepBoxes(key: string, boxes: Boxes): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(boxes));
  } catch {
    /* not kept: the next session starts from box 1 */
  }
}

/** Box 1 first (a drink never seen is in it), then 2, then 3; by name inside a box. */
export function dealOrder(cards: DrinkCard[], boxes: Boxes): DrinkCard[] {
  const box = (c: DrinkCard) => boxes[c.cocktailId] ?? 1;
  return [...cards].sort((a, b) => box(a) - box(b) || a.name.localeCompare(b.name));
}

export const afterAnswer = (box: Box | undefined, knew: boolean): Box => (knew ? (Math.min(3, (box ?? 1) + 1) as Box) : 1);

/** The first word of the method ("Shake", "Stir", "Build"), or null when the card states none. */
export function methodWord(method: string | null): string | null {
  const m = /[\p{L}]+/u.exec(method ?? '');
  return m ? m[0] : null;
}

export function endWords(known: number, total: number): string {
  const left = total - known;
  const head = `${known} of ${total} known`;
  if (left <= 0) return `${head}.`;
  return `${head}; ${left} ${left === 1 ? 'comes' : 'come'} round first next time.`;
}
