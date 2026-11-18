/**
 * A new page opens at its top (r58 N-02): /house arrived at scrollY 224
 * because the previous page's offset carried over. Only a forward navigation
 * to a DIFFERENT path resets; Back/Forward (POP) keeps the browser's own
 * restoration, and a same-path change (a query or hash) is left alone.
 */
import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

export function ScrollToTop() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current !== pathname && type !== 'POP') window.scrollTo(0, 0);
    previous.current = pathname;
  }, [pathname, type]);
  return null;
}
