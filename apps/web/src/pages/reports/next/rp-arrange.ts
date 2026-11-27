/**
 * Moving and resizing a cutting without a pointer.
 *
 *   "Keyboard drag and resize are not supported by the grid library; everything
 *    else is keyboard-reachable. research web find a way to be able to do that,
 *    engineering part is important research and analyze."
 *                                        — the founder, /reports, 2026-09-03
 *
 * WHAT THE RESEARCH FOUND, AND WHY THIS FILE IS THE ANSWER
 * ========================================================
 * The claim in the note's §9 — *"react-grid-layout exposes no keyboard
 * affordance"* — is true and remains true (the library's own request for one,
 * react-grid-layout#936, was opened in 2019, went stale and was closed
 * unimplemented). What was WRONG was the conclusion drawn from it: that the
 * limitation is the library's to fix. It is not, because RGL's layout is a
 * CONTROLLED prop, and this page already holds that prop.
 *
 * Measured in the installed package, not inferred from the docs
 * (`apps/web/node_modules/react-grid-layout@2.2.2/dist/chunk-XM2M6TC6.mjs`):
 *
 *  - `ResponsiveGridLayout` re-derives its internal layout whenever the
 *    `layouts` prop stops deep-equalling the previous one (`derivedLayout`,
 *    :1348-1361). So a parent that writes a new slot re-renders the grid at
 *    that slot. A keyboard handler needs nothing from the library's event
 *    system at all.
 *  - The library's own pointer path is two calls: `moveElement(...)` then
 *    `compactor.compact(...)` (:800-811 for a drag; :925-930 for a resize). BOTH
 *    are exported from `react-grid-layout/core`, so the keyboard path can run
 *    the SAME arithmetic the mouse runs rather than an approximation of it.
 *    That is the whole engineering point: a keyboard move and a pointer move
 *    to the same square produce a bit-identical layout, because they are the
 *    same function.
 *
 * Hence: no new dependency, no fork of the library, no second layout engine.
 * `@dnd-kit` (whose KeyboardSensor is the canonical implementation of the
 * pick-up/arrow/drop model) and `react-aria`'s `useDrag`/`useDrop` were both
 * read and both rejected for this page — not because their model is wrong, but
 * because adopting either means running a second drag system beside RGL's, and
 * the two would have to agree about collision and compaction on every frame.
 * What was taken from them is their INTERACTION, not their code.
 *
 * THE INTERACTION, AND WHOSE IT IS
 * --------------------------------
 *  - Tab reaches a grip button on each cutting while the sheet is being
 *    arranged. A "drag affordance" — a real, focusable, named control rather
 *    than a `tabIndex` on the panel — is react-aria's prescription, and it is
 *    the exact defect Grafana's own accessibility issue (grafana#79627) records
 *    against its dashboard, which is built on this same library: panels carry
 *    `tabIndex="0"` with no accessible name, and *"keyboard users are unable to
 *    interact with the move panel functionality."*
 *  - Space or Enter picks the cutting up; arrows move it one grid unit;
 *    Shift+arrows resize it; Enter or Space places it; Escape returns it to
 *    where it was. Start/end/cancel are dnd-kit's `KeyboardSensor` defaults
 *    (`start: ['Space','Enter']`, `end: ['Space','Enter']`, `cancel:
 *    ['Escape']`) rather than a house invention.
 *  - Shift+arrow is RESIZE here, where React Flow uses it for a bigger step.
 *    Deliberate: React Flow's canvas is continuous and pixel-nudged, so a
 *    coarse step is worth a modifier; this ruling is twelve columns wide, one
 *    unit is already a twelfth of the sheet, and there is no second gear worth
 *    having. Resize, which has no other keyboard route at all, is worth more.
 *  - Every one of those moves also exists as a BUTTON (`Placing.tsx`), because
 *    WCAG 2.2 SC 2.5.7 Dragging Movements requires a *single-pointer* path, and
 *    the Understanding document is explicit that keyboard equivalence (2.1.1)
 *    and pointer operability "are evaluated independently" — arrow keys alone
 *    do not satisfy it. The W3C's own listed example of a sufficient technique
 *    is "providing up/down buttons to reorder list items".
 *
 * THE COUNTER-ARGUMENT, WHICH IS REAL
 * -----------------------------------
 * Atlassian's `pragmatic-drag-and-drop` accessibility guidance argues the
 * opposite: do not build directional keyboard drag, give each item an action
 * menu of outcomes instead — *"directional arrow movement does not translate
 * well to all experiences"*, and menus avoid screen-reader mode switching. It
 * is the better answer for a Kanban board, where the outcomes are nameable
 * ("move to Doing", "move to top"). It is the weaker answer here, because on a
 * free 12-column canvas the outcomes ARE the coordinates: a menu would have to
 * enumerate 12 columns × n rows, which is not a menu. What their argument wins
 * is the announcement discipline — their guidance that a live region must name
 * the item and both its old and its new position is followed exactly below.
 *
 * THE HOUSE RULE THIS FILE ADDS
 * -----------------------------
 * **Announce the position the sheet gave, never the position that was asked
 * for.** Vertical compaction means a cutting nudged down may be pulled back up,
 * and one nudged into an occupied square displaces its neighbour. Every
 * sentence below is built from the layout AFTER `compact()` has run, and when
 * the result equals what was there before, it says so. Announcing the intent
 * would be the page reporting its own request as an outcome — the same fault
 * as reporting an absence as a health (ADR 0020).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  correctBounds,
  getBreakpointFromWidth,
  getColsFromBreakpoint,
  getCompactor,
  getLayoutItem,
  moveElement,
  calcGridItemPosition,
  type Layout,
  type LayoutItem,
} from 'react-grid-layout/core';
import {
  SHEET_BREAKPOINTS,
  SHEET_BREAKPOINT_COLS,
  SHEET_COLS,
  SHEET_MARGIN,
  SHEET_MIN_H,
  SHEET_MIN_W,
  SHEET_ROW_HEIGHT,
  type AnalysisId,
  type Cutting,
  type Slot,
} from './rp-sheet';

/** The compaction the sheet is set to. Same string `Sheet.tsx` hands the grid. */
export const SHEET_COMPACT_TYPE = 'vertical' as const;

