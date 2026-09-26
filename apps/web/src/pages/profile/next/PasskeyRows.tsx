/**
 * Passkeys — Register II's "Second factor" rail, built (ADR 0222, Proposed).
 *
 * THE FOUNDER, 2026-09-21, round 6r, his pick verbatim: **"Passkey + paste
 * (Recommended)"** (ADR 0134 §7). As recorded there: WebAuthn, per user,
 * a peer path beside the manager passcode, enrolment and revocation here on
 * /profile, audited. Anyone in the house may add one -- staff too since the
 * founder's 2026-09-26 round-6 answer (ADR 0229), which also mails the
 * account on every new passkey and retires every passkey on a password reset.
 *
 * What this draws, and the honesty rules it keeps:
 *   - **Every passkey is a `ConnectionRow`**, like every other attachment on
 *     this page — the header row, one row per passkey, and a removed passkey
 *     stays listed, marked removed: one that once existed must not become
 *     indistinguishable from one that never did.
 *   - **Three states, never two.** A list that could not be read says so and
 *     offers a retry; it is never drawn as "no passkeys".
 *   - **A passkey signs you in** (the founder, 2026-09-25, item 29): Face ID,
 *     Touch ID or the device PIN on the sign-in page. It approves nothing yet
 *     -- the manager passcode it will sit beside (ADR 0112 F11) is unbuilt --
 *     and the note says so. "Check" proves one still answers, and grants nothing.
 *   - **Adding one needs a recent sign-in, or an emailed code** (same answer,
 *     which replaced "type your current password"): signed in within the last
 *     ten minutes, it goes straight to the device; otherwise the gateway says
 *     so, a six-digit code is emailed to the account's own address, and the
 *     field for it names itself `one-time-code` so a phone can fill it from
 *     the mail (ADR 0134 §7, SC 3.3.8: nothing to remember, paste allowed).
 *     A Google-only account adds one the same way.
 *   - **A disabled control carries its reason in words**: not an owner or
 *     manager here, or a browser that cannot make passkeys.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PASSKEYS_QUERY_KEY,
  addPasskey,
  checkPasskey,
  getPasskeys,
  passkeysSupported,
  removePasskey,
  sendStepUpCode,
  StepUpRequired,
  type Passkey,
  type PasskeyReceipt,
} from '../../../services/api/passkeys';
import { getErrorMessage } from '../../../services/api/client';
import { fmtDay } from './pf-format';
import { Btn, ConnectionRow, Field, Note, RetryLink, StatusLine } from './pf-ui';

type Msg = { tone: 'error' | 'done'; text: string } | null;

/** A WebAuthn prompt the person closed is not a failure of the product. */
export function describePasskeyError(e: unknown, what: string): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return `${what} — the device prompt was closed or timed out.`;
  }
  if (name === 'InvalidStateError') {
    return `${what} — this device already holds a passkey for your account.`;
  }
  return `${what} — ${getErrorMessage(e)}`;
}

/** What the audit and mail receipts say, when either did not happen. */
function receiptNote(r: PasskeyReceipt): string {
  const trail = !r.audited
    ? ` The change was made, but it was not written to the trail — ${r.auditReason ?? 'no reason was given'}.`
    : '';
  const mail = r.mailed === false ? ' The email to your account about it could not be sent.' : '';
  return `${trail}${mail}`;
}

function passkeySubtitle(p: Passkey): string {
  const kind = p.deviceType === 'multiDevice' ? 'Synced passkey' : 'On one device';
  const used = p.lastUsedAt ? `last checked ${fmtDay(p.lastUsedAt)}` : 'never checked';
  if (p.revokedAt) return `${kind} · added ${fmtDay(p.createdAt)} · removed ${fmtDay(p.revokedAt)}`;
  return `${kind} · added ${fmtDay(p.createdAt)} · ${used}`;
}

