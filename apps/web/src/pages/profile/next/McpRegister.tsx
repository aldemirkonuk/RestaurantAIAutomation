/**
 * Register IV — Model context.
 *
 * THREE PASSES, AND THE THIRD IS THE ONE THAT CALLS.
 * -------------------------------------------------
 * 2026-09-02: one disabled row with the shape of a connection drawn under it,
 * because `grep -rniw mcp` matched nothing in the gateway, the web app or the
 * schema.
 * 2026-09-03, morning: a real register — list, add, revoke — over
 * `apps/api-gateway/src/mcp-connections/` and `user_mcp_connections`
 * (migration 20260903094500). It was honest that a row was a DECLARATION and
 * that "Last call" would stay an em dash, because nothing dispatched.
 * 2026-09-03, this pass: something dispatches. `POST /mcp-connections/:id/probe`
 * performs the Model Context Protocol handshake over Streamable HTTP
 * (`initialize` → `notifications/initialized` → `tools/list`,
 * `apps/api-gateway/src/mcp-runtime/`), with a per-connection credential
 * encrypted at rest, a deadline and a size cap. "Last call", "Last answered",
 * the status and the tool names are readings now, not shapes.
 *
 * THE FOUR SENTENCES THIS REGISTER REFUSES TO COLLAPSE
 * ---------------------------------------------------
 *   · **never checked** — no probe has run. The chip is an em dash, not "ok".
 *   · **checked and it answered** — `Connected`, with what it said its name and
 *     version were, and the tools it listed.
 *   · **checked and it did not** — `Unavailable`, with the server's own words:
 *     a 500, a redirect, a timeout and a body of the wrong shape are four
 *     different lines, because they have four different fixes.
 *   · **could not be checked** — a credential is stored that this deployment
 *     cannot decrypt, so nothing was called. Not an anonymous call that
 *     happened to succeed. (This one shares a chip with the previous case and
 *     is separated by its sentence — see `chipFor`.)
 *
 * WHAT IS STILL NOT HERE, AND WHY IT IS A DECISION
 * -----------------------------------------------
 * No tool can be CALLED from this page, and there is no route to call one.
 * Listing a tool is a read; invoking one can send an email, place an order or
 * otherwise bind the restaurant, which is exactly what ADR 0013's commitment
 * guardrail governs — and that decision has not been taken for model-context
 * dispatch. The sentence on the row comes from `GET /mcp-connections/runtime`,
 * so the page states the SERVER's rule rather than a promise of its own.
 *
 * Claude's Connectors is the reference for the shape (DESIGN-FOUNDATION §6:
 * "one list of everything that acts on your behalf … each with its scope, its
 * last action and a revoke"). "Its last action" was the half that could not be
 * built in the morning; it is built here. What §6 tells us to refuse is also
 * taken: no raw config-file editor. The transport is fixed to http(s) because a
 * local `command:` transport would run a process on our servers, which is a
 * decision and not a text box.
 */

import { useState } from 'react';
import { Boxes } from 'lucide-react';
import { EM, MONO, SANS, SERIF, fmtDay, fmtMoment, parseScopes } from './pf-format';
import {
  Btn,
  Card,
  ConnectionRow,
  Field,
  Note,
  Register,
  RetryLink,
  StatusLine,
} from './pf-ui';
import type { McpServerVM, ProfileNextData } from './useProfileNextData';

type ConnectionState = Parameters<typeof ConnectionRow>[0]['state'];

/**
 * The chip a reader skims. `unknown` for a server nobody has checked is the
 * load-bearing case: every other state is a measurement, and this one is the
 * absence of one — giving it `Not connected` would be a claim about a server we
 * have never spoken to.
 *
 * The chip is THREE-way where the sentence under it is four-way, and that is
 * deliberate rather than a shortfall. `unconfigured` (a stored credential this
 * deployment cannot decrypt) shares `Unavailable` with a server that answered
 * badly, because the existing chip vocabulary is shared with the payment
 * register and its fifth word, `Provider not connected`, means something else
 * entirely there. Inventing a sixth for one case would make every other
 * register's chip mean slightly less. The distinction survives in full in the
 * `reason` line, which is always rendered directly beneath the title.
 */
function chipFor(server: McpServerVM): ConnectionState {
  if (server.status === 'revoked') return 'unavailable';
  if (!server.probe) return 'unknown';
  return server.probe.status === 'ok' ? 'connected' : 'unavailable';
}

