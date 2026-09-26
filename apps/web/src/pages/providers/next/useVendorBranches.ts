/**
 * One vendor's branches — offices, warehouses, stores — read and written from
 * the vendor sheet (founder, 2026-09-26, round 8, item 51; ADR 0221).
 *
 * WHY THIS EXISTS
 * ---------------
 * Until this hook, `GET/POST/PATCH/DELETE /providers/:id/locations` had two
 * callers, both legacy: `Providers.tsx` and `EditProviderModal.tsx`. The
 * legacy sheet held every branch in form state and, on save, re-synced the
 * whole list — delete what vanished, create what was new, PATCH everything
 * else. A failure anywhere in that sync was `console.error` and nothing else
 * (`Providers.tsx`, "Location sync failed"), so the person was told the vendor
 * was saved while a branch was not.
 *
 * Here each change is its own write, answered on its own, and after every
 * write the list is READ AGAIN rather than patched locally: making one branch
 * primary takes the mark off another, and removing the primary hands it on
 * (`providers.service.ts`, `deleteProviderLocation`), so the server's rows are
 * the only honest picture of what changed.
 *
 * Every route is house-scoped on the gateway (the vendor must be the caller's
 * house's; `provider-subresources-are-house-scoped.spec.ts`). Nothing here
 * names a house — the token does.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../../services/api/client';
import { useAuth } from '../../../contexts/AuthContext';
import {
  createProviderLocation,
  deleteProviderLocation,
  getProviderLocations,
  updateProviderLocation,
  type ProviderLocation,
} from '../../../services/api/providers';

/** What the add/edit form hands the hook. */
export interface BranchDraft {
  name: string;
  type: string;
  address: string;
  isPrimary?: boolean;
  /** Present only when the address was picked from the suggestions. */
  latitude?: number | null;
  longitude?: number | null;
}

/** `'new'` while a branch is being added; a branch id while that one is written. */
export type BranchBusy = 'new' | string | null;

export interface VendorBranchesState {
  /** Null until read. NEVER an invented empty list. */
  branches: ProviderLocation[] | null;
  loading: boolean;
  /** Why the read failed. Null when it did not. */
  error: string | null;
  busy: BranchBusy;
  /** Why the last write did not land. Null when it did. */
  saveError: string | null;
  /** A fact the last write produced that the person did not ask for. */
  notice: string | null;
  /** A write that landed but whose follow-on did not. */
  warning: string | null;
  add: (draft: BranchDraft) => Promise<boolean>;
  update: (id: string, draft: BranchDraft) => Promise<boolean>;
  makePrimary: (id: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  reload: () => void;
}

/** A class-validator 400 answers `message` as an array; say it as one line. */
function says(e: unknown): string {
  const m = getErrorMessage(e) as unknown;
  return Array.isArray(m) ? m.join('; ') : String(m);
}

function pair(d: BranchDraft): { latitude: number; longitude: number } | null {
  return typeof d.latitude === 'number' && typeof d.longitude === 'number'
    ? { latitude: d.latitude, longitude: d.longitude }
    : null;
}

/**
 * The PATCH body for an edit: only what changed. An address that changed is
 * sent with its point when it has one; sent without, the gateway clears the
 * old point rather than keep one resolved for the previous address.
 */
export function changesFrom(
  was: ProviderLocation,
  draft: BranchDraft,
): Partial<{ name: string; type: string; address: string; latitude: number; longitude: number }> {
  const out: Partial<{ name: string; type: string; address: string; latitude: number; longitude: number }> = {};
  const name = draft.name.trim();
  if (name !== was.name) out.name = name;
  if (draft.type !== was.type) out.type = draft.type;
  const address = draft.address.trim();
  if (address !== (was.address ?? '')) {
    out.address = address;
    const p = pair(draft);
    if (p) Object.assign(out, p);
  }
  return out;
}

export function useVendorBranches(providerId: string | null): VendorBranchesState {
  const { activeRestaurantId } = useAuth();
  const [branches, setBranches] = useState<ProviderLocation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BranchBusy>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
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
    // Cleared before asking: another house's branches must not be on screen
    // for a frame after a tenant switch.
    setBranches(null);
    setError(null);
    setLoading(true);

    getProviderLocations(providerId)
      .then((rows) => {
        if (cancelled || !alive.current) return;
        setBranches(Array.isArray(rows) ? rows : []);
      })
      .catch((e) => {
        if (cancelled || !alive.current) return;
        // The list stays NULL: an empty array would read as "this vendor has
        // no branches", a claim about the book made out of a failed read.
        setError(says(e));
      })
      .finally(() => {
        if (cancelled || !alive.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [providerId, activeRestaurantId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  /** Run one write; on success re-read, on failure say so and keep the list. */
  const write = useCallback(
    async (
      target: BranchBusy,
      run: () => Promise<{ notice?: string | null; warning?: string | null } | void>,
    ): Promise<boolean> => {
      if (!providerId) return false;
      setBusy(target);
      setSaveError(null);
      setNotice(null);
      setWarning(null);
      try {
        const said = await run();
        if (!alive.current) return true;
        if (said && said.notice) setNotice(said.notice);
        if (said && said.warning) setWarning(said.warning);
        reload();
        return true;
      } catch (e) {
        if (alive.current) setSaveError(says(e));
        return false;
      } finally {
        if (alive.current) setBusy(null);
      }
    },
    [providerId, reload],
  );

  const add = useCallback(
    (draft: BranchDraft) =>
      write('new', async () => {
        const address = draft.address.trim();
        await createProviderLocation(providerId as string, {
          name: draft.name.trim(),
          type: draft.type,
          ...(address ? { address } : {}),
          isPrimary: draft.isPrimary ?? false,
          ...(address ? pair(draft) ?? {} : {}),
        });
      }),
    [providerId, write],
  );

  const update = useCallback(
    (id: string, draft: BranchDraft) =>
      write(id, async () => {
        const was = branches?.find((b) => b.id === id);
        if (!was) throw new Error('That branch is no longer on the list. Read it again and retry.');
        const body = changesFrom(was, draft);
        if (Object.keys(body).length === 0) return;
        await updateProviderLocation(providerId as string, id, body);
      }),
    [providerId, write, branches],
  );

  const makePrimary = useCallback(
    (id: string) =>
      write(id, async () => {
        await updateProviderLocation(providerId as string, id, { isPrimary: true });
      }),
    [providerId, write],
  );

  const remove = useCallback(
    (id: string) =>
      write(id, async () => {
        const out = await deleteProviderLocation(providerId as string, id);
        if (out?.promotionFailed) {
          return {
            warning:
              'The branch was removed, but no other branch could be made primary, so none is marked now. Choose one below.',
          };
        }
        if (out?.promotedId) {
          const next = branches?.find((b) => b.id === out.promotedId);
          return {
            notice: `${next ? next.name : 'The oldest remaining branch'} is now the primary branch.`,
          };
        }
        return {};
      }),
    [providerId, write, branches],
  );

  return {
    branches,
    loading,
    error,
    busy,
    saveError,
    notice,
    warning,
    add,
    update,
    makePrimary,
    remove,
    reload,
  };
}
