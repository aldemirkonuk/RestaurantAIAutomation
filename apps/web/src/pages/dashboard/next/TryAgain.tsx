/**
 * TryAgain — the word every "couldn't be read" line on the dashboard ends on
 * (DASH-W19). Before it, a failed read left the founder one way back: reload
 * the whole page. It reads again only what its own sentence is about, and
 * says "Reading…" while it does, so a second press cannot stack requests.
 */

import { useEffect, useRef, useState } from 'react';

export function TryAgain({ onRetry }: { onRetry: () => unknown }) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onRetry();
    } catch {
      // The line that called us still says what failed; nothing to add.
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="dn-ink ml-1 not-italic text-inkm-2 underline underline-offset-2 hover:text-inkm-1 disabled:no-underline disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
    >
      {busy ? 'Reading…' : 'Try again'}
    </button>
  );
}

export default TryAgain;
