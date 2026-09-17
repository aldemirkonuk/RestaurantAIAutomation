/**
 * The document-level state every house overlay shares.
 *
 * Split from `Sheet.tsx` so the component file exports only components (the
 * repo's `react-refresh/only-export-components` rule; `sheetStackContext.ts` and
 * `dayStripDates.ts` are the same split). Everything here is module state on
 * purpose: two overlays from two unrelated subtrees still share one body, one
 * Escape key and one set of page roots.
 */

/* ── body scroll lock ─────────────────────────────────────────────────────
   Counted, not a boolean: two stacked overlays closing in the wrong order would
   otherwise leave the page unscrollable (or unlock it while one is still up). */
let scrollLocks = 0;
let restoreOverflow = '';

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (scrollLocks === 0) {
    restoreOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.body.style.overflow = restoreOverflow;
  };
}

/* ── overlay stack, topmost last ──────────────────────────────────────────
   A window-level Escape listener on every open overlay is how each one
   closes "from anywhere" — but that means a Sheet opened from inside an open
   Panel has TWO listeners on the same target, and `stopPropagation()` does
   nothing for sibling listeners registered directly on `window`. One Escape
   press used to close both. This stack is the shared source of truth for which
   overlay is topmost; only that one's handler acts, regardless of listener
   registration order.

   An overlay enters it when it is LIVE — rendered, and holding its level when a
   spindle is above it — so a Sheet waiting for a level is never on top of it. */
export const openStack: string[] = [];

/* ── the page gives up width, not light ───────────────────────────────────
   Sketch 103 · 1a, "The Pass": while a Sheet is open, `data-sheet-open` and
   `--sheet-width` land on every `.mudavym` page root (never on the overlay's own
   root) for the page's own CSS to answer with a compressed list.

   Counted, like the scroll lock, and last-opened wins the width — two sheets
   are the spindle (1c), and the page compresses to whichever one is on top. */
export type SheetLayout = 'overlay' | 'compress';
interface OpenSheet {
  id: symbol;
  layout: SheetLayout;
  width: number;
}
const openSheets: OpenSheet[] = [];

function isPageRoot(el: Element): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.classList.contains('mudavym') &&
    !el.classList.contains('mdv-ovl') &&
    !el.closest('.mdv-ovl')
  );
}

function pageRoots(): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<HTMLElement>('.mudavym')).filter(isPageRoot);
}

function paintRoot(root: HTMLElement, top: OpenSheet | undefined): void {
  if (!top) {
    if (root.hasAttribute('data-sheet-open')) root.removeAttribute('data-sheet-open');
    if (root.style.getPropertyValue('--sheet-width')) root.style.removeProperty('--sheet-width');
    return;
  }
  const width = `${top.width}px`;
  if (root.getAttribute('data-sheet-open') !== top.layout) {
    root.setAttribute('data-sheet-open', top.layout);
  }
  if (root.style.getPropertyValue('--sheet-width') !== width) {
    root.style.setProperty('--sheet-width', width);
  }
}

function paintSheetWidth(): void {
  const top = openSheets[openSheets.length - 1];
  for (const root of pageRoots()) paintRoot(root, top);
}

/* A page root that mounts AFTER the sheet opened — a route's lazy chunk, a
   list that renders once its data lands — would otherwise never learn a sheet
   is beside it (judge probe J8, 2026-09-17). The observer lives only while a
   sheet is open, watches only for added nodes, and repaints only when one of
   them is, or holds, a page root; painting writes attributes, which it does not
   watch, so it cannot feed itself. */
let rootObserver: MutationObserver | null = null;

function watchForLateRoots(): void {
  if (rootObserver || typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
    return;
  }
  rootObserver = new MutationObserver((records) => {
    const top = openSheets[openSheets.length - 1];
    if (!top) return;
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (isPageRoot(node)) paintRoot(node, top);
        node.querySelectorAll('.mudavym').forEach((inner) => {
          if (isPageRoot(inner)) paintRoot(inner, top);
        });
      });
    }
  });
  rootObserver.observe(document.body, { childList: true, subtree: true });
}

function stopWatchingForLateRoots(): void {
  rootObserver?.disconnect();
  rootObserver = null;
}

export function markSheetOpen(layout: SheetLayout, width: number): () => void {
  const entry: OpenSheet = { id: Symbol('mdv-sheet'), layout, width };
  openSheets.push(entry);
  paintSheetWidth();
  watchForLateRoots();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const i = openSheets.findIndex((e) => e.id === entry.id);
    if (i >= 0) openSheets.splice(i, 1);
    paintSheetWidth();
    if (openSheets.length === 0) stopWatchingForLateRoots();
  };
}

/** Test seam: forget every open sheet (a test that unmounts mid-render). */
export function resetSheetWidth(): void {
  openSheets.length = 0;
  paintSheetWidth();
  stopWatchingForLateRoots();
}

/* ── the label check ──────────────────────────────────────────────────────
   `label` is the contract sentence (what it asks · what it writes · what
   leaving costs). Four words is the floor at which a sentence can carry three
   clauses; below it the caller has passed a title. Dev only — this is a nudge
   at the person writing the surface, never a runtime behaviour. */
const LABEL_MIN_WORDS = 4;
const warned = new Set<string>();

/** Test seam: resets the once-per-label memo. */
export function resetLabelWarnings(): void {
  warned.clear();
}

export function warnIfLabelIsATitle(label: string): void {
  if (!import.meta.env?.DEV) return;
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length >= LABEL_MIN_WORDS) return;
  if (warned.has(label)) return;
  warned.add(label);
  console.warn(
    `[mudavym overlay] label "${label}" reads like a title (${words.length} ` +
      `word${words.length === 1 ? '' : 's'}). The label IS the accessible name and ` +
      'should be the contract sentence: what it asks, what sealing or saving ' +
      'writes, what leaving costs. Put the heading in `title` instead.',
  );
}
