/**
 * Route and ground changes that develop instead of cutting (r58 N-13).
 *
 * `runViewTransition` wraps a DOM-changing update in the View Transitions API
 * where it exists and the person has not asked for reduced motion; everywhere
 * else it simply runs the update, so no behaviour depends on the API. Only
 * the update is ever awaited - a transition that is skipped or throws never
 * blocks or loses the navigation.
 *
 * Shared elements: the page body (`mdv-page`, so the sidebar and title bar
 * hold still), the page title (`mdv-title`) and the rail's current-room bar
 * (`mdv-rail-bar`, a real element inside the current link). Only one element
 * may hold a name, so each is moved from the old element to the new one.
 */
import { useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';
import { prefersReducedMotion } from './motion';
import '../../components/mudavym/shell-transitions.css';

type Doc = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> };
};

/**
 * Names are applied only while a transition runs. A permanent
 * `view-transition-name` makes the element a stacking context and a containing
 * block for fixed descendants, which would move every sheet and menu inside
 * the page body.
 */
const SHARED: ReadonlyArray<{ selector: string; name: string }> = [
  { selector: '.mdv-shell__main', name: 'mdv-page' },
  { selector: 'main h1', name: 'mdv-title' },
  { selector: '.mdv-rail__bar', name: 'mdv-rail-bar' },
];

/** Marks an element as a shared element; shell-transitions.css maps `data-vt`
 *  to the view-transition-name of the same value. '' removes the mark. */
const nameOf = (el: Element | null, name: string): void => {
  if (!el) return;
  if (name) el.setAttribute('data-vt', name);
  else el.removeAttribute('data-vt');
};

export function viewTransitionsAvailable(): boolean {
  return typeof document !== 'undefined' && typeof (document as Doc).startViewTransition === 'function';
}

/**
 * Run `update` inside a view transition. `update` must change the DOM
 * synchronously (wrap React state in `flushSync`). `origin` (client x, y)
 * makes the transition a circular reveal from that point - the ground change;
 * a reveal names nothing, so the whole page is one layer under the clip.
 */
export function runViewTransition(
  update: () => void,
  opts: { origin?: { x: number; y: number } } = {},
): void {
  const doc = typeof document !== 'undefined' ? (document as Doc) : null;
  if (!doc || !viewTransitionsAvailable() || prefersReducedMotion()) {
    update();
    return;
  }
  const root = doc.documentElement;
  const shared = opts.origin ? [] : SHARED;
  const olds = shared.map((n) => document.querySelector(n.selector));
  shared.forEach((n, i) => nameOf(olds[i], n.name));
  if (opts.origin) {
    const { x, y } = opts.origin;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    root.style.setProperty('--mdv-reveal-x', `${x}px`);
    root.style.setProperty('--mdv-reveal-y', `${y}px`);
    root.style.setProperty('--mdv-reveal-r', `${Math.ceil(r)}px`);
    root.dataset.mdvReveal = 'circle';
  }
  const clean = () => {
    delete root.dataset.mdvReveal;
    ['--mdv-reveal-x', '--mdv-reveal-y', '--mdv-reveal-r'].forEach((v) => root.style.removeProperty(v));
    SHARED.forEach((n) => document.querySelectorAll(n.selector).forEach((el) => nameOf(el, '')));
  };
  try {
    const t = doc.startViewTransition!(() => {
      update();
      shared.forEach((n, i) => {
        const next = document.querySelector(n.selector);
        if (olds[i] && olds[i] !== next) nameOf(olds[i], '');
        nameOf(next, n.name);
      });
    });
    t.finished.then(clean, clean);
  } catch {
    clean();
    update();
  }
}

/** `navigate`, developed: old page fades out, new one rises in. */
export function useViewTransitionNavigate(): (to: To, options?: NavigateOptions) => void {
  const navigate = useNavigate();
  return useCallback(
    (to, options) => runViewTransition(() => flushSync(() => navigate(to, options))),
    [navigate],
  );
}

/** Is this click one the browser would open in the same tab, unmodified? */
export function isPlainLeftClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
