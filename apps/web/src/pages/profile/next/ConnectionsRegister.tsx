/**
 * The Connections register — the founder's three additions, plus the two that
 * are already real, on ONE row shape.
 *
 * Four rails, in descending order of how real they are:
 *
 *   1. Sign-in        — real. `GET /auth/me` (linked providers + hasPassword),
 *                       `POST/DELETE /auth/me/link/:provider`.
 *   2. Workspace      — real. `GET /integrations/oauth/catalog` +
 *                       `/connections`, consent at `/authorize/:id`,
 *                       `DELETE /integrations/oauth/:id`.
 *   3. Model context  — NO BACKEND. Stated in one line, shape shown, controls
 *                       disabled. Measured 2026-09-02: zero matches for `mcp`
 *                       in `apps/api-gateway/src`, `apps/web/src` and
 *                       `supabase/migrations`.
 *   4. Payment        — the billing contact is real (it is the restaurant
 *                       record); the card and the plan are not. The plan is
 *                       the interesting one: it EXISTS
 *                       (`restaurants.subscription_tier`) and no endpoint
 *                       returns it, so it is `unknown`, not `unbuilt`, and it
 *                       renders as an em dash. The shipping page prints
 *                       "Plan: Free" from a hardcoded constant
 *                       (Profile.tsx:90, rendered :723).
 *
 * Putting the dark rails in the same register as the live ones is the whole
 * point: the reader compares them side by side, and what tells them apart is
 * the state chip plus whether the control is a live link or a disabled one
 * carrying its reason — never the amount of design spent on the row.
 * Splitting them into a "coming soon" box would have let the missing halves
 * look like a different kind of thing.
 */

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EM, SANS, fmtDay, roleLabel } from './pf-format';
import { Btn, Card, ConnectionRow, Field, Note, Register, RetryLink, StatusLine } from './pf-ui';
import { GoogleLink } from './GoogleLink';
import type { ProfileNextData } from './useProfileNextData';

/* ── the shapes of the two unbuilt rails, as field descriptors ─────────── */

const MCP_SHAPE = [
  { id: 'server', label: 'Server', hint: 'The name you give it, and where it answers.' },
  { id: 'transport', label: 'Transport', hint: 'How we reach it — a URL, or a local command.' },
  { id: 'tools', label: 'Tools exposed', hint: 'What the server offers the house agents.' },
  { id: 'scope', label: 'Who may call it', hint: 'Which agents, at which restaurant.' },
  { id: 'handshake', label: 'Last handshake', hint: 'When it last answered, and with what.' },
];

const CARD_SHAPE = [
  { id: 'method', label: 'Method', hint: 'Card, bank debit, or invoice.' },
  { id: 'holder', label: 'Held by', hint: 'The name on the instrument.' },
  { id: 'expiry', label: 'Expires', hint: 'So a lapse is caught before a failed charge.' },
  { id: 'next', label: 'Next charge', hint: 'Amount and date, once a plan has a price.' },
  { id: 'receipts', label: 'Receipts', hint: 'Every past charge, downloadable.' },
];

function Shape({
  rows,
  intro,
  can,
}: {
  rows: { id: string; label: string; hint: string }[];
  intro: string;
  can: string[];
}) {
  return (
    <div>
      <Note>{intro}</Note>
      <dl
        style={{
          margin: '10px 0 0',
          display: 'grid',
          gridTemplateColumns: 'minmax(120px, max-content) 1fr auto',
          gap: '6px 12px',
          fontFamily: SANS,
          fontSize: 12,
          alignItems: 'baseline',
        }}
      >
        {rows.map((r) => (
          <div key={r.id} style={{ display: 'contents' }}>
            <dt style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{r.label}</dt>
            <dd style={{ margin: 0, color: 'var(--ink-3)' }}>{r.hint}</dd>
            <dd style={{ margin: 0, color: 'var(--ink-3)' }}>{EM}</dd>
          </div>
        ))}
      </dl>
      <p
        style={{
          margin: '10px 0 0',
          fontFamily: SANS,
          fontSize: 12,
          color: 'var(--ink-2)',
          lineHeight: 1.6,
        }}
      >
        What it will let you do: {can.join('; ')}.
      </p>
    </div>
  );
}

/* ── rail heading ─────────────────────────────────────────────────────── */

