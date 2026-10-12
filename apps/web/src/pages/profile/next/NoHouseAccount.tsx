/**
 * Password, sign-ins and closing the account for a session in no house
 * (F-1396; the sibling of F-1321's `NoHousePasskeys`).
 *
 * The gateway serves all three without a house (`auth.controller.ts`:
 * `POST /auth/me/password`, `DELETE /auth/me/link/:provider` and
 * `DELETE /auth/me` are `@AllowsNoHouse`), but /profile sits inside the
 * house-required shell, so a person who left their last house had no way to
 * set a first password, take a sign-in off, or delete the account -- while
 * /privacy told them to do it "in your profile". The same rules as /profile
 * apply: an old sign-in is asked for the emailed code (F-1347), the last way
 * in cannot be unlinked, and deleting needs DELETE typed and the seal held.
 * Closed until opened, and nothing is read before that.
 */

import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HoldToApprove } from '../../../components/mudavym';
import { useAuth } from '../../../contexts/AuthContext';
import { getErrorMessage } from '../../../services/api/client';
import { profileApi } from '../../../services/api/profile';
import { Btn, Field, Note, PF_CSS, StatusLine } from './pf-ui';
import { StepUpField, useStepUpCode } from './StepUpCode';

type Msg = { tone: 'error' | 'done'; text: string } | null;

