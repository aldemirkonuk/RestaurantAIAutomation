/**
 * The error boundary's screen inside the shell (sketch 119, "the shared
 * pieces"): "the boundary under the shell — a second ErrorBoundary around
 * the outlet; the outer one at App.tsx stays for the shell itself; one copy
 * of the stale-chunk match." The boundary itself was already built (pass 1,
 * `HouseShell.tsx`'s inner `<ErrorBoundary key={pathname}>`); this is its
 * fallback — a house-styled screen, not `ErrorBoundary`'s own generic one —
 * passed as a render-function `fallback` so the class stays the one place
 * that categorises an error and matches a stale deploy chunk.
 *
 * The outer boundary (App.tsx) is untouched: if the SHELL itself throws —
 * the header, the rail, the counter — there is no chrome left standing to
 * render this inside, so its own plain screen is what a person sees. This
 * screen is only ever for a PAGE that crashed with the shell still up.
 */

import { AlertTriangle, Lock, RefreshCw, Server, WifiOff } from 'lucide-react';
import type { ErrorBoundaryFallbackInfo } from '../ErrorBoundary';

const ICON_FOR = {
  network: WifiOff,
  auth: Lock,
  server: Server,
  unknown: AlertTriangle,
} as const;

const COPY_FOR = {
  network: {
    eyebrow: 'network',
    headline: 'This page could not reach the house.',
    body: 'The rest of the shell still works — the rooms, the counter, the search — only this page did not load.',
  },
  auth: {
    eyebrow: 'session',
    headline: 'Your session may have run out.',
    body: 'Sign in again and the rooms, the counter and this page will pick up where they left off.',
  },
  server: {
    eyebrow: 'server',
    headline: 'The house answered with an error.',
    body: 'This has been recorded. The rest of the shell still works — try again, or move to another room.',
  },
  unknown: {
    eyebrow: 'error',
    headline: 'This page ran into a problem.',
    body: 'The rest of the shell still works — the rooms, the counter, the search. Try again, or move to another room.',
  },
} as const;

export function HouseErrorScreen({ error, errorCategory, retry, reset }: ErrorBoundaryFallbackInfo) {
  const Icon = ICON_FOR[errorCategory];
  const copy = COPY_FOR[errorCategory];

  return (
    <div className="mdv-errscreen mudavym" role="alert">
      <Icon className="mdv-errscreen__icon" aria-hidden />
      <p className="mdv-errscreen__eyebrow">{copy.eyebrow}</p>
      <h2 className="mdv-errscreen__headline">{copy.headline}</h2>
      <p className="mdv-errscreen__body">{copy.body}</p>
      {error && <p className="mdv-errscreen__detail">{error.message}</p>}
      <div className="mdv-errscreen__actions">
        <button type="button" className="mdv-errscreen__retry" onClick={retry}>
          <RefreshCw size={14} aria-hidden />
          Try again
        </button>
        <button type="button" className="mdv-link" onClick={reset}>
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}

export default HouseErrorScreen;
