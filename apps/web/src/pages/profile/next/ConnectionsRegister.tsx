/**
 * Register III — Connected accounts.
 *
 * Two rails, both real:
 *
 *   1. Sign-in    — `GET /auth/me` (linked providers + hasPassword),
 *                   `POST/DELETE /auth/me/link/:provider`.
 *   2. Workspace  — `GET /integrations/oauth/catalog` + `/connections`, consent
 *                   at `/authorize/:id`, `DELETE /integrations/oauth/:id`.
 *
 * WHAT MOVED OUT, AND WHY THAT IS THE POINT
 * -----------------------------------------
 * The first pass put Model context and Payment here as two more rails, both
 * `Not built`, deliberately beside the working ones so the reader could compare
 * them. That was the right shape for a page whose honest answer was "these do
 * not exist". They exist now — a gateway module, a table and a migration each —
 * so they have become Registers IV and V, and this register is what its name
 * says: the accounts a person signs in with, and the workspaces those accounts
 * let us write to.
 *
 * The row shape did not change and never should. `ConnectionRow` still draws
 * every row on this page, in every register, so what separates a live Google
 * link from a passkey that has no backend is its state chip and whether its
 * control is live or `disabled` carrying a reason — never the amount of design
 * spent on it.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Link2, Plug } from 'lucide-react';
import { EM, SANS, fmtDay } from './pf-format';
import { Btn, ConnectionRow, Note, Rail, Register, RetryLink, StatusLine } from './pf-ui';
import { GoogleLink } from './GoogleLink';
import type { ProfileNextData } from './useProfileNextData';
// The catalogue's own id union, not a copy of it: a hard-coded pair here is how
// `gmail_send` shipped with a Disconnect handler that would not compile for it.
import type { IntegrationId } from '../../../services/api/integrations';

export function ConnectionsRegister({
  data,
  onGoToSecurity,
}: {
  data: ProfileNextData;
  onGoToSecurity: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [signInMsg, setSignInMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);
  const [workMsg, setWorkMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);

  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));

  const meUnknown = data.meState !== 'ok';
  const linked = data.linked;
  const lastCredential = data.credentialCount !== null && data.credentialCount <= 1;

  const unlink = async (provider: 'google' | 'microsoft', label: string) => {
    setSignInMsg(null);
    try {
      await data.unlinkProvider(provider);
      setSignInMsg({ tone: 'done', text: `${label} unlinked.` });
    } catch (e) {
      setSignInMsg({ tone: 'error', text: `${label} could not be unlinked — ${String((e as Error).message)}` });
    }
  };

  const disconnect = async (id: IntegrationId, label: string) => {
    setWorkMsg(null);
    try {
      await data.disconnectWorkspace(id);
      setWorkMsg({ tone: 'done', text: `${label} disconnected. The grant was revoked at the provider first.` });
    } catch (e) {
      setWorkMsg({ tone: 'error', text: `${label} could not be disconnected — ${String((e as Error).message)}` });
    }
  };

  return (
    <Register
      eyebrow="Register III"
      icon={<Link2 size={13} aria-hidden />}
      title="What is connected to you"
      lead={
        <Note>
          Every account attached to this one — a way in, and the workspaces those accounts
          let Mudavym write to. The chip on each row is the whole truth about it.
        </Note>
      }
    >
      {/* ── 1. sign-in ────────────────────────────────────────────────── */}
      <Rail
        title="Sign-in"
        icon={<KeyRound size={12} aria-hidden />}
        lead={
          meUnknown
            ? 'Your account record could not be read, so nothing below claims which methods you have.'
            : 'The ways this account can be entered. The server refuses to remove the last one.'
        }
      >
        <ConnectionRow
          title="Password"
          subtitle={
            data.hasPassword === null
              ? 'Unknown — the account record has not answered.'
              : data.hasPassword
                ? 'Email and password.'
                : 'Not set — you arrived through a linked account.'
          }
          state={
            data.hasPassword === null ? 'unknown' : data.hasPassword ? 'connected' : 'available'
          }
          controls={
            <Btn onClick={onGoToSecurity}>
              {data.hasPassword ? 'Change password' : 'Set a password'}
            </Btn>
          }
        />

        <ConnectionRow
          title="Google"
          subtitle={
            linked === null
              ? 'Unknown — the account record has not answered.'
              : linked.google
                ? 'Linked. You can sign in with Google.'
                : 'Not linked.'
          }
          state={linked === null ? 'unknown' : linked.google ? 'connected' : 'available'}
          reason={
            linked?.google && lastCredential
              ? 'This is your only sign-in method, so it cannot be unlinked. Set a password first.'
              : null
          }
          controls={
            linked === null ? null : linked.google ? (
              <Btn
                onClick={() => void unlink('google', 'Google')}
                disabled={lastCredential}
                title={lastCredential ? 'Set a password first' : undefined}
              >
                Unlink
              </Btn>
            ) : (
              <GoogleLink
                onLinked={() => {
                  void data.refreshLinked();
                  setSignInMsg({ tone: 'done', text: 'Google linked.' });
                }}
                onError={(m) => setSignInMsg({ tone: 'error', text: `Google was not linked — ${m}` })}
              />
            )
          }
        />

        <ConnectionRow
          title="Microsoft"
          subtitle={
            linked === null
              ? 'Unknown — the account record has not answered.'
              : linked.microsoft
                ? 'Linked.'
                : 'Not linked.'
          }
          state={linked === null ? 'unknown' : linked.microsoft ? 'connected' : 'unavailable'}
          reason={
            linked?.microsoft
              ? lastCredential
                ? 'This is your only sign-in method, so it cannot be unlinked. Set a password first.'
                : null
              : 'Microsoft has a working route on our side but no sign-in button anywhere in the app, so it cannot be linked from here. Unlinking an existing Microsoft account does work.'
          }
          controls={
            linked?.microsoft ? (
              <Btn onClick={() => void unlink('microsoft', 'Microsoft')} disabled={lastCredential}>
                Unlink
              </Btn>
            ) : (
              <Btn disabled>Connect</Btn>
            )
          }
        />
        {signInMsg && <StatusLine tone={signInMsg.tone}>{signInMsg.text}</StatusLine>}
        {data.meState === 'error' && (
          <StatusLine tone="error">
            The account record could not be read ({data.meError}). Phone, password state and
            linked accounts above are unknown — not empty.{' '}
            <RetryLink onClick={data.refetchMe} />
          </StatusLine>
        )}
      </Rail>

      {/* ── 2. workspace ──────────────────────────────────────────────── */}
      <Rail
        title="Workspace"
        icon={<Plug size={12} aria-hidden />}
        lead="Places Mudavym may write on your behalf. Narrow grants only — never your whole drive."
      >
        {data.workspaceState === 'loading' && <Note>Reading the connection register…</Note>}
        {data.workspaceState === 'error' && (
          <StatusLine tone="error">
            The integration catalogue could not be read ({data.workspaceError}), so this rail is
            empty for a reason that has nothing to do with what you have connected.{' '}
            <RetryLink onClick={data.refetchWorkspace} />
          </StatusLine>
        )}
        {data.connectionsUnreadable && (
          <StatusLine tone="error">
            The connection register did not answer — either the request failed, or it came
            back with no rows at all against a non-empty catalogue, which for that endpoint
            means the same thing. The rows below say “unknown”, not “not connected”.
          </StatusLine>
        )}
        {data.workspace.map((w) => (
          <ConnectionRow
            key={w.id}
            title={w.label}
            subtitle={
              w.state === 'connected'
                ? `${w.account ?? 'Account unnamed'} · connected ${fmtDay(w.connectedAt)}`
                : w.description
            }
            state={w.state}
            reason={w.blockedReason}
            controls={
              w.state === 'connected' ? (
                <Btn onClick={() => void disconnect(w.id, w.label)}>Disconnect</Btn>
              ) : w.state === 'available' ? (
                <Link
                  to={`/authorize/${w.id}?returnPath=/profile`}
                  className="pf-btn pf-focus"
                  style={{
                    fontFamily: SANS,
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--seal-ring)',
                    color: 'var(--seal-deep)',
                    textDecoration: 'none',
                  }}
                >
                  Connect {w.providerLabel}
                </Link>
              ) : (
                <Btn disabled>Connect {w.providerLabel}</Btn>
              )
            }
            detailOpen={open === w.id}
            onToggleDetail={() => toggle(w.id)}
            detailLabel={w.state === 'connected' ? 'What you granted' : 'What it would ask for'}
            detail={
              <div>
                {w.state === 'connected' ? (
                  w.grantedScopes.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: 18, fontFamily: SANS, fontSize: 12, color: 'var(--ink-2)' }}>
                      {w.grantedScopes.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  ) : (
                    <Note>The grant recorded no scopes — {EM}.</Note>
                  )
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18, fontFamily: SANS, fontSize: 12, color: 'var(--ink-2)' }}>
                    {w.requestedScopes.map((s) => (
                      <li key={s.scope} style={{ marginBottom: 4 }}>
                        <strong style={{ fontWeight: 600 }}>{s.label}</strong> — {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
                {w.notRequested.length > 0 && (
                  <p style={{ margin: '8px 0 0', fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>
                    Never asked for: {w.notRequested.join('; ')}.
                  </p>
                )}
              </div>
            }
          />
        ))}
        {workMsg && <StatusLine tone={workMsg.tone}>{workMsg.text}</StatusLine>}
      </Rail>
    </Register>
  );
}

export default ConnectionsRegister;
