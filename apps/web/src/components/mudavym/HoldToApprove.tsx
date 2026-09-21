/**
 * Hold-to-approve — the press→seal interaction from sketch 087 `sig-hero`,
 * as a production control. One deliberate gesture replaces a confirm dialog,
 * and nothing fires on release short of the full hold.
 *
 * Motion (083 tokens, lib/mudavym/motion.ts):
 * - the fill is `pour` — deliberately linear, because the operator is timing
 *   it against their own thumb;
 * - an early release retreats on `tuck` and says exactly what did not happen
 *   ("Released at N% — nothing sent");
 * - completion lands the pressed Seal on `stamp`, the one motion in the
 *   system allowed to overshoot, then calls `onApprove` (exactly once).
 *
 * Paths:
 * - Pointer: press and hold for `holdMs`.
 * - Keyboard: Enter arms it ("Enter again to approve"), Enter again approves;
 *   Escape, a pointerdown outside the control, or the sheet it is mounted in
 *   closing (page-owned) disarms. No timer — ADR 0134 rule 5, locked
 *   2026-09-21 ("Until Esc or click away"): a fixed auto-disarm is itself a
 *   timed gesture WCAG 2.2.1 Timing Adjustable (Level A) requires a way to
 *   turn off, extend or adjust, so the control simply carries no timer to
 *   need one.
 * - Reduced motion: the timed hold collapses to the same two-step confirm as
 *   the keyboard path — press once to arm, press again to approve, instantly.
 */

