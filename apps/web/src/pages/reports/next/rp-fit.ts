/**
 * Cards that size to their content, inside the slot the sheet gave them.
 *
 * The reading's height is its sentences: two of them left a 108 px empty band
 * under the last one in an 8-row slot. The card reports the height its content
 * needs (`naturalPx`), and the sheet draws it in as many rows as that takes —
 * never fewer than six, never more than the slot it was given (a long reading
 * scrolls inside its card rather than pushing the sheet down). Only while the
 * sheet is being READ: arranging gives every cutting its stored slot back.
 */

import { SHEET_MARGIN, SHEET_ROW_HEIGHT, type AnalysisId } from './rp-sheet';

/** The cuttings whose slot follows their content. */
export const FIT_IDS: readonly AnalysisId[] = ['reading'];

/** Rows a fitted cutting keeps at the least. */
export const FIT_MIN_ROWS = 6;

/** How many ruled rows hold `px` of card: n rows are n x row + (n - 1) x margin. */
export function rowsForPx(px: number): number {
  const unit = SHEET_ROW_HEIGHT + SHEET_MARGIN[1];
  return Math.max(1, Math.ceil((px + SHEET_MARGIN[1]) / unit));
}

/** The rows a fitted cutting is drawn in: its content's, between six and its slot. */
export function fittedRows(slotH: number, px: number | undefined): number {
  if (px === undefined || !Number.isFinite(px) || px <= 0) return slotH;
  return Math.min(slotH, Math.max(FIT_MIN_ROWS, rowsForPx(px)));
}

/**
 * What the card would need if it were exactly as tall as its content: its
 * head and borders, the body's padding, and each block in the body with the
 * gap between them. Read from the blocks, not from `scrollHeight`, so a card
 * taller than its content does not read as needing all of that room.
 */
export function naturalPx(root: HTMLElement): number | null {
  const body = root.querySelector<HTMLElement>(':scope > .rp-cut__body');
  if (!body) return null;
  const cs = getComputedStyle(body);
  const num = (v: string) => Number.parseFloat(v) || 0;
  const kids = Array.from(body.children) as HTMLElement[];
  const blocks = kids.reduce((sum, k) => sum + k.offsetHeight, 0);
  const gaps = Math.max(0, kids.length - 1) * num(cs.rowGap);
  const rest = root.offsetHeight - body.offsetHeight;
  const px = rest + num(cs.paddingTop) + num(cs.paddingBottom) + blocks + gaps;
  return px > 0 ? Math.ceil(px) : null;
}

/** The rows that hold `px` of arrange controls above a card's body: the card grows by them (r101). */
export function controlRows(px: number | undefined): number {
  if (px === undefined || !Number.isFinite(px) || px <= 0) return 0;
  return Math.ceil(px / (SHEET_ROW_HEIGHT + SHEET_MARGIN[1]));
}
