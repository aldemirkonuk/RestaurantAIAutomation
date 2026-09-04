/**
 * The two manager acts that arrived with the collapse: declare a server, and
 * revoke one.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The founder's call of 2026-09-04 — "Move the registers and collapse the four
 * tabs" — takes the model-context register off `/profile`. Four of its controls
 * are gated at the gateway by `assertCanManageRestaurant`
 * (`mcp-connections.controller.ts:150` create, `:174` probe, `:188` secret,
 * `:203` revoke), so all four are the house's and belong on the manager-only
 * surface. Probe already lives on the row above. Declare and revoke did not,
 * and the row said so in words ("it is on /profile until this register moves
 * fully"). A move that leaves a control behind is not a move; it is a deletion
 * with a signpost. So they moved here.
 *
 * Setting a credential is deliberately part of DECLARING and nothing else: the
 * separate "change this server's credential" control stayed behind with the
 * register that had a place to put it, and its absence is stated on the panel
 * rather than left to be discovered. `PUT /:id/secret` is untouched and still
 * answers; what is missing is a button, and the panel says which.
 *
 * SELF-CONTAINED ON PURPOSE, AND WITHOUT REACT-QUERY
 * --------------------------------------------------
 * Plain `apiClient` calls and one `onChanged` callback, not `useMutation`.
 * That is not a style choice: `ConnectionsNext`'s render-contract test mocks
 * `useConnectionsNextData` and mounts the page with no `QueryClientProvider`,
 * so a `useQueryClient()` in here takes the whole page's test suite down with
 * "No QueryClient set" — measured, 23 of 25 failing. A panel that can be
 * mounted anywhere is also one that can be moved again the day the ownership
 * fork (ADR 0114, "what this decision does NOT settle") is answered.
 *
 * HONESTY
 * -------
 *   - Every refusal is the gateway's own sentence. There is no "try again".
 *   - The credential field is disabled, carrying the deployment's reason, when
 *     `MCP_CONNECTION_SECRET_KEY` is absent — a field that accepted a secret
 *     the server would drop is worse than no field.
 *   - Revoke is behind the seal. It destroys a stored credential and cannot be
 *     undone by re-declaring: the old row stays revoked. That is the house's
 *     die, pressed once.
 *   - A non-manager sees the panel refuse in words before the click, because
 *     the gateway refuses after it, and only one of those is a page telling
 *     the truth.
 */

import { useState } from 'react';
import { Plus, ShieldOff } from 'lucide-react';
import { HoldToApprove } from '../../../components/mudavym';
import { apiClient, getErrorMessage } from '../../../services/api/client';
import type { McpRuntimeVM, McpServerVM } from './useConnectionsNextData';

const ICON = { width: 14, height: 14, strokeWidth: 1.8 } as const;

/** Space- or comma-separated lowercase slugs; anything else is named and dropped. */
export function parseScopes(raw: string): { scopes: string[]; rejected: string[] } {
  const scopes: string[] = [];
  const rejected: string[] = [];
  for (const part of raw.split(/[\s,]+/).filter(Boolean)) {
    if (/^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)*$/.test(part)) scopes.push(part);
    else rejected.push(part);
  }
  return { scopes, rejected };
}

const FIELD: React.CSSProperties = {
  width: '100%',
  fontFamily: 'inherit',
  fontSize: 12.5,
  padding: '7px 9px',
  borderRadius: 4,
  border: '1px solid var(--paper-2)',
  background: 'var(--paper-0)',
  color: 'var(--ink-1)',
};

function Row({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label
        htmlFor={id}
        className="cx-col-h"
        style={{ marginBottom: 4, display: 'block' }}
      >
        {label}
      </label>
      {children}
      {hint ? <p className="cx-ctl-note">{hint}</p> : null}
    </div>
  );
}

export interface HouseServerControlsProps {
  servers: McpServerVM[];
  runtime: McpRuntimeVM | null;
  /** Manager or owner. A false renders the refusal, never a hidden panel. */
  canManage: boolean;
  /** Re-read the register after a write. `useConnectionsNextData.refetchMcp`. */
  onChanged?: () => void;
}

