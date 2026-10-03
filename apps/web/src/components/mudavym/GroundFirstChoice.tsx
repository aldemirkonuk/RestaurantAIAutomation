/**
 * GroundFirstChoice — the one-time theme question, ADR 0169's 2026-10-01
 * amendment (batch 4).
 *
 * THE FOUNDER, 2026-10-01: "paper at first always , then they can select is
 * what i meant at onboarding" — and, of the ways offered, "First sign-in,
 * never chosen (Recommended)". So everyone starts on Paper, and the first time
 * a signed-in person's ACCOUNT says they have never chosen a theme, this asks
 * them once: Paper / Charcoal / System, Paper pre-selected. Saving writes the
 * choice to the account (`saveGroundSetting` → `GroundChoiceSync`'s writer), so
 * the account never answers "never chosen" again and this never shows again,
 * on any device.
 *
 * WHEN IT ASKS — ONLY ON A CONFIRMED "NEVER CHOSE". The store's `source` must
 * be `default` with someone signed in. `unknown` (the account has not answered
 * yet), `unreadable` (it could not be read), `device-cache` (this device's copy
 * of an answer) and `account` (an answer) never ask: a read that has not come
 * back, or failed, is not the person saying they never chose (CLAUDE.md §9).
 *
 * NEVER ON TOP OF THE DATA TERMS. While an owner's "Hold to accept" terms
 * sheet is up — or its read is still in flight and it may be about to be —
 * this waits (`useDataTermsSignInBusy`, which mirrors `DataTermsSignInGate`'s
 * own conditions), and asks once that sheet has closed.
 *
 * CLOSING SAVES NOTHING. "Not now", Escape, or a click outside closes it for
 * this page load and writes nothing, so the account still says "never chosen"
 * and the next load asks again. The founder ruled this on 2026-10-01 ("Ask
 * again next load"); the rejected alternative — closing saves Paper, so it
 * never asks again — is recorded in ADR 0169's batch-4 amendment.
 *
 * SHAPE: `Panel` (ADR 0112) — centered, because this is an ask the reader
 * answers, not a record or a menu; content in `sheet.css`'s vocabulary
 * (`mdv-item` rows, `mdv-btn--seal`). It adds no motion: it arrives and leaves
 * on `Panel`'s own `settle`.
 *
 * LIVE PREVIEW. The panel paints itself in the option picked — Charcoal shows
 * charcoal, System shows whatever this device resolves to (read when System is
 * picked) — while the page behind stays on Paper until Save.
 *
 * WHERE IT IS MOUNTED: once, in `components/layout/DashboardLayout.tsx`, beside
 * `DataTermsSignInGate` — see that file.
 */

import { useRef, useState } from 'react';
import { Panel } from './Sheet';
import { useDataTermsSignInBusy } from '../../hooks/queries/useDataTerms';
import {
  GROUND_OPTIONS,
  getGroundOwnerId,
  groundPaintFor,
  saveGroundSetting,
  useGroundState,
  type GroundSetting,
  type GroundState,
} from '../../lib/mudavym/groundChoice';

/** `ask` waits on the account saying "never chosen"; `saving` and `failed`
 *  stay up whatever the account says meanwhile (an optimistic save moves the
 *  source before the answer lands); `closed` is done for this page load. */
type Phase = 'ask' | 'saving' | 'failed' | 'closed';

export function GroundFirstChoice() {
  const ground = useGroundState();
  const owner = getGroundOwnerId();
  if (!owner) return null;
  // Keyed by person: a different account signing in on this tab is asked
  // afresh, never inherits the previous person's "closed".
  return <FirstChoiceAsk key={owner} ground={ground} />;
}

function FirstChoiceAsk({ ground }: { ground: GroundState }) {
  const termsBusy = useDataTermsSignInBusy();
  const [phase, setPhase] = useState<Phase>('ask');
  const [picked, setPicked] = useState<GroundSetting>('paper');
  const firstRef = useRef<HTMLInputElement>(null);

  const open =
    !termsBusy &&
    (phase === 'saving' || phase === 'failed' || (phase === 'ask' && ground.source === 'default'));

  const save = async () => {
    setPhase('saving');
    const saved = await saveGroundSetting(picked);
    setPhase((p) => (p === 'closed' || saved ? 'closed' : 'failed'));
  };

  // Closing is not an answer: nothing is written, and the next load asks again.
  const close = () => setPhase('closed');

  return (
    <Panel
      open={open}
      onClose={close}
      closeLabel="Not now"
      scrim
      ground={groundPaintFor(picked)}
      initialFocusRef={firstRef}
      label="Choose how Mudavym looks for you: Paper, Charcoal or System. Saving keeps it on your account; Not now saves nothing and asks again next time."
      eyebrow="Your theme"
      title="How should Mudavym look for you?"
      contract={
        <span>
          Everyone starts on Paper. What you save follows you to any device you sign in on, and
          you can change it any time on your profile, under Preferences.
        </span>
      }
      footer={
        <div style={{ display: 'grid', gap: 8 }}>
          {phase === 'failed' ? (
            <p className="mdv-hintline" role="alert" data-ground-first-refusal>
              {ground.writeError ??
                'This theme was not saved to your account, so it will not be remembered. Try again, or choose later on your profile.'}
            </p>
          ) : null}
          <div className="mdv-actions">
            <button
              type="button"
              className="mdv-btn mdv-btn--seal"
              onClick={() => void save()}
              disabled={phase === 'saving'}
            >
              {phase === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      }
    >
      <fieldset data-ground-first-choice style={{ border: 0, margin: 0, padding: '4px 0 8px' }}>
        <legend className="mdv-sect">Theme</legend>
        {GROUND_OPTIONS.map(({ value, label, hint }, i) => (
          <label key={value} className="mdv-item" data-active={picked === value ? 'true' : undefined}>
            <input
              ref={i === 0 ? firstRef : undefined}
              type="radio"
              name="mdv-ground-first-choice"
              value={value}
              checked={picked === value}
              onChange={() => setPicked(value)}
              style={{ accentColor: 'var(--seal)', margin: 0 }}
            />
            <span className="mdv-item__text">
              <span className="mdv-item__label">{label}</span>
              {hint ? <span className="mdv-item__sub">{hint}</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
    </Panel>
  );
}

export default GroundFirstChoice;
