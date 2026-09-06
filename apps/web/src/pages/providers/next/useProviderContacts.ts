/**
 * One vendor's contacts, and the one field on them a text sender depends on.
 *
 * WHY THIS HOOK EXISTS AT ALL (ADR 0121 P0 item 2)
 * ------------------------------------------------
 * `provider_contacts.phone_type` has existed since the production baseline and
 * nothing has ever written it. The legacy sheet
 * (`components/providers/EditProviderModal.tsx:1504`) renders a picker for it,
 * but that picker writes to local component state and the modal has no call to
 * `addProviderContact` or `updateProviderContact` anywhere — grep both names in
 * that file and the result is empty. Worse, when the modal hydrates from the
 * server it OVERWRITES whatever the row held with the literal `'main_line'`
 * (`:403`), so the stored value could not even be read back.
 *
 * The consequence ADR 0121 states: *"A text sender that cannot tell a landline
 * from a mobile will text a landline."*
 *
 * WHAT THE SERVER DECIDES, AND WHAT THIS HOOK DOES NOT
 * -----------------------------------------------------
 * `reach` and `phoneTypeStated` are computed by the gateway
 * (`providers/phone-reachability.ts`) and rendered here verbatim. This file
 * contains no vocabulary of its own and no mapping from a type to a verdict —
 * two places deciding what counts as a mobile is one place too many, and the
 * one that matters is the one the send path reads.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, getErrorMessage } from '../../../services/api/client';
import { useAuth } from '../../../contexts/AuthContext';
import type { ProviderContact } from '../../../services/api/providers';

/** The values the gateway accepts. Kept in the order the sheet shows them. */
export const PHONE_TYPE_CHOICES: { value: string; label: string }[] = [
  { value: 'cell', label: 'Mobile' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'main_line', label: 'Main line' },
  { value: 'direct', label: 'Direct line' },
  { value: 'office', label: 'Office' },
  { value: 'fax', label: 'Fax' },
];

export interface ProviderContactsState {
  /** Null until read. NEVER an invented empty list. */
  contacts: ProviderContact[] | null;
  loading: boolean;
  /** Why the read failed. Null when it did not. */
  error: string | null;
  /** The contact id currently being written, or null. */
  saving: string | null;
  saveError: string | null;
  setPhoneType: (contactId: string, phoneType: string) => Promise<boolean>;
  reload: () => void;
}

export function useProviderContacts(
  providerId: string | null,
): ProviderContactsState {
  const { activeRestaurantId } = useAuth();
  const [contacts, setContacts] = useState<ProviderContact[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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
    // Cleared before asking: another house's contacts must not be on screen
    // for a frame after a tenant switch.
    setContacts(null);
    setError(null);
    setLoading(true);

    apiClient
      .get<ProviderContact[]>(`/providers/${providerId}/contacts`)
      .then((res) => {
        if (cancelled || !alive.current) return;
        setContacts(Array.isArray(res.data) ? res.data : []);
      })
      .catch((e) => {
        if (cancelled || !alive.current) return;
        // The list stays NULL. An empty array here would render as "this vendor
        // has no contacts", which is a claim about the book made out of a failed
        // read.
        setError(getErrorMessage(e));
      })
      .finally(() => {
        if (cancelled || !alive.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [providerId, activeRestaurantId, nonce]);

  const setPhoneType = useCallback(
    async (contactId: string, phoneType: string): Promise<boolean> => {
      if (!providerId) return false;
      setSaving(contactId);
      setSaveError(null);
      try {
        const res = await apiClient.patch<ProviderContact>(
          `/providers/${providerId}/contacts/${contactId}`,
          { phoneType },
        );
        if (!alive.current) return true;
        // The SERVER's row replaces ours, including its `reach` and its
        // sentence. Patching the local object with the value we sent would show
        // a verdict nobody computed.
        setContacts((prev) =>
          prev
            ? prev.map((c) => (c.id === contactId ? { ...c, ...res.data } : c))
            : prev,
        );
        return true;
      } catch (e) {
        if (alive.current) setSaveError(getErrorMessage(e));
        return false;
      } finally {
        if (alive.current) setSaving(null);
      }
    },
    [providerId],
  );

  return {
    contacts,
    loading,
    error,
    saving,
    saveError,
    setPhoneType,
    reload: () => setNonce((n) => n + 1),
  };
}
