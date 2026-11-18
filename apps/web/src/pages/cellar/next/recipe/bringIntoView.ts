/** Room below an opened recipe's top edge for its heading and first line, in px. */
export const LEAF_HEAD_ROOM = 160;

/**
 * Scrolls an opened recipe to the top of the screen when its heading would
 * not be seen: above the screen, or below `innerHeight - LEAF_HEAD_ROOM`. A
 * recipe already in view does not move the page. Measured on its top edge,
 * not its height: it is still opening (0 tall) when this runs.
 */
export function bringIntoView(el: HTMLElement | null) {
  if (!el) return;
  const top = el.getBoundingClientRect().top;
  if (top >= 0 && top <= window.innerHeight - LEAF_HEAD_ROOM) return;
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
}
