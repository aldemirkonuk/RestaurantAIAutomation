/**
 * Hold-to-approve — the press→seal interaction from sketch 063 `sig-hero`,
 * as a production control. One deliberate gesture replaces a confirm dialog,
 * and nothing fires on release short of the full hold.
 *
 * Motion (059 tokens, lib/mudavym/motion.ts):
 * - the fill is `pour` — deliberately linear, because the operator is timing
 *   it against their own thumb;
 * - an early release retreats on `tuck` and says exactly what did not happen
 *   ("Released at N% — nothing sent");
 * - completion lands the pressed Seal on `stamp`, the one motion in the
 *   system allowed to overshoot, then calls `onApprove` (exactly once).
 *
 * Paths:
 * - Pointer: press and hold for `holdMs`.
 * - Keyboard: Enter arms it ("Enter again to approve"), Enter again within
 *   3s approves; Escape or the timeout disarms.
 * - Reduced motion: the timed hold collapses to the same two-step confirm as
 *   the keyboard path — press once to arm, press again to approve, instantly.
 */

import { CSSProperties, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { animate, pour, stamp, tuck, useReducedMotion } from '../../lib/mudavym/motion';
import { Seal } from './Seal';

export interface HoldToApproveProps {
  /**
   * Called exactly once when the hold completes (or the confirm is given).
   *
   * Receives the challenge token when `onChallenge` supplied one, so a caller
   * that needs a PROVABLE seal can pass it straight to the write. Callers that
   * do not use `onChallenge` keep the `() => void` shape and get `null`.
   */
  onApprove: (challenge?: string | null) => void;
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
  /** Hold duration in ms. Default: the `pour` token's 620. */
  holdMs?: number;
  disabled?: boolean;
  className?: string;
}

type Phase = 'idle' | 'holding' | 'armed' | 'sealed';

const ARM_WINDOW_MS = 3000;
const RELEASE_NOTE_MS = 1800;

export function HoldToApprove({
  onApprove,
  onChallenge,
  label = 'Hold to approve',
  approvedLabel = 'Approved',
  holdMs = pour.ms,
  disabled = false,
  className,
}: HoldToApproveProps) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [releaseNote, setReleaseNote] = useState<string | null>(null);

  const fillRef = useRef<HTMLDivElement | null>(null);
  const sealRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const holdStartRef = useRef(0);
  const progressRef = useRef(0);
  const committedRef = useRef(false);
  /** The in-flight mint, started when the gesture began. */
  const challengeRef = useRef<Promise<string | null> | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setFill = (p: number) => {
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
    progressRef.current = p;
  };

  const clearTimers = () => {
    cancelAnimationFrame(rafRef.current);
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
  };
  useEffect(() => clearTimers, []);

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    clearTimers();

    // No proof was asked for: the original behaviour, unchanged.
    if (!challengeRef.current) {
      setFill(1);
      setPhase('sealed');
      onApprove(null);
      return;
    }

    const pending = challengeRef.current;
    challengeRef.current = null;
    void pending
      .then((token) => {
        if (!token) throw new Error('no seal');
        setFill(1);
        setPhase('sealed');
        onApprove(token);
      })
      .catch(() => {
        // Not sealed, and said so. The gesture completed and the approval did
        // not — which is a different sentence from "released early", because
        // the operator did nothing wrong.
        committedRef.current = false;
        setFill(0);
        setPhase('idle');
        setReleaseNote('The seal could not be issued — nothing sent.');
        if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
        noteTimerRef.current = setTimeout(() => setReleaseNote(null), RELEASE_NOTE_MS);
      });
  }, [onApprove]);

  /** Begin minting the proof, once per gesture. */
  const beginChallenge = useCallback(() => {
    if (!onChallenge || challengeRef.current) return;
    challengeRef.current = Promise.resolve()
      .then(() => onChallenge())
      .catch(() => null);
  }, [onChallenge]);

  // The seal lands on the stamp spring once its node exists.
  useEffect(() => {
    if (phase === 'sealed' && sealRef.current) {
      animate(
        sealRef.current,
        [
          { transform: 'scale(0.8)', opacity: 0.3 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        stamp,
      );
    }
  }, [phase]);

  const arm = () => {
    beginChallenge();
    setPhase('armed');
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = setTimeout(() => {
      setPhase((p) => (p === 'armed' ? 'idle' : p));
    }, ARM_WINDOW_MS);
  };

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
    if (fillRef.current) {
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
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      setPhase('idle');
    }
  };

  const sealed = phase === 'sealed';
  const armed = phase === 'armed';

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
    cursor: disabled || sealed ? 'default' : 'pointer',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    opacity: disabled ? 0.5 : 1,
  };

  return (
    <div className={className}>
      <button
        type="button"
        style={trackStyle}
        disabled={disabled || sealed}
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
            {armed ? 'Enter again to approve' : label}
          </span>
        )}
      </button>
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
        {releaseNote ?? (armed ? 'Press Enter again to approve — Esc cancels.' : '')}
      </div>
    </div>
  );
}

export default HoldToApprove;
