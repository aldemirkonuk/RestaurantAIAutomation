/**
 * One vendor's terms, read on the provider row.
 *
 * THE ROUTE IS A HOUSE ROUTE, NOT A VENDOR ROUTE. `GET /vendor-terms`
 * (apps/api-gateway/src/vendor-terms/vendor-terms.controller.ts:44) answers with
 * EVERY vendor's terms for the tenant in the token; there is no
 * `GET /vendor-terms/:providerId`. So this hook reads the register and picks the
 * one row, rather than inventing a route that does not exist. The additive
 * gateway patch that would make it a one-provider read is written up in
 * .planning/06-pages/providers.md §9 — it was NOT applied, because
 * `apps/api-gateway/src/vendor-terms/**` belongs to another builder this pass.
 *
 * The consequence is stated where the reader can see it: the section says it
 * read the whole house register. It is not hidden behind a spinner that implies
 * a narrow read.
 *
 * TENANT KEY. The fetch is keyed by `activeRestaurantId` and re-runs when it
 * changes, so a restaurant switch can never leave the previous tenant's terms on
 * screen. The gateway takes the tenant from the JWT and accepts no id from us
 * (controller header comment, :19-28) — the key is a client-side cache boundary,
 * not an authorisation claim.
 *
 * WRITE. `PUT /vendor-terms/:providerId` (:71). A provider belonging to another
 * house is NOT FOUND inside the row filter
 * (`VendorTermsService.requireProvider`, vendor-terms.service.ts:784-805), so
 * the refusal we render is the gateway's 404 and not a check of our own.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, getErrorMessage } from '../../../services/api/client';
import { useAuth } from '../../../contexts/AuthContext';
import type {
  SetVendorTermsBody,
  VendorTermsRegister,
  VendorTermsRow,
} from '../../settings/next/useSettingsNextData';

export interface ProviderTermsState {
  /** The register, once read. Null while unknown — never an invented empty one. */
  register: VendorTermsRegister | null;
  /** This provider's row inside it, or null when the register holds no such row. */
  row: VendorTermsRow | null;
  loading: boolean;
  /** Words for why the register could not be read. Null when it was. */
  error: string | null;
  /** 403 from the gateway — a real state, not an empty list. */
  denied: boolean;
  saving: boolean;
  /** Why the last write did not land. Null when nothing failed. */
  saveError: string | null;
  /** False when the audit row failed even though the terms were written. */
  audited: boolean | null;
  auditReason: string | null;
  save: (body: SetVendorTermsBody) => Promise<boolean>;
  reload: () => void;
}

function statusOf(e: unknown): number | null {
  const s = (e as { response?: { status?: number } } | null)?.response?.status;
  return typeof s === 'number' ? s : null;
}

export function useProviderTerms(providerId: string | null): ProviderTermsState {
  const { activeRestaurantId } = useAuth();
  const [register, setRegister] = useState<VendorTermsRegister | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [audited, setAudited] = useState<boolean | null>(null);
  const [auditReason, setAuditReason] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;
    // A tenant switch clears the answer before asking again: the previous
    // house's terms must not be on screen for a frame.
    setRegister(null);
    setError(null);
    setDenied(false);
    setLoading(true);
    void (async () => {
      try {
        const { data } = await apiClient.get<VendorTermsRegister>('/vendor-terms');
        if (cancelled) return;
        setRegister(data ?? null);
        if (!data) setError('the register came back empty of structure');
      } catch (e) {
        if (cancelled) return;
        setDenied(statusOf(e) === 403);
        setError(getErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerId, activeRestaurantId, nonce]);

  const save = useCallback(
    async (body: SetVendorTermsBody): Promise<boolean> => {
      if (!providerId) return false;
      setSaving(true);
      setSaveError(null);
      try {
        const { data } = await apiClient.put<{
          readout: VendorTermsRegister;
          audited?: boolean;
          auditReason?: string | null;
        }>(`/vendor-terms/${providerId}`, body);
        // The server's answer replaces the register. Every inference is
        // recomputed by the write, so an optimistic patch would sit a stated
        // term beside a stale contradiction.
        if (data?.readout) setRegister(data.readout);
        else setNonce((n) => n + 1);
        setAudited(data?.audited ?? null);
        setAuditReason(data?.auditReason ?? null);
        return true;
      } catch (e) {
        const st = statusOf(e);
        setSaveError(
          st === 404
            ? 'That vendor is not on this restaurant’s books, so nothing was recorded.'
            : getErrorMessage(e),
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [providerId],
  );

  const row =
    register && providerId
      ? (register.vendors.find((v) => v.providerId === providerId) ?? null)
      : null;

  return {
    register,
    row,
    loading,
    error,
    denied,
    saving,
    saveError,
    audited,
    auditReason,
    save,
    reload: () => setNonce((n) => n + 1),
  };
}

export default useProviderTerms;
