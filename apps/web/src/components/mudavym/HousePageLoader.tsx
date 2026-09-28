/**
 * The page loader — sketch 119, "the shared pieces": "the loader ladder."
 * Mounted as the ONE Suspense fallback in App.tsx (a lazy route chunk still
 * loading), gated like every other shell chrome piece.
 *
 * A ladder, not an instant spinner: most chunks are already cached and load
 * in well under 400ms, so showing anything for those is a flash the eye
 * reads as a stutter, not a signal. Only past 400ms does a mark appear, and
 * only past 12s — long enough to mean something is actually slow, not that
 * the network had one bad round trip — does the copy say so in words.
 *
 * Legacy (shell off): unchanged — the original `PageLoader` (`ui/page-loader.tsx`),
 * an instant spinner, no staging.
 */

import { useEffect, useState } from 'react';
import { PageLoader } from '../ui/page-loader';
import { useMudavymDesign } from '../../lib/mudavym/useMudavymDesign';
import './house-page-loader.css';

const MARK_AFTER_MS = 400;
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

  if (stage === 'silent') return null;

  return (
    <div className="mdv-pageloader mudavym" role="status" aria-live="polite">
      <p className="mdv-pageloader__mark">
        {stage === 'slow' ? 'Still reading — this is taking longer than usual.' : 'Reading…'}
      </p>
      <HousePageSkeleton />
    </div>
  );
}

export function HousePageLoader() {
  const shellOn = useMudavymDesign('shell');
  if (shellOn) return <HouseLadderLoader />;
  return <PageLoader />;
}

export default HousePageLoader;
