/**
 * The page loader — sketch 119, "the shared pieces": "the loader ladder."
 * Mounted as the ONE Suspense fallback in App.tsx (a lazy route chunk still
 * loading), gated like every other shell chrome piece.
 *
 * A ladder, not an instant spinner: the shell's frame (sidebar and title bar)
 * paints at once and fades in over 160ms; the word "Reading…" appears only
 * past 800ms, in an aria-live status; and only past 12s — long enough to mean something is actually slow, not that
 * the network had one bad round trip — does the copy say so in words.
 *
 * Legacy (shell off): unchanged — the original `PageLoader` (`ui/page-loader.tsx`),
 * an instant spinner, no staging.
 */

import { useEffect, useState } from 'react';
import { PageLoader } from '../ui/page-loader';
import { useMudavymDesign } from '../../lib/mudavym/useMudavymDesign';
import { ShellSkeleton } from './ShellSkeleton';
import './house-page-loader.css';

/** The word "Reading…" only appears past this; before it the frame alone shows (r58 N-02). */
const MARK_AFTER_MS = 800;
const SLOW_AFTER_MS = 12_000;

type Stage = 'silent' | 'reading' | 'slow';

function useLadderStage(): Stage {
  const [stage, setStage] = useState<Stage>('silent');
  useEffect(() => {
    const toReading = setTimeout(() => setStage('reading'), MARK_AFTER_MS);
    const toSlow = setTimeout(() => setStage('slow'), SLOW_AFTER_MS);
    return () => {
      clearTimeout(toReading);
      clearTimeout(toSlow);
    };
  }, []);
  return stage;
}

export function HousePageSkeleton() {
  return (
    <div className="mdv-skel" aria-hidden="true">
      <div className="mdv-skel__line mdv-skel__line--wide" />
      <div className="mdv-skel__line mdv-skel__line--mid" />
      <div className="mdv-skel__block" />
      <div className="mdv-skel__line mdv-skel__line--mid" />
      <div className="mdv-skel__line mdv-skel__line--narrow" />
    </div>
  );
}

function HouseLadderLoader() {
  const stage = useLadderStage();

  // The frame is there from the first paint; the spoken line is a live region
  // that exists from the start and only gains words past 800 ms.
  return (
    <div className="mdv-pageloader mudavym">
      <ShellSkeleton />
      <p className="mdv-pageloader__mark" role="status" aria-live="polite">
        {stage === 'silent' ? '' : stage === 'slow' ? 'Still reading — this is taking longer than usual.' : 'Reading…'}
      </p>
    </div>
  );
}

export function HousePageLoader() {
  const shellOn = useMudavymDesign('shell');
  if (shellOn) return <HouseLadderLoader />;
  return <PageLoader />;
}

export default HousePageLoader;
