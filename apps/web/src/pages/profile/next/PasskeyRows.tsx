/**
 * Passkeys — Register II's "Second factor" rail, built (ADR 0222, Proposed).
 *
 * THE FOUNDER, 2026-09-21, round 6r, his pick verbatim: **"Passkey + paste
 * (Recommended)"** (ADR 0134 §7). As recorded there: WebAuthn, per user,
 * owners and managers only, a peer path beside the manager passcode,
 * enrolment and revocation here on /profile, audited.
 *
 * What this draws, and the honesty rules it keeps:
 *   - **Every passkey is a `ConnectionRow`**, like every other attachment on
 *     this page — the header row, one row per passkey, and a removed passkey
 *     stays listed, marked removed: one that once existed must not become
 *     indistinguishable from one that never did.
 *   - **Three states, never two.** A list that could not be read says so and
 *     offers a retry; it is never drawn as "no passkeys".
 *   - **Nothing asks for a passkey yet**, and the header says it: the manager
 *     passcode it sits beside (ADR 0112 F11) is unbuilt, so a passkey approves
 *     nothing today. "Check" proves one still answers, and grants nothing.
 *   - **Adding one takes your password, typed now** (ADR 0222 fork 1, as
 *     built). The field accepts paste and names itself `current-password`, so
 *     a password manager can fill it (ADR 0134 §7, SC 3.3.8).
 *   - **A disabled control carries its reason in words**: not an owner or
 *     manager here, no password set, or a browser that cannot make passkeys.
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

/** What the audit and notice receipts say, when either did not happen. */
function receiptNote(r: PasskeyReceipt): string {
  if (!r.audited) return ` The change was made, but it was not written to the trail — ${r.auditReason ?? 'no reason was given'}.`;
  return '';
}

function passkeySubtitle(p: Passkey): string {
  const kind = p.deviceType === 'multiDevice' ? 'Synced passkey' : 'On one device';
  const used = p.lastUsedAt ? `last checked ${fmtDay(p.lastUsedAt)}` : 'never checked';
  if (p.revokedAt) return `${kind} · added ${fmtDay(p.createdAt)} · removed ${fmtDay(p.revokedAt)}`;
  return `${kind} · added ${fmtDay(p.createdAt)} · ${used}`;
}

export function PasskeyRows({ hasPassword }: { hasPassword: boolean | null }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: PASSKEYS_QUERY_KEY, queryFn: getPasskeys, retry: false });
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const supported = passkeysSupported();

  const refresh = () => qc.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY });

  const add = useMutation({
    mutationFn: () => addPasskey({ currentPassword: password, nickname }),
    onSuccess: (r) => {
      setAdding(false);
      setPassword('');
      setNickname('');
      setMsg({ tone: 'done', text: `Passkey added.${receiptNote(r)}` });
      void refresh();
    },
    onError: (e) => setMsg({ tone: 'error', text: describePasskeyError(e, 'Nothing was added') }),
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
  const busy = add.isPending || remove.isPending || check.isPending;

  // Why "Add a passkey" is disabled, in words. Null exactly when it is not.
  const addReason = !readout.eligible
    ? (readout.eligibilityReason ?? 'Passkeys are for the house’s owners and managers.')
    : !supported
      ? 'This browser cannot make a passkey. Open Mudavym in a current Safari, Chrome, Edge or Firefox.'
      : hasPassword === false
        ? 'Set a password first, above. A passkey is added only after you type your password, so a borrowed session cannot add one.'
        : null;

  return (
    <>
      <ConnectionRow
        title="Passkeys"
        subtitle={
          live.length === 0
            ? 'A passkey on the device you are holding, for approving what the house asks an owner or manager to approve.'
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
        Nothing in Mudavym asks for a passkey yet. The approval it will stand beside — the manager passcode at the
        moment an order is sealed — is not built, so a passkey approves nothing today. Adding one now means it is
        ready the day that lands.
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
            {hasPassword !== false && (
              <Field
                id="pf-passkey-password"
                label="Your current password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
                hint={<Note>So a session someone borrowed cannot add a passkey of its own.</Note>}
              />
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn type="submit" emphasis="seal" disabled={busy || !password}>
                {add.isPending ? 'Waiting for your device…' : 'Continue on this device'}
              </Btn>
              <Btn
                disabled={add.isPending}
                onClick={() => {
                  setAdding(false);
                  setPassword('');
                }}
              >
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
