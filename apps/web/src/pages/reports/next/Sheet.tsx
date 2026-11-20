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
  type LayoutItem,
  type ResponsiveLayouts,
} from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import { tuck } from '@/lib/mudavym';
import { colsForWidth, liftCuttings, projectCuttings, sheetLayouts, slotRect } from './rp-arrange';
import {
  ANALYSIS_IDS,
  SHEET_BREAKPOINTS,
  SHEET_BREAKPOINT_COLS,
  SHEET_MARGIN,
  SHEET_ROW_HEIGHT,
  TEXT_IDS,
  isStackedWidth,
  slotHeightPx,
  type AnalysisId,
  type Slot,
} from './rp-sheet';

const Grid = Responsive;

/**
 * The width the sheet is laid out at, known BEFORE the first paint (r61, c2).
 *
 * `WidthProvider` starts at 1280 and only learns the real width when its
 * ResizeObserver first fires, a frame or more later: on a 375 px phone the
 * first paint was the desktop ruling (items 741 px wide, the page 1,296 px
 * across) and then snapped to one column. The width is read synchronously from
 * the sheet's own box in a layout effect, so the grid is first drawn at the
 * ruling it will keep, and the observer only follows later resizes. Until the
 * box exists nothing is drawn (`data-measured='false'`).
 */
function useSheetWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    // A box that is not laid out reads 0 (hidden pane, jsdom): the window's
    // own width is the nearest honest answer and the observer corrects it.
    setWidth(el.clientWidth || window.innerWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

/** Pointer targets that must never begin a drag — the two new selects included. */
const DRAG_CANCEL =
  '.react-resizable-handle,button,a,input,textarea,select,option,label,[role="button"],.rp-no-drag';

export interface SheetCutting {
  id: AnalysisId;
  slot: Slot;
  /** Folded to a strip: it runs the sheet's full width while reading (`flowStrips`). */
  strip?: boolean;
  /** Rows the arrange controls add to the card while arranging (r101): drawn on top of the stored slot, never written back. */
  extraRows?: number;
  /** The whole cutting, already rendered — the sheet only lays paper out. */
  body: ReactNode;
}

export interface SheetProps {
  cuttings: SheetCutting[];
  arranging: boolean;
  /** `order` is the list order the move leaves the sheet in: on a narrow
   *  ruling, row-mates are drawn in list order (`liftCuttings`). */
  onMove: (slots: Partial<Record<AnalysisId, Slot>>, order?: AnalysisId[]) => void;
  /** The sheet element, shared with `useArrange` so both measure one ruling. */
  containerRef?: (el: HTMLDivElement | null) => void;
  /** Where a keyboard-held cutting started. Drawn as an outline, not a child. */
  ghost?: Slot | null;
}

export function Sheet({ cuttings, arranging, onMove, containerRef, ghost }: SheetProps) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [ghostBox, setGhostBox] = useState<CSSProperties | null>(null);
  const width = useSheetWidth(el);
  /* Below 768 px the sheet is a plain CSS column, decided here and not by the
     grid (r74): `window.innerWidth` is known on the very first render, so a
     phone never waits on a measurement, and react-grid-layout is not mounted
     there at all. The measured box width takes over as soon as it exists. */
  const stacked = isStackedWidth(width);

  /* While arranging, a card's controls row is room the card gains, not room the plot gives up (r101): the grid
     draws the slot plus the rows the controls take, and what the reader moves or resizes is written back without them. */
  const shown = useMemo(
    () =>
      arranging
        ? cuttings.map((c) => (c.extraRows ? { ...c, slot: { ...c.slot, h: c.slot.h + c.extraRows } } : c))
        : cuttings,
    [cuttings, arranging],
  );
  const layouts = useMemo(
    (): ResponsiveLayouts => sheetLayouts(shown, arranging),
    [shown, arranging],
  );

  /* The grid hands back the layout of the ruling it is drawing. On a narrow
     ruling that is a PROJECTION of the twelve-column sheet, so it is written
     back through `liftCuttings` — the keyboard's path — rather than saved as
     is, which left every cutting four twelfths wide on the desktop after one
     drag on a phone. */
  const handleChange = useCallback(
    (next: readonly LayoutItem[]) => {
      if (!arranging) return;
      const cols = colsForWidth(el?.clientWidth ?? 0);
      const placed = next.map((l) => ({
        id: l.i as AnalysisId,
        slot: { x: l.x, y: l.y, w: l.w, h: l.h },
      }));
      const lifted = liftCuttings(shown, projectCuttings(shown, cols), placed, cols);
      const slots: Partial<Record<AnalysisId, Slot>> = {};
      for (const c of lifted) {
        const extra = shown.find((x) => x.id === c.id)?.extraRows ?? 0;
        slots[c.id] = extra ? { ...c.slot, h: Math.max(1, c.slot.h - extra) } : c.slot;
      }
      onMove(slots, lifted.map((c) => c.id));
    },
    [arranging, shown, el, onMove],
  );

  /* The ghost is positioned from react-grid-layout's OWN `calcGridItemPosition`
     against the measured width, so it lands on the same pixel the item did
     rather than on a second, drifting idea of where column 4 is. Absolute
     inside `.rp-sheet`, which is `position: relative`, and never a grid child:
     a real child would take part in compaction and push the sheet around. */
  useLayoutEffect(() => {
    if (!ghost || !el || stacked) {
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
  }, [el, ghost, stacked]);

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
      data-measured={stacked || width > 0}
      data-layout={stacked ? 'stack' : 'grid'}
      style={{ ['--rp-tuck' as keyof CSSProperties]: `${tuck.ms}ms ${tuck.easing}` } as CSSProperties}
    >
      {ghostBox && <div className="rp-ghost" style={ghostBox} aria-hidden />}
      {/* Not drawn until the sheet's own width is known (`useSheetWidth`). */}
      {stacked && (
        <div className="rp-stack">
          {/* List order IS the narrow reading order (`projectCuttings`). */}
          {shown.map((c) => (
            <div
              key={c.id}
              className="rp-grid-item rp-stack__item"
              data-grows={TEXT_IDS.has(c.id) || undefined}
              style={
                TEXT_IDS.has(c.id)
                  ? { minHeight: slotHeightPx(c.slot.h) }
                  : { height: slotHeightPx(c.slot.h) }
              }
            >
              {c.body}
            </div>
          ))}
        </div>
      )}
      {!stacked && width > 0 && (
      <Grid
        className="layout"
        width={width}
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
        {/* A stable DOM order: the list is the narrow reading order and
            changes under a held cutting, and moving the focused grip's node
            would drop keyboard focus mid-move. Position comes from the layout. */}
        {[...cuttings]
          .sort((a, b) => ANALYSIS_IDS.indexOf(a.id) - ANALYSIS_IDS.indexOf(b.id))
          .map((c) => (
            <div key={c.id} className="rp-grid-item">
              {c.body}
            </div>
          ))}
      </Grid>
      )}
    </div>
  );
}

export default Sheet;