const H3 = { margin: '16px 0 6px', fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' } as const;

function AccountPanel() {
  const { deleteAccountAndSignOut } = useAuth();
  const meQ = useQuery({ queryKey: ['no-house-me'], queryFn: () => profileApi.getMe() });
  const me = meQ.data;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<Msg>(null);
  const passwordStepUp = useStepUpCode();

  const [unlinking, setUnlinking] = useState<{ provider: 'google' | 'microsoft'; label: string } | null>(null);
  const [signInMsg, setSignInMsg] = useState<Msg>(null);
  const unlinkStepUp = useStepUpCode();

  const [confirmDelete, setConfirmDelete] = useState('');
  const [deleteMsg, setDeleteMsg] = useState<Msg>(null);
  const deleteStepUp = useStepUpCode();

  if (meQ.isLoading) return <Note>Reading your account…</Note>;
  if (!me) {
    return (
      <StatusLine tone="error">
        Your account could not be read just now. Nothing was changed; close this and open it again.
      </StatusLine>
    );
  }

  const ways =
    (me.hasPassword ? 1 : 0) + (me.linkedProviders.google ? 1 : 0) + (me.linkedProviders.microsoft ? 1 : 0);

  const savePassword = async () => {
    if (next.length < 8) {
      setPasswordMsg({ tone: 'error', text: 'A new password needs at least eight characters.' });
      return;
    }
    if (next !== confirm) {
      setPasswordMsg({ tone: 'error', text: 'The two new passwords do not match.' });
      return;
    }
    setPasswordMsg(null);
    setSaving(true);
    try {
      await profileApi.changePassword({
        currentPassword: current || undefined,
        newPassword: next,
        ...(passwordStepUp.emailCode ? { emailCode: passwordStepUp.emailCode } : {}),
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      passwordStepUp.reset();
      setPasswordMsg({ tone: 'done', text: 'Password saved. Every other device was signed out; this one stays signed in.' });
      await meQ.refetch();
    } catch (e) {
      if (!passwordStepUp.asked(e)) setPasswordMsg({ tone: 'error', text: `Not changed — ${getErrorMessage(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const unlink = async (provider: 'google' | 'microsoft', label: string) => {
    setSignInMsg(null);
    try {
      await profileApi.unlinkProvider(provider, unlinking?.provider === provider ? unlinkStepUp.emailCode : undefined);
      setUnlinking(null);
      unlinkStepUp.reset();
      setSignInMsg({ tone: 'done', text: `${label} unlinked.` });
      await meQ.refetch();
    } catch (e) {
      if (unlinkStepUp.asked(e)) {
        setUnlinking({ provider, label });
        return;
      }
      setUnlinking(null);
      setSignInMsg({
        tone: 'error',
        text: `${label} could not be unlinked — ${getErrorMessage(e)}${unlinkStepUp.clearAfterRefusal()}`,
      });
    }
  };

  const destroy = () => {
    setDeleteMsg(null);
    void deleteAccountAndSignOut(deleteStepUp.emailCode)
      .then(() => {
        window.location.href = '/login';
      })
      .catch((e: unknown) => {
        if (deleteStepUp.asked(e)) return;
        setDeleteMsg({
          tone: 'error',
          text: `The account was NOT deleted — ${getErrorMessage(e)}${deleteStepUp.clearAfterRefusal()}`,
        });
      });
  };

  const signIns = (
    [
      ['google', 'Google'],
      ['microsoft', 'Microsoft'],
    ] as const
  ).filter(([p]) => me.linkedProviders[p]);

  return (
    <>
      <h3 style={H3}>{me.hasPassword ? 'Change your password' : 'Set a password'}</h3>
      {me.hasPassword && (
        <Field
          id="nh-current-password"
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={setCurrent}
        />
      )}
      <Field id="nh-new-password" label="New password" type="password" autoComplete="new-password" value={next} onChange={setNext} />
      <Field
        id="nh-confirm-password"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={setConfirm}
      />
      <StepUpField id="nh-password-code" stepUp={passwordStepUp} />
      <Btn
        onClick={() => void savePassword()}
        disabled={saving || !next || !passwordStepUp.ready || passwordStepUp.sending}
      >
        {saving ? 'Saving…' : me.hasPassword ? 'Update password' : 'Set password'}
      </Btn>
      {passwordMsg && <StatusLine tone={passwordMsg.tone}>{passwordMsg.text}</StatusLine>}

      <h3 style={H3}>Sign-ins</h3>
      {signIns.length === 0 ? (
        <Note>No Google or Microsoft sign-in is linked to this account.</Note>
      ) : (
        signIns.map(([provider, label]) => (
          <div key={provider} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ flex: 1, fontSize: 13 }}>{label}</span>
            <Btn onClick={() => void unlink(provider, label)} disabled={ways <= 1}>
              Unlink
            </Btn>
          </div>
        ))
      )}
      {signIns.length > 0 && ways <= 1 && (
        <Note>This is your only way to sign in. Set a password first, then it can be unlinked.</Note>
      )}
      {unlinking && (
        <div style={{ margin: '8px 0' }}>
          <StepUpField id="nh-unlink-code" stepUp={unlinkStepUp} />
          {unlinkStepUp.sentTo !== null && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn
                emphasis="seal"
                disabled={!unlinkStepUp.ready || unlinkStepUp.sending}
                onClick={() => void unlink(unlinking.provider, unlinking.label)}
              >
                Unlink {unlinking.label}
              </Btn>
              <Btn
                onClick={() => {
                  setUnlinking(null);
                  unlinkStepUp.reset();
                }}
              >
                Cancel
              </Btn>
            </div>
          )}
        </div>
      )}
      {signInMsg && <StatusLine tone={signInMsg.tone}>{signInMsg.text}</StatusLine>}

      <h3 style={H3}>Delete your account</h3>
      <Note>
        Permanently deletes your Mudavym account. It cannot be undone. If you opened a restaurant here, or you are the
        only owner of one, it cannot be deleted yet. Both are checked before anything is deleted.
      </Note>
      <Field
        id="nh-confirm-delete"
        label="Type DELETE to arm the seal"
        value={confirmDelete}
        onChange={setConfirmDelete}
        placeholder="DELETE"
      />
      <StepUpField id="nh-delete-code" stepUp={deleteStepUp} />
      <div style={{ maxWidth: 280 }}>
        <HoldToApprove
          key={deleteStepUp.sentTo ?? 'no-code'}
          onApprove={destroy}
          disabled={confirmDelete !== 'DELETE' || !deleteStepUp.ready || deleteStepUp.sending}
          label="Hold to delete this account"
          approvedLabel="Sent to the server"
        />
      </div>
      {deleteMsg && <StatusLine tone={deleteMsg.tone}>{deleteMsg.text}</StatusLine>}
    </>
  );
}

export function NoHouseAccount() {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <section style={{ marginTop: 16, textAlign: 'left' }} aria-label="Your account">
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
        {open ? 'Hide your account' : 'Password, sign-ins and deleting your account'}
      </button>
      {open && (
        <div id={panelId} style={{ marginTop: 12 }}>
          <style>{PF_CSS}</style>
          <AccountPanel />
        </div>
      )}
    </section>
  );
}

export default NoHouseAccount;
