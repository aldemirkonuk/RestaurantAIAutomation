/**
 * One cutting laid flat — the whole screen given to a single register
 * (founder /goal 2026-11-07: "each graph … with full screen rendering").
 *
 *  1. **A place in history, not a widget state.** `/reports?flat=<id>`, owned
 *     by `Cutting.tsx`: Back closes it, the link shares, landscape works, and
 *     react-grid-layout is never maximised. Not a route in `App.tsx` — open PRs
 *     edit that file, and a route would unmount the sheet underneath; laid over
 *     it, its scroll position and query cache survive for free.
 *  2. **The cutting's own drawing.** `renderBody` is the function the cutting
 *     renders on the sheet, over the same `Register`, so loading, refused,
 *     held-back (ADR 0348) and said-not-drawn read the same here, and no second
 *     request is sent.
 *  3. **View-only (F3).** "Draw as" here never calls `onGraph` and never writes
 *     the sheet, and the line under it says so.
 *  4. **Outside ADR 0112's three shapes and two widths** (`components/mudavym/
 *     Sheet.tsx`, the `wide` note), as the founder's /goal allows when cited.
 *     It keeps the house overlay contract — modal, named by its title, focus in
 *     and back to the opener, Tab held, the counted scroll lock, and a place on
 *     the shared overlay stack (`openStack`) so Escape closes only the topmost
 *     overlay — and it arrives on the house `settle`
 *     (opacity + 6px, 320ms, `rp-flat-in` in MOTIONS.md) so a 1440 card does
 *     not become a full-viewport layer in one frame with no cue. Exit is
 *     instant (ADR 0112: no overlay exit but the dirty-sheet tear); reduced
 *     motion is no animation, the fade included; input and focus are never
 *     held back by it. Rejected: a View Transition card-to-flat morph (a
 *     large-area zoom is a vestibular trigger and it cross-fades two charts).
 *  5. **It steps through the sheet** (r108 g1). Previous and Next, and the Left
 *     and Right keys, lay the neighbouring cutting flat in sheet order; "3 of
 *     9" says where. Each cutting owns its `?flat=`, so a step is a replace of
 *     that one param (`Cutting.tsx`), and the dialog it lands on is a new one.
 *     Nothing animates (MOTIONS.md: a subject change is not animated).
 *  6. **The page's shortcuts stay behind it.** ⌘K / Ctrl-K is the page's
 *     window-level palette key (ReportsNext.tsx); while this view is up it is
 *     stopped at `document`, which the bubble reaches before `window`, so the
 *     palette never opens unseen underneath (audit 2026-11-07).
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { lockBodyScroll, openStack } from '@/components/mudavym/overlayState';
import { readGroundFromDom, type MudavymGround } from '@/lib/mudavym/shellGround';
import type { ComboPick } from './rp-combo';
import { GRAPH_LABEL, type GraphType } from './rp-sheet';
import './reports-flat.css';

/** The search parameter that lays a cutting flat: `/reports?flat=till`. */
export const FLAT_PARAM = 'flat';

const TABBABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),' +
  'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => !el.hasAttribute('hidden') && !el.closest('[aria-hidden="true"]'),
  );
}

/** Where this cutting sits in the sheet's read order, and the way to its neighbours. */
export interface FlatStep {
  /** 1-based. */
  position: number;
  total: number;
  /** Titles, or null at an end: the sheet does not wrap. */
  prevTitle: string | null;
  nextTitle: string | null;
  go: (dir: 'prev' | 'next') => void;
}

/** Where Left and Right are the control's own, not a step. */
const OWN_ARROWS =
  'select,input,textarea,[contenteditable="true"],[role="radiogroup"],[role="tablist"],[role="slider"],[role="listbox"],.rp-plot';

export interface CuttingFlatProps {
  title: string;
  windowLine: string;
  /** `spec.graphs`; the view starts from the sheet's `initialGraph`. */
  graphs: GraphType[];
  initialGraph: GraphType;
  /** The sheet's bars-and-line choice for this cutting, the view's starting point. */
  initialComboPick?: Partial<ComboPick>;
  /**
   * The cutting's own body, drawn as `graph`, with the working open. `combo` is
   * this view's own bars-and-line choice: held here, above the drawing, so
   * flipping "Draw as" away and back keeps it, and never handed to the sheet.
   */
  renderBody: (
    graph: GraphType,
    combo: { pick?: Partial<ComboPick>; onPick: (p: ComboPick) => void },
  ) => ReactNode;
  /** The till's window picker, wired to the page's state. */
  windowControl?: ReactNode;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Absent when the sheet has one cutting to lay flat. */
  step?: FlatStep;
  /** A step lands with focus on the button it came by; any other opening on Back. */
  initialFocus?: 'prev' | 'next';
}

