/**
 * Register IV — Model context.
 *
 * FIRST PASS SAID "NOT BUILT". THIS ONE IS BUILT.
 * ----------------------------------------------
 * On 2026-09-02 this was one disabled row with the shape of a connection drawn
 * underneath it, because `grep -rniw mcp` matched nothing in the gateway, the
 * web app or the schema. The founder read the honest dash and asked for the
 * thing. It now runs on `apps/api-gateway/src/mcp-connections/` and the
 * `user_mcp_connections` table (migration 20260903094500): the list is a read,
 * Add is a write, Revoke is a write, and every one of them is scoped by the user
 * and the restaurant on the signed token.
 *
 * THE ONE THING STILL WORTH BEING HONEST ABOUT
 * --------------------------------------------
 * A row here is a DECLARATION, not traffic. Nothing in this product dispatches
 * to a model-context server yet, so `last_used_at` is null on every row and will
 * stay null until something calls. That is why the column is nullable in the
 * table rather than defaulting to the creation time, why "Last call" renders as
 * an em dash, and why the register's lead says it in one sentence instead of
 * letting a quiet column imply a quiet server.
 *
 * Claude's Connectors is the reference for the shape (DESIGN-FOUNDATION §6:
 * "one list of everything that acts on your behalf … each with its scope, its
 * last action and a revoke"). What §6 tells us to refuse is also taken: no raw
 * config-file editor. Three fields, and the transport is fixed to http(s)
 * because a local `command:` transport would run a process on our servers,
 * which is a decision and not a text box.
 */

import { useState } from 'react';
import { Boxes } from 'lucide-react';
import { EM, MONO, SANS, fmtDay, fmtMoment, parseScopes } from './pf-format';
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

function ScopeList({ scopes }: { scopes: string[] }) {
  if (scopes.length === 0) {
    return (
      <Note>
        No scope was granted with this server. It is declared, and it may call nothing —
        that is a real state, not a missing value.
      </Note>
    );
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {scopes.map((s) => (
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

export function McpRegister({ data }: { data: ProfileNextData }) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [scopeText, setScopeText] = useState('');
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);

  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));

  const parsed = parseScopes(scopeText);
  const canSubmit = name.trim().length >= 2 && /^https?:\/\/\S+$/.test(url.trim()) && !saving;

  const add = async () => {
    setMsg(null);
    setSaving(true);
    try {
      await data.addMcpServer({ name, url, scopes: parsed.scopes });
      setName('');
      setUrl('');
      setScopeText('');
      setAdding(false);
      setMsg({
        tone: 'done',
        text: 'Server declared. Nothing has called it — this product does not dispatch to model-context servers yet.',
      });
    } catch (e) {
      setMsg({ tone: 'error', text: `Not added — ${String((e as Error).message)}` });
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (server: McpServerVM) => {
    setMsg(null);
    setRevoking(server.id);
    try {
      await data.revokeMcpServer(server.id);
      setMsg({ tone: 'done', text: `${server.name} revoked. The row stays, marked revoked.` });
    } catch (e) {
      setMsg({ tone: 'error', text: `${server.name} was not revoked — ${String((e as Error).message)}` });
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
          of your own. Declaring one records the grant; it does not start any traffic,
          because nothing in this product dispatches to a model-context server yet. Every
          “Last call” below is therefore an em dash, and it is a true one.
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

      {servers.map((s) => (
        <ConnectionRow
          key={s.id}
          title={s.name}
          subtitle={
            <span style={{ fontFamily: MONO, fontSize: 11.5, wordBreak: 'break-all' }}>{s.url}</span>
          }
          state={s.status === 'active' ? 'connected' : 'unavailable'}
          reason={
            s.status === 'revoked'
              ? `Revoked ${fmtDay(s.revokedAt)}. The row is kept so a grant that once existed does not become indistinguishable from one that never did.`
              : null
          }
          controls={
            s.status === 'active' ? (
              <Btn onClick={() => void revoke(s)} disabled={revoking === s.id}>
                {revoking === s.id ? 'Revoking…' : 'Revoke'}
              </Btn>
            ) : undefined
          }
          detailOpen={open === s.id}
          onToggleDetail={() => toggle(s.id)}
          detailLabel="Scopes and dates"
          detail={
            <div>
              <ScopeList scopes={s.scopes} />
              <dl
                style={{
                  margin: '10px 0 0',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(110px, max-content) 1fr',
                  gap: '6px 12px',
                  fontFamily: SANS,
                  fontSize: 12,
                  alignItems: 'baseline',
                }}
              >
                <dt style={{ color: 'var(--ink-2)', fontWeight: 600 }}>Declared</dt>
                <dd style={{ margin: 0, color: 'var(--ink-3)' }}>{fmtMoment(s.createdAt)}</dd>
                <dt style={{ color: 'var(--ink-2)', fontWeight: 600 }}>Last call</dt>
                <dd style={{ margin: 0, color: 'var(--ink-3)' }}>
                  {s.lastUsedAt ? fmtMoment(s.lastUsedAt) : `${EM} — nothing has called it`}
                </dd>
              </dl>
            </div>
          }
        />
      ))}

      {data.mcpState !== 'idle' && (
        <div style={{ marginTop: 12 }}>
          {adding ? (
            <Card
              title="Declare a server"
              lead="Three fields, and only three. A raw config editor is what this idiom refuses — the operator is a restaurateur, not a developer."
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
                    http or https only. A local command transport would run a process on our
                    servers, which is a decision rather than a field.
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
          revoked rows are kept above.
        </p>
      )}
    </Register>
  );
}

export default McpRegister;