/** One compactor for the file: `getCompactor` is pure and its result is stateless. */
const COMPACTOR = getCompactor(SHEET_COMPACT_TYPE, false, false);

/* ────────────────────────────────────────────────── the ruling in play ─── */

/**
 * How many columns the sheet is actually ruled into right now.
 *
 * Read through react-grid-layout's own breakpoint functions from the sheet
 * element's measured width, so the keyboard and the pointer cannot disagree
 * about the ruling. A width of 0 — jsdom, or a sheet not yet laid out — falls
 * back to the sheet's declared twelve rather than to `xxs`'s two, because "we
 * could not measure" must not silently become "this is a phone".
 */
export function colsForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return SHEET_COLS;
  const bp = getBreakpointFromWidth(SHEET_BREAKPOINTS, width);
  return getColsFromBreakpoint(bp, SHEET_BREAKPOINT_COLS);
}

/** The pixel rectangle of one slot, from the library's own position maths. */
export function slotRect(
  slot: Slot,
  containerWidth: number,
  cols: number,
): { left: number; top: number; width: number; height: number } | null {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return null;
  const p = calcGridItemPosition(
    {
      margin: SHEET_MARGIN,
      containerPadding: [0, 0],
      containerWidth,
      cols,
      rowHeight: SHEET_ROW_HEIGHT,
      maxRows: Infinity,
    },
    slot.x,
    slot.y,
    slot.w,
    slot.h,
  );
  return { left: p.left, top: p.top, width: p.width, height: p.height };
}

/* ─────────────────────────────────────────────── the layout arithmetic ── */

/** Anything laid on the ruling: a draft cutting, or the sheet's own item. */
interface Placed {
  id: AnalysisId;
  slot: Slot;
}

function toLayout(cuttings: Placed[]): LayoutItem[] {
  return cuttings.map((c) => ({
    i: c.id,
    x: c.slot.x,
    y: c.slot.y,
    w: c.slot.w,
    h: c.slot.h,
    minW: SHEET_MIN_W,
    minH: SHEET_MIN_H,
  }));
}

