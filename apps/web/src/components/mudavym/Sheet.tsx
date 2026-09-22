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
 * renders the overlay at its end state with no animation at all — EXCEPT the
 * entrance (ADR 0134 §6, 2026-09-21, locked): a Sheet/Panel/Popover arriving
 * under reduced motion crosses on `REDUCED_FADE`, a 120ms opacity-only
 * cross-fade, because a surface that appears with zero frames is genuinely
 * harder to notice and noticing it is functional. Every OTHER motion in this
 * family — the tear, the lean, the seal — is unaffected and still renders none.
 * 120ms names no eighth token (ADR 0134 §1 stays literally true); it is a
 * disclosed literal, allow-listed by file:line in
 * `scripts/check_motion_tokens.py`, the same shape the guard gives the two
 * pre-existing shimmer sheens.
 */

import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
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
import { useSheetStack } from './sheetStackContext';
import { Denied, type DeniedProps } from './Denied';
import {
  lockBodyScroll,
  markSheetOpen,
  openStack,
  warnIfLabelIsATitle,
  type SheetLayout,
} from './overlayState';
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

/* The document-level state — the counted scroll lock, the Escape stack, the
   page-width hooks and the label memo — lives in `overlayState.ts`, so this file
   exports only components. */

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

/* ── the weight (1d) ─────────────────────────────────────────────────────
   A dialog that asks "are you sure you want to discard?" is a system that never
   watched what you did. A dirty Panel gains weight instead: a stray click
   outside cannot lift it — it leans, says what it is holding, and waits for a
   second, deliberate act. The sentence is spoken, not only drawn, because the
   lean is a movement and a movement reaches no screen reader. */
const WEIGHT_OUTSIDE =
  'This panel is holding unsaved edits. Click Close to leave; nothing will be written.';
const WEIGHT_ESC =
  'This panel is holding unsaved edits. Press Escape again to leave; nothing will be written.';
/** How long a first Escape stays armed. Long enough to be deliberate, short
    enough that an Escape minutes later is not read as a confirmation. */
const ESC_ARM_MS = 6000;

/* ── the phone form (F9) ─────────────────────────────────────────────────
   639px, not 640: `sheet.css`'s `wide` note already says a 640px viewport
   collapses the sheet to full width, so the bottom form starts one pixel below
   that and the two rules can never both claim the same viewport. */
const PHONE_QUERY = '(max-width: 639px)';

export type Detent = 'peek' | 'half' | 'full';
const DETENTS: readonly Detent[] = ['peek', 'half', 'full'];

function phoneNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return Boolean(window.matchMedia(PHONE_QUERY)?.matches);
}

function useIsPhone(): boolean {
  /* Initialised from the query, not `false`: a sheet mounted already open on a
     phone (a deep link, a restored draft) otherwise paints one frame in the
     desktop form and then jumps to the bottom edge (judge minor 12). */
  const [phone, setPhone] = useState(phoneNow);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(PHONE_QUERY);
    setPhone(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPhone(e.matches);
    // `addListener` is the Safari < 14 spelling; both are kept for the same
    // reason `useReducedMotion` keeps them.
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener?.(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener?.(onChange);
    };
  }, []);
  return phone;
}

export type OverlayShape = 'sheet' | 'panel' | 'popover';

