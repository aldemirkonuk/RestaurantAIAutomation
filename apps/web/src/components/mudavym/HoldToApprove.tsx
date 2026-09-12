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
  /** Called exactly once when the hold completes (or the confirm is given). */
  onApprove: () => void;
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
    setFill(1);
    setPhase('sealed');
    onApprove();
  }, [onApprove]);

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
