/**
 * The sheet — the founder's drag-to-rearrange canvas, back.
 *
 *   "Used to like today's drag-to-rearrange canvas — where we can just swipe
 *    and change everything to its place."   (MAKEOVER-VERDICTS: /reports, MERGE)
 *
 *   "…are we still able to drag and drop, or now it's fixed locations? If it's
 *    drag and drop and we can still adjust it, then it's perfect."
 *                                            (the second-pass review, 2026-09-03)
 *
 * Both, and unchanged by the new controls: **move by dragging anywhere on a
 * cutting, resize by pulling its bottom-right corner** — `isDraggable` and
 * `isResizable` are the same flag, on together while arranging and off together
 * while reading, and both `onDragStop` and `onResizeStop` write the new slot
 * into the draft. The "Show instead" and "Draw as" selects sit inside
 * `draggableCancel`, so choosing from them never starts a drag.
 *
 * Same engine as the page it merges from — `react-grid-layout`, already a
 * dependency and already the canvas under `components/reports/DashboardCanvas`
 * — so this is a re-clothing of a proven interaction, not a second one. No new
 * package (ADR 0042's motion rule: this system is CSS easings + WAAPI).
 *
 * The one idea: THE GRID IS THE PAPER'S RULING. While you are reading, the
 * sheet is plain paper and the cuttings sit flush. Press "Arrange the sheet"
 * and the twelve-column feint ruling fades up (`settle`), every cutting takes a
 * dashed edge and a grab cursor, and lifting one raises it on `tuck`. Letting
 * go rules the account off and writes the arrangement to the reader's own
 * preferences. The ruling is the promise that a cutting lands square.
 *
 * FOURTH PASS, 2026-09-03 — the same paper is now movable from the keyboard.
 * `layouts` was always a CONTROLLED prop (react-grid-layout re-derives from it
 * whenever it stops deep-equalling the previous one), so `rp-arrange.ts` writes
 * the same draft this component reads and the grid follows. Nothing in the
 * pointer path below changed; the keyboard is a second writer of one state, not
 * a second interaction. The only thing this file gained is the GHOST: the
 * outline of where a picked-up cutting started, so "Escape puts it back" names
 * a place the reader can see.
 */

import { useCallback, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Responsive,
  WidthProvider,
  type LayoutItem,
  type ResponsiveLayouts,
} from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import { tuck } from '@/lib/mudavym';
import { colsForWidth, slotRect } from './rp-arrange';
import {
  SHEET_BREAKPOINTS,
  SHEET_BREAKPOINT_COLS,
  SHEET_MARGIN,
  SHEET_MIN_H,
  SHEET_MIN_W,
  SHEET_ROW_HEIGHT,
  type AnalysisId,
  type Slot,
} from './rp-sheet';

const Grid = WidthProvider(Responsive);

/** Pointer targets that must never begin a drag — the two new selects included. */
const DRAG_CANCEL =
  '.react-resizable-handle,button,a,input,textarea,select,option,label,[role="button"],.rp-no-drag';

export interface SheetCutting {
  id: AnalysisId;
  slot: Slot;
  /** The whole cutting, already rendered — the sheet only lays paper out. */
  body: ReactNode;
}

export interface SheetProps {
  cuttings: SheetCutting[];
  arranging: boolean;
  onMove: (slots: Partial<Record<AnalysisId, Slot>>) => void;
  /** The sheet element, shared with `useArrange` so both measure one ruling. */
  containerRef?: (el: HTMLDivElement | null) => void;
  /** Where a keyboard-held cutting started. Drawn as an outline, not a child. */
  ghost?: Slot | null;
}

export function Sheet({ cuttings, arranging, onMove, containerRef, ghost }: SheetProps) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [ghostBox, setGhostBox] = useState<CSSProperties | null>(null);

  const layouts = useMemo((): ResponsiveLayouts => {
    const lg: LayoutItem[] = cuttings.map((c) => ({
      i: c.id,
      ...c.slot,
      minW: SHEET_MIN_W,
      minH: SHEET_MIN_H,
      static: !arranging,
    }));
    return { lg, md: lg, sm: lg, xs: lg, xxs: lg };
  }, [cuttings, arranging]);

  const handleChange = useCallback(
    (next: readonly LayoutItem[]) => {
      if (!arranging) return;
      const slots: Partial<Record<AnalysisId, Slot>> = {};
      for (const l of next) slots[l.i as AnalysisId] = { x: l.x, y: l.y, w: l.w, h: l.h };
      onMove(slots);
    },
    [arranging, onMove],
  );

  /* The ghost is positioned from react-grid-layout's OWN `calcGridItemPosition`
     against the measured width, so it lands on the same pixel the item did
     rather than on a second, drifting idea of where column 4 is. Absolute
     inside `.rp-sheet`, which is `position: relative`, and never a grid child:
     a real child would take part in compaction and push the sheet around. */
  useLayoutEffect(() => {
    if (!ghost || !el) {
      setGhostBox(null);
      return;
    }
    const width = el.clientWidth;
    const rect = slotRect(ghost, width, colsForWidth(width));
    setGhostBox(
      rect
        ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        : null,
    );
  }, [el, ghost]);

  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      setEl(node);
      containerRef?.(node);
    },
    [containerRef],
  );

  return (
    <div
      ref={attach}
      className="rp-sheet"
      data-arranging={arranging}
      style={{ ['--rp-tuck' as keyof CSSProperties]: `${tuck.ms}ms ${tuck.easing}` } as CSSProperties}
    >
      {ghostBox && <div className="rp-ghost" style={ghostBox} aria-hidden />}
      <Grid
        className="layout"
        layouts={layouts}
        breakpoints={SHEET_BREAKPOINTS}
        cols={SHEET_BREAKPOINT_COLS}
        rowHeight={SHEET_ROW_HEIGHT}
        margin={SHEET_MARGIN}
        containerPadding={[0, 0]}
        compactType="vertical"
        isDraggable={arranging}
        isResizable={arranging}
        draggableCancel={DRAG_CANCEL}
        onDragStop={handleChange}
        onResizeStop={handleChange}
      >
        {cuttings.map((c) => (
          <div key={c.id} className="rp-grid-item">
            {c.body}
          </div>
        ))}
      </Grid>
    </div>
  );
}

export default Sheet;
