/**
 * The vendor's own record, editable in the rebuilt `/providers` sheet — the
 * founder's answer (12) of 2026-09-21: *"the rebuilt /providers vendor sheet
 * gets an edit path (type first) and cards show 'Not stated' when unset."*
 *
 * Before this the rebuilt page had no edit path at all, so a vendor added with
 * "Not stated" (ADR 0083 addendum) could only be typed later from the legacy
 * dialog. The business type comes first because that is what a vendor added
 * in a hurry is missing; the name sits beside it. Everything else about a
 * vendor already has its own section in this sheet (contacts, terms, the usual
 * currency), and is edited there.
 *
 * Rules the form keeps:
 *   - "Not stated" is a real choice, shown when nothing was stated and
 *     choosable later; it is sent as '' so the gateway clears the column
 *     (`providers.service.ts` `normalizeBusinessType`). It is never replaced
 *     with a guessed 'Distributor'.
 *   - A type outside the three offered (a catalogue's own, or one the house
 *     typed) is listed as itself, not coerced.
 *   - Only what changed is sent: saving the name never touches the type.
 *   - A failed save keeps what was typed and says nothing changed.
 */

import { useMemo, useState } from 'react';
import { updateProvider, type Provider } from '../../../services/api/providers';
import { getErrorMessage } from '../../../services/api/client';
import { BUSINESS_TYPES } from './NewVendorSheet';
import { MONO, SANS } from './pv-format';

/** What a card or a sheet shows for a vendor's type. */
export function businessTypeLabel(type: string | null | undefined): string {
  const t = (type ?? '').trim();
  return t === '' ? 'Not stated' : t;
}

export function VendorRecordEdit({
  provider,
  onSaved,
}: {
  provider: Provider;
  /** Called with the record as the gateway returned it. */
  onSaved: (updated: Provider) => void;
}) {
  const current = (provider.primaryBusinessType ?? '').trim();
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState(current);
  const [name, setName] = useState(provider.name);
  const [busy, setBusy] = useState(false);
  const [says, setSays] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const options = useMemo(() => {
    const known = BUSINESS_TYPES as readonly string[];
    return current && !known.includes(current) ? [...known, current] : [...known];
  }, [current]);

  const typeChanged = type !== current;
  const nameChanged = name.trim() !== provider.name && name.trim() !== '';
  const canSave = !busy && (typeChanged || nameChanged) && name.trim() !== '';

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setProblem(null);
    setSays(null);
    try {
      const updated = await updateProvider({
        id: provider.id,
        ...(typeChanged ? { primaryBusinessType: type } : {}),
        ...(nameChanged ? { name: name.trim() } : {}),
      });
      setSays('Saved.');
      setEditing(false);
      onSaved({ ...provider, ...updated });
    } catch (e) {
      setProblem(`Nothing was changed (${getErrorMessage(e)}). What you typed is still here.`);
    } finally {
      setBusy(false);
    }
  };

  const label: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: 9.5,
    fontWeight: 500,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--ink-3, #7C7365)',
  };

  if (!editing) {
    return (
      <div className="flex items-baseline justify-between gap-4 py-1.5" data-testid="vendor-record">
        <span style={label}>Business type</span>
        <span style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-1, #211C16)' }}>
          {businessTypeLabel(provider.primaryBusinessType)}{' '}
          <button
            type="button"
            data-testid="vendor-record-edit"
            onClick={() => {
              setType(current);
              setName(provider.name);
              setEditing(true);
              setSays(null);
              setProblem(null);
            }}
            style={{
              marginLeft: 8,
              fontSize: 11.5,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
              background: 'transparent',
              color: 'var(--seal-deep, #14515C)',
              cursor: 'pointer',
            }}
          >
            Edit the record
          </button>
        </span>
        {says && (
          <span role="status" data-testid="vendor-record-says" style={{ fontSize: 11.5 }}>
            {says}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="py-2" data-testid="vendor-record-form" style={{ fontFamily: SANS }}>
      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={label}>Business type</legend>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
          {['', ...options].map((t) => (
            <label key={t || 'not-stated'} style={{ fontSize: 12.5 }}>
              <input type="radio" name="vendor-type" checked={type === t} onChange={() => setType(t)} />{' '}
              {businessTypeLabel(t)}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor="vendor-record-name" style={{ ...label, display: 'block', marginTop: 10 }}>
        Name
      </label>
      <input
        id="vendor-record-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          width: '100%',
          fontSize: 12.5,
          padding: '6px 8px',
          borderRadius: 6,
          border: '1px solid var(--paper-2, #EAE4D8)',
          background: 'var(--paper-0, #FAF7F1)',
        }}
      />
      <div className="flex gap-2" style={{ marginTop: 10 }}>
        <button
          type="button"
          data-testid="vendor-record-save"
          onClick={() => void save()}
          disabled={!canSave}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '5px 12px',
            borderRadius: 8,
            border: '1px solid var(--seal, #1A5E6B)',
            background: canSave ? 'var(--seal, #1A5E6B)' : 'transparent',
            color: canSave ? 'var(--paper-0, #FBF8F1)' : 'var(--ink-3, #7C7365)',
            cursor: canSave ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          style={{
            fontSize: 12,
            padding: '5px 12px',
            borderRadius: 8,
            border: '1px solid var(--paper-2, #EAE4D8)',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          Leave it
        </button>
      </div>
      {problem && (
        <p role="alert" data-testid="vendor-record-problem" style={{ fontSize: 11.5, margin: '6px 0 0' }}>
          {problem}
        </p>
      )}
    </div>
  );
}

export default VendorRecordEdit;
