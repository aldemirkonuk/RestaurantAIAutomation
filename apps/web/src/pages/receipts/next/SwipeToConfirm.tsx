/**
 * SwipeToConfirm — the receipts ceremony the founder named ("a swipe-up
 * confirm motion is likely living here"). A deliberate gesture with real
 * travel: drag the handle UP through the track; releasing early settles
 * back (tuck), completing the travel fires onConfirm once.
 *
 * Keyboard and reduced-motion path: focus the handle and HOLD Space or
 * Enter — progress fills over the pour duration (620ms, un-eased, the same
 * honesty rule as every countdown: linear, no theatrical easing). Letting
 * go early resets. Screen readers get the control as a button whose label
 * says exactly what completing it asserts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { pour, tuck, useReducedMotion } from '../../../lib/mudavym/motion';
import { MONO, SANS } from './rc2-format';

const TRAVEL = 96; // px of upward drag that constitutes the gesture

interface Props {
  label: string;
  /** What completing the gesture asserts — read to screen readers too. */
  assertion: string;
  disabled?: boolean;
  onConfirm: () => void;
}

export function SwipeToConfirm({ label, assertion, disabled = false, onConfirm }: Props) {
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(0); // 0..1
  const [settling, setSettling] = useState(false);
  const doneRef = useRef(false);
  const startY = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const holdStart = useRef(0);

  const complete = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setProgress(1);
    onConfirm();
  }, [onConfirm]);

  const reset = useCallback(() => {
    startY.current = null;
    if (!doneRef.current) {
      setSettling(true);
      setProgress(0);
    }
  }, []);

  // pointer path
  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || doneRef.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSettling(false);
    startY.current = e.clientY;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current === null || doneRef.current) return;
    const p = Math.min(Math.max((startY.current - e.clientY) / TRAVEL, 0), 1);
    setProgress(p);
    if (p >= 1) complete();
  };
  const onPointerUp = () => {
    if (doneRef.current) return;
    reset();
  };

  // keyboard hold path — linear fill, per the un-eased countdown rule
  const stopHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.cancelAnimationFrame(holdTimer.current);
      holdTimer.current = null;
    }
    if (!doneRef.current) reset();
  }, [reset]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || doneRef.current) return;
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (holdTimer.current !== null) return; // already holding
    setSettling(false);
    holdStart.current = performance.now();
    const tick = () => {
      const p = Math.min((performance.now() - holdStart.current) / pour.ms, 1);
      setProgress(p);
      if (p >= 1) {
        holdTimer.current = null;
        complete();
        return;
      }
      holdTimer.current = window.requestAnimationFrame(tick);
    };
    holdTimer.current = window.requestAnimationFrame(tick);
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') stopHold();
  };
  useEffect(() => () => stopHold(), [stopHold]);

  const done = doneRef.current;

  return (
    <div style={{ fontFamily: SANS }}>
      <div
        style={{
          position: 'relative',
          height: TRAVEL + 44,
          width: 76,
          margin: '0 auto',
          borderRadius: 38,
          background: 'var(--paper-1, #F3EFE6)',
          border: '1px solid var(--paper-2, #EAE4D8)',
          overflow: 'hidden',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {/* fill rises with the gesture */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: `${Math.round(progress * 100)}%`,
            background: done ? 'var(--seal, #1A5E6B)' : 'var(--seal-tint, rgba(26,94,107,.10))',
            transition: settling && !reduced ? `height ${tuck.ms}ms ${tuck.easing}` : 'none',
          }}
        />
        <button
          type="button"
          role="button"
          aria-label={`${label}. ${assertion} Hold Space or drag up to complete.`}
          disabled={disabled || done}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          // A consent hold must not complete undeliberately: losing focus
          // mid-hold (click away, Alt-Tab) cancels like a lifted key
          // (opus-honesty BLOCKER 2 / receipts-audit D3).
          onBlur={stopHold}
          style={{
            position: 'absolute',
            left: '50%',
            bottom: done ? TRAVEL : progress * TRAVEL,
            transform: 'translateX(-50%)',
            width: 60,
            height: 40,
            borderRadius: 20,
            border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
            background: done ? 'var(--seal, #1A5E6B)' : 'var(--paper-0, #FAF7F1)',
            color: done ? 'var(--paper-0, #FAF7F1)' : 'var(--seal-deep, #14515C)',
            cursor: disabled || done ? 'default' : 'grab',
            touchAction: 'none',
            transition: settling && !reduced ? `bottom ${tuck.ms}ms ${tuck.easing}` : 'none',
            fontFamily: MONO,
            fontSize: 15,
          }}
        >
          {done ? '✓' : '↑'}
        </button>
      </div>
      <p
        style={{
          textAlign: 'center',
          fontFamily: MONO,
          fontSize: 9.5,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: done ? 'var(--seal-deep, #14515C)' : 'var(--ink-3, #7C7365)',
          margin: '6px 0 0',
        }}
      >
        {/* The gesture completing is NOT the verification succeeding — the
            control never claims "Verified"; on success the document leaves
            the queue, and on failure the parent remounts this control fresh
            (receipts-audit.md, BLOCKER 2). */}
        {done ? 'Confirming…' : label}
      </p>
      <p style={{ textAlign: 'center', fontSize: 10.5, color: 'var(--ink-3, #7C7365)', margin: '2px 0 0', maxWidth: 220, marginLeft: 'auto', marginRight: 'auto' }}>
        {assertion}
      </p>
    </div>
  );
}
