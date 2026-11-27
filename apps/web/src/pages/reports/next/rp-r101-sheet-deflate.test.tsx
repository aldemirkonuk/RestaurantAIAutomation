/**
 * r101 review (reports): the controls rows a card gains while arranging are never saved, on any path.
 *  1. a no-op drag with unequal controls rows keeps the list order and saves no gaps;
 *  2. a resize to the grid's floor saves SHEET_MIN_H, and the grid's floor rises by the controls rows;
 *  3. the keyboard works on what the grid draws: the ghost and the spoken square are the visible ones.
 * The grid is mocked (jsdom has no layout) and compaction is done by react-grid-layout's own compactor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { getCompactor } from 'react-grid-layout/core';

type Item = { i: string; x: number; y: number; w: number; h: number; minH?: number };
const grid = vi.hoisted(() => ({
  props: null as null | {
    layouts?: { lg: Item[] };
    onDragStop?: (l: ReadonlyArray<Item>) => void;
    onResizeStop?: (l: ReadonlyArray<Item>) => void;
  },
}));
vi.mock('react-grid-layout/legacy', () => ({
  Responsive: (props: Record<string, unknown>) => {
    grid.props = props as typeof grid.props;
    return <div>{props.children as ReactNode}</div>;
  },
}));

import Sheet from './Sheet';
import { useArrange } from './rp-arrange';
import { DEFAULT_SLOTS, SHEET_MIN_H, type AnalysisId, type Cutting } from './rp-sheet';

afterEach(cleanup);

const SIX: AnalysisId[] = ['reading', 'till', 'pacing', 'week', 'goals', 'bench'];
const EXTRA: Partial<Record<AnalysisId, number>> = { reading: 3, till: 2 };
const sheet = (extra: Partial<Record<AnalysisId, number>>) =>
  SIX.map((id) => ({ id, slot: { ...DEFAULT_SLOTS[id] }, extraRows: extra[id], body: <p>{id}</p> }));
/** What the real grid hands back after a drag that moved nothing: its own compaction of the drawn layout. */
const compacted = (): Item[] =>
  getCompactor('vertical', false, false).compact(
    (grid.props?.layouts?.lg ?? []).map((l) => ({ ...l })),
    12,
  ) as Item[];

describe('a no-op drag with unequal controls rows', () => {
  it('[REVERT-FAILS] keeps the list order and the saved rows', () => {
    const onMove = vi.fn();
    render(<Sheet cuttings={sheet(EXTRA)} arranging onMove={onMove} />);
    grid.props?.onDragStop?.(compacted());
    const [slots, order] = onMove.mock.calls[0];
    expect(order).toEqual(SIX);
    expect(slots.week.y).toBe(DEFAULT_SLOTS.week.y);
    expect(slots.pacing.y).toBe(DEFAULT_SLOTS.pacing.y);
    expect(slots.reading.h).toBe(DEFAULT_SLOTS.reading.h);
  });
  it('control: with no controls rows the same drag saves the same order', () => {
    const onMove = vi.fn();
    render(<Sheet cuttings={sheet({})} arranging onMove={onMove} />);
    grid.props?.onDragStop?.(compacted());
    expect(onMove.mock.calls[0][1]).toEqual(SIX);
  });
});

describe('a resize to the grid floor', () => {
  it('[REVERT-FAILS] raises the grid floor by the controls rows and never saves below SHEET_MIN_H', () => {
    const onMove = vi.fn();
    const cuttings = [{ id: 'till' as const, slot: { x: 0, y: 0, w: 12, h: 9 }, extraRows: 3, body: <p>till</p> }];
    render(<Sheet cuttings={cuttings} arranging onMove={onMove} />);
    expect(grid.props?.layouts?.lg[0].minH).toBe(SHEET_MIN_H + 3);
    grid.props?.onResizeStop?.([{ i: 'till', x: 0, y: 0, w: 12, h: SHEET_MIN_H + 3 }]);
    expect(onMove.mock.calls[0][0].till.h).toBe(SHEET_MIN_H);
    // What the grid did before the floor rose: it let the card down to SHEET_MIN_H drawn rows.
    grid.props?.onResizeStop?.([{ i: 'till', x: 0, y: 0, w: 12, h: SHEET_MIN_H }]);
    expect(onMove.mock.calls[1][0].till.h).toBe(SHEET_MIN_H);
  });
});

describe('the keyboard ghost', () => {
  const cuttings = (): Cutting[] => SIX.map((id) => ({ id, slot: { ...DEFAULT_SLOTS[id] }, graph: 'bars' }) as Cutting);
  function setup(extraRows: Partial<Record<AnalysisId, number>>) {
    const saved: Cutting[][] = [];
    return {
      saved,
      ...renderHook(() => {
        const el = useRef<HTMLElement | null>(null);
        return useArrange({ cuttings: cuttings(), apply: (n) => saved.push(n), sheetRef: el, arranging: true, extraRows });
      }),
    };
  }
  it('[REVERT-FAILS] is drawn where the card is, as tall as the card, and the pick-up names that square', () => {
    // The grid draws pacing under reading (8 + 3 = 11 rows), not at its stored row 8.
    render(<Sheet cuttings={sheet(EXTRA)} arranging onMove={() => {}} />);
    const drawn = compacted().find((l) => l.i === 'pacing')!;
    expect(drawn.y).toBe(DEFAULT_SLOTS.reading.h + EXTRA.reading!);
    const { result } = setup(EXTRA);
    act(() => result.current.pickUp('pacing', 'Spend pacing'));
    expect(result.current.origin).toEqual({ x: drawn.x, y: drawn.y, w: drawn.w, h: drawn.h });
    expect(result.current.message).toContain(`row ${drawn.y + 1}`);
  });
  it('a keyboard move saves slots without the controls rows and keeps the list order', () => {
    const { result, saved } = setup(EXTRA);
    act(() => result.current.pickUp('week', 'The week'));
    act(() => result.current.nudge(0, 1));
    const next = saved[0];
    const byId = Object.fromEntries(next.map((c) => [c.id, c.slot]));
    expect(byId.reading.h).toBe(DEFAULT_SLOTS.reading.h);
    expect(byId.till.h).toBe(DEFAULT_SLOTS.till.h);
    expect(next.map((c) => c.id).slice(0, 3)).toEqual(['reading', 'till', 'pacing']);
  });
});
