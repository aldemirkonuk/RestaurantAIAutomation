/**
 * Mudavym overlays — one primitive, three shapes.
 *
 * The founder's instruction for this pass, verbatim: "modal window changes are
 * a must to match with new wave." Every dialog, sheet, popover or palette that
 * can appear while a rebuilt page is on screen must look and move like the page
 * under it.
 *
 * WHAT WAS THERE BEFORE
 * ---------------------
 * Four hand-rolled overlays, no shared primitive: providers' TwinSheet
 * (TwinSheet.tsx:88, inline styles + its own `pv-sheet-in` keyframes), the
 * calendar's EventSheet (EventSheet.tsx:220, `.cn-scrim`/`.cn-sheet`),
 * the reports Ask-the-book panel (AskTheBook.tsx:102, `.rp-ask__*`), and
 * communications' TemplateSheet (a fixed wrapper around two legacy builders).
 * Each re-derived the scrim colour, the motion and the Esc handler. None
 * trapped focus, none returned focus to the opener, none locked body scroll.
 *
 * THREE SHAPES, NOT ONE, AND NOT SEVEN
 * ------------------------------------
 *   Sheet   — right slide-in. One object's detail or edit. `tuck`, 440px.
 *   Panel   — centered. An ask, a command, a confirmation. `settle`, 620px.
 *   Popover — anchored to its trigger. A menu, a switcher, a small picker.
 *             `ink`, fixed-positioned under the anchor and clamped.
 *
 * The shape is chosen by what the overlay is FOR, so the shape itself carries
 * information: something arriving from the right is one record; something in
 * the middle wants an answer; something hanging off a control belongs to that
 * control. See the ADR for the two rejected alternatives (one shape for
 * everything; per-page freedom).
 *
 * THE TOKENS TRAVEL WITH IT
 * -------------------------
 * ADR 0042 scopes every token under `.mudavym`, never `:root` (mudavym.css:1-25).
 * An overlay portalled to `document.body` therefore has NO tokens unless its own
 * root carries `.mudavym` — and, when the page beneath forces Warm Charcoal, the
 * page's `data-ground` on the SAME element (PageGate's header explains why a
 * second `.mudavym` node must carry the ground itself: a custom property
 * declared on a descendant beats one inherited from an ancestor).
 *
 * Motion is a token from lib/mudavym/motion.ts and nothing else; reduced motion
 * renders the overlay at its end state with no animation at all.
 */

import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  MudavymGroundContext,
  readGroundFromDom,
  readShellGroundFromDom,
  useMudavymShell,
  type MudavymGround,
} from '../../lib/mudavym/shellGround';
import { ink, settle, tuck, useReducedMotion, animate, type MotionToken } from '../../lib/mudavym/motion';
import './sheet.css';

/* ── Fraunces ─────────────────────────────────────────────────────────────
   index.html loads DM Sans / Plus Jakarta Sans / JetBrains Mono but not the
   house serif, and index.html is shared. The id matches the page-level helpers
   (pages/dashboard/next/fonts.ts:10) so all three inject at most one link. */
const FRAUNCES_LINK_ID = 'mudavym-fraunces';

function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FRAUNCES_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FRAUNCES_LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

/* ── body scroll lock ─────────────────────────────────────────────────────
   Counted, not a boolean: two stacked overlays closing in the wrong order would
   otherwise leave the page unscrollable (or unlock it while one is still up). */
let scrollLocks = 0;
let restoreOverflow = '';

function lockBodyScroll(): () => void {
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

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');

/**
 * The tabbable elements inside the panel, in document order.
 *
 * Deliberately NOT filtered by `offsetParent`/`getBoundingClientRect`: jsdom
 * reports every element as having no layout, so a visibility filter empties the
 * list in every test while behaving differently in a browser — a trap that
 * makes the focus tests pass for the wrong reason. `[hidden]` and an
 * `aria-hidden` subtree are excluded because those are declarations, readable
 * in both environments.
 */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && !el.closest('[aria-hidden="true"]'),
  );
}

