/**
 * The canvas contract — drag and resize, which the founder asked about by name.
 *
 *   "…are we still able to drag and drop, or now it's fixed locations? If it's
 *    drag and drop and we can still adjust it, then it's perfect."
 *                                            (the second-pass review, 2026-09-03)
 *
 * `ReportsNext.test.tsx` covers the mode toggle and what the reader can reach
 * while arranging, but jsdom cannot produce `react-grid-layout`'s pointer-delta
 * math, so nothing there proved that a MOVE or a RESIZE actually writes a new
 * slot. This file does, at the only seam where it can be proved without a real
 * pointer: the grid is replaced by a stand-in that captures the props `Sheet`
 * hands it, and the test invokes `onDragStop` / `onResizeStop` itself with the
 * layout react-grid-layout would have produced.
 *
 * That is a narrower claim than "drag works end to end" — it is "the callbacks
 * are bound, and the layout they receive becomes the slot we save" — and it is
 * the half that can regress silently. The other half (RGL's own drag mechanics)
 * is the library's, and is exercised by using the page.
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

/** The props `Sheet` last handed the grid. */
const grid = vi.hoisted(() => ({
  props: null as null | {
    isDraggable?: boolean;
    isResizable?: boolean;
    draggableCancel?: string;
    layouts?: { lg: Array<{ i: string; static?: boolean; minW?: number; minH?: number }> };
    onDragStop?: (l: ReadonlyArray<{ i: string; x: number; y: number; w: number; h: number }>) => void;
    onResizeStop?: (l: ReadonlyArray<{ i: string; x: number; y: number; w: number; h: number }>) => void;
    children?: ReactNode;
  },
}));

vi.mock('react-grid-layout/legacy', () => ({
  WidthProvider: (C: unknown) => C,
  Responsive: (props: Record<string, unknown>) => {
    grid.props = props as typeof grid.props;
    return <div data-testid="grid">{props.children as ReactNode}</div>;
  },
}));

import Sheet from './Sheet';

const cuttings = [
  { id: 'till' as const, slot: { x: 0, y: 0, w: 5, h: 9 }, body: <p>through the till</p> },
  { id: 'ledger' as const, slot: { x: 5, y: 0, w: 7, h: 9 }, body: <p>figures of record</p> },
];

function paint(arranging: boolean) {
  const onMove = vi.fn();
  render(<Sheet cuttings={cuttings} arranging={arranging} onMove={onMove} />);
  return { onMove, props: grid.props as NonNullable<typeof grid.props> };
}

describe('Sheet — the drag-to-rearrange canvas', () => {
  it('turns a finished drag into the moved cutting’s new slot', () => {
    const { onMove, props } = paint(true);
    expect(typeof props.onDragStop).toBe('function');
    // The layout react-grid-layout hands back after a drag: `till` has moved.
    props.onDragStop?.([
      { i: 'till', x: 3, y: 2, w: 5, h: 9 },
      { i: 'ledger', x: 5, y: 0, w: 7, h: 9 },
    ]);
    expect(onMove).toHaveBeenCalledWith({
      till: { x: 3, y: 2, w: 5, h: 9 },
      ledger: { x: 5, y: 0, w: 7, h: 9 },
    });
  });

  it('turns a finished resize into the same thing — width and height, not just position', () => {
    const { onMove, props } = paint(true);
    expect(typeof props.onResizeStop).toBe('function');
    props.onResizeStop?.([
      { i: 'till', x: 0, y: 0, w: 9, h: 14 },
      { i: 'ledger', x: 9, y: 0, w: 3, h: 9 },
    ]);
    expect(onMove).toHaveBeenCalledWith({
      till: { x: 0, y: 0, w: 9, h: 14 },
      ledger: { x: 9, y: 0, w: 3, h: 9 },
    });
  });

  it('moves and resizes only while arranging, and pins every cutting while reading', () => {
    const arranging = paint(true);
    expect(arranging.props.isDraggable).toBe(true);
    expect(arranging.props.isResizable).toBe(true);
    expect(arranging.props.layouts?.lg.every((l) => l.static === false)).toBe(true);

    const reading = paint(false);
    expect(reading.props.isDraggable).toBe(false);
    expect(reading.props.isResizable).toBe(false);
    expect(reading.props.layouts?.lg.every((l) => l.static === true)).toBe(true);
    // Belt and braces: even if the grid called back while reading, nothing moves.
    reading.props.onDragStop?.([{ i: 'till', x: 8, y: 8, w: 2, h: 2 }]);
    expect(reading.onMove).not.toHaveBeenCalled();
  });

  it('never starts a drag from the two controls this pass added', () => {
    // "Show instead" and "Draw as" are <select>s inside the cutting. Without
    // them in draggableCancel, choosing an option would drag the paper.
    const { props } = paint(true);
    for (const target of ['select', 'option', 'button', 'a', 'label', '.rp-no-drag']) {
      expect(props.draggableCancel).toContain(target);
    }
  });

  it('gives every cutting a floor, so a resize cannot crush one to nothing', () => {
    const { props } = paint(true);
    expect(props.layouts?.lg.every((l) => (l.minW ?? 0) >= 3 && (l.minH ?? 0) >= 3)).toBe(true);
  });
});
