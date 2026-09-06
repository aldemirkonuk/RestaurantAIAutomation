/**
 * "Certifications on file" — the owed act on `/team`.
 *
 * WHAT WAS OWED. The rebuilt roster READS credentials: the expanded row's
 * "Credentials" card lists what is on file and says, correctly, that an empty
 * file is not a clean one. It could not put anything on file, change what was
 * there, or take one off. The legacy desk could
 * (`pages/team/command/OpsRulesPanel.tsx:37`, the Certifications tab), and that
 * desk is deleted with packet 4 — so without this sheet the act would leave the
 * product entirely.
 *
 * ONE PERSON, NOT A REGISTER. The legacy desk showed every certification in the
 * house behind a member dropdown. Census 102 gives this a SHEET opened from a
 * roster row, because one person's certificates are one record, and the person
 * whose file you are correcting is the one you are looking at. Nobody has to
 * find a name in a list to change the row they already have open.
 *
 * THE ROUTES, ALL FOUR, ALL TENANT-SCOPED IN THE PATH:
 *   GET    /team/:restaurantId/certifications          team.controller.ts:228
 *   POST   /team/:restaurantId/certifications          team.controller.ts:232
 *   PATCH  /team/:restaurantId/certifications/:certId  team.controller.ts:241
 *   DELETE /team/:restaurantId/certifications/:certId  team.controller.ts:251
 *
 * WHAT THE SCHEMA CANNOT DO, SAID ON THE SHEET. `team_certifications` carries no
 * role and no applies-to column (census 102's own note). So the house cannot
 * know which shifts a certificate is required for, and this sheet says exactly
 * that rather than offering a "required for" picker that would write nowhere.
 * The same sentence is already on the read-only card; it belongs here too,
 * because this is where somebody would go looking for the field.
 *
 * THE STATUS IS THE SERVER'S. `status` is `valid | expiring | expired |
 * submitted` and is computed where the dates are (`listCertifications`). This
 * sheet renders it and never derives it: a second opinion about whether a
 * certificate has expired is how two screens come to disagree about whether
 * somebody may work.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { getErrorMessage } from '@/services/api/client';
import {
  createCertification,
  deleteCertification,
  updateCertification,
  type Certification,
  type TeamMember,
} from '@/services/api/team';
import { EM, fmtDayShort, resolveName } from './tm-format';

/** How a status reads to a person. The server's word, in the house's language. */
export const STATUS_WORDS: Record<Certification['status'], string> = {
  valid: 'valid',
  expiring: 'expiring soon',
  expired: 'expired',
  submitted: 'submitted, not yet checked',
};

export interface CertDraft {
  certType: string;
  issuedAt: string;
  expiresAt: string;
}

export const EMPTY_CERT: CertDraft = { certType: '', issuedAt: '', expiresAt: '' };

/**
 * What stops a certificate being filed, in words, or null.
 *
 * The dates are optional — a certificate with no expiry is an ordinary thing,
 * and the server's `status` handles it. What is refused is a pair that cannot
 * both be true, because a certificate that expired before it was issued is a
 * typo and filing it would make the compliance lens wrong quietly.
 */
export function certRefusal(d: CertDraft): string | null {
  if (d.certType.trim() === '') return 'Name the certificate.';
  if (d.issuedAt && d.expiresAt && d.expiresAt < d.issuedAt) {
    return 'It cannot expire before it was issued. Check the two dates.';
  }
  return null;
}

export interface CertificationsSheetProps {
  open: boolean;
  member: TeamMember | null;
  /** Every certificate in the house. `null` means the file could not be read. */
  certs: Certification[] | null;
  onClose: () => void;
  /** Re-read after a write. */
  onChanged: () => void;
  /** The house, for the tenant-scoped path. */
  restaurantId: string | null;
}

