/**
 * Finding a line on the current menu (r41 R4): to change one price on a 300-line
 * menu the owner types a few letters instead of scrolling. Pure: it only picks
 * from lines already read; nothing is read or written here.
 *
 * A match ignores case and accents, and treats the Turkish dotless i as i, so
 * "rakı", "RAKI" and "raki" all find the same line.
 */
import type { MenuLine } from '../../../services/api/menus';

/** Below this many lines the page fits on one screen and offers no find box. */
export const FIND_FROM_LINES = 12;

export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .toLowerCase();
}

/** Every word typed must be found somewhere on the line (name, producer, section, region, grape, vintage). */
export function lineMatches(line: MenuLine, typed: string): boolean {
  const words = fold(typed).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold([line.name, line.producer, line.category, line.region, line.country, line.grape_variety, line.vintage].filter(Boolean).join(' '));
  return words.every((w) => hay.includes(w));
}
