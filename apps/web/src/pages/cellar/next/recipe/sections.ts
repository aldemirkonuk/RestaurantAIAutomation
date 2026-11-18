import { foldDishText } from '../../../dishes/fold';

/**
 * The menu sections already on the cocktail list, each once (spelt as first
 * written, so "Aperitivo" and "aperitivo " are one), in reading order. Offered
 * to the Section box so a house does not type one section two ways.
 */
export function sectionsInUse(rows: ReadonlyArray<{ menu_section: string | null }>): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const s = (r.menu_section ?? '').trim();
    if (s && !seen.has(foldDishText(s))) seen.set(foldDishText(s), s);
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, s]) => s);
}
