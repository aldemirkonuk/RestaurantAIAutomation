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
import { useSheetStack } from './SheetStack';
import { Denied, type DeniedProps } from './Denied';
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

/* ── the page gives up width, not light ───────────────────────────────────
   Sketch 103 · 1a, "The Pass": on a floor at service the operator is not
   reading, they are watching, and a scrim takes the whole page away to show one
   record. So a Sheet paints no scrim by default and instead tells the page it
   is there: `data-sheet-open` and `--sheet-width` land on every `.mudavym` page
   root (never on the overlay's own root) for the page's own CSS to answer with
   a compressed list.

   Counted, like the scroll lock, and last-opened wins the width — two sheets
   are the spindle (1c), and the page compresses to whichever one is on top. */
type SheetLayout = 'overlay' | 'compress';
interface OpenSheet {
  id: symbol;
  layout: SheetLayout;
  width: number;
}
const openSheets: OpenSheet[] = [];

function pageRoots(): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<HTMLElement>('.mudavym')).filter(
    (el) => !el.classList.contains('mdv-ovl') && !el.closest('.mdv-ovl'),
  );
}

function paintSheetWidth(): void {
  const top = openSheets[openSheets.length - 1];
  for (const root of pageRoots()) {
    if (!top) {
      root.removeAttribute('data-sheet-open');
      root.style.removeProperty('--sheet-width');
      continue;
    }
    root.setAttribute('data-sheet-open', top.layout);
    root.style.setProperty('--sheet-width', `${top.width}px`);
  }
}

function markSheetOpen(layout: SheetLayout, width: number): () => void {
  const entry: OpenSheet = { id: Symbol('mdv-sheet'), layout, width };
  openSheets.push(entry);
  paintSheetWidth();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const i = openSheets.findIndex((e) => e.id === entry.id);
    if (i >= 0) openSheets.splice(i, 1);
    paintSheetWidth();
  };
}

