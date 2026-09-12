/**
 * The one real "Connect" on this page.
 *
 * Google Identity Services renders its own button and hands back an id_token,
 * which `POST /auth/me/link/google` verifies server-side
 * (auth.service.ts:1963-2040). Everything else on the Connections register is
 * either a redirect to a consent screen that already exists, or a disabled
 * control carrying its reason — so this is the only place a token is acquired.
 *
 * Copied rather than imported from `components/auth/GoogleLinkButton`: that
 * component paints itself in the legacy grey/green palette and this page may
 * not restyle a shared component other pages render.
 *
 * Three honest end states, no fourth: the button, "not configured on this
 * deployment", or the script failed to load and says so.
 */

import { useEffect, useRef, useState } from 'react';
import { getGoogleClientId, loadGoogleIdentityScript } from '../../../lib/googleIdentity';
import { profileApi } from '../../../services/api/profile';
import { apiMessage, SANS } from './pf-format';

export function GoogleLink({
  onLinked,
  onError,
}: {
  onLinked: () => void;
  onError: (message: string) => void;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unconfigured' | 'blocked'>(
    'loading',
  );
  const [linking, setLinking] = useState(false);
  const clientId = getGoogleClientId();

  useEffect(() => {
    if (!clientId) {
      setPhase('unconfigured');
      return;
    }
    let cancelled = false;
    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id || !containerRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response: { credential: string }) => {
            setLinking(true);
            profileApi
              .linkProvider('google', { token: response.credential })
              .then(() => onLinked())
              .catch((e: unknown) => onError(apiMessage(e, 'Failed to link Google account')))
              .finally(() => setLinking(false));
          },
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'medium',
          text: 'continue_with',
          shape: 'pill',
        });
        setPhase('ready');
      })
      .catch(() => {
        if (!cancelled) setPhase('blocked');
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, onLinked, onError]);

  const word = (t: string) => (
    <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>{t}</span>
  );

  if (phase === 'unconfigured') {
    return word('Google sign-in is not configured on this deployment, so it cannot be linked here.');
  }
  if (phase === 'blocked') {
    return word('Google’s sign-in script could not be loaded, so linking is unavailable right now.');
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span ref={containerRef} />
      {phase === 'loading' && word('Loading Google sign-in…')}
      {linking && word('Linking…')}
    </span>
  );
}

export default GoogleLink;
