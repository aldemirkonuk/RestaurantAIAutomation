/**
 * Register II — Security.
 *
 * WHAT THE FIELD DOES, AND WHAT WE CAN HONESTLY DO
 * ------------------------------------------------
 * Stripe, Linear and Vercel all open their security page on the same three
 * objects: the credential, the sessions, and the second factor. Two of those
 * three do not exist behind this product, and the interesting design question is
 * what to draw in their place.
 *
 * The answer this register takes is that a session row must be EVIDENCE, so it
 * builds the one row it can prove and refuses to invent the rest:
 *
 *   * "This browser" is real. Its signed-in and expiry times are the `iat`/`exp`
 *     claims of the JWT this tab is holding — values the gateway signed — and
 *     its device is this browser's own user-agent. Sign out is the live
 *     `POST /auth/logout`.
 *   * "Other devices" is `Not built`, because the gateway keeps no session
 *     register at all: logout blacklists the token presented with it
 *     (auth/services/token-blacklist.service.ts) and nothing anywhere records a
 *     device, an address or a last-seen. A competitor's page would show an empty
 *     devices table here; an empty table would say "you are signed in nowhere
 *     else", which we cannot know.
 *   * Two-factor, passkeys and API tokens are each `Not built` with the
 *     measurement behind the claim. Measured 2026-09-03 across
 *     `apps/api-gateway/src`, `apps/web/src` and `supabase/migrations`: zero
 *     matches for `2fa`, `totp`, `mfa`, `passkey`, `webauthn`, and no
 *     user-issued API token anywhere — every call this product makes is
 *     authenticated with the short-lived JWT.
 *
 * No fake toggles. A switch that flips and stores nothing is the same lie as a
 * Connect button with no endpoint, and it is worse here, because the thing it
 * would claim is that the account is protected.
 */

import { useState } from 'react';
import { KeyRound, MonitorSmartphone, ShieldCheck, Terminal } from 'lucide-react';
import { EM, MONO, SANS, fmtMoment } from './pf-format';
import { Btn, Card, ConnectionRow, Field, Note, Rail, Register, StatusLine } from './pf-ui';
import type { ProfileNextData } from './useProfileNextData';