/** Test seam: forget every open sheet (a test that unmounts mid-render). */
export function resetSheetWidth(): void {
  openSheets.length = 0;
  paintSheetWidth();
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

/* ── the label check ──────────────────────────────────────────────────────
   `label` is the contract sentence (what it asks · what it writes · what
   leaving costs). Four words is the floor at which a sentence can carry three
   clauses; below it the caller has passed a title. Dev only — this is a nudge
   at the person writing the surface, never a runtime behaviour. */
const LABEL_MIN_WORDS = 4;
const warned = new Set<string>();

/** Exported for the test; resets the once-per-label memo. */
export function resetLabelWarnings(): void {
  warned.clear();
}

function warnIfLabelIsATitle(label: string): void {
  if (!import.meta.env?.DEV) return;
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length >= LABEL_MIN_WORDS) return;
  if (warned.has(label)) return;
  warned.add(label);
  // eslint-disable-next-line no-console
  console.warn(
    `[mudavym overlay] label "${label}" reads like a title (${words.length} ` +
      `word${words.length === 1 ? '' : 's'}). The label IS the accessible name and ` +
      'should be the contract sentence: what it asks, what sealing or saving ' +
      'writes, what leaving costs. Put the heading in `title` instead.',
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

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
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
   */
  wide?: boolean;
  /**
   * Paint the scrim — sketch 103 · 1a, "The Pass".
   *
   * **Default `false` for a Sheet** (changed 2026-09-06) and `true` for a
   * Panel; a Popover is unchanged (transparent unless `modal`). A sheet is one
   * record arriving beside a list that is still moving; a panel is a question,
   * and a question dims the page because nothing else matters until it is
   * answered.
   *
   * This is PAINT, not modality. Focus still moves in and returns, Esc still
   * works, the body still locks, and the page behind is still inert to the
   * pointer wherever the census row is modal — the scrim element is there, it
   * is simply not dark. Turning the light back on is `scrim`.
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
  onTear?: (reason: 'esc' | 'outside') => void;
  /**
   * The word this level puts on the spine (1c) — "Order 118 › Öküzgözü ›
   * Answers". Defaults to `title` when the title is a plain string, and to
   * `label` otherwise, so a page that already names its sheets gets a spine for
   * free and only a sheet with a composed title has to say anything.
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
   * Given, the action row is replaced by the sentence naming who can grant it.
   * The body is untouched: looking is exactly what is still allowed, and hiding
   * the record would answer a different question from the one being asked.
   */
  denied?: Pick<DeniedProps, 'who' | 'grant' | 'verb'>;
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
  /* A sheet takes width, never light (1a); a question dims the page. A popover
     keeps the behaviour it already had — transparent unless it is `modal`. */
  const dimmed = scrim ?? (shape === 'panel' || (shape === 'popover' && modal));

  /* ── the spindle (1c · F9) ──────────────────────────────────────────────
     Only Sheets take a level, and only under a provider — see SheetStack.tsx
     for why the cap is a page fact and not a document one. */
  const stack = useSheetStack();
  const stackId = useId();
  const spineWord = spine ?? (typeof title === 'string' ? title : label);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stacked = stack.present && shape === 'sheet';
  useLayoutEffect(() => {
    if (!open || !stacked) return;
    return stack.join(stackId, spineWord, () => onCloseRef.current());
    // `stack.join` is stable; `stack` itself is a new object on every depth
    // change, and depending on it would make each sheet re-join whenever a
    // sibling opened — which is how a stack turns into a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stacked, stackId, spineWord, stack.join]);

  /* Refused levels render NOTHING: the sentence goes on the top sheet, where
     the reader is already looking. `shown` therefore gates every open-dependent
     effect below — without it a sheet admitted on the second commit would never
     get its focus move, because the effect's deps had not changed. */
  const shown = !stacked || !open || stack.holds(stackId);
  const live = open && shown;
  const depth = stack.entries.length;
  const isTop = stacked && depth > 0 && stack.entries[depth - 1]?.id === stackId;

  /* ── the phone form (F9) ────────────────────────────────────────────────
     The same three levels, as detented bottom sheets with one breadcrumb. */
  const phone = useIsPhone();
  const bottom = phone && shape === 'sheet';
  const rests = detents.length > 0 ? detents : DETENTS;
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
    if (!live) return;
    warnIfLabelIsATitle(label);
  }, [live, label]);

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
    if (!live) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (shape === 'popover' && anchorRef?.current && !pos) return;
    const target = initialFocusRef?.current ?? focusables(panel)[0] ?? panel;
    target.focus();
  }, [live, initialFocusRef, shape, anchorRef, pos]);

  useEffect(() => {
    if (!live || !modal) return;
    return lockBodyScroll();
  }, [live, modal]);

  /* Tell the page a sheet is beside it. Sheets only: a Panel is over the page,
     not next to it, and a Popover belongs to a control that has not moved. */
  useEffect(() => {
    if (!live || shape !== 'sheet') return;
    return markSheetOpen(layout, wide ? 640 : 440);
  }, [live, shape, layout, wide]);

  /* Enter motion. `animate()` collapses to the end state under reduced motion;
     we skip it entirely so nothing is scheduled at all. */
  useEffect(() => {
    if (!live || reduced) return;
    const panel = panelRef.current;
    if (!panel) return;
    animate(panel, phone && shape === 'sheet' ? ENTER_BOTTOM : ENTER[shape], TOKEN[shape]);
  }, [live, reduced, shape, phone]);

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
    (reason: 'esc' | 'outside') => {
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
          { transform: 'translateX(28px)', opacity: 0 },
        ],
        tuck,
      );
      tearTimer.current = setTimeout(() => {
        tearing.current = false;
        onClose();
      }, tuck.ms);
    },
    [onClose, onTear, reduced],
  );

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
    (reason: 'esc' | 'outside') => {
      if (dirty && shape === 'sheet') {
        tear(reason);
        return;
      }
      if (dirty && shape === 'panel') {
        // A stray click never lifts this paper. Escape does, said twice.
        if (reason === 'outside') {
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

  /* Esc closes, from anywhere — an overlay whose Esc only works while focus is
     inside is an overlay you can get stuck behind. */
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        leave('esc');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live, leave]);

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
        {stack.entries.map((entry, i) => {
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
                  onClick={() => stack.closeTo(i)}
                >
                  {entry.title}
                </button>
              )}
            </span>
          );
        })}
        <span className="mdv-ovl__depth">
          Depth {depth} of {stack.cap}
        </span>
      </nav>
    ) : null;

  /* The cap is SPOKEN. A fourth level is not a silent no-op and is not a fourth
     sheet — it is this sentence, on the paper the reader is looking at, with
     the way out named. `assertive` because it is the answer to something the
     reader just did. */
  const refusal =
    isTop && stack.refusal ? (
      <p className="mdv-ovl__refusal" role="alert" aria-live="assertive">
        {stack.refusal}
      </p>
    ) : null;

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
              <button type="button" className="mdv-ovl__close" onClick={onClose}>
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
      <button
        type="button"
        aria-label={`Close ${label}`}
        className="mdv-ovl__scrim"
        onClick={() => leave('outside')}
      />
      <div
        ref={panelRef}
        className={`mdv-ovl__panel${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal={modal ? true : undefined}
        // ALWAYS the label — see the prop's note. `titleId` still exists so the
        // visible heading has a stable id for a caller that wants to point at
        // it; the NAME is never taken from it.
        aria-label={label}
        aria-describedby={contract ? contractId : undefined}
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
        {/* The grabber — only when there is more than one height to move
            between, per F9. A tap cycles, the arrows step, a drag snaps. */}
        {bottom && rests.length > 1 ? (
          <button
            type="button"
            className="mdv-ovl__grab"
            aria-label={`Sheet height — ${detent}. Press to change; use the arrow keys to step.`}
            onPointerDown={onGrabDown}
            onPointerUp={onGrabUp}
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
