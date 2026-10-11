/**
 * Passkeys for a session in no house (F-1321).
 *
 * A passkey is the person's, not the house's (ADR 0229; the founder,
 * 2026-09-26, round 7, item 44: "No-house enrolment ... allowed"), and the
 * gateway serves it so (`passkeys.controller.ts`, `@AllowsNoHouse`, F-1262).
 * But the one place that draws them, /profile, sits inside the house-required
 * shell, and `ProtectedRoute` sends a session with no house to /choose-house.
 * So the two pages such a session does reach -- /choose-house and /no-access --
 * carry the same `PasskeyRows` /profile does, behind one closed disclosure:
 * the page's own job (choose, join, or sign out) stays first, and nothing is
 * read until the person opens it.
 */

import { useId, useState } from 'react';
import { PasskeyRows } from './PasskeyRows';
import { PF_CSS } from './pf-ui';

export function NoHousePasskeys() {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <section style={{ marginTop: 24, textAlign: 'left' }} aria-label="Passkeys">
      <button
        type="button"
        className="pf-focus"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: 0,
          padding: 0,
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--seal-deep)',
          textDecoration: 'underline',
          textUnderlineOffset: 4,
          cursor: 'pointer',
        }}
      >
        {open ? 'Hide your passkeys' : 'Your passkeys'}
      </button>
      {open && (
        <div id={panelId} style={{ marginTop: 12 }}>
          <style>{PF_CSS}</style>
          <PasskeyRows />
        </div>
      )}
    </section>
  );
}

export default NoHousePasskeys;
