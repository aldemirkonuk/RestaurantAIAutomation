/**
 * The kind strip (ADR 0340 rule 18, lane 6): a section dragged onto a kind
 * moves there, and the same move is a long press or a "Move to…" button
 * away, in a sheet that says when it makes a new draft.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { KindStrip, kindStripWords, moveWords, type MovableSection, type StripKind } from './KindStrip';

const KINDS: StripKind[] = [
  { kind: 'beverage', count: 84, menuId: 'm-drinks' },
  { kind: 'food', count: 41, menuId: 'm-food' },
];
const REDS: MovableSection = { id: 's-reds', title: 'Reds', menuId: 'm-drinks', kind: 'beverage', lines: 12 };
const MEZE: MovableSection = { id: 's-meze', title: 'Meze', menuId: 'm-drinks', kind: 'beverage', lines: 1 };

function mount(onMove = vi.fn(), canMove = true) {
  render(<KindStrip kinds={KINDS} sections={[REDS, MEZE]} canMove={canMove} moving={null} onMove={onMove} />);
  return onMove;
}

afterEach(() => vi.useRealTimers());

describe('the strip in words', () => {
  it('counts each kind the read has a draft of, in Drinks, Food, Desserts order', () => {
    expect(kindStripWords([...KINDS, { kind: 'desserts', count: 9, menuId: 'm-d' }])).toBe('Drinks 84 · Food 41 · Desserts 9');
    expect(kindStripWords([{ kind: 'desserts', count: null, menuId: null }])).toBe('');
  });

  it('says a move to a kind with no draft makes one, and what then shows as Gone', () => {
    expect(moveWords(MEZE, KINDS[1])).toBe('Move Meze (1 line) to Food.');
    expect(moveWords(REDS, { kind: 'desserts', count: null, menuId: null })).toMatch(
      /^Move Reds \(12 lines\) to Desserts\. This read has no Desserts draft yet, so moving makes one; the live Desserts menu's lines that are not in it show under Gone\.$/,
    );
  });
});

describe('moving a section', () => {
  it('a section dropped on another kind moves there', () => {
    const onMove = mount();
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '' };
    fireEvent.dragStart(screen.getAllByTestId('kind-strip-section')[1], { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('kind-strip-food'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('kind-strip-food'), { dataTransfer });
    expect(onMove).toHaveBeenCalledWith(MEZE, 'food');
  });

  it('a section dropped on its own kind does not move', () => {
    const onMove = mount();
    const data = new Map<string, string>([['text/plain', 's-reds']]);
    fireEvent.drop(screen.getByTestId('kind-strip-beverage'), { dataTransfer: { getData: (k: string) => data.get(k) ?? '' } });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('"Move to…" opens a sheet of the other kinds, and a tap moves it', () => {
    const onMove = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Move Meze to another kind' }));
    expect(screen.queryByTestId('kind-move-beverage')).toBeNull();
    expect(screen.getByText(/This read has no Desserts draft yet, so moving makes one/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('kind-move-food'));
    expect(onMove).toHaveBeenCalledWith(MEZE, 'food');
  });

  it('a long press opens the same sheet; a short one does not', () => {
    vi.useFakeTimers();
    mount();
    const row = screen.getAllByTestId('kind-strip-section')[0];
    fireEvent.pointerDown(row);
    act(() => void vi.advanceTimersByTime(200));
    fireEvent.pointerUp(row);
    act(() => void vi.advanceTimersByTime(600));
    expect(screen.queryByTestId('kind-move-sheet')).toBeNull();
    fireEvent.pointerDown(row);
    act(() => void vi.advanceTimersByTime(600));
    expect(screen.getByTestId('kind-move-sheet')).toBeInTheDocument();
  });

  it('staff see the counts and nothing to move', () => {
    mount(vi.fn(), false);
    expect(screen.getByTestId('kind-strip-beverage')).toHaveTextContent('Drinks 84');
    expect(screen.getByTestId('kind-strip-desserts')).toHaveTextContent('Desserts none');
    expect(screen.queryByTestId('kind-strip-section')).toBeNull();
  });
});