export type OverlayShape = 'sheet' | 'panel' | 'popover';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name. Required — an overlay with no name is a room with no sign. */
  label: string;
  /** Mono eyebrow above the title (what kind of thing this is). */
  eyebrow?: ReactNode;
  /** Fraunces title (the product speaking). */
  title?: ReactNode;
  /** Header-right slot, left of the Close control. */
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Force a ground. Normally left off — the overlay reads the page's. */
  ground?: MudavymGround;
  /** Words on the close control. The house closes with words, not an X. */
  closeLabel?: string;
  /** Default true for sheet/panel, false for popover. */
  showClose?: boolean;
  className?: string;
  /** Extra class on the scrolling body. */
  bodyClassName?: string;
  /**
   * A wider right sheet — 640px instead of 440px. `Sheet` only.
   *
   * ADR 0112 fixed one width on purpose, and this is the one exception it
   * anticipated: 440px holds an object's FIELDS, and the email composer holds a
   * letter. A letter is prose that a person reads back as prose, and at 440px
   * minus padding the body column is roughly 46 characters — narrow enough that
   * the writer cannot see the paragraph they are judging. Sketch 100 asked for
   * exactly this and nothing else about the shape ("The one thing this sketch
   * asks of sketch 099: a `wide` sheet at 640px").
   *
   * It is a boolean rather than a number so it cannot become per-page freedom
   * by increments: there are two widths, and a third needs an ADR.
   */
  wide?: boolean;
  /** Stack order. Default 100. */
  zIndex?: number;
  /** Element to focus on open. Defaults to the first focusable in the panel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Trap focus, lock body scroll and dim the page. Sheet and Panel always do;
   * a Popover does not, because it belongs to a control on the page.
   *
   * The one exception the system has: an anchored surface that is a FORM, not a
   * picker (`InviteTeamDialog`). It keeps the anchored position operators know
   * and the modal behaviour its Radix dialog had, rather than silently dropping
   * a focus trap in the name of a shape.
   */
  modal?: boolean;
}

interface RootProps extends OverlayProps {
  shape: OverlayShape;
  anchorRef?: RefObject<HTMLElement | null>;
  /** Popover width in px. Default 320. */
  width?: number;
}

const TOKEN: Record<OverlayShape, MotionToken> = { sheet: tuck, panel: settle, popover: ink };
const TOKEN_NAME: Record<OverlayShape, string> = { sheet: 'tuck', panel: 'settle', popover: 'ink' };