import { CSSProperties, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { animate, ink, pour, stamp, tuck, useReducedMotion } from '../../lib/mudavym/motion';
import { Seal } from './Seal';
/* `.mdv-bound` lives in the overlay stylesheet with the rest of the house
   content vocabulary; the control is mounted inside a Sheet or a Panel most of
   the time, but not always (dashboard's OneTapPanel mounts it inline), so it
   carries its own import rather than assuming an overlay above it. */
import './sheet.css';

export interface HoldToApproveProps {
  /**
   * Called exactly once when the hold completes (or the confirm is given).
   *
   * Receives the challenge token when `onChallenge` supplied one, so a caller
   * that needs a PROVABLE seal can pass it straight to the write. Callers that
   * do not use `onChallenge` keep the `() => void` shape and get `null`.
   * Return the write promise for asynchronous work: the success receipt waits
   * for it to resolve, and a rejection never stamps the seal.
   */
  onApprove: (challenge?: string | null) => void | Promise<unknown>;
  /**
   * Mint the proof, at the moment the hold BEGINS.
   *
   * The seal on an MCP tool write is redeemed rather than asserted (founder,
   * 2026-09-04; ADR 0107 addendum): the gateway issues a one-time token bound
   * to the actor, the connection, the tool and the arguments, and the write has
   * to carry it back. That only means anything if the token is minted when the
   * gesture STARTS — a token fetched at the moment of approval would be one
   * more thing the same request asked for itself, which is the assertion model
   * with extra steps.
   *
   * If it resolves null or throws, the hold does NOT approve: the control says
   * the seal could not be issued and nothing is sent. Silently approving
   * without a token would be the one failure this whole mechanism exists to
   * prevent, arriving through the UI instead of the API.
   */
  onChallenge?: () => Promise<string | null>;
  /** Face of the control, e.g. the amount being approved. */
  label?: ReactNode;
  /** Shown next to the seal once approved. */
  approvedLabel?: ReactNode;
  /**
   * What the seal bound — sketch 103 · 1d, accepted 2026-09-06.
   *
   * "Hold it, and read back exactly what was bound." Rendered under the seal
   * once the hold completes, headed "What the seal bound". This closes finder
   * B's D17: every drawn footer in the census covers FAILURE, and nothing said
   * what happens on success.
   *
   * It is the caller's own words — the amount, the payee, the rows summed —
   * because only the caller knows what the write actually contained. The
   * primitive supplies the ceremony and the heading, never the figures.
   */
  boundSummary?: ReactNode;
  /**
   * Called after the seal lands, with the summary it bound.
   *
   * Separate from `onApprove` on purpose: `onApprove` is the WRITE, and it runs
   * before anything is read back. `onSealed` is the receipt — it is what a
   * ledger line, a trail row or a toast is written from, and it carries the
   * same `boundSummary` the reader can see, so the two cannot drift.
   */
  onSealed?: (bound: { summary: ReactNode; challenge: string | null }) => void;
  /** Hold duration in ms. Default: the `pour` token's 620. */
  holdMs?: number;
  /**
   * How long a returned write may stay unsettled before the control stops
   * waiting and says the outcome could not be confirmed. Omitted, it waits for
   * as long as the write takes — the behaviour every caller had before
   * 2026-09-17. A write that settles AFTER the wait is still honoured: a
   * success seals (it is now confirmed, and a re-send would duplicate it)
   * unless a newer gesture has already committed its own write, and a failure
   * leaves the "could not be confirmed" line where it is.
   *
   * Whether a hold should time out by default is the founder's call (A-fix
   * open question); until then this is opt-in.
   */
  confirmTimeoutMs?: number;
  /**
   * The words the control uses around the act, for a hold that is not an
   * approval — "Confirming the send…", "The deletion could not be confirmed.
   * Check the record before trying again." Each key falls back to the approval
   * wording below.
   */
  copy?: Partial<HoldCopy>;
  disabled?: boolean;
  className?: string;
}

export interface HoldCopy {
  /** Face of the control while armed by keyboard or reduced motion. */
  armed: string;
  /** Status line while armed. */
  armedHint: string;
  /** Face of the control while the write is awaited. */
  pending: string;
  /** Status line when the write failed or could not be confirmed in time. */
  unconfirmed: string;
}

const APPROVAL_COPY: HoldCopy = {
  armed: 'Enter again to approve',
  armedHint: 'Press Enter again to approve — Esc or clicking elsewhere cancels.',
  pending: 'Confirming approval…',
  unconfirmed: 'Approval could not be confirmed. Check the record before trying again.',
};

type Phase = 'idle' | 'holding' | 'armed' | 'pending' | 'sealed';

const RELEASE_NOTE_MS = 1800;

export function HoldToApprove({
  onApprove,
  onChallenge,
  label = 'Hold to approve',
  approvedLabel = 'Approved',
  boundSummary,
  onSealed,
  holdMs = pour.ms,
  confirmTimeoutMs,
  copy: copyProp,
  disabled = false,
  className,
}: HoldToApproveProps) {
  const copy: HoldCopy = { ...APPROVAL_COPY, ...copyProp };
  /* Read inside `commit` through a ref, like `boundSummary`: a caller's inline
     `copy={{…}}` is a new object every render and must not rebuild `commit`. */
  const unconfirmedRef = useRef(copy.unconfirmed);
  unconfirmedRef.current = copy.unconfirmed;
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [releaseNote, setReleaseNote] = useState<string | null>(null);
  const [sealedSummary, setSealedSummary] = useState<ReactNode>();

  const fillRef = useRef<HTMLDivElement | null>(null);
  const sealRef = useRef<HTMLDivElement | null>(null);
  const boundRef = useRef<HTMLDivElement | null>(null);
  /* `boundSummary` is usually a freshly-created element on every render; read
     it through a ref so `commit` is not rebuilt each time and the seal cannot
     fire twice for one gesture. */
  const boundSummaryRef = useRef<ReactNode>(boundSummary);
  boundSummaryRef.current = boundSummary;
  const rafRef = useRef(0);
  const holdStartRef = useRef(0);
  const progressRef = useRef(0);
  const committedRef = useRef(false);
  /** The in-flight mint, started when the gesture began. */
  const challengeRef = useRef<Promise<string | null> | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Which gesture a settling write belongs to — a late answer to an older
      gesture must never stamp over a newer one. */
  const attemptRef = useRef(0);

  const setFill = (p: number) => {
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
    progressRef.current = p;
  };

  const clearTimers = () => {
    cancelAnimationFrame(rafRef.current);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = null;
  };
  useEffect(() => clearTimers, []);

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    clearTimers();

    setFill(1);
    setPhase('pending');
    setReleaseNote(null);
    const attempt = ++attemptRef.current;
    /* Still this gesture's to answer: no newer gesture has begun. */
    const current = () => attemptRef.current === attempt;
    // Capture the description when the action is committed, before a parent
    // render can replace it while the write is awaiting confirmation.
    const summary = boundSummaryRef.current;
    let timedOut = false;
    const refuse = (message: string) => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
      committedRef.current = false;
      setFill(0);
      setPhase('idle');
      setReleaseNote(message);
    };
    const writeFailed = () => {
      // After a timeout the line already says the outcome is unconfirmed; a
      // late failure changes nothing the reader has not been told.
      if (timedOut || !current()) return;
      refuse(unconfirmedRef.current);
    };
    const approve = (challenge: string | null) => {
      const seal = () => {
        // A late confirmation after the wait ran out is still the truth, and
        // stamping it is what stops the reader re-sending a write that landed —
        // unless a newer gesture has already committed a write of its own.
        if (!current()) return;
        clearTimers();
        committedRef.current = true;
        setFill(1);
        setReleaseNote(null);
        setSealedSummary(summary);
        setPhase('sealed');
        onSealed?.({ summary, challenge });
      };
      let result: void | Promise<unknown>;
      try {
        result = onApprove(challenge);
      } catch {
        writeFailed();
        return;
      }
      if (result && typeof result.then === 'function') {
        if (confirmTimeoutMs !== undefined) {
          confirmTimerRef.current = setTimeout(() => {
            confirmTimerRef.current = null;
            if (!current()) return;
            refuse(unconfirmedRef.current);
            timedOut = true;
          }, confirmTimeoutMs);
        }
        // Use the rejection branch rather than catch: an error in a receipt
        // callback is not evidence that an already confirmed write failed.
        void result.then(seal, writeFailed);
      } else {
        seal();
      }
    };

    if (!challengeRef.current) {
      approve(null);
      return;
    }
    const pending = challengeRef.current;
    challengeRef.current = null;
    void pending.then((token) => {
      if (token) approve(token);
      else refuse('The seal could not be issued — nothing sent.');
    }, () => refuse('The seal could not be issued — nothing sent.'));
  }, [onApprove, onSealed, confirmTimeoutMs]);

  /** Begin minting the proof, once per gesture. */
  const beginChallenge = useCallback(() => {
    if (!onChallenge || challengeRef.current) return;
    challengeRef.current = Promise.resolve()
      .then(() => onChallenge())
      .catch(() => null);
  }, [onChallenge]);

  /* The read-back arrives on `ink` — a micro-state under a control that has
     not moved. Under reduced motion it is simply there, which is the end state
     and not a shorter version of it. */
  useEffect(() => {
    if (phase !== 'sealed' || reduced || !boundRef.current) return;
    animate(boundRef.current, [{ opacity: 0 }, { opacity: 1 }], ink);
  }, [phase, reduced]);

  // The seal lands on the stamp spring once its node exists. Under reduced
  // motion nothing is scheduled at all — not a stamp collapsed to zero.
  useEffect(() => {
    if (phase === 'sealed' && sealRef.current && !reduced) {
      animate(
        sealRef.current,
        [
          { transform: 'scale(0.8)', opacity: 0.3 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        stamp,
      );
    }
  }, [phase, reduced]);

  const arm = () => {
    beginChallenge();
    // A failure line from the last attempt must not hide the armed hint: the
    // reader is being told what the next key press does (judge probe J4).
    setReleaseNote(null);
    setPhase('armed');
  };

  /* Disarm on Escape or a pointer landing outside the control. ADR 0134 rule
     5, locked 2026-09-21 ("Until Esc or click away"): `arm()` above sets no
     timer, so these are how an armed-but-abandoned control returns to idle.
     - Escape is read on the document, not only by `onKeyDown`: a pointer arm
       under reduced motion leaves focus wherever it was (Safari does not
       focus a clicked button), and a reader who tabbed away still pressed Esc.
     - The pointerdown listener runs in the CAPTURE phase, so an outside
       element that stops propagation cannot keep the control armed. A
       pointerdown ON the button is excluded (`contains`), so this never
       races the same press that confirms it.
     - A sheet this control is mounted inside disarms it on close: `Sheet`
       renders null when closed, the control unmounts, and these listeners
       go with it. */
  useEffect(() => {
    if (phase !== 'armed') return;
    const disarmOutside = (e: PointerEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setPhase((p) => (p === 'armed' ? 'idle' : p));
      }
    };
    const disarmOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPhase((p) => (p === 'armed' ? 'idle' : p));
    };
    document.addEventListener('pointerdown', disarmOutside, true);
    document.addEventListener('keydown', disarmOnEscape);
    return () => {
      document.removeEventListener('pointerdown', disarmOutside, true);
      document.removeEventListener('keydown', disarmOnEscape);
    };
  }, [phase]);

  /** Two-step confirm — keyboard path, and pointer path under reduced motion. */
  const stepConfirm = () => {
    if (phase === 'armed') commit();
    else arm();
  };

  const startHold = () => {
    beginChallenge();
    setReleaseNote(null);
    setPhase('holding');
    holdStartRef.current = performance.now();
    if (fillRef.current) fillRef.current.style.transition = 'none';
    const tick = (now: number) => {
      const p = Math.min(1, (now - holdStartRef.current) / holdMs);
      setFill(p);
      if (p >= 1) commit();
      else rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const releaseHold = () => {
    if (committedRef.current || phase !== 'holding') return;
    cancelAnimationFrame(rafRef.current);
    const p = progressRef.current;
    // The gesture ended without approval, so the seal it began is abandoned.
    // It expires on the server; nothing here spends it.
    challengeRef.current = null;
    setPhase('idle');
    // Honest about what did NOT happen.
    setReleaseNote(`Released at ${Math.round(p * 100)}% — nothing sent.`);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(() => setReleaseNote(null), RELEASE_NOTE_MS);
    // Retreat on tuck (the rubber-band home).
    if (fillRef.current && !reduced) {
      animate(fillRef.current, [{ transform: `scaleX(${p})` }, { transform: 'scaleX(0)' }], tuck);
    }
    setFill(0);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || committedRef.current) return;
    if (reduced) {
      stepConfirm();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    startHold();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || committedRef.current) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // suppress the synthesized click
      if (!e.repeat) stepConfirm();
    } else if (e.key === 'Escape' && phase === 'armed') {
      setPhase('idle');
    }
  };

  const sealed = phase === 'sealed';
  const pending = phase === 'pending';
  const armed = phase === 'armed';

  /* Pending and sealed are NOT `disabled`: a focused button that becomes
     disabled drops focus to <body> in browsers that apply the focus-fixup rule,
     which walks the reader out of an overlay's focus trap mid-confirmation.
     `aria-disabled` says the same thing to assistive technology, and every
     handler already refuses while `committedRef` holds. The caller's own
     `disabled` stays a real `disabled`. */
  const inert = sealed || pending;

  const trackStyle: CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    minHeight: 48,
    padding: '0 16px',
    borderRadius: 12,
    border: `1px solid ${sealed ? 'var(--seal, #1A5E6B)' : 'var(--seal-ring, rgba(26,94,107,.32))'}`,
    background: sealed ? 'var(--seal-tint, rgba(26,94,107,.10))' : 'var(--paper-1, #F3EFE6)',
    color: 'var(--ink-1, #211C16)',
    fontWeight: 600,
    fontSize: 14,
    cursor: disabled || sealed || pending ? 'default' : 'pointer',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    opacity: disabled ? 0.5 : 1,
  };

  return (
    <div className={className}>
      <button
        ref={buttonRef}
        type="button"
        style={trackStyle}
        disabled={disabled}
        aria-disabled={inert || undefined}
        aria-busy={pending}
        aria-label={typeof label === 'string' ? label : 'Hold to approve'}
        onPointerDown={onPointerDown}
        onPointerUp={releaseHold}
        onPointerCancel={releaseHold}
        onKeyDown={onKeyDown}
      >
        {/* fill — İznik pouring in under the label */}
        <div
          ref={fillRef}
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--seal, #1A5E6B)',
            opacity: 0.16,
            transform: 'scaleX(0)',
            transformOrigin: '0 50%',
            pointerEvents: 'none',
          }}
        />
        {sealed ? (
          <span ref={sealRef} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Seal size={24} pressed />
            <span style={{ color: 'var(--seal-deep, #14515C)' }}>{approvedLabel}</span>
          </span>
        ) : (
          <span style={{ position: 'relative' }}>
            {pending ? copy.pending : armed ? copy.armed : label}
          </span>
        )}
      </button>
      {/* What the seal bound (1d). Only after the wax lands, and only when the
          caller gave something to read back — a heading over nothing would be
          a receipt for a write nobody described. */}
      {sealed && sealedSummary ? (
        <div ref={boundRef} className="mdv-bound" role="status" aria-live="polite">
          <span className="mdv-bound__head">What the seal bound</span>
          <div className="mdv-bound__body">{sealedSummary}</div>
        </div>
      ) : null}
      {/* status line — honest, and reserved so nothing jumps */}
      <div
        aria-live="polite"
        style={{
          minHeight: 18,
          marginTop: 4,
          fontSize: 11.5,
          textAlign: 'center',
          color: 'var(--ink-3, #7C7365)',
        }}
      >
        {releaseNote ?? (armed ? copy.armedHint : '')}
      </div>
    </div>
  );
}

export default HoldToApprove;
