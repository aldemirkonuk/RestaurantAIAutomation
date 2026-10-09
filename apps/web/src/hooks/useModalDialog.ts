/**
 * The dialog behaviour the older hand-built modals were missing (F-321): a
 * screen reader was never told a modal had opened, Escape did nothing, focus
 * stayed behind on the page, and Tab walked out into the table underneath.
 *
 * Put the returned ref on the modal's panel, alongside `role="dialog"`,
 * `aria-modal="true"`, `tabIndex={-1}` and a label. While `open`:
 * - focus moves onto the panel, and goes back where it came from on close;
 * - Escape calls `onClose` (only when the key was pressed inside this panel,
 *   or on nothing at all, so a modal opened from inside it closes first);
 * - Tab and Shift+Tab wrap inside the panel.
 *
 * New overlays should use the Mudavym `Sheet`, which does all of this already.
 */

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalDialog<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    ref.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      const panel = ref.current;
      if (!panel) return;
      const target = e.target as Node | null;
      if (target && target !== document.body && !panel.contains(target)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (returnTo && returnTo.isConnected) returnTo.focus();
    };
  }, [open]);

  return ref;
}