export function HouseServerControls({
  servers,
  runtime,
  canManage,
  onChanged,
}: HouseServerControlsProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [scopeText, setScopeText] = useState('');
  const [secret, setSecret] = useState('');
  const [declaring, setDeclaring] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);

  const declare = async () => {
    setMsg(null);
    setDeclaring(true);
    try {
      const trimmed = secret.trim();
      await apiClient.post('/mcp-connections', {
        name: name.trim(),
        url: url.trim(),
        scopes: parseScopes(scopeText).scopes,
        // Omitted rather than sent empty — the gateway refuses an empty secret,
        // and "no credential" is a different request from "a blank one".
        ...(runtime?.secretStorage.configured && trimmed ? { secret: trimmed } : {}),
      });
      setName('');
      setUrl('');
      setScopeText('');
      setSecret('');
      setOpen(false);
      setMsg({
        tone: 'done',
        text: 'Declared. Nothing has been called yet — use “Check again” on its row to shake hands with it.',
      });
      onChanged?.();
    } catch (e) {
      setMsg({ tone: 'error', text: `Not declared — ${getErrorMessage(e)}` });
    } finally {
      setDeclaring(false);
    }
  };

  const revoke = async (id: string, serverName: string) => {
    setMsg(null);
    setRevoking(id);
    try {
      await apiClient.delete(`/mcp-connections/${id}`);
      setMsg({
        tone: 'done',
        text: `${serverName} revoked. The row stays, marked revoked, and its stored credential was destroyed — a grant that once existed must not become indistinguishable from one that never did.`,
      });
      onChanged?.();
    } catch (e) {
      setMsg({ tone: 'error', text: `${serverName} was not revoked — ${getErrorMessage(e)}` });
    } finally {
      setRevoking(null);
    }
  };

  const parsed = parseScopes(scopeText);
  const canStoreSecret = runtime?.secretStorage.configured === true;
  const valid = name.trim().length >= 2 && /^https?:\/\/\S+$/.test(url.trim());
  const live = servers.filter((s) => s.status === 'active');

  if (!canManage) {
    return (
      <p className="cx-ctl-note" style={{ marginTop: 10, maxWidth: 640 }}>
        Declaring a server and revoking one are the house&rsquo;s acts, and the
        gateway refuses both for anyone who is not a manager or an owner. They
        are not hidden from you — they are listed here so the register says what
        exists and who may do it.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 12, maxWidth: 640 }}>
      {open ? (
        <div
          style={{
            border: '1px solid var(--paper-2)',
            borderRadius: 6,
            padding: '14px 15px',
            background: 'var(--paper-1)',
          }}
        >
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--ink-2)' }}>
            <strong style={{ color: 'var(--ink-1)' }}>Declare a server.</strong> Four
            fields, and only four. A raw configuration editor is what this idiom
            refuses — the operator runs a restaurant.
          </p>

          <Row id="cx-mcp-name" label="Name">
            <input
              id="cx-mcp-name"
              style={FIELD}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="House POS bridge"
            />
          </Row>

          <Row
            id="cx-mcp-url"
            label="Endpoint"
            hint="http or https, reachable from the public internet. A private-network or loopback address is refused when the server is checked, because a gateway that fetches those on request is a way into them."
          >
            <input
              id="cx-mcp-url"
              style={FIELD}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com"
            />
          </Row>

          <Row
            id="cx-mcp-scopes"
            label="Scopes granted"
            hint={
              <>
                Space- or comma-separated lowercase slugs. Leave it empty to
                declare a server that may call nothing yet.
                {parsed.rejected.length > 0 ? (
                  <> Not a valid scope, and will be dropped: {parsed.rejected.join(', ')}.</>
                ) : null}
              </>
            }
          >
            <input
              id="cx-mcp-scopes"
              style={FIELD}
              value={scopeText}
              onChange={(e) => setScopeText(e.target.value)}
              placeholder="inventory:read orders:read"
            />
          </Row>

          <Row
            id="cx-mcp-secret"
            label="Credential"
            hint={
              runtime === null
                ? 'This deployment did not report whether it can store a credential, so the field is disabled rather than accepting one it might drop.'
                : canStoreSecret
                  ? 'Optional. Encrypted before it is stored and never returned by any route — a server that authenticates by network position needs none. Changing it afterwards is not built on this page: the route answers, the button does not exist yet.'
                  : (runtime.secretStorage.reason ??
                    'This deployment cannot store a credential, so the field is disabled.')
            }
          >
            <input
              id="cx-mcp-secret"
              type="password"
              autoComplete="off"
              style={{ ...FIELD, opacity: canStoreSecret ? 1 : 0.55 }}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={!canStoreSecret}
              placeholder="Bearer token, if this server needs one"
            />
          </Row>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className="cx-btn is-seal"
              onClick={() => void declare()}
              disabled={!valid || declaring}
            >
              {declaring ? 'Declaring…' : 'Declare server'}
            </button>
            <button
              type="button"
              className="cx-btn"
              onClick={() => setOpen(false)}
              disabled={declaring}
            >
              Cancel
            </button>
          </div>
          {!valid ? (
            <p className="cx-ctl-note">
              A name of at least two characters and an http(s) endpoint are needed.
            </p>
          ) : null}
        </div>
      ) : (
        <button type="button" className="cx-btn is-seal" onClick={() => setOpen(true)}>
          <Plus {...ICON} aria-hidden /> Declare a server
        </button>
      )}

      {live.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <span className="cx-col-h">Revoke an attachment</span>
          <p className="cx-ctl-note" style={{ marginTop: 0 }}>
            Revoking destroys the stored credential and cannot be undone by
            declaring the same server again — the revoked row stays. It is the
            one act here that carries the seal.
          </p>
          {live.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                padding: '8px 0',
                borderTop: '1px solid var(--paper-2)',
              }}
            >
              <span style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>
                <ShieldOff {...ICON} aria-hidden style={{ verticalAlign: '-2px' }} />{' '}
                {s.name}
              </span>
              <HoldToApprove
                label={`Hold to revoke ${s.name}`}
                onApprove={() => void revoke(s.id, s.name)}
                disabled={revoking !== null}
              />
            </div>
          ))}
        </div>
      ) : null}

      {msg ? (
        <p
          role="status"
          className="cx-ctl-note"
          style={{ color: msg.tone === 'error' ? 'var(--ink-1)' : 'var(--ink-2)' }}
        >
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}

export default HouseServerControls;
