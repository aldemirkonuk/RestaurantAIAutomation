/**
 * The Mail tab's few motions, all quiet (MOTIONS.md, ADR 0112): an opacity
 * step of 160 ms ("ink") and a 320 ms settle for the one moment a test letter
 * proves the address. Nothing slides, pulses or changes size; a row that
 * arrives never moves the rows already there. Reduced motion: no animation at
 * all, and a leaving thing is gone at once.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export const INK_MS = 160;
export const SETTLE_MS = 320;
export const STAGGER_MS = 24;
export const STAGGER_CAP = 6;

export const MAIL_MOTION_CSS = `
  @keyframes mail-fade-in { from { opacity: 0 } to { opacity: 1 } }
  @keyframes mail-fade-out { from { opacity: 1 } to { opacity: 0 } }
  @keyframes mail-ink-step { from { color: var(--ink-3, #7C7365) } }
  .mail-fade-in { animation: mail-fade-in ${INK_MS}ms ease-out both }
  .mail-fade-out { animation: mail-fade-out ${INK_MS}ms ease-out both; pointer-events: none }
  .mail-arrive { animation: mail-fade-in ${SETTLE_MS}ms ease-out both, mail-ink-step ${INK_MS}ms ease-out both }
  @media (prefers-reduced-motion: reduce) {
    .mail-fade-in, .mail-fade-out, .mail-arrive { animation: none !important }
  }
`;

/** One style block per surface; the rules are identical, so a second copy is harmless. */
export function MailMotionStyles() {
  return <style data-testid="mail-motion-css">{MAIL_MOTION_CSS}</style>;
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Keys that arrived after the list was first drawn (or after `resetKey`
 * changed, which is a different list rather than more of the same one). Each
 * maps to its place among the new ones, so rows can be delayed a step apiece.
 * Nothing enters while the list is not `ready` (still reading, or showing the
 * previous list as a placeholder): the first ready list is the baseline.
 */
export function useEnteringKeys(keys: string[], resetKey: string, ready: boolean): Map<string, number> {
  const seen = useRef<Set<string> | null>(null);
  const lastReset = useRef(resetKey);
  const [entering, setEntering] = useState<Map<string, number>>(() => new Map());
  const joined = keys.join('\u0000');
  useLayoutEffect(() => {
    if (lastReset.current !== resetKey) {
      lastReset.current = resetKey;
      seen.current = null;
      setEntering((m) => (m.size === 0 ? m : new Map()));
    }
    if (!ready) return;
    if (seen.current === null) {
      seen.current = new Set(keys);
      return;
    }
    const fresh = keys.filter((k) => !seen.current!.has(k));
    if (fresh.length === 0) return;
    fresh.forEach((k) => seen.current!.add(k));
    setEntering((m) => {
      const next = new Map(m);
      fresh.forEach((k, i) => next.set(k, i));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, resetKey, ready]);
  return entering;
}

/** The inline style of an entering row: a 24 ms step apiece, batched after six. */
export function enterDelay(place: number): { animationDelay: string } {
  return { animationDelay: `${Math.min(place, STAGGER_CAP) * STAGGER_MS}ms` };
}

/**
 * Keeps what it wrapped on screen for one ink step after `show` turns false,
 * fading, then takes it out (so the space is given back on the next render, and
 * nothing animates a size). Reduced motion: gone at once.
 */
export function FadeAway({ show, block, children }: { show: boolean; block?: boolean; children: ReactNode }) {
  const last = useRef<ReactNode>(children);
  if (show) last.current = children;
  const [leaving, setLeaving] = useState(false);
  const was = useRef(show);
  useLayoutEffect(() => {
    if (show) {
      setLeaving(false);
    } else if (was.current && !prefersReducedMotion()) {
      setLeaving(true);
      const t = setTimeout(() => setLeaving(false), INK_MS);
      was.current = show;
      return () => clearTimeout(t);
    }
    was.current = show;
  }, [show]);
  if (show) return <>{children}</>;
  if (!leaving) return null;
  return (
    <span className="mail-fade-out" aria-hidden="true" data-testid="fading-away" style={{ display: block ? 'block' : 'inline-flex' }}>
      {last.current}
    </span>
  );
}