export function PasskeyRows() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: PASSKEYS_QUERY_KEY, queryFn: getPasskeys, retry: false });
  const [adding, setAdding] = useState(false);
  const [nickname, setNickname] = useState('');
  /** Set once the gateway asked for an emailed code: where it went, and the typed code. */
  const [stepUp, setStepUp] = useState<{ sentTo: string } | null>(null);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const supported = passkeysSupported();

  const refresh = () => qc.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY });

  const closeForm = () => {
    setAdding(false);
    setNickname('');
    setStepUp(null);
    setCode('');
  };

  const sendCode = useMutation({
    mutationFn: () => sendStepUpCode(),
    onSuccess: (r) => {
      setStepUp({ sentTo: r.sentTo });
      setCode('');
    },
    onError: (e) => setMsg({ tone: 'error', text: `No code was sent — ${getErrorMessage(e)}` }),
  });

  const add = useMutation({
    mutationFn: () => addPasskey({ nickname, emailCode: stepUp ? code : undefined }),
    onSuccess: (r) => {
      closeForm();
      setMsg({ tone: 'done', text: `Passkey added. It signs you in on this device from now on.${receiptNote(r)}` });
      void refresh();
    },
    onError: (e) => {
      if (e instanceof StepUpRequired) {
        // The sign-in is more than ten minutes old: email a code, then ask for it.
        setMsg(null);
        sendCode.mutate();
        return;
      }
      setMsg({ tone: 'error', text: describePasskeyError(e, 'Nothing was added') });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => removePasskey(id),
    onSuccess: (r) => {
      setConfirming(null);
      setMsg({ tone: 'done', text: `Passkey removed. It can no longer be used.${receiptNote(r)}` });
      void refresh();
    },
    onError: (e) => setMsg({ tone: 'error', text: describePasskeyError(e, 'Nothing was removed') }),
  });

  const check = useMutation({
    mutationFn: () => checkPasskey(),
    onSuccess: (r) => {
      setMsg({ tone: 'done', text: `${r.passkey.nickname ?? 'Your passkey'} answered. Nothing was approved by it.${receiptNote(r)}` });
      void refresh();
    },
    onError: (e) => setMsg({ tone: 'error', text: describePasskeyError(e, 'Not checked') }),
  });

  if (q.isPending) {
    return <ConnectionRow title="Passkeys" subtitle="Reading your passkeys…" state="unknown" />;
  }

  const readout = q.data;
  if (q.isError || !readout || !readout.readable) {
    const why = q.isError ? getErrorMessage(q.error) : (readout?.reason ?? 'no reason was given');
    return (
      <ConnectionRow
        title="Passkeys"
        subtitle="Your passkeys could not be read."
        state="unknown"
        reason={`The list did not load — ${why}. This is not the same as having none.`}
        controls={<RetryLink onClick={() => void q.refetch()} />}
      />
    );
  }

  const live = readout.passkeys.filter((p) => !p.revokedAt);
  const busy = add.isPending || remove.isPending || check.isPending || sendCode.isPending;

  // Why "Add a passkey" is disabled, in words. Null exactly when it is not.
  const addReason = !readout.eligible
    ? (readout.eligibilityReason ?? 'A passkey cannot be added right now.')
    : !supported
      ? 'This browser cannot make a passkey. Open Mudavym in a current Safari, Chrome, Edge or Firefox.'
      : null;

  return (
    <>
      <ConnectionRow
        title="Passkeys"
        subtitle={
          live.length === 0
            ? 'Sign in with Face ID, Touch ID or your device’s PIN instead of a password.'
            : `${live.length === 1 ? 'One passkey' : `${live.length} passkeys`} on this account.`
        }
        state={live.length > 0 ? 'connected' : 'available'}
        reason={addReason}
        controls={
          <>
            <Btn
              emphasis="seal"
              disabled={addReason !== null || busy || adding}
              onClick={() => {
                setMsg(null);
                setAdding(true);
              }}
            >
              Add a passkey
            </Btn>
            {live.length > 0 && readout.eligible && supported && (
              <Btn disabled={busy} onClick={() => { setMsg(null); check.mutate(); }}>
                {check.isPending ? 'Waiting for your device…' : 'Check a passkey'}
              </Btn>
            )}
          </>
        }
      />
      <Note>
        A passkey signs you in on mudavym.com: choose “Sign in with a passkey” on the sign-in page. It does not approve
        anything yet — the manager passcode it will stand beside, at the moment an order is sealed, is not built.
        Lost the device? Sign in with your email or password and remove it here.
      </Note>

      {adding && (
        <div
          style={{
            border: '1px solid var(--paper-2)',
            background: 'var(--paper-1)',
            borderRadius: 12,
            padding: '12px 14px',
            margin: '8px 0',
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setMsg(null);
              add.mutate();
            }}
          >
            <Field
              id="pf-passkey-name"
              label="Name it (optional)"
              value={nickname}
              onChange={setNickname}
              placeholder="Work laptop"
              autoComplete="off"
            />
            {stepUp && (
              <Field
                id="pf-passkey-code"
                label="The code we emailed you"
                autoComplete="one-time-code"
                inputMode="numeric"
                value={code}
                onChange={setCode}
                placeholder="123456"
                hint={
                  <Note>
                    You signed in more than ten minutes ago, so we emailed a six-digit code to {stepUp.sentTo} to make
                    sure it is you. It works once, for ten minutes.
                  </Note>
                }
              />
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn type="submit" emphasis="seal" disabled={busy || (stepUp !== null && code.replace(/\s+/g, '').length !== 6)}>
                {add.isPending ? 'Waiting for your device…' : sendCode.isPending ? 'Emailing a code…' : 'Continue on this device'}
              </Btn>
              {stepUp && (
                <Btn disabled={busy} onClick={() => { setMsg(null); sendCode.mutate(); }}>
                  Send a new code
                </Btn>
              )}
              <Btn disabled={add.isPending} onClick={closeForm}>
                Cancel
              </Btn>
            </div>
          </form>
        </div>
      )}

      {readout.passkeys.map((p) => (
        <ConnectionRow
          key={p.id}
          title={p.nickname ?? 'Unnamed passkey'}
          subtitle={passkeySubtitle(p)}
          state={p.revokedAt ? 'unavailable' : 'connected'}
          reason={p.revokedAt ? 'Removed. It can no longer be used, and it stays listed so the record is whole.' : null}
          controls={
            p.revokedAt ? undefined : confirming === p.id ? (
              <>
                <Btn emphasis="seal" disabled={remove.isPending} onClick={() => remove.mutate(p.id)}>
                  {remove.isPending ? 'Removing…' : 'Yes, remove it'}
                </Btn>
                <Btn disabled={remove.isPending} onClick={() => setConfirming(null)}>
                  Keep it
                </Btn>
              </>
            ) : (
              <Btn disabled={busy} onClick={() => { setMsg(null); setConfirming(p.id); }}>
                Remove
              </Btn>
            )
          }
        />
      ))}
      {readout.passkeys.length === 0 && (
        <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--ink-3)' }}>
          No passkey has been added to this account.
        </p>
      )}

      {msg && <StatusLine tone={msg.tone}>{msg.text}</StatusLine>}
    </>
  );
}

export default PasskeyRows;