export default function CuttingFlat({
  title,
  windowLine,
  graphs,
  initialGraph,
  initialComboPick,
  renderBody,
  windowControl,
  anchorRef,
  onClose,
  step,
  initialFocus,
}: CuttingFlatProps) {
  const [picked, setGraph] = useState<GraphType>(initialGraph);
  // A drawing the data turned out not to carry (the list shrinks when the read lands) is not held on to.
  const graph: GraphType = graphs.length === 0 || graphs.includes(picked) ? picked : graphs[0];
  const [comboPick, setComboPick] = useState<Partial<ComboPick> | undefined>(initialComboPick);
  const [ground, setGround] = useState<MudavymGround | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const prevRef = useRef<HTMLButtonElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  const stepRef = useRef(step);
  useEffect(() => {
    closeRef.current = onClose;
    stepRef.current = step;
  });

  /* Portalled outside the page's `.mudavym` root, so the ground (ADR 0169)
     is read off the opener; until then <html>'s choice applies. */
  useLayoutEffect(() => {
    setGround(readGroundFromDom(anchorRef.current));
  }, [anchorRef]);

  // Focus in, the house's counted scroll lock, a place on the overlay stack,
  // Escape out when on top, and the page's ⌘K held back.
  useEffect(() => {
    // The button the reader came by, if it is still there (an end has one fewer); else Back.
    const wanted = initialFocus === 'prev' ? prevRef.current : initialFocus === 'next' ? nextRef.current : null;
    (wanted ?? backRef.current)?.focus();
    const release = lockBodyScroll();
    openStack.push(titleId);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // `document` runs before `window` in the bubble phase, so the page's
        // window-level palette listener never hears this press.
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !e.defaultPrevented &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        const target = e.target instanceof Element ? e.target : null;
        const s = stepRef.current;
        if (!s || target?.closest(OWN_ARROWS)) return;
        if (openStack[openStack.length - 1] !== titleId) return;
        const dir = e.key === 'ArrowLeft' ? 'prev' : 'next';
        if ((dir === 'prev' ? s.prevTitle : s.nextTitle) === null) return;
        e.preventDefault();
        s.go(dir);
        return;
      }
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Only the topmost overlay acts (openStack, overlayState.ts).
      if (openStack[openStack.length - 1] !== titleId) return;
      e.preventDefault();
      closeRef.current();
    };
    // Focus that escapes (a Tab from <body>) comes back to the first control.
    const onFocusIn = (e: FocusEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) backRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      const idx = openStack.lastIndexOf(titleId);
      if (idx !== -1) openStack.splice(idx, 1);
      release();
    };
  }, [titleId]);

  /** Tab and Shift+Tab wrap inside the dialog. */
  const holdTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !rootRef.current) return;
    const items = tabbables(rootRef.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = active ? items.includes(active) : false;
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      ref={rootRef}
      className="mudavym rp-page rp-flat"
      data-ground={ground ?? undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={holdTab}
    >
      <div className="rp-flat__head">
        <div className="rp-flat__bar">
          <button
            ref={backRef}
            type="button"
            className="rp-btn rp-ink rp-focus rp-flat__back"
            onClick={onClose}
          >
            <ArrowLeft size={14} strokeWidth={1.8} aria-hidden />
            <span className="rp-flat__back-label">Back to the sheet</span>
          </button>
          {step && (
            <div className="rp-flat__steps" role="group" aria-label="Move through the sheet">
              <span className="rp-flat__step-slot">
                {step.prevTitle !== null && (
                  <button
                    ref={prevRef}
                    type="button"
                    className="rp-btn rp-ink rp-focus rp-flat__step"
                    aria-label={`Previous: ${step.prevTitle}`}
                    title={`Previous: ${step.prevTitle}`}
                    onClick={() => step.go('prev')}
                  >
                    <ChevronLeft size={16} strokeWidth={1.8} aria-hidden />
                  </button>
                )}
              </span>
              <span className="rp-cap rp-flat__step-count">
                {step.position} of {step.total}
              </span>
              <span className="rp-flat__step-slot">
                {step.nextTitle !== null && (
                  <button
                    ref={nextRef}
                    type="button"
                    className="rp-btn rp-ink rp-focus rp-flat__step"
                    aria-label={`Next: ${step.nextTitle}`}
                    title={`Next: ${step.nextTitle}`}
                    onClick={() => step.go('next')}
                  >
                    <ChevronRight size={16} strokeWidth={1.8} aria-hidden />
                  </button>
                )}
              </span>
            </div>
          )}
        </div>
        <div className="rp-flat__row">
          <div style={{ minWidth: 0 }}>
            <h2 id={titleId} className="rp-cut__title rp-flat__title">
              {title}
            </h2>
            <p className="rp-cut__window">{windowLine}</p>
          </div>
          <div className="rp-flat__controls">
            {graphs.length > 0 && (
              <label className="rp-field">
                <span className="rp-eyebrow">Draw as</span>
                <select
                  className="rp-select rp-focus"
                  aria-label={`Draw ${title} as`}
                  value={graph}
                  onChange={(e) => setGraph(e.target.value as GraphType)}
                >
                  {graphs.map((g) => (
                    <option key={g} value={g}>
                      {GRAPH_LABEL[g]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {windowControl}
          </div>
        </div>
      </div>
      <div className="rp-flat__body">
        {renderBody(graph, { pick: comboPick, onPick: setComboPick })}
      </div>
      <p className="rp-cap rp-flat__note">
        This view is not saved to your sheet.
        {windowControl ? ' The window you pick is kept in the page link, so a reload or a shared link opens on it.' : ''}
      </p>
    </div>,
    document.body,
  );
}
