/**
 * Register I — who you are, and how the room is lit.
 *
 * The password form moved out on 2026-09-03: the second pass gave security its
 * own register (`SecurityRegister.tsx`, Register II) so that the credential
 * could sit next to the session, the second factor and the API tokens, the way
 * every account page the founder named arranges them. This register is now
 * identity and preference only.
 *
 * The honesty work here is the phone field. It comes from `GET /auth/me`, the
 * read the shipping page swallows (Profile.tsx:110-118). When that read has
 * not answered, the field is disabled and says the value is unknown — it does
 * not render as an empty box that a Save would then write as "no phone".
 *
 * The support address is the other one. `VITE_SUPPORT_EMAIL` falls back to
 * `support@wineops.ai` on the shipping page (Profile.tsx:445) — a domain with
 * no mailbox behind it (profile.md §7). An unconfigured deployment gets a
 * sentence here, not a mailto that goes nowhere.
 */

import { useState } from 'react';
import { UserRound } from 'lucide-react';
import { EM, MONO, SANS, roleLabel } from './pf-format';
import { Btn, Card, Field, Note, Register, StatusLine } from './pf-ui';
import type { ProfileNextData } from './useProfileNextData';

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL as string | undefined;

export function IdentityRegister({ data }: { data: ProfileNextData }) {
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [phoneDraft, setPhoneDraft] = useState<string | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountMsg, setAccountMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);

  const recordRead = data.meState === 'ok';
  const name = nameDraft ?? data.user?.name ?? '';
  const phone = phoneDraft ?? (recordRead ? data.phone : '');

  const saveAccount = async () => {
    if (name.trim().length < 2) {
      setAccountMsg({ tone: 'error', text: 'A display name needs at least two characters.' });
      return;
    }
    setAccountMsg(null);
    setSavingAccount(true);
    try {
      await data.saveAccount(name, recordRead ? phone : '');
      setNameDraft(null);
      setPhoneDraft(null);
      setAccountMsg({
        tone: 'done',
        text: recordRead
          ? 'Saved.'
          : 'Display name saved. Phone was left untouched — it was never read.',
      });
    } catch (e) {
      setAccountMsg({ tone: 'error', text: `Not saved — ${String((e as Error).message)}` });
    } finally {
      setSavingAccount(false);
    }
  };

  return (
    <Register
      eyebrow="Register I"
      icon={<UserRound size={13} aria-hidden />}
      title="Who you are"
      lead={<Note>Your name, your address, your role, and how the room is lit.</Note>}
    >
      <Card title="Account">
        <Field id="pf-name" label="Display name" value={name} onChange={setNameDraft} />
        <Field
          id="pf-email"
          label="Email"
          value={data.user?.email ?? EM}
          readOnly
          hint={
            <Note>
              {SUPPORT_EMAIL ? (
                <>
                  Email is changed by{' '}
                  <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--seal-deep)' }}>
                    support
                  </a>
                  , not here.
                </>
              ) : (
                'Email is changed by support, not here — and no support address is configured on this deployment, so there is no link to offer.'
              )}
            </Note>
          }
        />
        <Field
          id="pf-phone"
          label="Phone"
          type="tel"
          value={phone}
          onChange={setPhoneDraft}
          disabled={!recordRead}
          placeholder={recordRead ? '+1 555 000 0000' : EM}
          hint={
            recordRead ? undefined : (
              <Note>
                {data.meState === 'error'
                  ? 'Unknown — your account record could not be read, so this is a dash, not an empty. Saving will not touch it.'
                  : 'Reading your account record…'}
              </Note>
            )
          }
        />
        <div style={{ marginBottom: 12 }}>
          <span style={{ display: 'block', marginBottom: 4, fontFamily: SANS, fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}>
            Role
          </span>
          <span
            style={{
              display: 'inline-block',
              padding: '3px 9px',
              borderRadius: 999,
              border: '1px solid var(--paper-2)',
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-2)',
            }}
          >
            {roleLabel(data.role)}
          </span>
          <Note>Set by your restaurant owner, not from this page.</Note>
        </div>
        <Btn emphasis="seal" onClick={() => void saveAccount()} disabled={savingAccount}>
          {savingAccount ? 'Saving…' : 'Save changes'}
        </Btn>
        {accountMsg && <StatusLine tone={accountMsg.tone}>{accountMsg.text}</StatusLine>}
      </Card>

      <Card title="Preferences" lead="Kept in this browser.">
        <span style={{ display: 'block', marginBottom: 6, fontFamily: SANS, fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}>
          Theme
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className="pf-btn pf-focus"
              aria-pressed={data.theme === t}
              onClick={() => data.setTheme(t)}
              style={{
                fontFamily: SANS,
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'capitalize',
                padding: '6px 12px',
                borderRadius: 8,
                border: `1px solid ${data.theme === t ? 'var(--seal-ring)' : 'var(--paper-2)'}`,
                background: data.theme === t ? 'var(--seal-tint)' : 'transparent',
                color: 'var(--ink-1)',
                cursor: 'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <Note>Warm Charcoal is the dark ground. “System” follows your device.</Note>
      </Card>
    </Register>
  );
}

export default IdentityRegister;
