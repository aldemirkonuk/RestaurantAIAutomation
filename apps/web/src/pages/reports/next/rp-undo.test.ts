/**
 * Arranging keeps a step history (r108 g4). A step is the whole draft, so an
 * undo puts back every cutting a write moved, the displaced neighbour too; the
 * history is capped at 50; and Cmd/Ctrl-Z typed into a field is the field's.
 */
import { describe, expect, it } from 'vitest';
import type { SheetState } from './rp-sheet';
import { isUndoKey, pushStep, sameSheet, UNDO_CAP, undoLabel, undoneWords } from './rp-undo';

const sheet = (...cs: Array<[string, number, number, number, number, string?]>): SheetState => ({
  cuttings: cs.map(([id, x, y, w, h, graph = 'area']) => ({ id, slot: { x, y, w, h }, graph })) as SheetState['cuttings'],
});
const TITLES: Record<string, string> = { till: 'Through the till', ledger: 'Figures of record', seats: 'The room', quadrants: 'Margin against movement' };
const titleOf = (id: string) => TITLES[id] ?? id;

const A = sheet(['till', 0, 0, 6, 4], ['ledger', 0, 4, 6, 4]);

describe('the step history', () => {
  it('[REVERT-FAILS] keeps the whole draft a write replaced', () => {
    const B = sheet(['till', 0, 4, 6, 4], ['ledger', 0, 0, 6, 4]);
    const past = pushStep([], { sheet: A, id: 'ledger' }, B);
    expect(past).toHaveLength(1);
    expect(sameSheet(past[0].sheet, A)).toBe(true);
  });

  it('[REVERT-FAILS] a write that changed nothing is not a step', () => {
    expect(pushStep([], { sheet: A, id: 'till' }, sheet(['till', 0, 0, 6, 4], ['ledger', 0, 4, 6, 4]))).toHaveLength(0);
  });

  it('[REVERT-FAILS] keeps at most 50 steps, the oldest out first', () => {
    let past = pushStep([], { sheet: sheet(['till', 0, 0, 1, 1]), id: null }, A);
    for (let i = 1; i <= 60; i++) past = pushStep(past, { sheet: sheet(['till', i, 0, 1, 1]), id: null }, A);
    expect(UNDO_CAP).toBe(50);
    expect(past).toHaveLength(50);
    expect(past[0].sheet.cuttings[0].slot.x).toBe(11);
    expect(past[49].sheet.cuttings[0].slot.x).toBe(60);
  });

  it('[REVERT-FAILS] tells a drawing apart, and a bars-and-line pick', () => {
    expect(sameSheet(A, sheet(['till', 0, 0, 6, 4, 'bars'], ['ledger', 0, 4, 6, 4]))).toBe(false);
    const picked = { cuttings: A.cuttings.map((c, i) => (i === 0 ? { ...c, combo: { bars: 'value', line: 'checks' } } : c)) };
    expect(sameSheet(A, picked as SheetState)).toBe(false);
  });
});

describe('the words', () => {
  it('[REVERT-FAILS] a move names the cutting and where it goes back to', () => {
    const now = sheet(['till', 0, 4, 6, 4], ['ledger', 0, 0, 6, 4]);
    const step = { sheet: A, id: 'ledger' as const };
    expect(undoLabel(step, now, titleOf, 12)).toBe(
      'Undo: Figures of record back to column 1 of 12, row 5, 6 columns wide, 4 rows tall',
    );
    expect(undoneWords(step, now, titleOf, 12)).toBe(
      'Undone. Figures of record is back at column 1 of 12, row 5, 6 columns wide, 4 rows tall.',
    );
  });

  it('[REVERT-FAILS] a swap names the cutting that comes back', () => {
    const before = sheet(['quadrants', 0, 0, 6, 4]);
    const now = sheet(['seats', 0, 0, 6, 4]);
    expect(undoLabel({ sheet: before, id: 'quadrants' }, now, titleOf, 12)).toContain('Undo: Margin against movement back to column 1');
    // With no id from the write, the diff still finds it: one left, one came.
    expect(undoneWords({ sheet: before, id: null }, now, titleOf, 12)).toContain('Undone. Margin against movement is back at column 1');
  });

  it('[REVERT-FAILS] a cutting put on is taken off again; a drawing is drawn as it was', () => {
    const added = sheet(['till', 0, 0, 6, 4], ['ledger', 0, 4, 6, 4], ['seats', 0, 8, 6, 4]);
    expect(undoLabel({ sheet: A, id: 'seats' }, added, titleOf, 12)).toBe('Undo: take The room off again');
    expect(undoneWords({ sheet: A, id: 'seats' }, added, titleOf, 12)).toBe('Undone. The room is off the sheet.');
    const drawn = sheet(['till', 0, 0, 6, 4, 'bars'], ['ledger', 0, 4, 6, 4]);
    expect(undoLabel({ sheet: A, id: 'till' }, drawn, titleOf, 12)).toBe('Undo: draw Through the till as it was');
  });

  it('[REVERT-FAILS] a whole-sheet write ("Put it all back") says the sheet', () => {
    const fresh = sheet(['seats', 0, 0, 12, 4], ['quadrants', 0, 4, 12, 4]);
    expect(undoLabel({ sheet: A, id: null }, fresh, titleOf, 12)).toBe('Undo: the sheet as it was');
    expect(undoneWords({ sheet: A, id: null }, fresh, titleOf, 12)).toBe('Undone. The sheet is back as it was.');
  });

  it('[REVERT-FAILS] on the phone stack it names the place in the list, not a column', () => {
    const now = sheet(['till', 0, 4, 6, 4], ['ledger', 0, 0, 6, 4]);
    expect(undoLabel({ sheet: A, id: 'ledger' }, now, titleOf, 1)).toBe('Undo: Figures of record back to position 2 of 2, 4 rows tall');
  });
});

describe('Cmd-Z and Ctrl-Z', () => {
  const key = (over: Partial<Parameters<typeof isUndoKey>[0]> = {}) => ({
    key: 'z',
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    target: document.body as EventTarget,
    ...over,
  });

  it('[REVERT-FAILS] is the page’s on the sheet, with either modifier', () => {
    expect(isUndoKey(key())).toBe(true);
    expect(isUndoKey(key({ metaKey: false, ctrlKey: true, key: 'Z' }))).toBe(true);
  });

  it('[REVERT-FAILS] is not the page’s in a select, an input or a text area, nor with Shift (redo)', () => {
    for (const tag of ['select', 'input', 'textarea']) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      expect(isUndoKey(key({ target: el }))).toBe(false);
      el.remove();
    }
    expect(isUndoKey(key({ shiftKey: true }))).toBe(false);
    expect(isUndoKey(key({ metaKey: false }))).toBe(false);
  });
});
