/**
 * "Sign in again", over the page instead of a reload (F-335).
 *
 * The API client announces a refused refresh token (lib/sessionEnded.ts); this
 * panel answers it. The page underneath is left exactly as it was, so a typed
 * order or count is still there. Two ways back:
 *   - sign in in a new tab: the new session lands in this browser's storage,
 *     which this tab reads on its next request, so the person comes back here
 *     and presses Save again. The panel closes on its own when that happens.
 *   - sign in here: leaves the page, says why on the sign-in page, and comes
 *     back to this page after.
 */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Panel } from './Sheet';
import {
  SESSION_ENDED_EVENT,
  signInAgainPath,
  type SessionEndedDetail,
} from '../../lib/sessionEnded';

const ACT = {
  font: 'inherit',
  color: 'var(--ink-1)',
  background: 'none',
  border: 0,
  padding: '4px 6px',
  textDecoration: 'underline',
  cursor: 'pointer',
} as const;

export function SessionEndedPanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const [message, setMessage] = useState<string | null>(null);
  const here = `${location.pathname}${location.search}`;

  useEffect(() => {
    const onEnded = (e: Event) => {
      if (window.location.pathname === '/login') return;
      setMessage((e as CustomEvent<SessionEndedDetail>).detail?.message ?? '');
    };
    // Signed in again in another tab: this tab can save again.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'refreshToken' && e.newValue) setMessage(null);
    };
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  if (message === null) return null;

  return (
    <Panel
      open
      onClose={() => setMessage(null)}
      label="Your sign-in has ended. What you typed on this page is still here. Sign in again to save it."
      title="Sign in again"
      closeLabel="Stay on this page"
      footer={
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
          <button
            type="button"
            style={ACT}
            data-testid="session-ended-new-tab"
            onClick={() => window.open(signInAgainPath(here), '_blank', 'noopener')}
          >
            Sign in in a new tab
          </button>
          <button
            type="button"
            style={ACT}
            data-testid="session-ended-here"
            onClick={() => {
              setMessage(null);
              navigate(signInAgainPath(here));
            }}
          >
            Sign in here
          </button>
        </span>
      }
    >
      <p>{message}</p>
      <p>
        What you typed on this page is still here. To keep it, sign in in a new
        tab, then come back to this tab and save again. Signing in here leaves
        this page, and anything not saved yet is lost; you come back to this
        page after.
      </p>
    </Panel>
  );
}
