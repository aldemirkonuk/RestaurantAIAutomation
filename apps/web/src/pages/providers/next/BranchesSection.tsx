/**
 * A vendor's branches — the offices, warehouses and stores this house deals
 * with — seen, added, edited and removed on the vendor sheet.
 *
 * Founder, 2026-09-26, round 8, item 51 (ADR 0221): the three legacy-only
 * features are built into the new pages before the cutover deletes the old
 * ones. This is the first of them. It ports every field the legacy sheet's
 * Locations tab edited (`EditProviderModal.tsx`, "Provider Locations"): the
 * branch's name, its kind (office / warehouse / store / other), its address
 * (picked from the same Places suggestions, which also give it a point), which
 * branch is primary, and removal.
 *
 * NOT HERE, ON PURPOSE: a map. The legacy world map is deleted at the cutover
 * and a new one comes later as its own tab (item 52). The point a picked
 * address carries is still stored, so that map will have something to draw.
 *
 * The drawing follows `ContactsSection` on the same sheet — same heading,
 * same body type, the same refusal rule (ink with a left rule, never a colour;
 * the house has no red, ADR 0042), every colour a house token.
 */

import { useId, useState } from 'react';
import { PlacesAutocomplete, type PlaceResult } from '../../../components/ui/PlacesAutocomplete';
import '../../../components/locations/locations-mudavym.css';
import {
  PROVIDER_LOCATION_TYPES,
  type ProviderLocation,
} from '../../../services/api/providers';
import { MONO, SANS } from './pv-format';
import {
  changesFrom,
  useVendorBranches,
  type BranchBusy,
  type BranchDraft,
} from './useVendorBranches';

const LABEL: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
  margin: '14px 0 6px',
};

const BODY: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--ink-2, #4F473C)',
};

const QUIET: React.CSSProperties = {
  ...BODY,
  fontSize: 11.5,
  color: 'var(--ink-3, #7C7365)',
  margin: '2px 0 0',
};

/** A sentence saying something did NOT happen — same shape as ContactsSection's. */
const REFUSAL: React.CSSProperties = {
  ...BODY,
  color: 'var(--ink-1, #211C16)',
  borderLeft: '2px solid var(--ink-3, #7C7365)',
  paddingLeft: 8,
  margin: '6px 0 0',
};

const FIELD: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12.5,
  padding: '5px 8px',
  borderRadius: 7,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FFFDF8)',
  color: 'var(--ink-1, #211C16)',
  width: '100%',
};

const FIELD_LABEL: React.CSSProperties = {
  display: 'block',
  fontFamily: MONO,
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.11em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
  marginBottom: 3,
};

const LINK: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: 'var(--seal-deep, #14515C)',
  textDecoration: 'underline',
};

/** The button `TermsSection` draws, so the sheet's editors match. */
function Btn({
  children,
  onClick,
  disabled,
  quiet,
  type = 'button',
  label,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  quiet?: boolean;
  type?: 'button' | 'submit';
  /** Names the branch for a screen reader when the visible text does not. */
  label?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        fontFamily: SANS,
        fontSize: 12,
        fontWeight: 600,
        padding: '4px 11px',
        borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        border: `1px solid ${quiet ? 'var(--paper-2, #EAE4D8)' : 'var(--seal-ring, rgba(26,94,107,.32))'}`,
        background: 'transparent',
        color: quiet ? 'var(--ink-2, #4F473C)' : 'var(--seal-deep, #14515C)',
      }}
    >
      {children}
    </button>
  );
}

function kindLabel(type: string): string {
  return PROVIDER_LOCATION_TYPES.find((t) => t.value === type)?.label ?? type;
}

function PrimaryChip() {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 8.5,
        fontWeight: 600,
        letterSpacing: '0.11em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        padding: '3px 7px',
        borderRadius: 3,
        color: 'var(--seal-deep, #14515C)',
        background: 'var(--seal-tint, rgba(26,94,107,.10))',
        boxShadow: 'inset 0 0 0 1px var(--seal-ring, rgba(26,94,107,.32))',
      }}
    >
      Primary
    </span>
  );
}

