/**
 * To — the book, and only the book.
 *
 * The founder's decision (2026-09-04): recipients come from the vendor book,
 * with "add to the book" inline. Typing an address the house has no record of
 * does not send a letter to it; it offers to CREATE the vendor contact first,
 * through the route that already exists (`POST /providers/:id/contacts`,
 * providers.controller.ts:377). Once the contact exists, every guardrail, the
 * round count and the conversation book all key on a real record instead of a
 * string somebody typed into a field.
 *
 * That is a restriction, and it is deliberate: a free-text To is exactly how a
 * letter escapes the book, and with it the guardrails and the round count.
 *
 * The server refuses an off-book address independently
 * (`house-letters.service.ts`, refusal 1). This field is the courtesy; that is
 * the rule.
 */

import { useMemo, useState } from 'react';
import { BookUser, Plus } from 'lucide-react';
import { apiClient } from '../../../../services/api/client';
import type { BookEntry } from './useComposeData';
import { EM, MONO, SANS, looksLikeAddress } from './compose-format';

const ICON = { size: 13, strokeWidth: 1.75 } as const;

export interface Recipient {
  providerId: string;
  providerName: string;
  email: string;
}

export function RecipientField({
  book,
  failed,
  error,
  value,
  onChange,
  onBookChanged,
}: {
  book: BookEntry[] | null;
  failed: boolean;
  error: string | null;
  value: Recipient | null;
  onChange: (next: Recipient | null) => void;
  onBookChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [addState, setAddState] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'failed'; message: string }
  >({ kind: 'idle' });
  const [newName, setNewName] = useState('');
  const [newProvider, setNewProvider] = useState('');

  const providers = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of book ?? []) map.set(e.providerId, e.providerName);
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [book]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return (book ?? []).slice(0, 8);
    return (book ?? [])
      .filter(
        (e) =>
          e.email.toLowerCase().includes(q) ||
          e.providerName.toLowerCase().includes(q) ||
          (e.contactName ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [book, query]);

  const unknownAddress =
    query.trim().length > 0 &&
    looksLikeAddress(query) &&
    !(book ?? []).some((e) => e.email.toLowerCase() === query.trim().toLowerCase());

  async function addToBook() {
    if (!newProvider) return;
    setAddState({ kind: 'saving' });
    try {
      await apiClient.post(`/providers/${newProvider}/contacts`, {
        name: newName.trim() || query.trim(),
        email: query.trim(),
      });
      const providerName = providers.find((p) => p.id === newProvider)?.name ?? '';
      // The contact is created BEFORE the letter can address it, so the
      // recipient this sets is a record and not a hope.
      onChange({ providerId: newProvider, providerName, email: query.trim() });
      setAdding(false);
      setAddState({ kind: 'idle' });
      onBookChanged();
    } catch (e) {
      setAddState({
        kind: 'failed',
        message: e instanceof Error ? e.message : 'unknown error',
      });
    }
  }

  return (
    <div style={{ fontFamily: SANS }}>
      <label
        htmlFor="cmp-to"
        style={{
          display: 'block',
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-3, #7C7365)',
          marginBottom: 4,
        }}
      >
        To
      </label>

      {value ? (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
        >
          <BookUser {...ICON} aria-hidden style={{ color: 'var(--seal-deep, #14515C)' }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
            {value.providerName || EM}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
            {value.email}
          </span>
          <button
            type="button"
            className="ml-auto"
            onClick={() => {
              onChange(null);
              setQuery('');
            }}
            style={{
              fontSize: 11.5,
              padding: '3px 9px',
              borderRadius: 8,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'transparent',
              color: 'var(--ink-2, #4F473C)',
              cursor: 'pointer',
            }}
          >
            Change
          </button>
        </div>
      ) : failed ? (
        <p role="alert" style={{ fontSize: 12, color: 'var(--alarm-deep, #8C3322)', margin: 0 }}>
          {error ?? 'The vendor book could not be read.'} No recipient can be chosen: the book is
          not empty — it is unknown, and nothing may be addressed until it can be read.
        </p>
      ) : book === null ? (
        <p style={{ fontSize: 12, color: 'var(--ink-3, #7C7365)', margin: 0 }}>
          Reading the vendor book…
        </p>
      ) : (
        <>
          <input
            id="cmp-to"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the book by vendor, contact or address"
            style={{
              width: '100%',
              fontSize: 12.5,
              padding: '7px 10px',
              borderRadius: 8,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'var(--paper-0, #FAF7F1)',
              color: 'var(--ink-1, #211C16)',
            }}
          />
          {book.length === 0 && (
            <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: '6px 0 0' }}>
              This house has no vendor address on record yet. Add one on /providers, or add a
              contact below — a letter is never sent to an address the book does not hold.
            </p>
          )}
          {matches.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 2 }}>
              {matches.map((e) => (
                <li key={`${e.providerId}:${e.email}`}>
                  <button
                    type="button"
                    className="cmp-pick"
                    onClick={() =>
                      onChange({
                        providerId: e.providerId,
                        providerName: e.providerName,
                        email: e.email,
                      })
                    }
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      fontSize: 12,
                      padding: '6px 9px',
                      borderRadius: 8,
                      border: '1px solid transparent',
                      background: 'transparent',
                      color: 'var(--ink-1, #211C16)',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{e.providerName || EM}</span>{' '}
                    <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-2, #4F473C)' }}>
                      {e.email}
                    </span>
                    {e.contactName ? (
                      <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                        {' '}
                        · {e.contactName}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {unknownAddress && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-2 inline-flex items-center gap-1.5"
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: '5px 10px',
                borderRadius: 8,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: 'transparent',
                color: 'var(--seal-deep, #14515C)',
                cursor: 'pointer',
              }}
            >
              <Plus {...ICON} aria-hidden />
              Add {query.trim()} to the book
            </button>
          )}

          {adding && (
            <div
              className="mt-2 rounded-lg p-3"
              style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
            >
              <p style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)', margin: '0 0 8px' }}>
                An address is added as a vendor contact, not as a one-off recipient — that is what
                makes the guardrails and the round count apply to it.
              </p>
              <label
                htmlFor="cmp-new-provider"
                style={{ display: 'block', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}
              >
                Which vendor
              </label>
              <select
                id="cmp-new-provider"
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value)}
                style={{
                  width: '100%',
                  fontSize: 12.5,
                  padding: '6px 8px',
                  marginTop: 3,
                  borderRadius: 8,
                  border: '1px solid var(--paper-2, #EAE4D8)',
                  background: 'var(--paper-0, #FAF7F1)',
                  color: 'var(--ink-1, #211C16)',
                }}
              >
                <option value="">Choose a vendor</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <label
                htmlFor="cmp-new-name"
                style={{ display: 'block', fontSize: 11, color: 'var(--ink-3, #7C7365)', marginTop: 8 }}
              >
                Contact name
              </label>
              <input
                id="cmp-new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Who this address belongs to"
                style={{
                  width: '100%',
                  fontSize: 12.5,
                  padding: '6px 8px',
                  marginTop: 3,
                  borderRadius: 8,
                  border: '1px solid var(--paper-2, #EAE4D8)',
                  background: 'var(--paper-0, #FAF7F1)',
                  color: 'var(--ink-1, #211C16)',
                }}
              />
              {addState.kind === 'failed' && (
                <p role="alert" style={{ fontSize: 11.5, color: 'var(--alarm-deep, #8C3322)', margin: '8px 0 0' }}>
                  The contact was NOT created ({addState.message}) — nothing was stored and no
                  letter may be addressed to it.
                </p>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={addToBook}
                  disabled={!newProvider || addState.kind === 'saving'}
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: '5px 11px',
                    borderRadius: 8,
                    border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                    background: newProvider ? 'var(--seal-tint, rgba(26,94,107,.10))' : 'transparent',
                    color: 'var(--seal-deep, #14515C)',
                    cursor: newProvider ? 'pointer' : 'not-allowed',
                    opacity: newProvider ? 1 : 0.55,
                  }}
                >
                  {addState.kind === 'saving' ? 'Adding…' : 'Add to the book'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setAddState({ kind: 'idle' });
                  }}
                  style={{
                    fontSize: 11.5,
                    padding: '5px 11px',
                    borderRadius: 8,
                    border: '1px solid var(--paper-2, #EAE4D8)',
                    background: 'transparent',
                    color: 'var(--ink-2, #4F473C)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default RecipientField;
