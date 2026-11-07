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
import { act, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { getBreakpointFromWidth, getColsFromBreakpoint } from 'react-grid-layout/core';

/** The props `Sheet` last handed the grid. */
const grid = vi.hoisted(() => ({
  props: null as null | {
    isDraggable?: boolean;
    isResizable?: boolean;
    draggableCancel?: string;
    breakpoints?: Record<string, number>;
    cols?: Record<string, number>;
    margin?: [number, number];
    layouts?: Record<
      string,
      Array<{ i: string; x: number; y: number; w: number; h: number; static?: boolean; minW?: number; minH?: number }>
    >;
    onBreakpointChange?: (bp: string, cols: number) => void;
    onWidthChange?: (w: number, m: [number, number], cols: number, p: [number, number] | null) => void;
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
  const view = render(<Sheet cuttings={cuttings} arranging={arranging} onMove={onMove} />);
  return { onMove, props: grid.props as NonNullable<typeof grid.props>, view };
}

/** The props the grid holds NOW — re-read after anything that re-renders. */
const live = () => grid.props as NonNullable<typeof grid.props>;

/**
 * Do what react-grid-layout does when measured at `width`, with its OWN
 * breakpoint functions and `Sheet`'s props. Returns the column count.
 */
function resizeTo(width: number): number {
  const p = live();
  const bp = getBreakpointFromWidth(p.breakpoints as never, width);
  const cols = getColsFromBreakpoint(bp, p.cols as never);
  act(() => {
    p.onBreakpointChange?.(bp, cols);
    p.onWidthChange?.(width, p.margin ?? [14, 14], cols, [0, 0]);
  });
  return cols;
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

/**
 * "No bugs when switched places": below 768 px nothing writes a slot, because
 * a 4- or 2-column coordinate saved over the desktop sheet swapped cuttings.
 */
describe('Sheet — one ruling, whatever the width', () => {
  it('drops a drag or a resize that finishes on a phone-width sheet', () => {
    const { onMove } = paint(true);
    expect(resizeTo(500)).toBe(4);
    // What react-grid-layout hands back at xs: four-column coordinates.
    live().onDragStop?.([
      { i: 'till', x: 0, y: 0, w: 4, h: 9 },
      { i: 'ledger', x: 0, y: 9, w: 4, h: 9 },
    ]);
    live().onResizeStop?.([
      { i: 'till', x: 0, y: 0, w: 2, h: 12 },
      { i: 'ledger', x: 0, y: 12, w: 4, h: 9 },
    ]);
    expect(onMove).toHaveBeenCalledTimes(0);
  });

  it('is neither draggable nor resizable while it flows, and says so on the sheet', () => {
    const { view } = paint(true);
    resizeTo(500);
    expect(live().isDraggable).toBe(false);
    expect(live().isResizable).toBe(false);
    const sheet = view.container.querySelector('.rp-sheet') as HTMLElement;
    expect(sheet).toHaveAttribute('data-flow', 'true');
    resizeTo(1280);
    expect(live().isDraggable).toBe(true);
    expect(sheet).toHaveAttribute('data-flow', 'false');
  });

  it('lays the phone sheet out as one full-width column in the desktop sheet’s order', () => {
    const onMove = vi.fn();
    render(
      <Sheet
        arranging
        onMove={onMove}
        cuttings={[
          { id: 'ledger', slot: { x: 6, y: 0, w: 6, h: 4 }, body: <p>b</p> },
          { id: 'week', slot: { x: 0, y: 9, w: 12, h: 9 }, body: <p>c</p> },
          { id: 'till', slot: { x: 0, y: 0, w: 6, h: 9 }, body: <p>a</p> },
        ]}
      />,
    );
    const { layouts, cols } = live();
    for (const bp of ['xs', 'xxs'] as const) {
      const flow = layouts![bp];
      // Sorted by the desktop (y, x): till (0,0), ledger (0,6), week (9,0).
      expect(flow.map((l) => l.i)).toEqual(['till', 'ledger', 'week']);
      for (const l of flow) {
        expect(l.x).toBe(0);
        expect(l.w).toBe(cols![bp]);
        expect(l.static).toBe(true);
        // A floor of about 300 px: ceil((300 + 14) / (34 + 14)) rows.
        expect(l.h).toBeGreaterThanOrEqual(7);
      }
      // Stacked, each under the one before — no two share a row.
      expect(flow[1].y).toBe(flow[0].y + flow[0].h);
      expect(flow[2].y).toBe(flow[1].y + flow[1].h);
    }
    // The desktop sheet is handed over untouched.
    expect(layouts!.lg.find((l) => l.i === 'ledger')).toMatchObject({ x: 6, y: 0, w: 6, h: 4 });
  });

  it('keeps twelve columns at 900 px, where a desktop with the sidebar open measures', () => {
    const { onMove } = paint(true);
    expect(resizeTo(900)).toBe(12);
    expect(live().isDraggable).toBe(true);
    live().onDragStop?.([
      { i: 'till', x: 7, y: 0, w: 5, h: 9 },
      { i: 'ledger', x: 0, y: 0, w: 7, h: 9 },
    ]);
    expect(onMove).toHaveBeenCalledWith({
      till: { x: 7, y: 0, w: 5, h: 9 },
      ledger: { x: 0, y: 0, w: 7, h: 9 },
    });
  });

  it('starts flowing below 768 px and not at it', () => {
    paint(true);
    expect(resizeTo(768)).toBe(12);
    expect(resizeTo(767)).toBe(4);
  });

  it('treats a width of 0 (not laid out yet) as the twelve-column sheet', () => {
    const { onMove } = paint(true);
    resizeTo(0);
    live().onDragStop?.([{ i: 'till', x: 1, y: 0, w: 5, h: 9 }]);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('keys every cutting by its id, so a change of subject moves nobody else', () => {
    const onMove = vi.fn();
    const view = render(<Sheet cuttings={cuttings} arranging onMove={onMove} />);
    const before = live().layouts!.lg.find((l) => l.i === 'ledger');
    // "Show instead": till's square of paper now carries the room.
    view.rerender(
      <Sheet
        arranging
        onMove={onMove}
        cuttings={[{ ...cuttings[0], id: 'seats' }, cuttings[1]]}
      />,
    );
    const p = live();
    expect(p.layouts!.lg.find((l) => l.i === 'ledger')).toEqual(before);
    expect(p.layouts!.lg.find((l) => l.i === 'seats')).toMatchObject({ x: 0, y: 0, w: 5, h: 9 });
    const keys = (p.children as ReactElement[]).map((c) => c.key);
    expect(keys).toEqual(['seats', 'ledger']);
  });
});
