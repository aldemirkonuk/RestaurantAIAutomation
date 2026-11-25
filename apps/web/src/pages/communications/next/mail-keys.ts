/**
 * The Mail tab's keys (r107 mail-gap g3), as pure rules the tab and the nav
 * call: where focus goes for an arrow, and when a bare key is the page's and
 * not the reader's typing. The global bare keys (`?`, `g` then a letter) live in
 * CommandProvider; `/`, `j`, `k` and Escape are free there.
 */

/** A field the reader types in: a bare key there is theirs. */
export function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.tagName !== 'string') return false;
  const tag = node.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    node.isContentEditable === true ||
    node.getAttribute('role') === 'textbox'
  );
}

/** Inside a sheet or dialog (the composer, the intake sheet): its own keys win. */
export function inOverlay(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  return Boolean(node && typeof node.closest === 'function' && node.closest('[role="dialog"], [aria-modal="true"]'));
}

export function hasModifier(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey || e.altKey;
}

/** Down/Up and j/k step one row, Home/End jump; no wrap. null = not ours. */
export function listMove(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  const at = current < 0 ? 0 : current;
  switch (key) {
    case 'ArrowDown':
    case 'j':
      return Math.min(at + 1, count - 1);
    case 'ArrowUp':
    case 'k':
      return Math.max(at - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Left/Right step to the next tab and wrap, Home/End jump. null = not ours. */
export function tabMove(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