/** Why a dirty surface is leaving: Escape, a click outside, or a spine jump. */
export type LeaveReason = 'esc' | 'outside' | 'spine';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /**
   * The accessible name, ALWAYS — sketch 103 · 1e, "Announced".
   *
   * It is the contract sentence, not a heading: *what it asks, what sealing or
   * saving writes, what leaving costs.* "This asks one thing: confirm the 10
   * bottles that arrived. Sealing writes the count to the book. Leaving writes
   * nothing."
   *
   * Until 2026-09-06 this prop was discarded whenever `title` was set
   * (`aria-label={title ? undefined : label}`), and every one of the sixty live
   * rows carries a title — so the *required* prop reached no ear on any of
   * them, and the requirement made a builder believe the room had a sign
   * (finder B, D1). The name is now the label on every surface and the title is
   * only what the eye reads.
   */
  label: string;
  /**
   * The contract sentence as the reader SEES it — rendered in the header and
   * wired to `aria-describedby`, so the eye and the ear get the same thing.
   *
   * Optional and never fabricated: a surface that does not state its contract
   * gets no `aria-describedby` at all rather than a description invented from
   * its title. An absence is shown as one (ADR 0020).
   */
  contract?: ReactNode;
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
   *
   * Two callers hold letters: the composer (`communications/next/Compose/
   * ComposeSheet.tsx`, sketch 100) and the vendor answers
   * (`orders/next/ResponsesSheet.tsx`) — ADR 0134 fork 13, the founder
   * 2026-09-21: "Stays 640, it's letters (Recommended)". A vendor's reply is a
   * letter the reader reads back — this width's own case, not a third width.
   */
  wide?: boolean;
  /**
   * No enter animation at all — ADR 0134 §4, locked by the founder 2026-09-21.
   *
   * For a surface a person opens from the keyboard, hundreds of times a day:
   * the command palette, Ask AI, Recently viewed and Keyboard shortcuts. The
   * surface is simply there, whatever the motion setting — not the shape's
   * token under full motion and not §6's 120ms fade under reduced motion — and
   * `data-motion` reads `'none'`. Per surface, not per opener: the same
   * surface never answers a mouse and a key differently.
   */
  instant?: boolean;
  /**
   * Paint the scrim — sketch 103 · 1a, "The Pass".
   *
   * **Default: a Sheet dims the page unless it is laid beside the list
   * (`layout="compress"`)**; a Panel dims; a Popover is unchanged (transparent
   * unless `modal`). An explicit `scrim` always wins.
   *
   * Why the Sheet default is tied to `compress` (2026-09-17, pending OD-123): the
   * lane that built 1a turned the Sheet scrim off for EVERY sheet, but the scrim
   * element still catches the click and the body still locks. On the fourteen
   * live Sheet callers — none of which passes `compress`, and no page stylesheet
   * of which answers `data-sheet-open` — that is a fully lit list that cannot be
   * scrolled or clicked, where a click on a visible row closes the sheet and the
   * row click is lost. Whether a scrim-less sheet should leave the page
   * reachable (OD-123, Reading B) or keep it inert (Reading A) is the founder's
   * call. Until then the light goes off only where a page has said its list
   * gives up columns, which is the half of 1a that makes an unlit page honest.
   *
   * This is PAINT, not modality. Focus still moves in and returns, Esc still
   * works, the body still locks, and the page behind is still inert to the
   * pointer — the scrim element is there either way, it is simply not dark.
   */
  scrim?: boolean;
  /**
   * What the page should do with the width a Sheet takes — 1a's other half.
   *
   * The primitive never edits the page: while a Sheet is open it sets
   * `data-sheet-open="overlay|compress"` and `--sheet-width` on every
   * `.mudavym` page root, and the page's own CSS decides whether its list gives
   * up columns. `compress` is the sheet SAYING it is willing to be laid beside
   * the list; a page that has written no rule for it renders exactly as before.
   * `compress` also turns the Sheet's scrim off by default (see `scrim`).
   *
   * On a phone the sheet rests on the bottom edge and takes no width, so the
   * page is told `--sheet-width: 0px` there — a page's `padding-right:
   * var(--sheet-width)` must never pad a 375px screen by 440px.
   * See `components/mudavym/MOTIONS.md`.
   */
  layout?: SheetLayout;
  /**
   * The surface is holding words nobody has written yet — sketch 103 · 1b and
   * 1d, accepted 2026-09-06.
   *
   * With `dirty` set, Esc and a click outside stop destroying work:
   *   · a **Sheet** TEARS — it leaves on `tuck` and calls `onTear`, and the
   *     caller puts a `<Stub>` on the row holding the draft (1b);
   *   · a **Panel** LEANS — the paper has weight, so a stray click cannot lift
   *     it; only Close, or Esc said twice, leaves (1d).
   *
   * A spine jump over a dirty Sheet (1c) is a leave gesture too, and tears the
   * same way, with the reason `'spine'` — before 2026-09-17 it called `onClose`
   * directly and the draft left with no stub (judge probe J2).
   *
   * The caller owns the draft. The primitive owns the ceremony.
   */
  dirty?: boolean;
  /**
   * The surface left with unwritten words in it, and why.
   *
   * Fired at the gesture, before the surface is off the screen, so the caller
   * can put the stub on the row in the same frame. `onClose` still fires — a
   * tear is a close, said honestly.
   */
  onTear?: (reason: LeaveReason) => void;
  /**
   * The word this level puts on the spine (1c) — "Order 118 › Öküzgözü ›
   * Answers". Defaults to `title` when the title is a plain string, then to
   * `eyebrow` when that is, then to the word "Sheet" — never to `label`, which
   * is a contract sentence and would put a paragraph on a breadcrumb. A page
   * that already names its sheets gets a spine for free; a sheet with a
   * composed title should say its word here.
   */
  spine?: string;
  /**
   * The heights this sheet rests at on a phone (F9) — peek · half · full.
   *
   * The grabber appears only when there is more than one, and a TAP on it
   * cycles them: drag-only would fail WCAG 2.2 SC 2.5.7 on the one form where
   * every reader is using a thumb. Arrow keys step it, and a drag snaps to the
   * nearest. `Sheet` only; ignored on the desktop form.
   */
  detents?: readonly Detent[];
  /**
   * The reader may look at this and may not change it — ADR 0112's authority
   * rule, drawn (finder B, D24: none of the sixty live rows draws this state).
   *
   * Given, the action row is replaced by the authority rule's sentence, the
   * owner who can grant it, and — only when the caller supplies one — the route
   * this surface offers instead (double approval, F12 amendment 2). The body is
   * untouched: looking is exactly what is still allowed, and hiding the record
   * would answer a different question from the one being asked.
   */
  denied?: Pick<DeniedProps, 'owner' | 'grant' | 'verb' | 'otherwise'>;
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