export function CertificationsSheet({
  open,
  member,
  certs,
  onClose,
  onChanged,
  restaurantId,
}: CertificationsSheetProps) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<CertDraft>(EMPTY_CERT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const mine = useMemo(
    () => (certs ?? []).filter((c) => c.member_id === member?.id),
    [certs, member?.id],
  );

  const refusal = certRefusal(draft);

  const after = () => {
    setDraft(EMPTY_CERT);
    setEditingId(null);
    setTouched(false);
    setFailure(null);
    void qc.invalidateQueries({ queryKey: ['team', 'certs'] });
    void qc.invalidateQueries({ queryKey: ['team-next-certs'] });
    onChanged();
  };

  /** One failure sentence per act, each naming what did NOT happen. */
  const said = (verb: string, tail: string) => (e: unknown) =>
    setFailure(`${verb} (${getErrorMessage(e)}). ${tail}`);

  const add = useMutation({
    mutationFn: () =>
      createCertification(
        {
          memberId: member?.id,
          certType: draft.certType.trim(),
          issuedAt: draft.issuedAt || undefined,
          expiresAt: draft.expiresAt || undefined,
        },
        restaurantId ?? undefined,
      ),
    onSuccess: after,
    onError: said('The certificate was not filed', 'Nothing was written and your words are still here.'),
  });

  const change = useMutation({
    mutationFn: () =>
      updateCertification(
        editingId!,
        {
          certType: draft.certType.trim(),
          issuedAt: draft.issuedAt || undefined,
          expiresAt: draft.expiresAt || undefined,
        },
        restaurantId ?? undefined,
      ),
    onSuccess: after,
    onError: said('The change was not saved', 'The certificate on file is unchanged.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCertification(id, restaurantId ?? undefined),
    onSuccess: after,
    onError: said('It was not taken off the file', 'It is still on file.'),
  });

  const busy = add.isPending || change.isPending || remove.isPending;

  if (!member) return null;

  const name = resolveName(member);

  const startEdit = (c: Certification) => {
    setEditingId(c.id);
    setTouched(false);
    setFailure(null);
    setDraft({
      certType: c.cert_type,
      issuedAt: c.issued_at?.slice(0, 10) ?? '',
      expiresAt: c.expires_at?.slice(0, 10) ?? '',
    });
  };

  const submit = () => {
    setTouched(true);
    if (refusal || busy) return;
    if (editingId) change.mutate();
    else add.mutate();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      /* The contract, as the accessible name. */
      label={`This is the certificate file for ${name.text}. Filing, changing or removing one writes to this house's record at once. Leaving writes nothing.`}
      eyebrow="Certificates"
      title={name.text}
      closeLabel="Close the file"
      footer={
        <span className="tm-hint">
          A certificate carries no role and no shift, so which shifts require it is not
          recorded — the file has no column for it.
        </span>
      }
    >
      {/* ── what is on file ─────────────────────────────────────────────── */}
      {certs === null ? (
        <p className="tm-quiet" data-testid="cert-unreadable">
          The credential file could not be read, so nothing is listed. That is a failed read, not
          an empty file — do not file a duplicate on the strength of it.
        </p>
      ) : mine.length === 0 ? (
        <p className="tm-quiet" data-testid="cert-empty">
          Nothing on file for this person — an empty file, not a clean one.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="cert-list">
          {mine.map((c) => (
            <li
              key={c.id}
              className="tm-rrow__body"
              data-testid="cert-row"
              style={{ padding: '8px 0', borderBottom: '1px solid var(--paper-2)' }}
            >
              <div className="tm-facts">
                <span style={{ fontWeight: 600 }}>{c.cert_type}</span>
                <span className="tm-quiet" data-testid="cert-status">
                  {STATUS_WORDS[c.status] ?? c.status}
                </span>
              </div>
              <p className="tm-quiet" style={{ margin: '2px 0 0' }}>
                {`Issued ${c.issued_at ? fmtDayShort(c.issued_at.slice(0, 10)) : EM} · expires ${
                  c.expires_at ? fmtDayShort(c.expires_at.slice(0, 10)) : `${EM} — no expiry recorded`
                }`}
              </p>
              <div className="tm-actions" style={{ marginTop: 4 }}>
                <button
                  type="button"
                  className="tm-ctl"
                  data-testid="cert-edit"
                  disabled={busy}
                  onClick={() => startEdit(c)}
                >
                  Correct it
                </button>
                <button
                  type="button"
                  className="tm-ctl"
                  data-testid="cert-remove"
                  disabled={busy}
                  onClick={() => remove.mutate(c.id)}
                >
                  Take it off the file
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── file one, or correct the one being edited ───────────────────── */}
      <div style={{ marginTop: 14 }}>
        <p className="tm-hint" data-testid="cert-form-head">
          {editingId ? 'Correcting a certificate on file' : 'File a certificate'}
        </p>

        <label className="tm-quiet" htmlFor="cert-type">
          What it is
        </label>
        <input
          id="cert-type"
          className="tm-input"
          data-testid="cert-type"
          value={draft.certType}
          onChange={(e) => setDraft({ ...draft, certType: e.target.value })}
          placeholder="food-handler"
          style={{ width: '100%' }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          <div>
            <label className="tm-quiet" htmlFor="cert-issued">
              Issued
            </label>
            <input
              id="cert-issued"
              className="tm-input"
              type="date"
              data-testid="cert-issued"
              value={draft.issuedAt}
              onChange={(e) => setDraft({ ...draft, issuedAt: e.target.value })}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label className="tm-quiet" htmlFor="cert-expires">
              Expires
            </label>
            <input
              id="cert-expires"
              className="tm-input"
              type="date"
              data-testid="cert-expires"
              value={draft.expiresAt}
              onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <p className="tm-hint" data-testid="cert-dates-note">
          A certificate with no expiry is an ordinary thing and is filed as one. Whether it is
          valid, expiring or expired is the record’s own word, worked out where the dates are —
          this sheet never decides it a second time.
        </p>

        {touched && refusal && (
          <p role="status" className="tm-quiet" data-testid="cert-refusal">
            {refusal}
          </p>
        )}

        <div className="tm-actions" style={{ marginTop: 8 }}>
          {editingId && (
            <button
              type="button"
              className="tm-ctl"
              data-testid="cert-cancel"
              onClick={() => {
                setEditingId(null);
                setDraft(EMPTY_CERT);
                setTouched(false);
              }}
            >
              Leave it as it is
            </button>
          )}
          <button
            type="button"
            className="tm-ctl"
            data-primary="true"
            data-testid="cert-save"
            disabled={busy}
            onClick={submit}
          >
            {busy
              ? 'Writing it down…'
              : editingId
                ? 'Save the correction'
                : 'Put it on the file'}
          </button>
        </div>

        {failure && (
          <p role="status" className="tm-quiet" data-testid="cert-failure">
            {failure}
          </p>
        )}
      </div>
    </Sheet>
  );
}

export default CertificationsSheet;