function Chips({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <Note>{empty}</Note>;
  return (
    <ul
      style={{
        margin: 0,
        paddingLeft: 0,
        listStyle: 'none',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
      }}
    >
      {items.map((s) => (
        <li
          key={s}
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            padding: '2px 8px',
            borderRadius: 999,
            border: '1px solid var(--paper-2)',
            color: 'var(--ink-2)',
          }}
        >
          {s}
        </li>
      ))}
    </ul>
  );
}

/** A definition list of dates. Unknowns are em dashes with their reason. */
function Dates({ rows }: { rows: [string, string][] }) {
  return (
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
      {rows.map(([term, value]) => (
        <div key={term} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{term}</dt>
          <dd style={{ margin: 0, color: 'var(--ink-3)' }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The credential, as a date and a control — never as a value.
 *
 * The field is `type="password"` and the register never receives the stored
 * secret from any route, so there is nothing here that could pre-fill it. What
 * the row can say is WHEN one was set, which is the honest half.
 */
function SecretControl({
  server,
  data,
  onMessage,
}: {
  server: McpServerVM;
  data: ProfileNextData;
  onMessage: (m: { tone: 'error' | 'done'; text: string }) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const runtime = data.mcpRuntime;
  const storable = runtime?.secretStorage.configured === true;

  const save = async (secret: string | null) => {
    setBusy(true);
    try {
      await data.setMcpSecret(server.id, secret);
      setValue('');
      onMessage({
        tone: 'done',
        text: secret
          ? `A credential is stored for ${server.name}. It is encrypted, and no route returns it.`
          : `The credential for ${server.name} was cleared. It will be called without one.`,
      });
    } catch (e) {
      onMessage({
        tone: 'error',
        text: `${server.name}: ${String((e as Error).message)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <Field
        id={`pf-mcp-secret-${server.id}`}
        label="Credential"
        type="password"
        value={value}
        onChange={setValue}
        disabled={!storable || busy}
        autoComplete="off"
        placeholder={server.hasSecret ? 'Replace the stored credential' : 'Bearer token, if this server needs one'}
        hint={
          <Note>
            {runtime === null
              ? 'This deployment did not report whether it can store a credential, so the field is disabled rather than accepting one it might drop.'
              : storable
                ? 'Sent once, encrypted before it is stored, and never returned by any route. This register can tell you the date it was set and nothing else about it.'
                : runtime.secretStorage.reason}
          </Note>
        }
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn
          onClick={() => void save(value)}
          disabled={!storable || busy || value.trim().length === 0}
        >
          {busy ? 'Storing…' : server.hasSecret ? 'Replace credential' : 'Store credential'}
        </Btn>
        {server.hasSecret && (
          <Btn onClick={() => void save(null)} disabled={busy}>
            Clear it
          </Btn>
        )}
      </div>
    </div>
  );
}

export function McpRegister({ data }: { data: ProfileNextData }) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [scopeText, setScopeText] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [probing, setProbing] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);

  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));

  const runtime = data.mcpRuntime;
  const canStoreSecret = runtime?.secretStorage.configured === true;
  const parsed = parseScopes(scopeText);
  const canSubmit =
    name.trim().length >= 2 && /^https?:\/\/\S+$/.test(url.trim()) && !saving;

  const add = async () => {
    setMsg(null);
    setSaving(true);
    try {
      await data.addMcpServer({
        name,
        url,
        scopes: parsed.scopes,
        secret: canStoreSecret && secret.trim() ? secret : undefined,
      });
      setName('');
      setUrl('');
      setScopeText('');
      setSecret('');
      setAdding(false);
      setMsg({
        tone: 'done',
        text: 'Server declared. Nothing has been called yet — use “Check the server” to shake hands with it.',
      });
    } catch (e) {
      setMsg({ tone: 'error', text: `Not added — ${String((e as Error).message)}` });
    } finally {
      setSaving(false);
    }
  };

  const probe = async (server: McpServerVM) => {
    setMsg(null);
    setProbing(server.id);
    try {
      await data.probeMcpServer(server.id);
      // Deliberately no success sentence here: the ROW now carries the answer,
      // and a cheerful "checked!" beside a row that says "unreachable" would be
      // the page congratulating itself on a failure.
      setOpen(server.id);
    } catch (e) {
      setMsg({
        tone: 'error',
        text: `${server.name} was not checked — ${String((e as Error).message)}`,
      });
    } finally {
      setProbing(null);
    }
  };

  const revoke = async (server: McpServerVM) => {
    setMsg(null);
    setRevoking(server.id);
    try {
      await data.revokeMcpServer(server.id);
      setMsg({
        tone: 'done',
        text: `${server.name} revoked. The row stays, marked revoked, and its stored credential was destroyed.`,
      });
    } catch (e) {
      setMsg({
        tone: 'error',
        text: `${server.name} was not revoked — ${String((e as Error).message)}`,
      });
    } finally {
      setRevoking(null);
    }
  };

  const servers = data.mcpServers;
  const live = servers.filter((s) => s.status === 'active').length;

  return (
    <Register
      eyebrow="Register IV"
      icon={<Boxes size={13} aria-hidden />}
      title="Model context"
      lead={
        <Note>
          Servers the house agents may call — a POS bridge, a supplier catalogue, a server
          of your own. Declaring one records the grant; checking one shakes hands with it
          over the Model Context Protocol and writes down what answered. Tools can be
          listed here and not called: that is a decision, and it is stated below.
        </Note>
      }
    >
      {data.mcpState === 'loading' && <Note>Reading the model-context register…</Note>}

      {data.mcpState === 'error' && (
        <StatusLine tone="error">
          The model-context register could not be read ({data.mcpError}). This is not an
          empty register — it is an unread one, and no server below is being claimed either
          way. <RetryLink onClick={data.refetchMcp} />
        </StatusLine>
      )}

      {data.mcpState === 'idle' && (
        <Note>
          No restaurant is active on this session, so there is no register to address.
        </Note>
      )}

      {data.mcpState === 'ok' && servers.length === 0 && (
        <Note>
          No model-context server is declared for this restaurant. That is the register
          reporting nothing, not the register failing to answer.
        </Note>
      )}

      {servers.map((s) => {
        const p = s.probe;
        const answered = p?.status === 'ok';
        return (
          <ConnectionRow
            key={s.id}
            title={s.name}
            subtitle={
              <span style={{ fontFamily: MONO, fontSize: 11.5, wordBreak: 'break-all' }}>
                {s.url}
              </span>
            }
            state={chipFor(s)}
            reason={
              s.status === 'revoked'
                ? `Revoked ${fmtDay(s.revokedAt)}. The row is kept so a grant that once existed does not become indistinguishable from one that never did.`
                : p
                  ? p.detail
                  : 'This server has never been checked, so nothing is claimed about it either way. “Check the server” shakes hands with it.'
            }
            controls={
              s.status === 'active' ? (
                <>
                  <Btn onClick={() => void probe(s)} disabled={probing === s.id}>
                    {probing === s.id ? 'Checking…' : p ? 'Check again' : 'Check the server'}
                  </Btn>
                  <Btn onClick={() => void revoke(s)} disabled={revoking === s.id}>
                    {revoking === s.id ? 'Revoking…' : 'Revoke'}
                  </Btn>
                </>
              ) : undefined
            }
            detailOpen={open === s.id}
            onToggleDetail={() => toggle(s.id)}
            detailLabel="Scopes, tools and dates"
            detail={
              <div>
                {answered && (p.serverName || p.serverVersion) && (
                  <p
                    style={{
                      margin: '0 0 10px',
                      fontFamily: SERIF,
                      fontSize: 15.5,
                      color: 'var(--ink-1)',
                    }}
                  >
                    {p.serverName ?? 'An unnamed server'}
                    {p.serverVersion ? ` ${p.serverVersion}` : ''}
                    {p.protocolVersion ? (
                      <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3)' }}>
                        {'  '}
                        {p.protocolVersion}
                      </span>
                    ) : null}
                  </p>
                )}

                <h4
                  style={{
                    margin: '0 0 4px',
                    fontFamily: SANS,
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: 'var(--ink-2)',
                  }}
                >
                  Scopes granted
                </h4>
                <Chips
                  items={s.scopes}
                  empty="No scope was granted with this server. It is declared, and it may call nothing — that is a real state, not a missing value."
                />

                <h4
                  style={{
                    margin: '12px 0 4px',
                    fontFamily: SANS,
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: 'var(--ink-2)',
                  }}
                >
                  Tools it offers
                </h4>
                {p?.tools === null || p === null ? (
                  <Note>
                    {EM} — the server has not been asked. A tool list is what a handshake
                    returns, so this stays a dash until one succeeds.
                  </Note>
                ) : (
                  <>
                    <Chips
                      items={p.tools.map((t) => t.name)}
                      empty="The server answered and offers no tools. That is its answer, not a failed read."
                    />
                    {p.toolCount !== null && p.toolCount > p.tools.length && (
                      <Note>
                        {p.tools.length} of {p.toolCount} shown — the rest were not read, so
                        this list is a sample and says so.
                      </Note>
                    )}
                    {p.tools.length > 0 && (
                      <Note>
                        {runtime?.invocation.reason ??
                          'Tools can be listed but not called from here; this deployment did not report the rule, so none is claimed.'}
                      </Note>
                    )}
                  </>
                )}

                <Dates
                  rows={[
                    ['Declared', fmtMoment(s.createdAt)],
                    [
                      'Last call',
                      s.lastProbeAt
                        ? fmtMoment(s.lastProbeAt)
                        : `${EM} — it has never been called`,
                    ],
                    [
                      'Last answered',
                      s.lastUsedAt
                        ? fmtMoment(s.lastUsedAt)
                        : `${EM} — it has never answered`,
                    ],
                    [
                      'Credential',
                      s.hasSecret
                        ? `stored ${fmtDay(s.secretSetAt)}`
                        : `${EM} — none stored; it is called without one`,
                    ],
                  ]}
                />

                {s.status === 'active' && (
                  <SecretControl server={s} data={data} onMessage={setMsg} />
                )}
              </div>
            }
          />
        );
      })}

      {data.mcpState !== 'idle' && (
        <div style={{ marginTop: 12 }}>
          {adding ? (
            <Card
              title="Declare a server"
              lead="Four fields, and only four. A raw config editor is what this idiom refuses — the operator is a restaurateur, not a developer."
            >
              <Field
                id="pf-mcp-name"
                label="Name"
                value={name}
                onChange={setName}
                placeholder="House POS bridge"
              />
              <Field
                id="pf-mcp-url"
                label="Endpoint"
                value={url}
                onChange={setUrl}
                placeholder="https://mcp.example.com"
                hint={
                  <Note>
                    http or https only, and it must be reachable from the public internet:
                    an address on a private network or a loopback address is refused when
                    the server is checked, because a gateway that fetches those on request
                    is a way into them. A local command transport would run a process on
                    our servers, which is a decision rather than a field.
                  </Note>
                }
              />
              <Field
                id="pf-mcp-scopes"
                label="Scopes granted"
                value={scopeText}
                onChange={setScopeText}
                placeholder="inventory:read orders:read"
                hint={
                  <Note>
                    Space- or comma-separated lowercase slugs. Leave it empty to declare a
                    server that may call nothing yet.
                    {parsed.rejected.length > 0 && (
                      <>
                        {' '}
                        Not a valid scope, and will be dropped:{' '}
                        <span style={{ fontFamily: MONO }}>{parsed.rejected.join(', ')}</span>.
                      </>
                    )}
                  </Note>
                }
              />
              <Field
                id="pf-mcp-secret"
                label="Credential"
                type="password"
                value={secret}
                onChange={setSecret}
                disabled={!canStoreSecret}
                autoComplete="off"
                placeholder="Bearer token, if this server needs one"
                hint={
                  <Note>
                    {runtime === null
                      ? 'This deployment did not report whether it can store a credential, so the field is disabled rather than accepting one it might drop.'
                      : canStoreSecret
                        ? 'Optional. Encrypted before it is stored and never returned by any route — a server that authenticates by network position needs none.'
                        : runtime.secretStorage.reason}
                  </Note>
                }
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn emphasis="seal" onClick={() => void add()} disabled={!canSubmit}>
                  {saving ? 'Saving…' : 'Declare server'}
                </Btn>
                <Btn onClick={() => setAdding(false)} disabled={saving}>
                  Cancel
                </Btn>
              </div>
              {!canSubmit && !saving && (
                <Note>A name of at least two characters and an http(s) endpoint are needed.</Note>
              )}
            </Card>
          ) : (
            <Btn emphasis="seal" onClick={() => setAdding(true)}>
              Add a server
            </Btn>
          )}
        </div>
      )}

      {msg && <StatusLine tone={msg.tone}>{msg.text}</StatusLine>}

      {data.mcpState === 'ok' && servers.length > 0 && (
        <p style={{ margin: '10px 0 0', fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)' }}>
          {live === 1 ? 'One server is live' : `${live} servers are live`} in this restaurant;
          revoked rows are kept above.{' '}
          {runtime
            ? `A check waits ${Math.round(runtime.probeTimeoutMs / 1000)}s before it calls a server unreachable.`
            : 'This deployment did not report how long a check waits, so no figure is given.'}
        </p>
      )}
    </Register>
  );
}

export default McpRegister;