/** Write a computed layout back onto the cuttings, keeping their order. */
function fromLayout<T extends Placed>(cuttings: T[], layout: Layout): T[] {
  const byId = new Map(layout.map((l) => [l.i, l]));
  return cuttings.map((c) => {
    const l = byId.get(c.id);
    return l ? { ...c, slot: { x: l.x, y: l.y, w: l.w, h: l.h } } : c;
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function slotOf(cuttings: Placed[], id: AnalysisId): Slot | null {
  return cuttings.find((c) => c.id === id)?.slot ?? null;
}

export function sameSlot(a: Slot | null, b: Slot | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/* ────────────────────────────────────── one sheet, several rulings ──────── */

/**
 * The sheet as a narrower ruling draws it: the cuttings stacked in LIST order,
 * each clamped into the ruling (`correctBounds`), then compacted, so one may
 * rise beside a narrower one above it but never ahead of it. The list is the
 * narrow reading order; the wide sheet's rows do not decide it, because two
 * cuttings side by side on twelve columns have no order of their own there.
 * Identity at twelve, where the sheet IS the layout.
 */
export function projectCuttings<T extends Placed>(cuttings: T[], cols: number): T[] {
  if (cols >= SHEET_COLS) return cuttings;
  let y = 0;
  const stacked = toLayout(cuttings).map((l) => {
    const at = { ...l, y };
    y += l.h;
    return at;
  });
  return fromLayout(cuttings, COMPACTOR.compact(correctBounds(stacked, { cols }), cols));
}

/**
 * What `Sheet.tsx` hands the grid: each ruling its own projection. Handing the
 * twelve-column sheet to every ruling broke the phone sheet once the cuttings
 * went static (arrange off): `correctBounds` pushes a clamped static cutting
 * below every static one it overlaps instead of compacting, so the phone read
 * the whole left column, then the right one. Projected, the grid's own
 * `correctBounds` and `compact` leave every ruling exactly as handed.
 */
export function sheetLayouts(
  cuttings: Placed[],
  arranging: boolean,
): Record<keyof typeof SHEET_BREAKPOINT_COLS, LayoutItem[]> {
  const at = (cols: number): LayoutItem[] =>
    projectCuttings(cuttings, cols).map((c) => ({
      i: c.id,
      ...c.slot,
      minW: Math.min(SHEET_MIN_W, cols),
      minH: SHEET_MIN_H,
      static: !arranging,
    }));
  const lg = at(SHEET_COLS);
  return {
    lg,
    md: lg,
    sm: at(SHEET_BREAKPOINT_COLS.sm),
    xs: at(SHEET_BREAKPOINT_COLS.xs),
    xxs: at(SHEET_BREAKPOINT_COLS.xxs),
  };
}

/** The wide sheet's reading order: row, then column. */
function byRowThenColumn<T extends Placed>(cs: T[]): T[] {
  return [...cs].sort((a, b) => a.slot.y - b.slot.y || a.slot.x - b.slot.x);
}

/**
 * A move made on any ruling, written back onto the twelve-column sheet.
 *  - Full ruling: the new slots, and the list re-read in the wide reading
 *    order, so the desktop sheet decides the narrow order again once it is
 *    rearranged.
 *  - Narrow ruling: a narrow screen never rewrites the wide sheet's columns or
 *    rows for a cutting it did not move sideways or resize (before this, one
 *    phone drag saved every cutting four twelfths wide). Moved sideways: `x`
 *    scales by 12 / cols. Resized: at least one twelfth in the pressed
 *    direction, and the height as drawn. The list takes the order the narrow
 *    ruling now reads in, which is how a drag up or down on a phone is kept.
 */
export function liftCuttings<T extends Placed>(
  stored: T[],
  before: Placed[],
  after: Placed[],
  cols: number,
): T[] {
  const was = new Map(before.map((c) => [c.id, c.slot]));
  const now = new Map(after.map((c) => [c.id, c.slot]));
  if (stored.every((c) => sameSlot(was.get(c.id) ?? null, now.get(c.id) ?? null))) return stored;
  if (cols >= SHEET_COLS) {
    return byRowThenColumn(
      stored.map((c) => {
        const s = now.get(c.id);
        return s ? { ...c, slot: { ...s } } : c;
      }),
    );
  }
  const scale = SHEET_COLS / cols;
  const lifted = stored.map((c) => {
    const b = was.get(c.id);
    const a = now.get(c.id);
    if (!b || !a) return c;
    let w = c.slot.w;
    if (a.w > b.w) w = Math.max(c.slot.w + 1, Math.round(a.w * scale));
    else if (a.w < b.w) w = Math.min(c.slot.w - 1, Math.round(a.w * scale));
    w = clamp(w, SHEET_MIN_W, SHEET_COLS);
    const x = clamp(a.x === b.x ? c.slot.x : Math.round(a.x * scale), 0, SHEET_COLS - w);
    return { ...c, slot: { x, y: c.slot.y, w, h: a.h } };
  });
  const rank = new Map(byRowThenColumn(after).map((c, i) => [c.id, i]));
  const last = rank.size;
  const listed = lifted.sort((p, q) => (rank.get(p.id) ?? last) - (rank.get(q.id) ?? last));
  return fromLayout(listed, COMPACTOR.compact(toLayout(listed), SHEET_COLS));
}

/**
 * Up or Down on a narrow ruling: one place earlier or later in the list, which
 * is the narrow reading order. The wide sheet is untouched. The same array
 * when there is nowhere to go.
 */
export function reorderCutting<T extends Placed>(cs: T[], id: AnalysisId, dir: -1 | 1): T[] {
  const k = cs.findIndex((c) => c.id === id);
  const j = k + dir;
  if (k < 0 || j < 0 || j >= cs.length) return cs;
  const next = [...cs];
  [next[k], next[j]] = [next[j], next[k]];
  return next;
}

/**
 * The row a vertical arrow takes a cutting to: just past its nearest neighbour
 * sharing any of its columns; null at the top or foot. One-row steps never
 * show on a vertically compacted sheet (the compactor undoes them), so this is
 * dnd-kit's sortable keyboard model.
 */
function verticalTarget(layout: LayoutItem[], item: LayoutItem, dir: -1 | 1): number | null {
  const shares = (o: LayoutItem) => o.i !== item.i && o.x < item.x + item.w && item.x < o.x + o.w;
  if (dir < 0) {
    // The nearest cutting wholly above: the one whose foot is lowest.
    let best: LayoutItem | null = null;
    for (const o of layout) {
      if (!shares(o) || o.y + o.h > item.y) continue;
      if (!best || o.y + o.h > best.y + best.h || (o.y + o.h === best.y + best.h && o.y > best.y))
        best = o;
    }
    return best ? best.y : null;
  }
  // The nearest cutting wholly below: the one whose head is highest.
  let best: LayoutItem | null = null;
  for (const o of layout) {
    if (!shares(o) || o.y < item.y + item.h) continue;
    if (!best || o.y < best.y) best = o;
  }
  return best ? best.y + best.h : null;
}

/**
 * Move one cutting — the keyboard's half of `onDragStop`. Left and right move
 * it one column; up and down move it past its neighbour (`verticalTarget`).
 *
 * `moveElement` then `compact` is exactly what react-grid-layout runs when a
 * pointer is released (chunk-XM2M6TC6.mjs:800-811), with `isUserAction: true`
 * so a displaced neighbour is pushed the way a dragged one pushes it.
 */
export function moveCutting<T extends Placed>(
  cuttings: T[],
  id: AnalysisId,
  dx: number,
  dy: number,
  cols: number,
): T[] {
  const layout = toLayout(cuttings);
  const item = getLayoutItem(layout, id);
  if (!item) return cuttings;
  const x = clamp(item.x + dx, 0, Math.max(0, cols - item.w));
  let y = item.y;
  if (dy !== 0) {
    const to = verticalTarget(layout, item, dy < 0 ? -1 : 1);
    if (to === null) {
      if (x === item.x) return cuttings;
    } else {
      y = to;
    }
  }
  if (x === item.x && y === item.y) return cuttings;
  const moved = moveElement(layout, item, x, y, true, false, SHEET_COMPACT_TYPE, cols, false);
  return fromLayout(cuttings, COMPACTOR.compact(moved, cols));
}

/**
 * Resize one cutting by whole grid units — the keyboard's half of
 * `onResizeStop`, which is "set w/h, then compact" (:925-930).
 *
 * The floor is `SHEET_MIN_W`/`SHEET_MIN_H`, the same one the grid enforces for
 * a pointer resize; the ceiling is the ruling itself, so a cutting can never be
 * widened off the paper.
 */
export function resizeCutting<T extends Placed>(
  cuttings: T[],
  id: AnalysisId,
  dw: number,
  dh: number,
  cols: number,
): T[] {
  const layout = toLayout(cuttings);
  const item = getLayoutItem(layout, id);
  if (!item) return cuttings;
  const w = clamp(item.w + dw, Math.min(SHEET_MIN_W, cols), cols - item.x);
  const h = Math.max(SHEET_MIN_H, item.h + dh);
  if (w === item.w && h === item.h) return cuttings;
  item.w = w;
  item.h = h;
  return fromLayout(cuttings, COMPACTOR.compact(layout, cols));
}

/* ───────────────────────────────────────────────── what is announced ──── */

/** A slot in the reader's words. 1-based, because paper columns start at one. */
export function positionWords(slot: Slot, cols: number): string {
  return `column ${slot.x + 1} of ${cols}, row ${slot.y + 1}, ${slot.w} ${
    slot.w === 1 ? 'column' : 'columns'
  } wide, ${slot.h} ${slot.h === 1 ? 'row' : 'rows'} tall`;
}

export const ARRANGE_KEY_HELP =
  'Left and right move it one column, up and down move it past the cutting above or below, Shift and an arrow key resize it, Enter places it, Escape puts it back.';

export function pickedUpWords(title: string, slot: Slot, cols: number): string {
  return `${title} picked up at ${positionWords(slot, cols)}. ${ARRANGE_KEY_HELP}`;
}

/**
 * The honest one. `after` is read from the layout the compactor produced, so a
 * cutting that was pulled back by the ruling says the row it actually landed
 * on, and one that could not move says that instead of repeating its own
 * request back as though it had happened.
 */
export function movedWords(
  title: string,
  before: Slot,
  after: Slot,
  cols: number,
  intent: 'move' | 'resize',
): string {
  if (sameSlot(before, after))
    return `${title} did not ${intent === 'move' ? 'move' : 'change size'} — it is held at ${positionWords(
      after,
      cols,
    )}.`;
  return `${title} is now at ${positionWords(after, cols)}.`;
}

export function placedWords(title: string, from: Slot, to: Slot, cols: number): string {
  if (sameSlot(from, to)) return `${title} placed back where it was: ${positionWords(to, cols)}.`;
  return `${title} placed at ${positionWords(to, cols)}, from ${positionWords(from, cols)}. Rule the sheet off to keep it.`;
}

export function cancelledWords(title: string, back: Slot, cols: number): string {
  return `Move cancelled. ${title} is back at ${positionWords(back, cols)}.`;
}

/* ──────────────────────────────────────────────────────── the hook ────── */

export interface ArrangeApi {
  /** The cutting currently picked up, or null. */
  picked: AnalysisId | null;
  /** Where the picked cutting was when it was picked up, as the ruling in
   *  play draws it — the ghost's slot. */
  origin: Slot | null;
  /** The live-region sentence. Replaced, never appended to. */
  message: string;
  /** How many columns the ruling is in right now (measured, not assumed). */
  cols: number;
  pickUp: (id: AnalysisId, title: string) => void;
  place: () => void;
  cancel: () => void;
  nudge: (dx: number, dy: number) => void;
  resize: (dw: number, dh: number) => void;
  /** Bind to the grip button. Handles the whole key model, including Escape. */
  keyDown: (id: AnalysisId, title: string) => (e: { key: string; shiftKey: boolean; preventDefault: () => void }) => void;
}

export interface ArrangeInput {
  /** The draft's cuttings — null while the sheet is only being read. */
  cuttings: Cutting[] | null;
  /** Writes the draft. Same setter the pointer path uses. */
  apply: (next: Cutting[]) => void;
  /** The `.rp-sheet` element, for the measured width. */
  sheetRef: { current: HTMLElement | null };
  /** True only while arranging; leaving the mode drops any pick-up. */
  arranging: boolean;
}

export function useArrange({ cuttings, apply, sheetRef, arranging }: ArrangeInput): ArrangeApi {
  const [picked, setPicked] = useState<AnalysisId | null>(null);
  const [origin, setOrigin] = useState<Slot | null>(null);
  // The whole sheet as it was at pick-up, slots AND order — what Escape puts
  // back. A move can reorder the list and push other cuttings aside.
  const [home, setHome] = useState<Cutting[] | null>(null);
  const [message, setMessage] = useState('');
  const [cols, setCols] = useState(SHEET_COLS);

  // The callbacks below run from event handlers, so they must read the CURRENT
  // draft rather than the one that was current when they were created.
  const live = useRef<Cutting[] | null>(cuttings);
  live.current = cuttings;
  const titles = useRef(new Map<AnalysisId, string>());

  const measure = useCallback((): number => {
    const next = colsForWidth(sheetRef.current?.clientWidth ?? 0);
    setCols(next);
    return next;
  }, [sheetRef]);

  /* Leaving arrange mode drops the pick-up: a cutting held on a sheet that is
     no longer being arranged would be held forever, and the grip is gone. */
  useEffect(() => {
    if (!arranging && picked) {
      setPicked(null);
      setOrigin(null);
      setHome(null);
      setMessage('');
    }
  }, [arranging, picked]);

  const pickUp = useCallback(
    (id: AnalysisId, title: string) => {
      const cs = live.current;
      if (!cs) return;
      const stored = slotOf(cs, id);
      if (!stored) return;
      titles.current.set(id, title);
      const c = measure();
      // Say the square the reader can see, not the saved twelfths.
      const slot = slotOf(projectCuttings(cs, c), id) ?? stored;
      setPicked(id);
      setOrigin({ ...slot });
      setHome(cs);
      setMessage(pickedUpWords(title, slot, c));
    },
    [measure],
  );

  const step = useCallback(
    (dx: number, dy: number, dw: number, dh: number) => {
      const cs = live.current;
      if (!cs || !picked) return;
      // The move is made on the ruling in play, then written back onto the
      // twelve-column sheet (`liftCuttings`); identity at the full ruling.
      const drawn = projectCuttings(cs, cols);
      const before = slotOf(drawn, picked);
      if (!before) return;
      const intent: 'move' | 'resize' = dw === 0 && dh === 0 ? 'move' : 'resize';
      // Up and down on a narrow ruling change the reading order, not the wide
      // sheet's rows (`reorderCutting`).
      const next =
        intent === 'move' && dy !== 0 && cols < SHEET_COLS
          ? reorderCutting(cs, picked, dy < 0 ? -1 : 1)
          : liftCuttings(
              cs,
              drawn,
              intent === 'move'
                ? moveCutting(drawn, picked, dx, dy, cols)
                : resizeCutting(drawn, picked, dw, dh, cols),
              cols,
            );
      apply(next);
      // Read the answer back out of the layout the ruling will draw from what
      // was saved. This is the line that makes the announcement a report
      // rather than an echo.
      const after = slotOf(projectCuttings(next, cols), picked);
      setMessage(
        movedWords(titles.current.get(picked) ?? 'The cutting', before, after ?? before, cols, intent),
      );
    },
    [apply, cols, picked],
  );

  const nudge = useCallback((dx: number, dy: number) => step(dx, dy, 0, 0), [step]);
  const resize = useCallback((dw: number, dh: number) => step(0, 0, dw, dh), [step]);

  const place = useCallback(() => {
    const cs = live.current;
    if (!picked || !cs || !origin) return;
    const to = slotOf(projectCuttings(cs, cols), picked) ?? origin;
    setMessage(placedWords(titles.current.get(picked) ?? 'The cutting', origin, to, cols));
    setPicked(null);
    setOrigin(null);
    setHome(null);
  }, [cols, origin, picked]);

  const cancel = useCallback(() => {
    const cs = live.current;
    if (!picked || !cs || !origin || !home) return;
    // Put the sheet back exactly as it was picked up.
    const restored = home;
    apply(restored);
    setMessage(
      cancelledWords(
        titles.current.get(picked) ?? 'The cutting',
        slotOf(projectCuttings(restored, cols), picked) ?? origin,
        cols,
      ),
    );
    setPicked(null);
    setOrigin(null);
    setHome(null);
  }, [apply, cols, home, origin, picked]);

  const keyDown = useCallback(
    (id: AnalysisId, title: string) =>
      (e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
        const holding = picked === id;

        // dnd-kit's KeyboardSensor defaults: Space and Enter both start and
        // both end. `preventDefault` is what stops the browser turning the key
        // into a second `click` on the grip and toggling twice.
        if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
          e.preventDefault();
          if (holding) place();
          else pickUp(id, title);
          return;
        }
        if (e.key === 'Escape') {
          if (!holding) return;
          e.preventDefault();
          cancel();
          return;
        }
        if (!holding) return; // arrows do nothing until a cutting is held

        const dir =
          e.key === 'ArrowLeft'
            ? [-1, 0]
            : e.key === 'ArrowRight'
              ? [1, 0]
              : e.key === 'ArrowUp'
                ? [0, -1]
                : e.key === 'ArrowDown'
                  ? [0, 1]
                  : null;
        if (!dir) return;
        e.preventDefault();
        if (e.shiftKey) resize(dir[0], dir[1]);
        else nudge(dir[0], dir[1]);
      },
    [cancel, nudge, picked, pickUp, place, resize],
  );

  return useMemo(
    () => ({
      picked,
      origin,
      message,
      cols,
      pickUp,
      place,
      cancel,
      nudge,
      resize,
      keyDown,
    }),
    [cancel, cols, keyDown, message, nudge, origin, picked, pickUp, place, resize],
  );
}
