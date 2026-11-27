/**
 * Arranging keeps a step history (r108 g4): every write to the draft pushes
 * the draft it replaced, and "Undo" takes the newest one back. Undoing to an
 * empty history leaves the reader's sheet as it was when arranging started,
 * which is the cancel the page did not have (page doc reports.md:196, :962).
 *
 * A step is the WHOLE draft, never a delta. A swap moves two cuttings and a
 * move can push its neighbours aside (react-grid-layout compacts), so an undo
 * that put back only the cutting it names would leave a displaced neighbour
 * where the compactor pushed it. Restoring the whole draft puts every one
 * back.
 *
 * Pure, so the words and the cap are pinned without a page.
 */
import { positionWords, projectCuttings, slotOf, stackAt } from './rp-arrange';
import type { AnalysisId, Cutting, SheetState, Slot } from './rp-sheet';

/** The most steps kept; the oldest goes first. */
export const UNDO_CAP = 50;

/**
 * One step back: the whole draft before the write, and the cutting the write
 * was about when the page knew it (a move, a swap, a take-off). `id` null is a
 * write about the whole sheet (a house layout, "Put it all back").
 */
export interface UndoStep {
  sheet: SheetState;
  id: AnalysisId | null;
}

/** `past` with `step` pushed on, at most `UNDO_CAP` long. A write that changed nothing is not a step. */
export function pushStep(past: readonly UndoStep[], step: UndoStep, next: SheetState): UndoStep[] {
  if (sameSheet(step.sheet, next)) return past as UndoStep[];
  const out = [...past, step];
  return out.length > UNDO_CAP ? out.slice(out.length - UNDO_CAP) : out;
}

const sameSlot = (a: Slot, b: Slot) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const sameCutting = (a: Cutting, b: Cutting) =>
  a.id === b.id &&
  a.graph === b.graph &&
  sameSlot(a.slot, b.slot) &&
  (a.combo?.bars ?? null) === (b.combo?.bars ?? null) &&
  (a.combo?.line ?? null) === (b.combo?.line ?? null);

export function sameSheet(a: SheetState, b: SheetState): boolean {
  return a.cuttings.length === b.cuttings.length && a.cuttings.every((c, i) => sameCutting(c, b.cuttings[i]));
}

type TitleOf = (id: AnalysisId) => string;

/** Where `id` lies on `sheet` in the reader's words, on the ruling in play. */
function whereIn(sheet: SheetState, id: AnalysisId, cols: number): string | null {
  const slot = slotOf(projectCuttings(sheet.cuttings, cols), id);
  if (!slot) return null;
  return positionWords(slot, cols, cols === 1 ? stackAt(sheet.cuttings, id) : undefined);
}

/**
 * What undoing `step` from `now` does, and to which cutting. The step's own
 * `id` when the write named one; else the one cutting the diff points at
 * (exactly one changed, or a swap: one left and one came); else the sheet.
 */
function subject(step: UndoStep, now: SheetState): { id: AnalysisId; kind: 'back' | 'off' | 'drawn' } | null {
  const before = step.sheet;
  const was = new Map(before.cuttings.map((c) => [c.id, c]));
  const is = new Map(now.cuttings.map((c) => [c.id, c]));
  const gone = before.cuttings.filter((c) => !is.has(c.id));
  const came = now.cuttings.filter((c) => !was.has(c.id));
  let id = step.id;
  if (id == null) {
    const changed = before.cuttings.filter((c) => is.has(c.id) && !sameCutting(c, is.get(c.id)!));
    if (gone.length === 1 && came.length <= 1) id = gone[0].id;
    else if (gone.length === 0 && came.length === 1 && changed.length === 0) id = came[0].id;
    else if (gone.length === 0 && came.length === 0 && changed.length === 1) id = changed[0].id;
    else return null;
  }
  const b = was.get(id);
  const n = is.get(id);
  if (!b) return { id, kind: 'off' }; // undo takes off what the write put on
  if (n && sameSlot(n.slot, b.slot) && !sameCutting(n, b)) return { id, kind: 'drawn' };
  return { id, kind: 'back' };
}

/** "Undo: Through the till back to column 1 of 12, row 1, …" — the Undo button's name. */
export function undoLabel(step: UndoStep, now: SheetState, titleOf: TitleOf, cols: number): string {
  const s = subject(step, now);
  if (!s) return 'Undo: the sheet as it was';
  const title = titleOf(s.id);
  if (s.kind === 'off') return `Undo: take ${title} off again`;
  if (s.kind === 'drawn') return `Undo: draw ${title} as it was`;
  const where = whereIn(step.sheet, s.id, cols);
  return where ? `Undo: ${title} back to ${where}` : `Undo: ${title} back`;
}

/** The live region's sentence once the undo is done. */
export function undoneWords(step: UndoStep, now: SheetState, titleOf: TitleOf, cols: number): string {
  const s = subject(step, now);
  if (!s) return 'Undone. The sheet is back as it was.';
  const title = titleOf(s.id);
  if (s.kind === 'off') return `Undone. ${title} is off the sheet.`;
  const where = whereIn(step.sheet, s.id, cols);
  if (s.kind === 'drawn' || !where) return `Undone. ${title} is back as it was.`;
  return `Undone. ${title} is back at ${where}.`;
}

/** True when a key press is Cmd-Z / Ctrl-Z meant for the page: not Shift (redo), not typed into a field. */
export function isUndoKey(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
  target: EventTarget | null;
}): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return false;
  const t = e.target as HTMLElement | null;
  if (!t || typeof t.closest !== 'function') return true;
  // A field keeps its own undo: a select's value, an input's text.
  return !t.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"]');
}