/**
 * ADR 0134 §6 (2026-09-21, locked) — the one reduced-motion exception, an
 * ENTRANCE only. Not exported from lib/mudavym/motion.ts and not one of the
 * seven named tokens: minting an eighth token was the rejected alternative
 * (ADR 0134 §1). Disclosed instead, here, and allow-listed by file:line in
 * `scripts/check_motion_tokens.py` citing this ADR section.
 */
const REDUCED_FADE: MotionToken = { easing: 'linear', ms: 120 };
/** Opacity only — nothing here is allowed to move. */
const FADE_ENTER: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

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

/* On a phone the sheet arrives from the bottom edge, not the right one — same
   `tuck`, same 28px, the axis the form actually moves on. */
const ENTER_BOTTOM: Keyframe[] = [
  { transform: 'translateY(28px)', opacity: 0 },
  { transform: 'none', opacity: 1 },
];

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
  contract,
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
  instant = false,
  dirty = false,
  onTear,
  denied,
  spine,
  detents = DETENTS,
  scrim,
  layout = 'overlay',
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
  const contractId = useId();
  const modal = modalProp ?? shape !== 'popover';
  const withClose = showClose ?? modal;
  /* A question dims the page. A Sheet dims it too UNLESS the page has said its
     list gives up columns (`compress`) — the interim reading of 1a while OD-123
     is open; see the `scrim` prop. A popover keeps the behaviour it already
     had — transparent unless it is `modal`. */
  const dimmed =
    scrim ??
    (shape === 'panel' ||
      (shape === 'sheet' && layout !== 'compress') ||
      (shape === 'popover' && modal));

  /* ── the spindle (1c · F9) ──────────────────────────────────────────────
     Only Sheets take a level, and only under a provider — see SheetStack.tsx
     for why the cap is a page fact and not a document one. */
  const {
    present: stackPresent,
    entries: stackEntries,
    cap: stackCap,
    refusal: stackRefusal,
    join: joinStack,
    rename: renameLevel,
    waiting: isWaiting,
    admitted: isAdmitted,
    closeTo: closeStackTo,
  } = useSheetStack();
  const stackId = useId();
  /* Never the label: a contract sentence on a breadcrumb is a paragraph. */
  const spineWord =
    spine ??
    (typeof title === 'string' ? title : typeof eyebrow === 'string' ? eyebrow : 'Sheet');
  const spineWordRef = useRef(spineWord);
  spineWordRef.current = spineWord;
  /* The spine leaves a level by the level's OWN leave path, so a dirty sheet
     tears instead of losing its draft (judge probe J2). Read through a ref: the
     entry is registered once per open, and `leave` is rebuilt as `dirty` moves. */
  const leaveRef = useRef<(reason: LeaveReason) => void>(() => onClose());
  const stacked = stackPresent && shape === 'sheet';
  useLayoutEffect(() => {
    if (!open || !stacked) return;
    return joinStack(stackId, spineWordRef.current, () => leaveRef.current('spine'));
  }, [open, stacked, stackId, joinStack]);
  useLayoutEffect(() => {
    if (open && stacked) renameLevel(stackId, spineWord);
  }, [open, stacked, stackId, spineWord, renameLevel]);

  /* ── who is live, and when ───────────────────────────────────────────────
     A level that is WAITING renders nothing: the refusal sentence goes on the
     top sheet, where the reader is already looking, and the waiting sheet is
     admitted the moment a level is released (SheetStack.tsx).

     A sheet is rendered in the SAME commit it opens unless the spindle is
     already known to be full or it is already known to be waiting. Until
     2026-09-17 every stacked sheet rendered one commit late, so a Sheet and a
     Panel opened in one commit (a deep link, a restored draft) registered
     for Escape and took focus in the wrong order: Escape closed the Sheet
     behind the Panel and focus landed in the Sheet (judge probe J6a, a
     regression of #359's topmost-Escape rule).

     Rendering in the opening commit is optimistic only in the rare case of
     four sheets opening in one commit; so every effect that ACTS — focus, the
     Escape stack, the scroll lock, the page-width hooks, motion — also asks the
     provider's live list, which is correct during the commit, whether this
     sheet holds a level right now (`holdsLevel`). A sheet that turns out to be
     waiting does none of it, and renders nothing on the next commit, before
     the browser paints. */
  const holdsRendered = stackEntries.some((e) => e.id === stackId);
  const shown =
    !stacked ||
    !open ||
    holdsRendered ||
    (!isWaiting(stackId) && stackEntries.length < stackCap);
  const live = open && shown;
  const holdsLevel = useCallback(
    () => !stacked || isAdmitted(stackId),
    [stacked, isAdmitted, stackId],
  );
  const depth = stackEntries.length;
  const isTop = stacked && depth > 0 && stackEntries[depth - 1]?.id === stackId;

  /* ── the phone form (F9) ────────────────────────────────────────────────
     The same three levels, as detented bottom sheets with one breadcrumb. */
  const phone = useIsPhone();
  const bottom = phone && shape === 'sheet';
  /* Keyed on the heights, not the array: a caller that writes
     `detents={['peek', 'half', 'full']}` inline hands over a new array on every
     render, and a page that "keeps its pulse" re-renders constantly — the
     reader's chosen height snapped back to `full` on every tick (judge J9). */
  const restsKey = (detents.length > 0 ? detents : DETENTS).join('|');
  const rests = useMemo(() => restsKey.split('|') as Detent[], [restsKey]);
  const [detent, setDetent] = useState<Detent>(() => rests[rests.length - 1]);
  useEffect(() => {
    // A sheet re-opened should rest where the form says it rests, not where the
    // last reader dragged it.
    if (live) setDetent(rests[rests.length - 1]);
  }, [live, rests]);
  const stepDetent = useCallback(
    (delta: number) => {
      setDetent((current) => {
        const i = rests.indexOf(current);
        const next = Math.min(rests.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta));
        return rests[next];
      });
    },
    [rests],
  );
  const cycleDetent = useCallback(() => {
    setDetent((current) => {
      const i = rests.indexOf(current);
      return rests[(i + 1) % rests.length];
    });
  }, [rests]);
  /* A drag is the gesture people expect; the tap is the one WCAG 2.2 SC 2.5.7
     requires. Both land on the same three heights — up is taller. */
  const dragFrom = useRef<number | null>(null);
  const onGrabDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    dragFrom.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onGrabUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null) return;
    const dy = e.clientY - from;
    if (Math.abs(dy) < 24) {
      cycleDetent();
      return;
    }
    stepDetent(dy < 0 ? 1 : -1);
  };
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

  /* A label that reads like a title is the defect this pass fixed, arriving
     again through the caller. Dev only, once per distinct label, and only while
     the surface is actually open — a warning nobody can trip is a warning that
     lies about coverage. */
  useEffect(() => {
    // Sheets and Panels only: a popover or a menu names a control ("Theme",
    // "Notifications"), and a contract sentence there would be noise.
    if (!live || shape === 'popover' || !holdsLevel()) return;
    warnIfLabelIsATitle(label);
  }, [live, label, shape, holdsLevel]);

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
    if (!live || !holdsLevel()) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (shape === 'popover' && anchorRef?.current && !pos) return;
    // Try each candidate in turn and CONFIRM the move landed before stopping.
    // A candidate that is genuinely hidden in the browser but not by the
    // `hidden` ATTRIBUTE `focusables()` checks — a responsive Tailwind class
    // like `hidden md:block`, invisible to jsdom because no compiled
    // stylesheet is loaded in a unit test — silently no-ops `.focus()`
    // rather than throwing, which used to leave focus on `<body>` with the
    // trap gone entirely. Checking `document.activeElement` after each
    // attempt needs no jsdom-vs-browser branch: jsdom and a real browser
    // agree on whether a `.focus()` call actually moved it.
    const candidates = [
      ...(initialFocusRef?.current ? [initialFocusRef.current] : []),
      ...focusables(panel),
      panel,
    ];
    for (const candidate of candidates) {
      candidate.focus();
      if (document.activeElement === candidate) return;
    }
    // `live`, not `open` (packet 0's spindle): a Sheet waiting for a level
    // renders nothing and must not take focus; one admitted later needs this
    // effect to run again when it becomes live.
  }, [live, holdsLevel, initialFocusRef, shape, anchorRef, pos]);

  useEffect(() => {
    if (!live || !modal || !holdsLevel()) return;
    return lockBodyScroll();
  }, [live, modal, holdsLevel]);

  /* Tell the page a sheet is beside it. Sheets only: a Panel is over the page,
     not next to it, and a Popover belongs to a control that has not moved. */
  useEffect(() => {
    if (!live || shape !== 'sheet' || !holdsLevel()) return;
    // A bottom sheet takes height, not width: the page is told it is there and
    // that it takes 0px, never the desktop form's 440px (judge probe J10).
    return markSheetOpen(layout, bottom ? 0 : wide ? 640 : 440);
  }, [live, shape, layout, wide, bottom, holdsLevel]);

  /* Enter motion. Under full motion `animate()` runs the shape's own token;
     under reduced motion every OTHER motion in this family skips `animate()`
     entirely so nothing is scheduled at all — the entrance is the single
     exception ADR 0134 §6 draws, a 120ms opacity-only cross-fade so an
     arriving surface is not literally invisible to notice. An `instant`
     surface (ADR 0134 §4) schedules nothing in either case. */
  useEffect(() => {
    if (!live || instant || !holdsLevel()) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (reduced) {
      animate(panel, FADE_ENTER, REDUCED_FADE, { respectReducedMotion: false });
      return;
    }
    animate(panel, bottom ? ENTER_BOTTOM : ENTER[shape], TOKEN[shape]);
  }, [live, instant, reduced, shape, bottom, holdsLevel]);

  /* ── the tear (1b) ──────────────────────────────────────────────────────
     A dirty Sheet does not vanish when you press Esc: it leaves on `tuck`, the
     one exit motion this system has, because a tear is something happening TO
     the paper rather than a detour ending. `onTear` fires at the gesture so the
     caller can put the stub on the row in the same frame; `onClose` follows
     when the motion has run. Reduced motion skips straight to the close. */
  const tearing = useRef(false);
  const tearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (tearTimer.current) clearTimeout(tearTimer.current);
    },
    [],
  );

  const tear = useCallback(
    (reason: LeaveReason) => {
      if (tearing.current) return;
      tearing.current = true;
      onTear?.(reason);
      const panel = panelRef.current;
      if (reduced || !panel) {
        tearing.current = false;
        onClose();
        return;
      }
      animate(
        panel,
        [
          { transform: 'none', opacity: 1 },
          // The axis the form moves on: out to the right, or down off a phone.
          { transform: bottom ? 'translateY(28px)' : 'translateX(28px)', opacity: 0 },
        ],
        tuck,
      );
      tearTimer.current = setTimeout(() => {
        tearTimer.current = null;
        tearing.current = false;
        onClose();
      }, tuck.ms);
    },
    [onClose, onTear, reduced, bottom],
  );

  /* The Close control. A tear already in flight has told the caller (`onTear`)
     and scheduled its own `onClose`; clicking Close during the tuck finishes
     that leave NOW rather than starting a second one — before 2026-09-17 it
     fired `onClose` twice, which re-opens a toggle-style caller (judge J3). */
  const closeNow = useCallback(() => {
    if (tearing.current) {
      if (tearTimer.current) clearTimeout(tearTimer.current);
      tearTimer.current = null;
      tearing.current = false;
    }
    onClose();
  }, [onClose]);

  /* ── the lean (1d) ──────────────────────────────────────────────────────
     `settle`, 6px, one lean each way and back. The note lives in a polite live
     region so the ear gets the same fact the eye does. */
  const [weightNote, setWeightNote] = useState<string | null>(null);
  const escArmed = useRef(false);
  const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (escTimer.current) clearTimeout(escTimer.current);
    },
    [],
  );

  const lean = useCallback(
    (note: string) => {
      setWeightNote(note);
      const panel = panelRef.current;
      if (!reduced && panel) {
        animate(
          panel,
          [
            { transform: 'none' },
            { transform: 'translateX(-6px)' },
            { transform: 'translateX(6px)' },
            { transform: 'none' },
          ],
          settle,
        );
      }
    },
    [reduced],
  );

  /** What a leave gesture means on this surface, right now. */
  const leave = useCallback(
    (reason: LeaveReason) => {
      if (dirty && shape === 'sheet') {
        tear(reason);
        return;
      }
      if (dirty && shape === 'panel') {
        // A stray click never lifts this paper. Escape does, said twice.
        if (reason !== 'esc') {
          lean(WEIGHT_OUTSIDE);
          return;
        }
        if (!escArmed.current) {
          escArmed.current = true;
          lean(WEIGHT_ESC);
          if (escTimer.current) clearTimeout(escTimer.current);
          escTimer.current = setTimeout(() => {
            escArmed.current = false;
            setWeightNote(null);
          }, ESC_ARM_MS);
          return;
        }
        escArmed.current = false;
        if (escTimer.current) clearTimeout(escTimer.current);
        onTear?.('esc');
        onClose();
        return;
      }
      onClose();
    },
    [dirty, shape, tear, lean, onTear, onClose],
  );
  leaveRef.current = leave;

  /* This overlay's place in the stack, kept live for as long as it is open.
     `titleId` (from `useId()`, declared above) is a stable per-instance
     identity — nothing here needs a second one.
     Keyed on `live`, not `open`: a Sheet the spindle (SheetStack.tsx) refused
     is open but renders nothing and has no Escape listener, so letting it sit
     on top of this stack would leave the visible top sheet's Escape dead. */
  useEffect(() => {
    if (!live || !holdsLevel()) return;
    openStack.push(titleId);
    return () => {
      const idx = openStack.lastIndexOf(titleId);
      if (idx !== -1) openStack.splice(idx, 1);
    };
  }, [live, holdsLevel, titleId]);

  /* Esc closes, from anywhere — an overlay whose Esc only works while focus is
     inside is an overlay you can get stuck behind. Only the TOPMOST overlay
     acts: every open overlay has its own listener on the same `window`
     target, and without this check one Escape press closed all of them. */
  useEffect(() => {
    if (!live || !holdsLevel()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === titleId) {
        e.stopPropagation();
        leave('esc');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live, holdsLevel, leave, titleId]);

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

  if (!open || !shown || typeof document === 'undefined') return null;

  /* ── the spine, and the cap said out loud (1c) ──────────────────────────
     Only the top level draws it: three spines on three sheets is the stack this
     replaces. Every level before the last is a control — "leave to any one of
     them in a single touch" — and the last is the level you are on. */
  const spineBar =
    isTop && depth > 1 ? (
      <nav className="mdv-ovl__spine" aria-label="Open sheets">
        {stackEntries.map((entry, i) => {
          const last = i === depth - 1;
          return (
            <span key={entry.id} className="mdv-ovl__spine-part">
              {i > 0 ? (
                <span className="mdv-ovl__spine-sep" aria-hidden="true">
                  ›
                </span>
              ) : null}
              {last ? (
                <span className="mdv-ovl__spine-here" aria-current="step">
                  {entry.title}
                </span>
              ) : (
                <button
                  type="button"
                  className="mdv-ovl__spine-back"
                  onClick={() => closeStackTo(i)}
                >
                  {entry.title}
                </button>
              )}
            </span>
          );
        })}
        <span className="mdv-ovl__depth">
          Depth {depth} of {stackCap}
        </span>
      </nav>
    ) : null;

  /* The cap is SPOKEN. A fourth level is not a silent no-op and is not a fourth
     sheet — it is this sentence, on the paper the reader is looking at, with
     the way out named. `assertive` because it is the answer to something the
     reader just did. */
  const refusal =
    isTop && stackRefusal ? (
      <p className="mdv-ovl__refusal" role="alert" aria-live="assertive">
        {stackRefusal}
      </p>
    ) : null;

  /* A caller that passes the same sentence as `label` and `contract` — the
     style the prop notes encourage — would have it announced twice: once as the
     name, once as the description. The visible line stays; the ear hears it
     once. */
  const contractRepeatsLabel =
    typeof contract === 'string' && contract.trim() === label.trim();

  const head =
    eyebrow || title || action || withClose || contract || spineBar || refusal ? (
      <div className="mdv-ovl__head">
        <div className="mdv-ovl__headrow">
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
              <button type="button" className="mdv-ovl__close" onClick={closeNow}>
                {closeLabel}
              </button>
            ) : null}
          </div>
        </div>
        {/* The contract, visible. Same sentence the ear gets, in the mono
            eyebrow's voice so it reads as the surface's own terms rather than
            as body copy. */}
        {contract ? (
          <p className="mdv-ovl__contract" id={contractId}>
            {contract}
          </p>
        ) : null}
        {spineBar}
        {refusal}
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
      data-scrim={dimmed ? 'on' : 'off'}
      data-dirty={dirty ? 'true' : undefined}
      data-denied={denied ? 'true' : undefined}
      data-form={bottom ? 'bottom' : undefined}
      data-detent={bottom ? detent : undefined}
      style={{ zIndex }}
    >
      {/* The scrim is a pointer target. Where the surface draws its own Close
          control, that control and Escape are the named ways out, so the scrim
          is hidden from assistive technology and from the tab order — it used
          to be announced as "Close <the whole contract sentence>", and on a
          dirty Panel it does not close at all, it leans. Where there is no
          Close control (a popover, by default) it stays the named way out, as
          it always was, with the short name a control's label gives it. */}
      {withClose ? (
        <button
          type="button"
          className="mdv-ovl__scrim"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => leave('outside')}
        />
      ) : (
        <button
          type="button"
          aria-label={shape === 'popover' ? `${closeLabel} ${label}` : closeLabel}
          className="mdv-ovl__scrim"
          onClick={() => leave('outside')}
        />
      )}
      <div
        ref={panelRef}
        className={`mdv-ovl__panel${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal={modal ? true : undefined}
        // ALWAYS the label — see the prop's note. `titleId` still exists so the
        // visible heading has a stable id for a caller that wants to point at
        // it; the NAME is never taken from it.
        aria-label={label}
        aria-describedby={contract && !contractRepeatsLabel ? contractId : undefined}
        // ADR 0134 §6: reduced motion renders NO MOVEMENT, not necessarily no
        // frames — an entrance crosses on the disclosed 120ms fade, and
        // `data-motion` says so rather than claiming 'none' for a surface
        // that did, in fact, animate. An `instant` surface (§4) did not, in
        // either setting, and says 'none'.
        data-motion={instant ? 'none' : reduced ? 'fade' : TOKEN_NAME[shape]}
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
        {/* The grabber — only when there is more than one height to move
            between, per F9. A tap cycles, the arrows step, a drag snaps. */}
        {bottom && rests.length > 1 ? (
          <button
            type="button"
            className="mdv-ovl__grab"
            aria-label={`Sheet height — ${detent}. Press to change; use the arrow keys to step.`}
            onPointerDown={onGrabDown}
            onPointerUp={onGrabUp}
            onClick={(e) => {
              // Native keyboard/assistive activation has no pointer sequence.
              // Pointer taps already cycle on release, so do not count twice.
              if (e.detail === 0) cycleDetent();
            }}
            onPointerCancel={() => {
              dragFrom.current = null;
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                stepDetent(1);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                stepDetent(-1);
              }
            }}
          >
            <span className="mdv-ovl__grab-bar" aria-hidden="true" />
          </button>
        ) : null}
        {head}
        <div className={`mdv-ovl__body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
        {/* What the paper is holding. Rendered only on a surface that can be
            dirty, so fifty-nine clean rows do not carry an empty region. */}
        {dirty ? (
          <p className="mdv-ovl__weight" role="status" aria-live="polite">
            {weightNote}
          </p>
        ) : null}
        {/* The action row, or the reason there is not one. Never both: an
            authority the reader does not hold beside a control they cannot use
            is the shape that makes people believe the software is broken. */}
        {denied ? (
          <div className="mdv-ovl__foot">
            <Denied {...denied} />
          </div>
        ) : footer ? (
          <div className="mdv-ovl__foot">{footer}</div>
        ) : null}
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
