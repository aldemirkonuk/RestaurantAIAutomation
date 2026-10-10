/**
 * The page boundary for a route with no house shell around it — the door,
 * the vendor portal, get-started, studio and authorize (F-735). Without it a
 * crash there reached only App.tsx's outermost boundary: the legacy
 * full-screen card, a "Dashboard" button for a visitor who has none, and the
 * component stack under "Show Technical Details".
 *
 * Same boundary as HouseShell's (one categorisation, one stale-chunk match),
 * the house error screen in its `standalone` words, and reset by any
 * navigation so a link to the same page clears the error (F-734's rule).
 */

import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ErrorBoundary } from '../ErrorBoundary';
import { HouseErrorScreen } from './HouseErrorScreen';
import './house-shell.css';

export function PageBoundary({ children, showHome = true }: { children: ReactNode; showHome?: boolean }) {
  const { key } = useLocation();
  return (
    <ErrorBoundary
      resetKey={key}
      fallback={(info) => <HouseErrorScreen {...info} standalone showHome={showHome} />}
    >
      {children}
    </ErrorBoundary>
  );
}

export default PageBoundary;