const ENTER: Record<OverlayShape, Keyframe[]> = {
  sheet: [
    { transform: 'translateX(28px)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ],
  panel: [
    { transform: 'translateY(6px)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ],
  popover: [
    { transform: 'translateY(4px)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ],
};

/**
 * Position a popover under its anchor, right-aligned and clamped to the
 * viewport. The maths is `hooks/useAnchoredDialogPosition.ts:21-32`, kept here
 * so the primitive has no dependency on a hook the legacy dialogs own.
 */
function useAnchoredPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null> | undefined,
  width: number,
): { top: number; left: number } | null {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let left = Math.max(16, r.right - width);
      if (left + width > window.innerWidth - 16) {
        left = Math.max(16, window.innerWidth - width - 16);
      }
      setPos({ top: r.bottom + 10, left });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, width]);
  return pos;
}

function OverlayRoot({
  shape,
  open,
  onClose,
  label,
  eyebrow,
  title,
  action,
  footer,
  children,
  ground,
  closeLabel = 'Close',
  showClose,
  className,
  bodyClassName,
  wide,
  zIndex = 100,
  initialFocusRef,
  anchorRef,
  width = 320,
  modal: modalProp,
}: RootProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const ctxGround = useContext(MudavymGroundContext);
  const shell = useMudavymShell();
  const reduced = useReducedMotion();
  const titleId = useId();
  const modal = modalProp ?? shape !== 'popover';
  const withClose = showClose ?? modal;
  const pos = useAnchoredPosition(shape === 'popover' && open, anchorRef, width);

  /* The ground, resolved once per open, most-specific first. `ground` prop >
     a provider above the opener > the DOM the page rendered > the shell store
     (the only reader for a trigger that lives in the header, outside the page's
     own `.mudavym` root). */
  const [resolved, setResolved] = useState<MudavymGround>('paper');
  useLayoutEffect(() => {
    if (!open) return;
    if (ground) {
      setResolved(ground);
      return;
    }
    if (ctxGround) {
      setResolved(ctxGround);
      return;
    }
    const anchor = anchorRef?.current ?? openerRef.current;
    setResolved(
      readGroundFromDom(anchor) ?? (shell.on ? shell.ground : readShellGroundFromDom()),
    );
  }, [open, ground, ctxGround, anchorRef, shell.on, shell.ground]);

  useEffect(() => {
    if (open) ensureFraunces();
  }, [open]);

  /* Remember the opener BEFORE focus moves inside, restore it on close. */
  useLayoutEffect(() => {
    if (!open) return;
    openerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const opener = openerRef.current;
    return () => {
      // A page that navigated away no longer has the opener in the document;
      // focusing a detached node silently sends focus to <body>, so check.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  /* Focus lands inside on open.
     `pos` is in the deps on purpose: a Popover has no position on its first
     commit, and until it does it is not painted where it belongs. Measured in
     a real browser — jsdom reports every element as focusable regardless of
     layout, so the unit test passed while Chrome put focus on <body>. */
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (shape === 'popover' && anchorRef?.current && !pos) return;
    const target = initialFocusRef?.current ?? focusables(panel)[0] ?? panel;
    target.focus();
  }, [open, initialFocusRef, shape, anchorRef, pos]);

  useEffect(() => {
    if (!open || !modal) return;
    return lockBodyScroll();
  }, [open, modal]);

  /* Enter motion. `animate()` collapses to the end state under reduced motion;
     we skip it entirely so nothing is scheduled at all. */
  useEffect(() => {
    if (!open || reduced) return;
    const panel = panelRef.current;
    if (!panel) return;
    animate(panel, ENTER[shape], TOKEN[shape]);
  }, [open, reduced, shape]);

  /* Esc closes, from anywhere — an overlay whose Esc only works while focus is
     inside is an overlay you can get stuck behind. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* Tab cycles inside a modal shape. A popover does not trap: it is attached to
     a control on the page, and tabbing off it should leave it. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!modal || e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusables(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [modal],
  );

  if (!open || typeof document === 'undefined') return null;

  const head =
    eyebrow || title || action || withClose ? (
      <div className="mdv-ovl__head">
        <div>
          {eyebrow ? <span className="mdv-ovl__eyebrow">{eyebrow}</span> : null}
          {title ? (
            <h2 className="mdv-ovl__title" id={titleId}>
              {title}
            </h2>
          ) : null}
        </div>
        <div className="mdv-ovl__headside">
          {action}
          {withClose ? (
            <button type="button" className="mdv-ovl__close" onClick={onClose}>
              {closeLabel}
            </button>
          ) : null}
        </div>
      </div>
    ) : null;

  return createPortal(
    <div
      className={`mdv-ovl mdv-ovl--${shape} mudavym`}
      data-ground={resolved === 'charcoal' ? 'charcoal' : undefined}
      data-shape={shape}
      // `wide` is a Sheet-only affordance; setting it on a Panel or Popover
      // would silently do nothing, so it is not carried there at all.
      data-wide={shape === 'sheet' && wide ? 'true' : undefined}
      data-modal={modal ? 'true' : undefined}
      style={{ zIndex }}
    >
      <button
        type="button"
        aria-label={`Close ${label}`}
        className="mdv-ovl__scrim"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={`mdv-ovl__panel${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal={modal ? true : undefined}
        aria-label={title ? undefined : label}
        aria-labelledby={title ? titleId : undefined}
        data-motion={reduced ? 'none' : TOKEN_NAME[shape]}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={
          shape === 'popover'
            ? {
                width,
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                // `opacity`, NOT `visibility`: a `visibility: hidden` subtree
                // cannot take focus, so the one frame before the anchor is
                // measured silently swallowed the focus move.
                opacity: pos ? 1 : 0,
              }
            : undefined
        }
      >
        {head}
        <div className={`mdv-ovl__body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
        {footer ? <div className="mdv-ovl__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Right slide-in — one object's detail or edit. Motion `tuck`, 440px. */
export function Sheet(props: OverlayProps) {
  return <OverlayRoot {...props} shape="sheet" />;
}

/** Centered — an ask, a command, a confirmation. Motion `settle`. */
export function Panel(props: OverlayProps) {
  return <OverlayRoot {...props} shape="panel" />;
}

export interface PopoverProps extends OverlayProps {
  anchorRef: RefObject<HTMLElement | null>;
  /** Width in px. Default 320. */
  width?: number;
}

/** Anchored to its trigger — a menu, a switcher, a small picker. Motion `ink`. */
export function Popover(props: PopoverProps) {
  return <OverlayRoot {...props} shape="popover" />;
}

export default Sheet;
