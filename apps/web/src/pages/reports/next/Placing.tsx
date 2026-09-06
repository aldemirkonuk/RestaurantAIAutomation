/**
 * The grip, and the placing bar — the two controls that make a cutting movable
 * without a pointer, and movable without a drag.
 *
 * They are two answers to two different criteria, and the difference matters:
 *
 *  - **The grip** answers WCAG 2.1.1 (keyboard). It is a real, focusable,
 *    named button rather than a `tabIndex` on the panel, which is react-aria's
 *    "drag affordance" and the exact thing Grafana's dashboard — same grid
 *    library — is recorded as lacking (grafana#79627: panels carry
 *    `tabIndex="0"` with no accessible name and cannot be moved from a
 *    keyboard). Space or Enter picks up; arrows move; Shift+arrows resize.
 *
 *  - **The placing bar** answers WCAG 2.2 SC 2.5.7 Dragging Movements, which
 *    is a SEPARATE criterion: *"All functionality that uses a dragging movement
 *    for operation can be achieved by a single pointer without dragging."* Its
 *    Understanding document states that keyboard equivalence and pointer
 *    operability "are evaluated independently", so the arrow keys alone would
 *    not satisfy it — a person who can click but cannot hold-and-drag needs
 *    buttons. Every keystroke below therefore also exists as a button, which is
 *    the W3C's own listed sufficient technique ("up/down buttons to reorder").
 *
 * Neither is decoration on the other: remove the bar and a switch-user loses
 * the canvas; remove the keys and every move costs four clicks.
 */

import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Move, Undo2 } from 'lucide-react';
import type { ArrangeApi } from './rp-arrange';
import { ARRANGE_KEY_HELP } from './rp-arrange';
import type { AnalysisId } from './rp-sheet';

/** The id of the one instructions node every grip points at. */
export const ARRANGE_HELP_ID = 'rp-arrange-help';

/**
 * The instructions a screen reader reads when a grip takes focus. One node for
 * the whole sheet — repeating it per cutting would read the same paragraph
 * eleven times on the way down the page.
 */
export function ArrangeHelp() {
  return (
    <p id={ARRANGE_HELP_ID} className="rp-cap rp-arrange__help">
      Or reach a cutting with the keyboard: Tab to its Move grip, then Space to pick it up.{' '}
      {ARRANGE_KEY_HELP} Every one of those is also a button, so nothing here needs a drag.
    </p>
  );
}

export interface GripProps {
  id: AnalysisId;
  title: string;
  arrange: ArrangeApi;
}

/**
 * The handle. `aria-pressed` carries the mode, so a screen reader says "Move
 * The reading, pressed" while it is held — the state is on the control the
 * user is standing on, not only in the live region.
 */
export function Grip({ id, title, arrange }: GripProps) {
  const held = arrange.picked === id;
  const ref = useRef<HTMLButtonElement | null>(null);

  /* A cutting moved to the foot of a long sheet takes its grip with it, and a
     focused control that has left the viewport is a keyboard user losing the
     page. `nearest` never scrolls when it is already visible. */
  useEffect(() => {
    if (!held) return;
    // Feature-checked rather than assumed: jsdom has no `scrollIntoView`, and
    // neither do some embedded webviews. Keeping the cutting movable matters
    // more than keeping it in view.
    const el = ref.current;
    if (el && typeof el.scrollIntoView === 'function')
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [held, arrange.message]);

  return (
    <button
      ref={ref}
      type="button"
      className="rp-grip rp-ink rp-focus rp-no-drag"
      aria-pressed={held}
      aria-describedby={ARRANGE_HELP_ID}
      onClick={() => (held ? arrange.place() : arrange.pickUp(id, title))}
      onKeyDown={arrange.keyDown(id, title)}
    >
      <Move size={13} strokeWidth={1.6} aria-hidden />
      {held ? `Placing ${title}` : `Move ${title}`}
    </button>
  );
}

function Step({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="rp-step rp-ink rp-focus rp-no-drag"
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export interface PlacingBarProps {
  title: string;
  arrange: ArrangeApi;
}

/**
 * The single-pointer path. Eight steps, a place and a put-back — the same ten
 * outcomes the keys produce, and no others, so the two paths cannot drift into
 * offering different things.
 */
export function PlacingBar({ title, arrange }: PlacingBarProps) {
  return (
    <div className="rp-placing rp-no-drag" role="group" aria-label={`Placing ${title}`}>
      <div className="rp-placing__set" role="group" aria-label="Move">
        <span className="rp-eyebrow">Move</span>
        <Step label={`Move ${title} left one column`} onClick={() => arrange.nudge(-1, 0)}>
          <ArrowLeft size={13} strokeWidth={1.6} aria-hidden />
        </Step>
        <Step label={`Move ${title} down one row`} onClick={() => arrange.nudge(0, 1)}>
          <ArrowDown size={13} strokeWidth={1.6} aria-hidden />
        </Step>
        <Step label={`Move ${title} up one row`} onClick={() => arrange.nudge(0, -1)}>
          <ArrowUp size={13} strokeWidth={1.6} aria-hidden />
        </Step>
        <Step label={`Move ${title} right one column`} onClick={() => arrange.nudge(1, 0)}>
          <ArrowRight size={13} strokeWidth={1.6} aria-hidden />
        </Step>
      </div>

      <div className="rp-placing__set" role="group" aria-label="Size">
        <span className="rp-eyebrow">Size</span>
        <Step label={`Make ${title} one column narrower`} onClick={() => arrange.resize(-1, 0)}>
          Narrower
        </Step>
        <Step label={`Make ${title} one column wider`} onClick={() => arrange.resize(1, 0)}>
          Wider
        </Step>
        <Step label={`Make ${title} one row shorter`} onClick={() => arrange.resize(0, -1)}>
          Shorter
        </Step>
        <Step label={`Make ${title} one row taller`} onClick={() => arrange.resize(0, 1)}>
          Taller
        </Step>
      </div>

      <div className="rp-placing__set" role="group" aria-label="Finish">
        <button
          type="button"
          className="rp-step rp-ink rp-focus rp-no-drag"
          data-strong="true"
          onClick={() => arrange.place()}
        >
          <Check size={13} strokeWidth={1.6} aria-hidden />
          Place it
        </button>
        <button
          type="button"
          className="rp-step rp-ink rp-focus rp-no-drag"
          onClick={() => arrange.cancel()}
        >
          <Undo2 size={13} strokeWidth={1.6} aria-hidden />
          Put it back
        </button>
      </div>
    </div>
  );
}

/**
 * The live region. One node for the sheet, `assertive` on purpose: the reader
 * pressed a key and is waiting for the answer, and a polite queue behind a
 * rapid run of arrow presses arrives after the cutting has already moved three
 * more times. Both dnd-kit and React Flow made the same call for the same
 * reason. `aria-atomic` so a shortened sentence is never read as a fragment of
 * the last one.
 */
export function ArrangeAnnouncer({ message }: { message: string }) {
  return (
    <div className="rp-sr-only" role="status" aria-live="assertive" aria-atomic="true">
      {message}
    </div>
  );
}