function Rail({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <h3
        style={{
          margin: 0,
          fontFamily: SANS,
          fontSize: 12.5,
          fontWeight: 700,
          letterSpacing: '0.01em',
          color: 'var(--ink-1)',
        }}
      >
        {title}
      </h3>
      <p style={{ margin: '2px 0 10px', fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>
        {lead}
      </p>
      {children}
    </div>
  );
}

/* ── the register ─────────────────────────────────────────────────────── */

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
  const [billingEmail, setBillingEmail] = useState<string | null>(null);
  const [billingPhone, setBillingPhone] = useState<string | null>(null);
  const [billingMsg, setBillingMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(
    null,
  );
  const [savingBilling, setSavingBilling] = useState(false);

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

  const disconnect = async (id: 'google_drive' | 'excel', label: string) => {
    setWorkMsg(null);
    try {
      await data.disconnectWorkspace(id);
      setWorkMsg({ tone: 'done', text: `${label} disconnected. The grant was revoked at the provider first.` });
    } catch (e) {
      setWorkMsg({ tone: 'error', text: `${label} could not be disconnected — ${String((e as Error).message)}` });
    }
  };

  /* billing contact — the one real half of the payment rail */
  const loc = data.location;
  const locReadable = data.locationState === 'ok' && loc !== null;
  const emailValue = billingEmail ?? loc?.billingEmail ?? '';
  const phoneValue = billingPhone ?? loc?.billingPhone ?? '';

  const saveBilling = async () => {
    setBillingMsg(null);
    setSavingBilling(true);
    try {
      await data.saveBillingContact(emailValue, phoneValue);
      setBillingEmail(null);
      setBillingPhone(null);
      setBillingMsg({ tone: 'done', text: 'Billing contact saved to the restaurant record.' });
    } catch (e) {
      setBillingMsg({ tone: 'error', text: `Not saved — ${String((e as Error).message)}` });
    } finally {
      setSavingBilling(false);
    }
  };

  return (
    <Register
      eyebrow="Register II"
      title="What is connected to you"
      lead={
        <Note>
          Every attachment this account has — a way in, a workspace, a tool, a way to be
          billed — in one shape. The chip on each row is the whole truth about it.
        </Note>
      }
    >
      {/* ── 1. sign-in ────────────────────────────────────────────────── */}
      <Rail
        title="Sign-in"
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

      {/* ── 3. model context (MCP) — no backend ───────────────────────── */}
      <Rail
        title="Model context"
        lead="No MCP backend exists yet: nothing in the gateway, the web app or the schema serves or stores a model-context connection (measured 2026-09-02). Nothing below is connectable."
      >
        <ConnectionRow
          title="Model-context servers"
          subtitle="Give the house agents a tool they can call — a POS, a supplier catalogue, a server of your own."
          state="unbuilt"
          reason="There is no endpoint to call and no table to write, so this control is disabled rather than drawn as a working one."
          controls={<Btn disabled>Add a server</Btn>}
          detailOpen={open === 'mcp'}
          onToggleDetail={() => toggle('mcp')}
          detailLabel="Show the shape"
          detail={
            <Shape
              rows={MCP_SHAPE}
              intro="When it exists, each connected server will be one row on this rail carrying:"
              can={[
                'point an agent at a tool without a code change',
                'see exactly which tools a server exposes before you trust it',
                'scope a server to one restaurant',
                'revoke it in one action, the way a workspace grant revokes',
              ]}
            />
          }
        />
      </Rail>

      {/* ── 4. payment ────────────────────────────────────────────────── */}
      <Rail
        title="Payment"
        lead="One half of this is real. The billing contact is the restaurant's own record and saves today; there is no payment provider integrated anywhere in this product (measured 2026-09-02: no Stripe or comparable client, no billing table, no subscription row)."
      >
        {data.isManagerOrOwner ? (
          <Card
            title="Billing contact"
            lead="Where invoices and plan notices would go. Saved onto the restaurant record."
          >
            {data.locationState === 'loading' && <Note>Reading the restaurant record…</Note>}
            {data.locationState === 'error' && (
              <StatusLine tone="error">
                The restaurant record could not be read ({data.locationError}). The fields stay
                empty and saving is refused — a value nobody read must not be written back.{' '}
                <RetryLink onClick={data.refetchLocation} />
              </StatusLine>
            )}
            <div style={{ marginTop: 10 }}>
              <Field
                id="pf-billing-email"
                label="Billing email"
                type="email"
                value={emailValue}
                onChange={setBillingEmail}
                disabled={!locReadable}
                placeholder="billing@restaurant.com"
              />
              <Field
                id="pf-billing-phone"
                label="Billing phone"
                type="tel"
                value={phoneValue}
                onChange={setBillingPhone}
                disabled={!locReadable}
                placeholder="+1 555 000 0000"
              />
              <Btn
                emphasis="seal"
                onClick={() => void saveBilling()}
                disabled={!locReadable || savingBilling}
              >
                {savingBilling ? 'Saving…' : 'Save billing contact'}
              </Btn>
            </div>
            {billingMsg && <StatusLine tone={billingMsg.tone}>{billingMsg.text}</StatusLine>}
          </Card>
        ) : (
          <ConnectionRow
            title="Billing contact"
            subtitle="Where invoices and plan notices would go."
            state="unknown"
            reason={`Managers and owners change the billing contact, and the server refuses the write for anyone else. Your role here is ${roleLabel(data.role)}, so this page does not show it — that is this page's choice: the underlying read is open to any member of the organisation.`}
          />
        )}

        <ConnectionRow
          title="Payment method"
          subtitle="A card, a debit, or an invoice arrangement to charge against."
          state="unbuilt"
          reason="No payment provider is wired into this product — there is no client, no webhook and no stored instrument. Adding one is a decision, not a switch."
          controls={<Btn disabled>Add a payment method</Btn>}
          detailOpen={open === 'card'}
          onToggleDetail={() => toggle('card')}
          detailLabel="Show the shape"
          detail={
            <Shape
              rows={CARD_SHAPE}
              intro="When a provider is chosen, the instrument on file will be one row carrying:"
              can={[
                'add and replace an instrument without leaving this page',
                'see the next charge before it happens',
                'download every past receipt',
                'hand billing to someone else without handing over the account',
              ]}
            />
          }
        />

        <ConnectionRow
          title="Plan"
          subtitle={
            <>
              Your restaurant is on a plan today and it already decides something real — the
              ceiling on model spend. Its value is <span style={{ fontVariantNumeric: 'tabular-nums' }}>{EM}</span> here.
            </>
          }
          state="unknown"
          reason="The plan lives on the restaurant record but no endpoint returns it to the browser, so this page cannot say which one you are on. It shows a dash rather than a guess."
        />
      </Rail>
    </Register>
  );
}

export default ConnectionsRegister;
