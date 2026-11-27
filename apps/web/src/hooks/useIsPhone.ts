import { useEffect, useState } from 'react';

/** The width below which a page gives up its table for cards (Tailwind's `md`). */
export const PHONE_QUERY = '(max-width: 767px)';

function read(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_QUERY)?.matches === true
    : false;
}

/**
 * Is the window phone-wide, live across rotation and resize? A browser without
 * `matchMedia` (and jsdom) answers false: the desktop layout is the default, so
 * nothing that is not a phone is ever shown a phone's page.
 */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(PHONE_QUERY);
    // A stubbed matchMedia may answer nothing; then the desktop page stands.
    if (!mql) return;
    const onChange = () => setPhone(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return phone;
}