/** A label/value pair inside a row's expanded working. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'contents' }}>
      <dt style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{label}</dt>
      <dd style={{ margin: 0, color: 'var(--ink-3)', fontFamily: MONO, fontSize: 11.5 }}>
        {value}
      </dd>
    </div>
  );
}

export function SecurityRegister({ data }: { data: ProfileNextData }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(
    null,
  );
  const [open, setOpen] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));

  const changePassword = async () => {
    if (next.length < 8) {
      setPasswordMsg({ tone: 'error', text: 'A new password needs at least eight characters.' });
      return;
    }
    if (next !== confirm) {
      setPasswordMsg({ tone: 'error', text: 'The two new passwords do not match.' });
      return;
    }
    setPasswordMsg(null);
    setSavingPassword(true);
    try {
      await data.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setPasswordMsg({ tone: 'done', text: 'Password updated. Your session is unaffected.' });
    } catch (e) {
      setPasswordMsg({ tone: 'error', text: `Not changed — ${String((e as Error).message)}` });
    } finally {
      setSavingPassword(false);
    }
  };

  const session = data.session;
  const sessionSubtitle = session.readable
    ? `${session.device ?? EM} · signed in ${fmtMoment(session.signedInAt)}`
    : `${session.device ?? EM} · this browser is holding no readable token, so the sign-in time is unknown`;

  return (
    <Register
      eyebrow="Register II"
      icon={<ShieldCheck size={13} aria-hidden />}
      title="What protects this account"
      lead={
        <Note>
          One credential, one session we can prove, and three protections that do not exist
          yet. Each of the three says what is missing rather than offering a switch that
          would store nothing.
        </Note>
      }
    >
      <Card
        id="pf-security"
        title="Password"
        lead={
          data.hasPassword === null
            ? 'Whether this account has a password is unknown — the record has not answered.'
            : data.hasPassword
              ? 'Change the password you sign in with.'
              : 'You signed in through a linked account. Set a password to also use email sign-in.'
        }
      >
        {data.hasPassword !== false && (
          <Field
            id="pf-current-password"
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
            hint={
              data.hasPassword === null ? (
                <Note>Fill this in if the account has one; the server will say if it is wrong.</Note>
              ) : undefined
            }
          />
        )}
        <Field
          id="pf-new-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={setNext}
        />
        <Field
          id="pf-confirm-password"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
        />
        <Btn onClick={() => void changePassword()} disabled={savingPassword || !next}>
          {savingPassword ? 'Saving…' : data.hasPassword === false ? 'Set password' : 'Update password'}
        </Btn>
        {passwordMsg && <StatusLine tone={passwordMsg.tone}>{passwordMsg.text}</StatusLine>}
      </Card>

      <Rail
        title="Sessions"
        icon={<MonitorSmartphone size={12} aria-hidden />}
        lead="One row, because one is all this product can prove. There is no session table behind it."
      >
        <ConnectionRow
          title="This browser"
          subtitle={sessionSubtitle}
          state={session.readable ? 'connected' : 'unknown'}
          controls={
            <Btn
              onClick={() => {
                setSigningOut(true);
                void data.signOut();
              }}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out of this browser'}
            </Btn>
          }
          detailOpen={open === 'session'}
          onToggleDetail={() => toggle('session')}
          detailLabel="Show the working"
          detail={
            <div>
              <Note>
                Everything on this row is read from the token this tab is holding and from the
                browser itself. No request was made to produce it, and nothing about it is
                stored.
              </Note>
              <dl
                style={{
                  margin: '10px 0 0',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(120px, max-content) 1fr',
                  gap: '6px 12px',
                  fontFamily: SANS,
                  fontSize: 12,
                  alignItems: 'baseline',
                }}
              >
                <Fact label="Device" value={session.device ?? EM} />
                <Fact label="Signed in" value={fmtMoment(session.signedInAt)} />
                <Fact label="Token expires" value={fmtMoment(session.expiresAt)} />
                <Fact label="Address" value={EM} />
              </dl>
              <p style={{ margin: '8px 0 0', fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>
                The address is a dash because the browser cannot see the address the gateway
                saw, and no endpoint reports it back.
              </p>
            </div>
          }
        />

        <ConnectionRow
          title="Other devices"
          subtitle="Everywhere else this account is signed in."
          state="unbuilt"
          reason="The gateway keeps no session register: signing out blacklists only the token presented with the request, and nothing records a device, an address or a last-seen. An empty list here would claim you are signed in nowhere else, which nothing in this product knows."
          controls={<Btn disabled>Sign out everywhere</Btn>}
        />
      </Rail>

      <Rail
        title="Second factor"
        icon={<KeyRound size={12} aria-hidden />}
        lead="This account can seal a purchase order. Neither protection below exists behind it yet."
      >
        <ConnectionRow
          title="Two-factor authentication"
          subtitle="A code from an authenticator app, on top of the password."
          state="unbuilt"
          reason="No second factor exists in the gateway — no secret, no enrolment, no verification step, no recovery codes (measured 2026-09-03 across the whole auth module). A toggle here would turn nothing on, so there is not one."
          controls={<Btn disabled>Turn on two-factor</Btn>}
        />
        <ConnectionRow
          title="Passkeys"
          subtitle="Sign in with the device you are already holding."
          state="unbuilt"
          reason="No WebAuthn registration or assertion route exists, and no credential store to put one in. Google sign-in is the only passwordless route this product has, and it is on the Connected accounts register."
          controls={<Btn disabled>Add a passkey</Btn>}
        />
      </Rail>

      <Rail
        title="Programmatic access"
        icon={<Terminal size={12} aria-hidden />}
        lead="What could call this product as you, without a browser."
      >
        <ConnectionRow
          title="API tokens"
          subtitle="A long-lived token for a script, a terminal, or another system."
          state="unbuilt"
          reason="The gateway issues no personal API tokens. Every call it accepts is authenticated with the short-lived JWT a sign-in produces, so there is nothing here to create, list or revoke — and no token of yours can be outstanding somewhere without your knowing."
          controls={<Btn disabled>Create a token</Btn>}
        />
      </Rail>
    </Register>
  );
}

export default SecurityRegister;
