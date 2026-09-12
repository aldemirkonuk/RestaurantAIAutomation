import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The ground a Mudavym control stands on — and only when it has to choose one.
 *
 * The sealed dies carry `.mudavym` on their root so the seal's tokens resolve
 * wherever they are dropped. Since ADR 0138 that selector paints Warm Charcoal
 * in EVERY app theme, which is right on a rebuilt page and wrong on the legacy
 * one. The legacy `/orders` follows the user's theme — `styles/globals.css`
 * repaints its Tailwind utilities wholesale under `.dark` — so a control that
 * is unconditionally charcoal became a dark slab with cream ink on a light
 * page. That is the failure `SealedApproveDie`'s own header records, inverted,
 * and it breaks ADR 0042's flag-off-is-byte-identical promise on a screen every
 * house can reach: `mudavym_design_orders` has a row for one restaurant.
 *
 * The rule, in one line: **if a page has already decided, inherit; if nothing
 * has, follow the theme the surrounding page is actually painting.**
 *
 *   nested (a `.mudavym` ancestor exists)  -> `undefined`, no attribute, inherit
 *   standalone, `html.light`               -> `paper`
 *   standalone, `html.dark`                -> `charcoal`
 *
 * Measured from the DOM rather than taken as a prop, because one component
 * renders in both places — `pages/Orders.tsx` (legacy) and
 * `pages/dashboard/next/WaitingOnYou.tsx` + `pages/orders/next/ResponsesSheet.tsx`
 * (inside a charcoal page) — and no caller should have to remember which it is.
 *
 * `useLayoutEffect` runs before paint, so there is no flash of the wrong ground.
 * Until the measurement lands the hook returns `undefined`: a nested die must
 * never stamp a ground its page did not ask for, and inheriting is the safe
 * direction to be wrong in for exactly one frame.
 *
 * The theme is read from `<html>`'s class rather than from `useTheme()`, on
 * purpose. That class is what `ThemeContext` writes (`ThemeContext.tsx:75-76`)
 * and, more to the point, it is what `styles/globals.css` keys its wholesale
 * repaint of the legacy page on — so this reads the same signal the page
 * itself obeys, instead of a parallel one that could disagree. It also keeps a
 * shared control from requiring a provider its callers may not have.
 */
export function useStandaloneGround(): {
  rootRef: React.RefObject<HTMLDivElement>;
  ground: 'paper' | 'charcoal' | undefined;
} {
  const rootRef = useRef<HTMLDivElement>(null);
  const [ground, setGround] = useState<'paper' | 'charcoal' | undefined>(undefined);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    // `parentElement.closest` and not `el.closest` — the root carries the class
    // itself, so asking from the element would always answer "nested".
    const nested = !!el.parentElement?.closest('.mudavym');
    const dark = document.documentElement.classList.contains('dark');
    const next = nested ? undefined : dark ? 'charcoal' : 'paper';
    setGround((prev) => (prev === next ? prev : next));
  });

  return { rootRef, ground };
}
