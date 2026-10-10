/**
 * DoorSeal — the hold-to-seal ceremony, door edition (sig-a lineage).
 *
 * Same family as `HoldToApprove` (components/mudavym), one deliberate
 * difference: past the forgiveness threshold, THE THUMB SEALS EVEN LIFTED
 * EARLY. A receiver at a loading dock has cold, possibly gloved hands and a
 * hand truck in the other one; demanding a full 620ms hold from that thumb
 * would fail the exact person the gesture exists for. Below the threshold an
 * early release still retreats and says exactly what did not happen — the
 * gesture stays deliberate, it just stops being a dexterity test.
 *
 * Motion (083 tokens, lib/mudavym/motion.ts):
 * - fill is `pour` — linear, the operator times it against their own thumb;
 * - release below the threshold retreats on `tuck` ("Released at N% —
 *   nothing saved.");
 * - release past the threshold runs the remaining fill on `settle`, then the
 *   pressed Seal lands on `stamp` — the one motion allowed to overshoot;
 * - keyboard: Enter or Space arms, Enter again seals, Escape disarms;
 *   holding the key down for the hold time seals too, the same timed hold
 *   the thumb makes (F-319);
 * - assistive tech: a screen reader, VoiceOver, TalkBack or voice control
 *   presses with a bare click (no pointer, no key). That click is the same
 *   two-step confirm — first arms, second seals. A thumb or mouse click is
 *   never a confirm: the pointer has to hold;
 * - reduced motion: the timed hold collapses to the same two-step confirm.
 *
 * A disabled seal explains itself on press (`disabledHint`) instead of being
 * silently dead — at the door, a control that ignores a tap reads as broken.
 */

import { CSSProperties, ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Seal } from '@/components/mudavym';
import { animate, pour, sealTiming, settle, stamp, tuck, useReducedMotion } from '@/lib/mudavym';

export interface DoorSealProps {
  /** Called exactly once when the seal lands. */
  onSeal: () => void;
  label?: ReactNode;
  sealedLabel?: ReactNode;
  /** Hold duration. Default: the `pour` token's 620ms. */
  holdMs?: number;
  /** Fraction of the hold past which an early lift still seals. */
  forgiveAt?: number;
  disabled?: boolean;
  /** Spoken (aria-live) and shown when a disabled seal is pressed. */
  disabledHint?: string;
  className?: string;
}

type Phase = 'idle' | 'holding' | 'armed' | 'sealed';

const ARM_WINDOW_MS = 3000;
const NOTE_MS = 2200;

