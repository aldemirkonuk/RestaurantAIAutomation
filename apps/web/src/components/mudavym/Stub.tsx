/**
 * The stub — sketch 103 · 1b, "The Stub", accepted by the founder 2026-09-06.
 *
 * "Nothing in a kitchen is thrown away because someone walked past it." Esc on
 * a dirty Sheet does not destroy the draft: the sheet TEARS (`Sheet`'s `dirty`
 * + `onTear`) and this stub stays on the row, holding the unwritten words, with
 * two ways out in words — Resume, or Discard.
 *
 * WHO OWNS WHAT
 * -------------
 * The caller owns the draft: it keeps the text, decides where the stub sits,
 * and re-opens the sheet from `onResume`. The primitive owns the ceremony —
 * the wording, the ten-second window and the honesty of what has already
 * happened. That split is deliberate: a stub that owned the draft would be a
 * second store for the same words.
 *
 * UNDO-AFTER, NOT ARE-YOU-SURE (ADR 0112 · F10)
 * ---------------------------------------------
 * A note is reversible; a ledger row is not. Discarding an unwritten note is
 * squarely on F10's closed list, so the act FIRES — `onDiscard` is called at
 * the click — and the way back is offered for ten seconds afterwards. It is
 * never a confirmation dialog, because a confirmation on something reversible
 * is a tax on the ninety-nine people who meant it.
 *
 * The undo is drawn only when the caller passed `onRestore`. An undo control
 * that cannot restore anything is an absence reported as health (ADR 0020), so
 * a caller that cannot put the words back gets no button offering to.
 */

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { animate, ink, useReducedMotion } from '../../lib/mudavym/motion';
import './sheet.css';

export interface StubProps {
  /** The unwritten words, exactly as the reader left them. */
  words?: ReactNode;
  /** Re-open the sheet on this row with the draft in it. */
  onResume: () => void;
  /** Throw the draft away. Fired at the click — see the file header. */
  onDiscard: () => void;
  /**
   * Put a discarded draft back. Omit it and no undo is offered at all, rather
   * than a button that cannot honour itself.
   */
  onRestore?: () => void;
  /** How long the way back stays open. Default 10s (F10's "a few seconds"). */
  undoSeconds?: number;
  /** Provenance — when it was held, and by whom. */
  footer?: ReactNode;
  /** Words on the resume control. Default "Resume". */
  resumeLabel?: string;
  /** Words on the discard control. Default "Discard". */
  discardLabel?: string;
  className?: string;
}

type StubState = 'held' | 'discarded' | 'gone';

export function Stub({
  words,
  onResume,
  onDiscard,
  onRestore,
  undoSeconds = 10,
  footer,
  resumeLabel = 'Resume',
  discardLabel = 'Discard',
  className,
}: StubProps) {
  const reduced = useReducedMotion();
  const [state, setState] = useState<StubState>('held');
  const [left, setLeft] = useState(undoSeconds);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTicking = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  };
  useEffect(() => stopTicking, []);

  /* The stub arrives on `ink` — it is a micro-state on a row that has not
     moved, not an overlay opening. Reduced motion renders it in place. */
  useEffect(() => {
    if (reduced || state !== 'held') return;
    const el = rootRef.current;
    if (!el) return;
    animate(el, [{ opacity: 0 }, { opacity: 1 }], ink);
  }, [reduced, state]);

  const discard = useCallback(() => {
    onDiscard();
    if (!onRestore) {
      setState('gone');
      return;
    }
    setState('discarded');
    setLeft(undoSeconds);
    stopTicking();
    tickRef.current = setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          stopTicking();
          setState('gone');
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  }, [onDiscard, onRestore, undoSeconds]);

  const restore = useCallback(() => {
    stopTicking();
    onRestore?.();
    setState('held');
  }, [onRestore]);

  if (state === 'gone') return null;

  if (state === 'discarded') {
    return (
      <div
        ref={rootRef}
        className={`mdv-stub${className ? ` ${className}` : ''}`}
        data-state="discarded"
        role="status"
        aria-live="polite"
      >
        <span className="mdv-stub__eyebrow">Discarded · nothing was written</span>
        <p className="mdv-stub__note">
          The words are gone from the row. {left} second{left === 1 ? '' : 's'} to put them back.
        </p>
        <div className="mdv-stub__acts">
          <button type="button" className="mdv-btn" onClick={restore}>
            Put it back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`mdv-stub${className ? ` ${className}` : ''}`}
      data-state="held"
      role="group"
      aria-label="Held here · unwritten"
    >
      <span className="mdv-stub__eyebrow">Held here · unwritten</span>
      {words ? <p className="mdv-stub__words">“{words}”</p> : null}
      <div className="mdv-stub__acts">
        <button type="button" className="mdv-btn" onClick={onResume}>
          {resumeLabel}
        </button>
        <button type="button" className="mdv-btn" onClick={discard}>
          {discardLabel}
        </button>
      </div>
      {footer ? <p className="mdv-stub__foot">{footer}</p> : null}
    </div>
  );
}

export default Stub;
