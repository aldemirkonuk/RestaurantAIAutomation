/**
 * True when pointer events should NOT start Framer Motion Reorder / similar list drags.
 */
export function isInteractiveReorderSurfaceTarget(el: Element | EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const sel =
    [
      'button',
      'a',
      'input',
      'textarea',
      'select',
      'option',
      '[role="button"]',
      '[role="slider"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="tab"]',
      '[role="spinbutton"]',
      '[role="switch"]',
      '[contenteditable="true"]',
      '.no-dashboard-reorder',
    ].join(',')
  return Boolean(el.closest(sel))
}