/** The add / edit form. `was` is the branch being edited; absent when adding. */
function BranchForm({
  was,
  offerPrimary,
  primaryByDefault,
  busy,
  onSave,
  onCancel,
}: {
  was?: ProviderLocation;
  offerPrimary: boolean;
  primaryByDefault: boolean;
  busy: boolean;
  onSave: (draft: BranchDraft) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<BranchDraft>({
    name: was?.name ?? '',
    type: was?.type ?? 'office',
    address: was?.address ?? '',
    isPrimary: primaryByDefault,
    latitude: null,
    longitude: null,
  });
  const nameMissing = draft.name.trim() === '';
  const nothingChanged = was ? Object.keys(changesFrom(was, draft)).length === 0 : false;

  return (
    <form
      aria-label={was ? `Edit ${was.name}` : 'Add a branch'}
      onSubmit={(e) => {
        e.preventDefault();
        if (nameMissing || nothingChanged || busy) return;
        onSave(draft);
      }}
      style={{
        marginTop: 8,
        padding: 10,
        borderRadius: 10,
        border: '1px solid var(--paper-2, #EAE4D8)',
        display: 'grid',
        gap: 10,
      }}
    >
      <div className="mdv-pair">
        <div>
          <label htmlFor={`${id}-name`} style={FIELD_LABEL}>
            Name
          </label>
          <input
            id={`${id}-name`}
            autoFocus
            required
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Main office"
            aria-invalid={nameMissing || undefined}
            style={FIELD}
          />
        </div>
        <div>
          <label htmlFor={`${id}-kind`} style={FIELD_LABEL}>
            Kind
          </label>
          <select
            id={`${id}-kind`}
            value={draft.type}
            onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
            style={FIELD}
          >
            {PROVIDER_LOCATION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-address`} style={FIELD_LABEL}>
          Address
        </label>
        {/* `.mdv-adopt`: a shared legacy control, repainted not rewritten —
            the same wrapper the house's own location sheet uses. */}
        <div className="mdv-adopt">
          <PlacesAutocomplete
            id={`${id}-address`}
            value={draft.address}
            // Typing after a pick drops the pick's point: it belonged to the
            // address that was picked, not to what is in the field now.
            onChange={(val) => setDraft((d) => ({ ...d, address: val, latitude: null, longitude: null }))}
            onPlaceSelect={(place: PlaceResult) => {
              const full = [
                place.streetAddress,
                place.city,
                place.stateProvince,
                place.postalCode,
                place.country,
              ]
                .filter(Boolean)
                .join(', ');
              setDraft((d) => ({
                ...d,
                address: full,
                latitude: place.latitude,
                longitude: place.longitude,
              }));
            }}
            placeholder="Start typing an address…"
          />
        </div>
      </div>

      {offerPrimary && (
        <label style={{ ...BODY, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={draft.isPrimary ?? false}
            onChange={(e) => setDraft((d) => ({ ...d, isPrimary: e.target.checked }))}
          />
          The primary branch
        </label>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn type="submit" disabled={busy || nameMissing || nothingChanged}>
          {busy ? 'Saving…' : was ? 'Save' : 'Add branch'}
        </Btn>
        <Btn quiet onClick={onCancel} disabled={busy}>
          Cancel
        </Btn>
      </div>
      {nameMissing && <p style={{ ...QUIET, margin: 0 }}>A branch needs a name.</p>}
    </form>
  );
}

/** Remove arms first, states what it does, and needs a second deliberate click. */
function RemoveBranch({
  branch,
  others,
  busy,
  onRemove,
}: {
  branch: ProviderLocation;
  others: number;
  busy: boolean;
  onRemove: () => void;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Btn quiet disabled={busy} onClick={() => setArmed(true)} label={`Remove ${branch.name}`}>
        Remove
      </Btn>
    );
  }
  const consequence =
    branch.isPrimary && others > 0
      ? `Removes ${branch.name}. The oldest other branch becomes primary.`
      : `Removes ${branch.name} from this vendor.`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span role="status" style={{ ...BODY, fontSize: 11.5 }}>
        {consequence}
      </span>
      <Btn
        disabled={busy}
        onClick={() => {
          setArmed(false);
          onRemove();
        }}
        label={`Yes, remove ${branch.name}`}
      >
        Yes, remove
      </Btn>
      <Btn quiet onClick={() => setArmed(false)}>
        Keep it
      </Btn>
    </span>
  );
}

export interface BranchesListProps {
  providerName: string;
  branches: ProviderLocation[] | null;
  loading: boolean;
  error: string | null;
  busy: BranchBusy;
  saveError: string | null;
  notice: string | null;
  warning: string | null;
  onAdd: (draft: BranchDraft) => Promise<boolean>;
  onUpdate: (id: string, draft: BranchDraft) => Promise<boolean>;
  onMakePrimary: (id: string) => void;
  onRemove: (id: string) => void;
  onReload: () => void;
}

/**
 * What the section draws, given what the hook read. Separate from the hook so
 * it can be rendered without a network, as `ContactsList` is.
 */
export function BranchesList({
  providerName,
  branches,
  loading,
  error,
  busy,
  saveError,
  notice,
  warning,
  onAdd,
  onUpdate,
  onMakePrimary,
  onRemove,
  onReload,
}: BranchesListProps) {
  const headingId = useId();
  /** `'new'`, a branch id, or null — one editor open at a time. */
  const [open, setOpen] = useState<string | null>(null);
  const busyName =
    busy && busy !== 'new' ? branches?.find((b) => b.id === busy)?.name ?? null : null;
  const readable = !loading && !error && branches !== null;

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} style={LABEL}>
        Branches
      </h3>

      {loading && (
        <p role="status" style={{ ...BODY, margin: 0 }}>
          Reading {providerName}’s branches…
        </p>
      )}

      {/* A FAILED READ IS NOT AN EMPTY BOOK. */}
      {!loading && error && (
        <p role="alert" style={REFUSAL}>
          This vendor’s branches could not be read, so nothing is shown — that is
          not the same as this vendor having none. {error}{' '}
          <button type="button" onClick={onReload} style={LINK}>
            Try again
          </button>
        </p>
      )}

      {readable && branches.length === 0 && open !== 'new' && (
        <p style={{ ...BODY, margin: 0 }}>
          No branches are recorded for {providerName}. Add the office, warehouse
          or store you deal with.
        </p>
      )}

      {readable && branches.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {branches.map((b) => {
            const rowBusy = busy === b.id;
            return (
              <li
                key={b.id}
                style={{
                  padding: '8px 0',
                  borderTop: '1px solid var(--paper-2, #EAE4D8)',
                  opacity: rowBusy ? 0.6 : 1,
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span style={{ ...BODY, color: 'var(--ink-1, #211C16)' }}>
                    {b.name}
                    <span style={{ color: 'var(--ink-3, #7C7365)' }}> · {kindLabel(b.type)}</span>
                  </span>
                  {b.isPrimary && <PrimaryChip />}
                </div>
                <p style={QUIET}>{b.address || 'No address recorded.'}</p>

                {open === b.id ? (
                  <BranchForm
                    was={b}
                    offerPrimary={false}
                    primaryByDefault={b.isPrimary}
                    busy={rowBusy}
                    onCancel={() => setOpen(null)}
                    onSave={async (d) => {
                      if (await onUpdate(b.id, d)) setOpen(null);
                    }}
                  />
                ) : (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    <Btn
                      quiet
                      disabled={busy !== null}
                      onClick={() => setOpen(b.id)}
                      label={`Edit ${b.name}`}
                    >
                      Edit
                    </Btn>
                    {!b.isPrimary && (
                      <Btn
                        quiet
                        disabled={busy !== null}
                        onClick={() => onMakePrimary(b.id)}
                        label={`Make ${b.name} the primary branch`}
                      >
                        Make primary
                      </Btn>
                    )}
                    <RemoveBranch
                      branch={b}
                      others={branches.length - 1}
                      busy={busy !== null}
                      onRemove={() => onRemove(b.id)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {readable &&
        (open === 'new' ? (
          <BranchForm
            offerPrimary
            primaryByDefault={branches.length === 0}
            busy={busy === 'new'}
            onCancel={() => setOpen(null)}
            onSave={async (d) => {
              if (await onAdd(d)) setOpen(null);
            }}
          />
        ) : (
          <div style={{ marginTop: 8 }}>
            <Btn disabled={busy !== null || open !== null} onClick={() => setOpen('new')}>
              Add a branch
            </Btn>
          </div>
        ))}

      {/* The write is in flight: said, not only dimmed. */}
      {busy && (
        <p role="status" style={{ ...QUIET, margin: '6px 0 0' }}>
          {busy === 'new' ? 'Adding the branch…' : `Saving ${busyName ?? 'the branch'}…`}
        </p>
      )}

      {notice && (
        <p role="status" style={{ ...BODY, margin: '6px 0 0' }}>
          {notice}
        </p>
      )}

      {warning && (
        <p role="alert" style={REFUSAL}>
          {warning}
        </p>
      )}

      {saveError && (
        <p role="alert" style={REFUSAL}>
          That was not saved, so the book still holds what it held: {saveError}
        </p>
      )}
    </section>
  );
}

export function BranchesSection({
  providerId,
  providerName,
}: {
  providerId: string;
  providerName: string;
}) {
  const s = useVendorBranches(providerId);
  return (
    <BranchesList
      providerName={providerName}
      branches={s.branches}
      loading={s.loading}
      error={s.error}
      busy={s.busy}
      saveError={s.saveError}
      notice={s.notice}
      warning={s.warning}
      onAdd={s.add}
      onUpdate={s.update}
      onMakePrimary={(id) => void s.makePrimary(id)}
      onRemove={(id) => void s.remove(id)}
      onReload={s.reload}
    />
  );
}

export default BranchesSection;
