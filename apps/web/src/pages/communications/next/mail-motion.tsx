/** The Mail tab's few motions (MOTIONS.md, ADR 0112): opacity and one colour step only; reduced motion draws end states. */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const INK_MS = 160;
const SETTLE_MS = 320;
const STAGGER_MS = 24;
const STAGGER_CAP = 6;

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

export function MailMotionStyles() {
  return <style>{MAIL_MOTION_CSS}</style>;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Keys that arrived after the first ready list (a new `resetKey` is a different list); value = place among the new. */
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
  }, [joined, resetKey, ready]);
  return entering;
}

export function enterDelay(place: number): { animationDelay: string } {
  return { animationDelay: `${Math.min(place, STAGGER_CAP) * STAGGER_MS}ms` };
}

/** Keeps its children one ink step after `show` turns false, fading; no size animates. Reduced motion: gone at once. */
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
