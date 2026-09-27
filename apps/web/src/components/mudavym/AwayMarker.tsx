/**
 * The Away marker — a quiet mark on a person's name while they are Away
 * (ADR 0218).
 *
 * The founder, 2026-09-21: *"they set away dates, UI shows a visual update
 * maybe crosslined or I let you design it on its name with explanation."*
 *
 * WHY DIMMED AND NOT CROSSED OUT. A line through a name reads as "removed" —
 * the roster's own language for someone who has left, or a shift that was
 * cancelled. Away is the opposite: the person is still here, just not today.
 * So the name keeps its place and its weight in the row and only its ink
 * lightens, and a small note beside it says when they are back: "Away until
 * 28 Sep". Tapping (or hovering) the note says what Away does, in one
 * sentence, so nobody has to guess why a name went grey.
 *
 * NO MOTION. The mark is a state, not an event; it appears with the row. The
 * explanation opens in place with no animation, so nothing here borrows a
 * token from ADR 0134 and nothing here needs a reduced-motion branch.
 *
 * DATES ONLY. The marker can say when, and never why: nothing else is kept
 * (KVKK — `house_away` has no reason column).
 *
 * Not re-exported from the barrel: it imports a stylesheet, and a CSS import
 * in `index.ts` would ride into every chunk that touches the barrel. Import it
 * by path.
 */

import { useId, useState, type ReactNode } from 'react';
import { awayExplanation, awayState, dayWords, type AwayWindowLike } from './awayWords';
import './away-marker.css';

export interface AwayMarkerProps {
  /** The name exactly as the page already draws it. */
  name: ReactNode;
  /** The person's name as plain words, for the explanation sentence. */
  personLabel?: string;
  /** This person's Away window, or none. */
  window: AwayWindowLike | null | undefined;
  /** Today in the house's time zone, YYYY-MM-DD. */
  today: string;
  /** The reader is the person themselves: the sentence says "you". */
  self?: boolean;
  /** Defaults to the reader's own locale. */
  locale?: string;
  /**
   * False inside a control that is itself a button (a roster row): the note
   * is then plain text with the explanation on hover, because a button inside
   * a button is invalid HTML and reaches no keyboard. The page must then say
   * the sentence somewhere the reader can reach — the roster does, in the
   * expanded row's Away card.
   */
  interactive?: boolean;
}

export function AwayMarker({
  name,
  personLabel,
  window,
  today,
  self,
  locale,
  interactive = true,
}: AwayMarkerProps) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  const state = awayState(window, today);
  if (state === 'none' || !window) return <>{name}</>;

  const note =
    state === 'now'
      ? `Away until ${dayWords(window.until, locale)}`
      : `Away from ${dayWords(window.from, locale)}`;
  const why = awayExplanation(window, { personLabel, self, locale });

  if (!interactive) {
    return (
      <span className="mdv-away" data-away={state}>
        <span className="mdv-away__name">{name}</span>
        <span className="mdv-away__note" title={why}>
          {note}
        </span>
      </span>
    );
  }

  return (
    <span className="mdv-away" data-away={state}>
      <span className="mdv-away__name">{name}</span>
      <button
        type="button"
        className="mdv-away__note"
        aria-expanded={open}
        aria-controls={noteId}
        title={why}
        onClick={(e) => {
          // The marker often sits inside a row that is itself a button.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {note}
      </button>
      {open && (
        <span className="mdv-away__why" id={noteId} role="note">
          {why}
        </span>
      )}
    </span>
  );
}

export default AwayMarker;