export function DoorSeal({
  onSeal,
  label = 'Hold to seal',
  sealedLabel = 'Sealed',
  holdMs = pour.ms,
  forgiveAt = 0.6,
  disabled = false,
  disabledHint,
  className,
}: DoorSealProps) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState<string | null>(null);

  const fillRef = useRef<HTMLDivElement | null>(null);
  /* The fill drawn for assistive technology: a progressbar beside the button
     (a button's children are presentational, so it cannot live inside). */
  const meterRef = useRef<HTMLSpanElement | null>(null);
  const statusId = useId();
  /** A key is being held down on top of the arm (keyboard hold). */
  const keyHoldRef = useRef(false);
  /** The browser's own click after a key we already handled. */
  const swallowClickRef = useRef(false);
  const sealRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const progressRef = useRef(0);
  const committedRef = useRef(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the two-step confirm armed; a double-tap is not a second decision. */
  const armedAtRef = useRef(0);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setFill = (p: number) => {
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
    meterRef.current?.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    progressRef.current = p;
  };

  const clearTimers = () => {
    cancelAnimationFrame(rafRef.current);
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
  };
  useEffect(() => clearTimers, []);

  const say = (text: string) => {
    setNote(text);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(() => setNote(null), NOTE_MS);
  };

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    clearTimers();
    setFill(1);
    setPhase('sealed');
    onSeal();
  }, [onSeal]);

  // The pressed Seal lands on the stamp spring once its node exists.
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
    armedAtRef.current = Date.now();
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = setTimeout(() => {
      setPhase((p) => (p === 'armed' ? 'idle' : p));
    }, ARM_WINDOW_MS);
  };

  /** Two-step confirm — keyboard path, and pointer path under reduced motion.
      A second press inside the confirm gap is ignored; the seal stays armed. */
  const stepConfirm = () => {
    if (phase !== 'armed') arm();
    else if (Date.now() - armedAtRef.current >= sealTiming.confirmGapMs) commit();
  };

  const startHold = () => {
    setNote(null);
    setPhase('holding');
    startRef.current = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / holdMs);
      setFill(p);
      if (p >= 1) commit();
      else rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  /* The key-held version of the thumb hold. It runs on top of the arm the key
     press already made, so letting go early leaves it armed (the next press
     seals) rather than reporting a release. */
  const startKeyHold = () => {
    keyHoldRef.current = true;
    startRef.current = performance.now();
    const tick = (now: number) => {
      if (!keyHoldRef.current) return;
      const p = Math.min(1, (now - startRef.current) / holdMs);
      setFill(p);
      if (p >= 1) {
        keyHoldRef.current = false;
        commit();
      } else rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const endKeyHold = () => {
    if (!keyHoldRef.current) return;
    keyHoldRef.current = false;
    cancelAnimationFrame(rafRef.current);
    if (!committedRef.current) setFill(0);
  };

  const swallowNextClick = () => {
    swallowClickRef.current = true;
    setTimeout(() => {
      swallowClickRef.current = false;
    }, 0);
  };

  const releaseHold = () => {
    if (committedRef.current || phase !== 'holding') return;
    cancelAnimationFrame(rafRef.current);
    const p = progressRef.current;

    // The door forgiveness: past the threshold the intent was unmistakable —
    // finish the pour for the thumb and seal.
    if (p >= forgiveAt) {
      if (fillRef.current) {
        animate(fillRef.current, [{ transform: `scaleX(${p})` }, { transform: 'scaleX(1)' }], settle);
      }
      commit();
      return;
    }

    setPhase('idle');
    // Honest about what did NOT happen.
    say(`Released at ${Math.round(p * 100)}% — nothing saved.`);
    if (fillRef.current) {
      animate(fillRef.current, [{ transform: `scaleX(${p})` }, { transform: 'scaleX(0)' }], tuck);
    }
    setFill(0);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (committedRef.current) return;
    if (disabled) {
      if (disabledHint) say(disabledHint);
      return;
    }
    if (reduced) {
      stepConfirm();
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is an enhancement (keeps the hold alive when a thumb drifts
      // off the die). A browser or synthetic pointer without it still holds.
    }
    startHold();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (committedRef.current) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      swallowNextClick();
      if (e.repeat) return;
      if (disabled) {
        if (disabledHint) say(disabledHint);
        return;
      }
      const wasArmed = phase === 'armed';
      stepConfirm();
      if (!wasArmed && !reduced) startKeyHold();
    } else if (e.key === 'Escape' && phase === 'armed') {
      // Esc disarms only — it must not travel on and close a Sheet (F-726).
      e.preventDefault();
      e.nativeEvent.stopPropagation();
      endKeyHold();
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      setPhase('idle');
    }
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    // Space presses a button on key-up; that click was this key, not a confirm.
    swallowNextClick();
    endKeyHold();
  };

  /* A bare click with no pointer and no key behind it (`detail === 0`) is how
     a screen reader or voice control presses a button. It takes the same two
     steps as the keyboard, never one. A thumb or mouse click (`detail >= 1`)
     is ignored: the pointer path is the hold. */
  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (swallowClickRef.current) {
      swallowClickRef.current = false;
      return;
    }
    if (e.detail !== 0 || committedRef.current) return;
    if (disabled) {
      if (disabledHint) say(disabledHint);
      return;
    }
    stepConfirm();
  };

  const sealed = phase === 'sealed';
  const armed = phase === 'armed';

  const trackStyle: CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    minHeight: 64, // gloved-thumb sized, comfortably past the 44px floor
    padding: '0 20px',
    borderRadius: 16,
    border: `1px solid ${sealed ? 'var(--seal, #1A5E6B)' : 'var(--seal-ring, rgba(26,94,107,.32))'}`,
    background: sealed ? 'var(--seal-tint, rgba(26,94,107,.10))' : 'var(--paper-1, #F3EFE6)',
    color: 'var(--ink-1, #211C16)',
    fontWeight: 600,
    fontSize: 16,
    cursor: sealed ? 'default' : 'pointer',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    opacity: disabled && !sealed ? 0.55 : 1,
  };

  return (
    <div className={className}>
      <button
        type="button"
        style={trackStyle}
        // Not the `disabled` attribute: a dead control at a door reads as a
        // broken app. It stays pressable and explains itself instead.
        aria-disabled={disabled || sealed}
        aria-label={typeof label === 'string' ? label : 'Hold to seal'}
        aria-describedby={statusId}
        data-ux-key="door:seal"
        onPointerDown={onPointerDown}
        onPointerUp={releaseHold}
        onPointerCancel={releaseHold}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={endKeyHold}
        onClick={onClick}
      >
        {/* fill — the pour under the label */}
        <div
          ref={fillRef}
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--seal, #1A5E6B)',
            opacity: 0.18,
            transform: 'scaleX(0)',
            transformOrigin: '0 50%',
            pointerEvents: 'none',
          }}
        />
        {sealed ? (
          <span ref={sealRef} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Seal size={28} pressed />
            <span style={{ color: 'var(--seal-deep, #14515C)' }}>{sealedLabel}</span>
          </span>
        ) : (
          <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Seal size={22} color="currentColor" />
            {armed ? 'Press again to seal' : label}
          </span>
        )}
      </button>
      <span
        ref={meterRef}
        className="sr-only"
        role="progressbar"
        aria-label="How far the hold has gone"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
      />
      {/* status line — honest, and reserved so nothing jumps */}
      <div
        id={statusId}
        aria-live="polite"
        style={{
          minHeight: 20,
          marginTop: 6,
          fontSize: 12.5,
          textAlign: 'center',
          color: 'var(--ink-4, #665D50)',
        }}
      >
        {note ?? (armed ? 'Press again to seal — Esc cancels.' : '')}
      </div>
    </div>
  );
}

export default DoorSeal;
