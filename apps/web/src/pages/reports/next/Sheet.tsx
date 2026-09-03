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
 */

import { useCallback, useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  Responsive,
  WidthProvider,
  type LayoutItem,
  type ResponsiveLayouts,
} from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import { tuck } from '@/lib/mudavym';
import {
  SHEET_COLS,
  SHEET_MARGIN,
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
}

export function Sheet({ cuttings, arranging, onMove }: SheetProps) {
  const layouts = useMemo((): ResponsiveLayouts => {
    const lg: LayoutItem[] = cuttings.map((c) => ({
      i: c.id,
      ...c.slot,
      minW: 3,
      minH: 3,
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

  return (
    <div
      className="rp-sheet"
      data-arranging={arranging}
      style={{ ['--rp-tuck' as keyof CSSProperties]: `${tuck.ms}ms ${tuck.easing}` } as CSSProperties}
    >
      <Grid
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: SHEET_COLS, md: SHEET_COLS, sm: 6, xs: 4, xxs: 2 }}
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
